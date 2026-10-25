import {
  audioClipEnd,
  captionBlockOutputRange,
  CUT_REASON_LABEL,
  keptCaptionWords,
  MIN_AUDIO_CLIP_SECONDS,
  MOTION_LABEL,
  motionSummary,
  outputDuration,
  placeMotions,
  retimeMotion,
  dropTarget,
  libraryDropTarget,
  mediaKindOf,
  mergeSelections,
  reviewSuggestions,
  selectionCount,
  selectionFromKeys,
  selectionHas,
  toggleInSelection,
  type DropTarget,
  type TimelineSelection,
  type TrackId,
  sourceToOutput,
  splitAudioClip,
  splitSegmentAt,
  type Asset,
  type AudioClip,
  type Motion,
  type Overlay,
  type Recipe,
  type Segment,
  type SuggestedCut,
  type VisualLayer,
} from "@vision/recipe";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  getFileWaveform,
  type FileWaveform,
  type FilmstripData,
  type ProjectFilmstrips,
  type ProjectWaveforms,
  type WaveformData,
} from "../api";
import { Icon } from "./Icon";
import { ASSET_DRAG_TYPE, ASSET_KIND_PREFIX } from "./LibraryPanel";

const MIN_SEGMENT = 0.1;
const HEAD_W = 148;
const MAX_ZOOM = 30;
/** Maior canvas de waveform desenhado; acima disso o CSS estica */
const MAX_WAVE_PX = 8000;

/** Maior canvas de filmstrip; acima disso os frames ficam esticados */
const MAX_FILM_PX = 16000;

const ROW = { ruler: 26, video: 64, clipAudio: 40, caption: 30, motion: 30, overlay: 30, music: 40, sfx: 34 };

/** Distância (px) em que bordas arrastadas grudam no playhead e em outras bordas */
const SNAP_PX = 6;

export type TimelineTool = "select" | "blade";

const LAYER_ROW: Record<VisualLayer, number> = {
  video: ROW.video,
  captions: ROW.caption,
  motions: ROW.motion,
  overlays: ROW.overlay,
};

function fileName(file: string): string {
  return file.split("/").pop() ?? file;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Posição de um bloco de legenda no vídeo final (null = trecho cortado) */
function blockOutputStart(
  segments: Segment[],
  sourceId: string | null,
  start: number
): number | null {
  return sourceId === null ? start : sourceToOutput(segments, sourceId, start);
}

function fmtRuler(sec: number, step: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  const ss = step < 1 ? s.toFixed(1).padStart(4, "0") : String(Math.round(s)).padStart(2, "0");
  return `${m}:${ss}`;
}

/** Intervalo entre marcas maiores: o menor que deixa ≥ 64px entre rótulos */
function rulerStep(pxPerSec: number): { major: number; minor: number } {
  const steps: [number, number][] = [
    [0.5, 5],
    [1, 4],
    [2, 4],
    [5, 5],
    [10, 5],
    [15, 3],
    [30, 6],
    [60, 6],
  ];
  for (const [major, div] of steps) {
    if (major * pxPerSec >= 64) return { major, minor: major / div };
  }
  return { major: 120, minor: 20 };
}

const WaveCanvas: React.FC<{
  waveform: WaveformData;
  sourceStart: number;
  sourceEnd: number;
  width: number;
  height: number;
  /** Depois do fim do arquivo, volta para sourceStart (clipe em loop) */
  loop?: boolean;
  color?: string;
}> = ({ waveform, sourceStart, sourceEnd, width, height, loop = false, color = "oklch(0.86 0.05 250 / 0.55)" }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const w = clamp(Math.floor(width), 1, MAX_WAVE_PX);
    canvas.width = w;
    canvas.height = height;
    ctx.clearRect(0, 0, w, height);
    ctx.fillStyle = color;
    // normaliza pelo pico máximo do clipe (o mais alto ocupa a altura toda)
    let maxPeak = 0.01;
    for (const p of waveform.peaks) if (p > maxPeak) maxPeak = p;
    const gain = Math.min(1 / maxPeak, 25);
    const firstBin = sourceStart * waveform.binsPerSecond;
    const binSpan = (sourceEnd - sourceStart) * waveform.binsPerSecond;
    const loopLen = waveform.peaks.length - firstBin;
    const mid = height / 2;
    for (let x = 0; x < w; x++) {
      let bin = Math.floor(firstBin + (x / w) * binSpan);
      if (loop && loopLen > 0 && bin >= waveform.peaks.length) {
        bin = Math.floor(firstBin + ((bin - firstBin) % loopLen));
      }
      const peak = Math.min((waveform.peaks[bin] ?? 0) * gain, 1);
      const barHalf = Math.max(Math.pow(peak, 0.7) * (mid - 1), 0.5);
      ctx.fillRect(x, mid - barHalf, 1, barHalf * 2);
    }
  }, [waveform, sourceStart, sourceEnd, width, height, loop, color]);
  return <canvas ref={ref} className="wave-canvas" style={{ height }} />;
};

/** Waveforms dos arquivos de música/SFX que estão na timeline */
function useFileWaveforms(files: string[]): Record<string, FileWaveform> {
  const [loaded, setLoaded] = useState<Record<string, FileWaveform>>({});
  const key = [...new Set(files)].sort().join("|");
  useEffect(() => {
    let alive = true;
    for (const file of key ? key.split("|") : []) {
      getFileWaveform(file)
        .then((w) => alive && setLoaded((prev) => (prev[file] ? prev : { ...prev, [file]: w })))
        .catch(() => {
          // sem waveform o clipe aparece liso
        });
    }
    return () => {
      alive = false;
    };
  }, [key]);
  return loaded;
}

// sprites ficam carregados entre renders/remontagens da timeline
const spriteCache = new Map<string, Promise<HTMLImageElement>>();

function loadSprite(url: string): Promise<HTMLImageElement> {
  let p = spriteCache.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => {
        spriteCache.delete(url);
        reject(new Error(`filmstrip não carregou: ${url}`));
      };
      img.src = url;
    });
    spriteCache.set(url, p);
  }
  return p;
}

/** Frames do bruto lado a lado; cada tile mostra o frame do instante sob ele */
const FilmCanvas: React.FC<{
  filmstrip: FilmstripData;
  sourceStart: number;
  sourceEnd: number;
  width: number;
  height: number;
}> = ({ filmstrip, sourceStart, sourceEnd, width, height }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  const [sprite, setSprite] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    let alive = true;
    loadSprite(filmstrip.url)
      .then((img) => alive && setSprite(img))
      .catch(() => alive && setSprite(null));
    return () => {
      alive = false;
    };
  }, [filmstrip.url]);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || !sprite) return;
    const dpr = window.devicePixelRatio || 1;
    const w = clamp(Math.floor(width * dpr), 1, MAX_FILM_PX);
    const h = Math.round(height * dpr);
    canvas.width = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    const frameW = sprite.naturalWidth / filmstrip.count;
    const frameH = sprite.naturalHeight;
    const tileW = Math.max(h * (frameW / frameH), 4);
    const span = sourceEnd - sourceStart;
    for (let x = 0; x < w; x += tileW) {
      // frame do instante no meio do tile
      const t = sourceStart + ((x + tileW / 2) / w) * span;
      const idx = clamp(Math.floor(t / filmstrip.interval), 0, filmstrip.count - 1);
      ctx.drawImage(sprite, idx * frameW, 0, frameW, frameH, x, 0, tileW, h);
    }
  }, [sprite, filmstrip, sourceStart, sourceEnd, width, height]);
  return <canvas ref={ref} className="film-canvas" style={{ height }} />;
};

interface TimelineProps {
  recipe: Recipe;
  waveforms: ProjectWaveforms | null;
  filmstrips: ProjectFilmstrips | null;
  playheadSeconds: number;
  selectedCaption: string | null;
  selectedOverlay: string | null;
  selectedMotion: string | null;
  onChange: (recipe: Recipe) => void;
  onSeek: (seconds: number) => void;
  onSelectCaption: (id: string | null) => void;
  onSelectOverlay: (id: string | null) => void;
  onSelectMotion: (id: string | null) => void;
  /** Item arrastado da biblioteca e solto num instante da timeline */
  onDropAsset: (asset: Asset, atSeconds: number) => void;
  tool: TimelineTool;
  onToolChange: (tool: TimelineTool) => void;
  selectedSegment: string | null;
  selectedAudioClip: string | null;
  onSelectSegment: (id: string | null) => void;
  onSelectAudioClip: (id: string | null) => void;
  /** Vários itens de uma vez (retângulo ou Shift/Ctrl+clique) */
  multiSelection: TimelineSelection | null;
  onMultiSelect: (s: TimelineSelection | null) => void;
  onDeleteMulti: () => void;
  /** Arquivos soltos do computador (vídeo, áudio, imagem), na trilha sob o cursor */
  onDropFiles: (files: File[], atSeconds: number, hovered: TrackId | null) => void;
}

export const Timeline: React.FC<TimelineProps> = ({
  recipe,
  waveforms,
  filmstrips,
  playheadSeconds,
  selectedCaption,
  selectedOverlay,
  selectedMotion,
  onChange,
  onSeek,
  onSelectCaption,
  onSelectOverlay,
  onSelectMotion,
  onDropAsset,
  tool,
  onToolChange,
  selectedSegment,
  selectedAudioClip,
  onSelectSegment,
  onSelectAudioClip,
  multiSelection,
  onMultiSelect,
  onDeleteMulti,
  onDropFiles,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  /** Retângulo de seleção em px do grid */
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const inMulti = (key: string) => (selectionHas(multiSelection, key) ? "multi" : "");
  const rulerRef = useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = useState(900);
  const [zoom, setZoom] = useState(1);
  /** Instante sob o cursor durante um arrastar da biblioteca */
  const [dropAt, setDropAt] = useState<number | null>(null);
  /** Trilha que vai receber o que está sendo arrastado (regra das camadas) */
  const [dropTrack, setDropTrack] = useState<DropTarget | null>(null);
  const trackAt = (el: EventTarget | null): TrackId | null =>
    ((el as HTMLElement | null)?.closest?.("[data-track]") as HTMLElement | null)?.dataset.track as TrackId | null ?? null;
  // clipe de vídeo leva o som junto: acende também a trilha "Áudio do vídeo"
  const laneDrop = (track: TrackId) =>
    dropTrack !== null && (dropTrack === track || (dropTrack === "video" && track === "videoAudio")) ? "drop-target" : "";
  /** Onde a ferramenta de corte cortaria (linha guia sob o cursor) */
  const [bladeAt, setBladeAt] = useState<number | null>(null);
  const fileWaves = useFileWaveforms(recipe.audioClips.map((c) => c.file));
  const pendingScroll = useRef<number | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewW(el.clientWidth);
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const segments = recipe.timeline.segments;
  const duration = Math.max(outputDuration(segments), 0.001);
  const laneW = Math.max(viewW - HEAD_W - 1, 120);
  const fitPps = (laneW - 24) / duration;
  const pxPerSec = fitPps * zoom;
  const contentW = Math.max(duration * pxPerSec + 24, laneW);
  const multiClip = recipe.sources.length > 1;
  /** Nome do arquivo enviado (sem extensão) ou o id em projetos antigos */
  const sourceLabel = (id: string) =>
    recipe.sources.find((s) => s.id === id)?.name?.replace(/\.[^.]+$/, "") || id;

  // Ctrl/⌘ + roda = zoom ancorado no cursor (listener nativo: precisa de passive:false)
  const zoomRef = useRef({ zoom, fitPps });
  zoomRef.current = { zoom, fitPps };
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const { zoom: z, fitPps: fit } = zoomRef.current;
      const rect = el.getBoundingClientRect();
      const cursorInLane = e.clientX - rect.left - HEAD_W;
      const t = (cursorInLane + el.scrollLeft) / (fit * z);
      const next = clamp(z * (e.deltaY < 0 ? 1.18 : 1 / 1.18), 1, MAX_ZOOM);
      pendingScroll.current = t * fit * next - cursorInLane;
      setZoom(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && pendingScroll.current !== null) {
      el.scrollLeft = Math.max(0, pendingScroll.current);
      pendingScroll.current = null;
    }
  }, [zoom]);

  // playhead saiu da área visível (reprodução/seek): rola junto
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const x = playheadSeconds * pxPerSec;
    if (x < el.scrollLeft || x > el.scrollLeft + laneW - 32) {
      el.scrollLeft = Math.max(0, x - laneW * 0.2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playheadSeconds]);

  const zoomTo = (next: number) => {
    const el = scrollRef.current;
    const z = clamp(next, 1, MAX_ZOOM);
    if (el) {
      // mantém o playhead no mesmo lugar da tela
      const screenX = playheadSeconds * pxPerSec - el.scrollLeft;
      pendingScroll.current = playheadSeconds * fitPps * z - screenX;
    }
    setZoom(z);
  };

  const timeAt = (clientX: number) => {
    const left = rulerRef.current?.getBoundingClientRect().left ?? 0;
    return clamp((clientX - left) / pxPerSec, 0, duration);
  };

  const startScrub = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    onSeek(timeAt(e.clientX));
    const onMove = (ev: PointerEvent) => onSeek(timeAt(ev.clientX));
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  /**
   * Fundo vazio de uma trilha: clique = seek; arrastar = retângulo que
   * seleciona tudo o que tocar (Shift/Ctrl soma à seleção atual).
   */
  const laneDown = (e: React.PointerEvent) => {
    const t = e.target as HTMLElement;
    if (e.button !== 0 || (t !== e.currentTarget && !t.classList.contains("lane-empty"))) return;
    const grid = gridRef.current;
    if (tool === "blade" || !grid) return startScrub(e);
    e.preventDefault();
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const base = additive ? multiSelection : null;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let active = false;
    const onMove = (ev: PointerEvent) => {
      if (!active && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return;
      active = true;
      const g = grid.getBoundingClientRect();
      const r = {
        left: Math.min(x0, ev.clientX),
        right: Math.max(x0, ev.clientX),
        top: Math.min(y0, ev.clientY),
        bottom: Math.max(y0, ev.clientY),
      };
      setMarquee({ x: r.left - g.left, y: r.top - g.top, w: r.right - r.left, h: r.bottom - r.top });
      const keys = Array.from(grid.querySelectorAll<HTMLElement>("[data-sel]"))
        .filter((el) => {
          const b = el.getBoundingClientRect();
          return b.right > r.left && b.left < r.right && b.bottom > r.top && b.top < r.bottom;
        })
        .map((el) => el.dataset.sel!);
      const hit = selectionFromKeys(keys);
      onMultiSelect(base ? mergeSelections(base, hit) : selectionCount(hit) > 0 ? hit : null);
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setMarquee(null);
      if (!active) {
        if (!additive) onMultiSelect(null);
        onSeek(timeAt(ev.clientX));
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  /** Shift/Ctrl+clique num bloco: põe ou tira da seleção (sem arrastar nem abrir) */
  const modifierTarget = (e: React.PointerEvent | React.MouseEvent): HTMLElement | null => {
    if (!(e.shiftKey || e.ctrlKey || e.metaKey) || e.button !== 0 || tool === "blade") return null;
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-sel]");
    if (!el || !gridRef.current?.contains(el)) return null;
    e.preventDefault();
    e.stopPropagation();
    return el;
  };

  const setSegments = (next: Segment[]) =>
    onChange({ ...recipe, timeline: { ...recipe.timeline, segments: next } });

  const startEdgeDrag = (e: React.PointerEvent, index: number, edge: "start" | "end") => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const orig = segments.map((s) => ({ ...s }));
    const sourceDur =
      recipe.sources.find((s) => s.id === orig[index].sourceId)?.durationInSeconds ?? Infinity;
    const onMove = (ev: PointerEvent) => {
      const deltaSec = (ev.clientX - startX) / pxPerSec;
      const next = orig.map((s) => ({ ...s }));
      const seg = next[index];
      if (edge === "start") {
        seg.sourceStart = round2(
          clamp(orig[index].sourceStart + deltaSec, 0, seg.sourceEnd - MIN_SEGMENT)
        );
      } else {
        seg.sourceEnd = round2(
          clamp(orig[index].sourceEnd + deltaSec, seg.sourceStart + MIN_SEGMENT, sourceDur)
        );
      }
      setSegments(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const setOverlays = (next: Overlay[]) => onChange({ ...recipe, overlays: next });

  /**
   * Arrasta/redimensiona um overlay direto na timeline (tempo do vídeo final).
   * "move" desloca preservando a duração; "start"/"end" ajustam as bordas.
   * Se não houve arrasto real, trata como clique (seleciona/desseleciona).
   */
  const startOverlayDrag = (e: React.PointerEvent, id: string, mode: "move" | "start" | "end") => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const orig = recipe.overlays.map((o) => ({ ...o }));
    const idx = orig.findIndex((o) => o.id === id);
    if (idx < 0) return;
    const o0 = orig[idx];
    const end0 = o0.end ?? duration;
    const dur0 = Math.max(end0 - o0.start, MIN_SEGMENT);
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - startX) > 3) moved = true;
      const deltaSec = (ev.clientX - startX) / pxPerSec;
      const next = orig.map((o) => ({ ...o }));
      const o = next[idx];
      if (mode === "move") {
        const start = round2(clamp(o0.start + deltaSec, 0, duration - dur0));
        o.start = start;
        if (o0.end !== null) o.end = round2(start + dur0);
      } else if (mode === "start") {
        o.start = round2(clamp(o0.start + deltaSec, 0, end0 - MIN_SEGMENT));
      } else {
        o.end = round2(clamp(end0 + deltaSec, o0.start + MIN_SEGMENT, duration));
      }
      setOverlays(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (!moved) onSelectOverlay(id === selectedOverlay ? null : id);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const moveSegment = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= segments.length) return;
    const next = [...segments];
    [next[index], next[target]] = [next[target], next[index]];
    setSegments(next);
  };

  // ─── Ferramenta de corte ───────────────────────────────────────────

  /** Instante do corte: gruda no playhead quando passa perto dele */
  const bladeTime = (clientX: number) => {
    const t = timeAt(clientX);
    return Math.abs(t - playheadSeconds) * pxPerSec < SNAP_PX ? playheadSeconds : t;
  };

  const bladeSegment = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSegments(splitSegmentAt(segments, bladeTime(e.clientX)));
  };

  const setAudioClips = (next: AudioClip[]) => onChange({ ...recipe, audioClips: next });

  const bladeAudioClip = (e: React.PointerEvent, clip: AudioClip) => {
    e.preventDefault();
    e.stopPropagation();
    const parts = splitAudioClip(clip, bladeTime(e.clientX), `aud_${Date.now().toString(36)}`);
    if (!parts) return;
    setAudioClips(recipe.audioClips.flatMap((c) => (c.id === clip.id ? parts : [c])));
  };

  /** Clique num trecho de vídeo (ou no áudio dele): corta ou seleciona */
  const segmentPointerDown = (e: React.PointerEvent, seg: Segment) => {
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    if (tool === "blade") return bladeSegment(e);
    e.stopPropagation();
    onSelectSegment(seg.id === selectedSegment ? null : seg.id);
  };

  // ─── Clipes de áudio: mover, aparar, selecionar ─────────────────────

  /** Bordas para onde um clipe arrastado gruda */
  const snapPoints = (exceptId: string) => {
    const pts = [0, duration, playheadSeconds, ...segmentPositions];
    for (const c of recipe.audioClips) {
      if (c.id !== exceptId) pts.push(c.start, audioClipEnd(c));
    }
    return pts;
  };

  const snap = (t: number, points: number[]) => {
    let best = t;
    let bestPx = SNAP_PX;
    for (const p of points) {
      const px = Math.abs(p - t) * pxPerSec;
      if (px < bestPx) {
        best = p;
        bestPx = px;
      }
    }
    return best;
  };

  const startAudioDrag = (
    e: React.PointerEvent,
    clip: AudioClip,
    mode: "move" | "start" | "end",
    mediaDuration: number | null
  ) => {
    if (e.button !== 0) return;
    if (tool === "blade") return bladeAudioClip(e, clip);
    e.preventDefault();
    e.stopPropagation();
    onSelectAudioClip(clip.id);
    const startX = e.clientX;
    const points = snapPoints(clip.id);
    const end0 = audioClipEnd(clip);
    // sem loop, o clipe não passa do fim do arquivo
    const maxEnd = clip.loop || mediaDuration === null ? Infinity : clip.start + (mediaDuration - clip.offset);
    const minStart = clip.loop ? 0 : Math.max(0, clip.start - clip.offset);
    const onMove = (ev: PointerEvent) => {
      const deltaSec = (ev.clientX - startX) / pxPerSec;
      let next: AudioClip;
      if (mode === "move") {
        let start = clip.start + deltaSec;
        // gruda pelo início ou pelo fim, o que estiver mais perto de uma borda
        const byStart = snap(start, points) - start;
        const byEnd = snap(start + clip.duration, points) - (start + clip.duration);
        if (byStart !== 0 && (byEnd === 0 || Math.abs(byStart) <= Math.abs(byEnd))) start += byStart;
        else start += byEnd;
        next = { ...clip, start: round2(clamp(start, 0, Math.max(duration - MIN_AUDIO_CLIP_SECONDS, 0))) };
      } else if (mode === "start") {
        const start = round2(clamp(snap(clip.start + deltaSec, points), minStart, end0 - MIN_AUDIO_CLIP_SECONDS));
        const moved = start - clip.start;
        next = {
          ...clip,
          start,
          duration: round2(end0 - start),
          offset: round2(Math.max(0, clip.offset + moved)),
        };
      } else {
        const end = round2(clamp(snap(end0 + deltaSec, points), clip.start + MIN_AUDIO_CLIP_SECONDS, maxEnd));
        next = { ...clip, duration: round2(end - clip.start) };
      }
      setAudioClips(recipe.audioClips.map((c) => (c.id === clip.id ? next : c)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // ─── Motions: adiantar, atrasar, aparar ────────────────────────────

  /** Inícios das palavras no vídeo final: motions costumam nascer numa palavra */
  const wordStarts = () => {
    const pts: number[] = [];
    for (const b of recipe.captions.blocks) {
      for (const w of b.words) {
        const t = blockOutputStart(segments, b.sourceId, w.start);
        if (t !== null) pts.push(t);
      }
    }
    return pts;
  };

  const startMotionDrag = (
    e: React.PointerEvent,
    m: Motion,
    outputStart: number,
    mode: "move" | "start" | "end"
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    onSelectMotion(m.id);
    const startX = e.clientX;
    const end0 = outputStart + m.durationSeconds;
    const points = [
      0,
      duration,
      playheadSeconds,
      ...segmentPositions,
      ...wordStarts(),
      ...placedMotions
        .filter((p) => p.motion.id !== m.id)
        .flatMap((p) => [p.outputStart, p.outputEnd]),
    ];
    const onMove = (ev: PointerEvent) => {
      const deltaSec = (ev.clientX - startX) / pxPerSec;
      if (Math.abs(ev.clientX - startX) < 3) return;
      let start = outputStart;
      let dur = m.durationSeconds;
      if (mode === "move") {
        start = outputStart + deltaSec;
        // gruda pelo início ou pelo fim, o que estiver mais perto de uma borda
        const byStart = snap(start, points) - start;
        const byEnd = snap(start + dur, points) - (start + dur);
        if (byStart !== 0 && (byEnd === 0 || Math.abs(byStart) <= Math.abs(byEnd))) start += byStart;
        else start += byEnd;
      } else if (mode === "start") {
        start = Math.min(snap(outputStart + deltaSec, points), end0 - 0.1);
        dur = end0 - start;
      } else {
        dur = snap(end0 + deltaSec, points) - outputStart;
      }
      onChange(retimeMotion(recipe, m.id, start, dur));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const reviewSuggestion = (cut: SuggestedCut, accept: boolean) =>
    onChange(reviewSuggestions(recipe, [cut.id], accept));

  let cursor = 0;
  const segmentPositions = segments.map((s) => {
    const left = cursor;
    cursor += s.sourceEnd - s.sourceStart;
    return left;
  });

  const pendingCuts = recipe.timeline.suggestedCuts.filter((c) => c.status === "pending");
  const placedMotions = placeMotions(recipe, true);
  const spoken = recipe.captions.blocks.length;

  const { major, minor } = rulerStep(pxPerSec);
  const ticks: React.ReactNode[] = [];
  for (let i = 0, t = 0; t <= duration + 1e-6; i++, t = i * minor) {
    const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
    const left = t * pxPerSec;
    ticks.push(<span key={`t${i}`} className={`tick ${isMajor ? "major" : "minor"}`} style={{ left }} />);
    if (isMajor) {
      ticks.push(
        <span key={`l${i}`} className="tick-label" style={{ left }}>
          {fmtRuler(t, major)}
        </span>
      );
    }
  }

const musicClips = recipe.audioClips.filter((c) => c.kind === "music");
  const sfxClips = recipe.audioClips.filter((c) => c.kind === "sfx");

  const renderAudioClip = (c: AudioClip) => {
    const wave = fileWaves[c.file];
    const mediaDuration = wave?.durationSeconds ?? c.mediaDurationSeconds;
    const width = c.duration * pxPerSec;
    const drag = (mode: "move" | "start" | "end") => (e: React.PointerEvent) =>
      startAudioDrag(e, c, mode, mediaDuration);
    return (
      <div
        key={c.id}
        data-sel={`audio:${c.id}`}
        className={`clip aclip kind-${c.kind} ${c.motionId ? "linked" : ""} ${c.status === "pending" ? "pending" : ""} ${selectedAudioClip === c.id ? "selected" : ""} ${inMulti(`audio:${c.id}`)}`}
        style={{ left: c.start * pxPerSec, width: Math.max(width, 4) }}
        title={`${c.status === "pending" ? "Sugestão da IA (só no preview até aceitar) · " : ""}${fileName(c.file)} · ${c.start.toFixed(2)}s → ${audioClipEnd(c).toFixed(2)}s · ${Math.round(c.volume * 100)}%${c.loop ? " · loop" : ""}${c.motionId ? " · som de motion (acompanha o motion)" : ""}`}
        onPointerDown={drag("move")}
      >
        {wave && (
          <WaveCanvas
            waveform={wave}
            sourceStart={c.offset}
            sourceEnd={c.offset + c.duration}
            width={width}
            height={(c.kind === "music" ? ROW.music : ROW.sfx) - 10}
            loop={c.loop}
            color={c.kind === "music" ? "oklch(0.86 0.11 155 / 0.75)" : "oklch(0.9 0.12 80 / 0.8)"}
          />
        )}
        {width > 40 && (
          <span className="clip-label">
            {c.status === "pending" ? "sugestão · " : c.motionId ? "♪ " : ""}
            {fileName(c.file)}
          </span>
        )}
        <div className="handle handle-l" onPointerDown={drag("start")} />
        <div className="handle handle-r" onPointerDown={drag("end")} />
      </div>
    );
  };

  const zoomSlider = Math.log(zoom) / Math.log(MAX_ZOOM);

  const moveLayer = (layer: VisualLayer, delta: -1 | 1) => {
    const order = [...recipe.layerOrder];
    const i = order.indexOf(layer);
    const j = i + delta;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    onChange({ ...recipe, layerOrder: order });
  };

  const head = (cls: string, name: string, meta: React.ReactNode, layer?: VisualLayer) => {
    const i = layer ? recipe.layerOrder.indexOf(layer) : -1;
    return (
      <div className={`tl-head ${cls}`}>
        <span className="th-swatch" />
        <span className="th-name">{name}</span>
        <span className="th-meta">{meta}</span>
        {layer && (
          <span className="th-order">
            <button
              className="icon ghost"
              title="Subir: passa na frente da camada de cima"
              disabled={i === 0}
              onClick={() => moveLayer(layer, -1)}
            >
              <Icon name="chevronUp" size={12} />
            </button>
            <button
              className="icon ghost"
              title="Descer: vai para trás da camada de baixo"
              disabled={i === recipe.layerOrder.length - 1}
              onClick={() => moveLayer(layer, 1)}
            >
              <Icon name="chevronDown" size={12} />
            </button>
          </span>
        )}
      </div>
    );
  };

  // trilhas visuais: renderizadas na ordem de layerOrder (a de cima cobre a de baixo)
  const visualLanes: Record<VisualLayer, React.ReactNode> = {
    video: (
      <>
        {/* vídeo */}
        {head("trk-video", "Vídeo", segments.length, "video")}
        <div className={`tl-lane ${laneDrop("video")}`} data-track="video" onPointerDown={laneDown}>
          {segments.map((seg, i) => {
            const width = (seg.sourceEnd - seg.sourceStart) * pxPerSec;
            return (
              <div
                key={seg.id}
                data-sel={`segment:${seg.id}`}
                className={`clip ${selectedSegment === seg.id ? "selected" : ""} ${inMulti(`segment:${seg.id}`)}`}
                style={{ left: segmentPositions[i] * pxPerSec, width }}
                title={`${sourceLabel(seg.sourceId)} · ${seg.sourceStart.toFixed(2)}s → ${seg.sourceEnd.toFixed(2)}s (bruto)`}
                onPointerDown={(e) => segmentPointerDown(e, seg)}
              >
                {filmstrips?.[seg.sourceId] && (
                  <FilmCanvas
                    filmstrip={filmstrips[seg.sourceId]}
                    sourceStart={seg.sourceStart}
                    sourceEnd={seg.sourceEnd}
                    width={width}
                    height={ROW.video - 10}
                  />
                )}
                {width > 46 && (
                  <span className="clip-label">
                    {multiClip ? `${sourceLabel(seg.sourceId)} · ` : ""}
                    {(seg.sourceEnd - seg.sourceStart).toFixed(1)}s
                  </span>
                )}
                <div className="handle handle-l" onPointerDown={(e) => startEdgeDrag(e, i, "start")} />
                {multiClip && (
                  <span className="clip-move" onPointerDown={(e) => e.stopPropagation()}>
                    <button title="Mover para a esquerda" onClick={() => moveSegment(i, -1)}>
                      <Icon name="chevronLeft" size={12} />
                    </button>
                    <button title="Mover para a direita" onClick={() => moveSegment(i, 1)}>
                      <Icon name="chevronRight" size={12} />
                    </button>
                  </span>
                )}
                <div className="handle handle-r" onPointerDown={(e) => startEdgeDrag(e, i, "end")} />
              </div>
            );
          })}
          {pendingCuts.map((cut) => {
            const outStart = sourceToOutput(segments, cut.sourceId, cut.sourceStart);
            if (outStart === null) return null;
            return (
              <div
                key={cut.id}
                className={`cut-sug reason-${cut.reason}`}
                style={{
                  left: outStart * pxPerSec,
                  width: Math.max((cut.sourceEnd - cut.sourceStart) * pxPerSec, 40),
                }}
                title={`${CUT_REASON_LABEL[cut.reason]} · confiança ${cut.confidence}${cut.note ? ` · ${cut.note}` : ""}`}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <span className="cut-sug-actions">
                  <button className="ok" title="Aceitar corte" onClick={() => reviewSuggestion(cut, true)}>
                    <Icon name="check" size={11} />
                  </button>
                  <button className="no" title="Rejeitar" onClick={() => reviewSuggestion(cut, false)}>
                    <Icon name="x" size={11} />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      </>
    ),
    captions: (
      <>
        {/* legenda */}
        {head("trk-caption", "Legenda", spoken, "captions")}
        <div className={`tl-lane alt ${laneDrop("captions")}`} data-track="captions" onPointerDown={laneDown}>
          {spoken === 0 && <span className="lane-empty">Transcreva para gerar a legenda</span>}
          {recipe.captions.blocks.map((block) => {
            // mesma regra do preview: palavra cortada some, o resto do bloco fica
            const range = captionBlockOutputRange(segments, block);
            if (range === null) return null;
            const { start, end } = range;
            const text = keptCaptionWords(segments, block)
              .map((w) => w.text)
              .join(" ");
            return (
              <div
                key={block.id}
                data-sel={`caption:${block.id}`}
                className={`blk cap-blk ${selectedCaption === block.id ? "selected" : ""} ${block.sourceId === null ? "narration" : ""} ${inMulti(`caption:${block.id}`)}`}
                style={{ left: start * pxPerSec, width: Math.max((end - start) * pxPerSec, 10) }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onSelectCaption(block.id === selectedCaption ? null : block.id)}
                title={text}
              >
                {text}
              </div>
            );
          })}
        </div>
      </>
    ),
    motions: (
      <>
        {/* motions */}
        {head(
        "trk-motion",
        "Motions",
        recipe.motions.filter((m) => m.status !== "rejected").length,
        "motions"
        )}
        <div className={`tl-lane ${laneDrop("motions")}`} data-track="motions" onPointerDown={laneDown}>
          {placedMotions.length === 0 && <span className="lane-empty">Sem motions</span>}
          {placedMotions.map(({ motion: m, outputStart }) => (
            <div
              key={m.id}
              data-sel={`motion:${m.id}`}
              className={`blk mo-blk kind-${m.kind} status-${m.status} ${selectedMotion === m.id ? "selected" : ""} ${inMulti(`motion:${m.id}`)}`}
              style={{
                left: outputStart * pxPerSec,
                width: Math.max(m.durationSeconds * pxPerSec, 12),
              }}
              title={`${MOTION_LABEL[m.kind]}${m.status === "pending" ? " (sugestão)" : ""} · ${motionSummary(m)}${m.note ? ` · ${m.note}` : ""}`}
              onPointerDown={(e) => startMotionDrag(e, m, outputStart, "move")}
            >
              <div className="handle handle-l" onPointerDown={(e) => startMotionDrag(e, m, outputStart, "start")} />
              {motionSummary(m) || MOTION_LABEL[m.kind]}
              <div className="handle handle-r" onPointerDown={(e) => startMotionDrag(e, m, outputStart, "end")} />
            </div>
          ))}
        </div>
      </>
    ),
    overlays: (
      <>
        {/* overlays */}
        {head("trk-overlay", "Overlays", recipe.overlays.length, "overlays")}
        <div className={`tl-lane alt ${laneDrop("overlays")}`} data-track="overlays" onPointerDown={laneDown}>
          {recipe.overlays.length === 0 && <span className="lane-empty">Sem overlays</span>}
          {recipe.overlays.map((o) => {
            const end = o.end ?? duration;
            return (
              <div
                key={o.id}
                data-sel={`overlay:${o.id}`}
                className={`blk ov-blk ${selectedOverlay === o.id ? "selected" : ""} ${inMulti(`overlay:${o.id}`)}`}
                style={{ left: o.start * pxPerSec, width: Math.max((end - o.start) * pxPerSec, 16) }}
                onPointerDown={(e) => startOverlayDrag(e, o.id, "move")}
                title={o.kind === "title" ? o.text : (o.file ?? "")}
              >
                <div className="handle handle-l" onPointerDown={(e) => startOverlayDrag(e, o.id, "start")} />
                {o.text || o.file?.split("/").pop()}
                <div className="handle handle-r" onPointerDown={(e) => startOverlayDrag(e, o.id, "end")} />
              </div>
            );
          })}
        </div>
      </>
    ),
  };


  return (
    <div className="timeline">
      <div className="tl-toolbar">
        <span className="tl-stats">
          {segments.length} {segments.length === 1 ? "trecho" : "trechos"} ·{" "}
          {pendingCuts.length > 0 ? `${pendingCuts.length} cortes sugeridos · ` : ""}
          {duration.toFixed(1)}s no corte
        </span>
        {pendingCuts.length > 0 && (
          <button
            className="sm primary"
            title="Aceita todas as sugestões de corte pendentes"
            onClick={() => onChange(reviewSuggestions(recipe, pendingCuts.map((c) => c.id), true))}
          >
            <Icon name="check" size={13} />
            Aprovar todos os cortes ({pendingCuts.length})
          </button>
        )}
        {multiSelection && selectionCount(multiSelection) > 0 && (
          <span className="tl-multi">
            <strong>{selectionCount(multiSelection)}</strong>&nbsp;selecionado(s)
            {multiSelection.segments.length > 0 && multiSelection.segments.length >= segments.length && (
              <span className="tl-multi-note" title="O vídeo precisa de ao menos um trecho">
                &nbsp;· trechos ficam
              </span>
            )}
            <button className="sm danger" title="Apaga tudo o que está selecionado (Delete) · Ctrl+Z desfaz" onClick={onDeleteMulti}>
              <Icon name="trash" size={13} /> Apagar
            </button>
            <button className="sm icon ghost" title="Limpar seleção (Esc)" onClick={() => onMultiSelect(null)}>
              <Icon name="x" size={13} />
            </button>
          </span>
        )}
        <div className="tl-tools" role="radiogroup" aria-label="Ferramenta">
          <button
            className={`sm icon ghost ${tool === "select" ? "active" : ""}`}
            role="radio"
            aria-checked={tool === "select"}
            title="Seleção (V): clique seleciona, arraste move · arraste no fundo seleciona vários · Shift/Ctrl+clique soma · Delete apaga · Ctrl+D duplica"
            onClick={() => onToolChange("select")}
          >
            <Icon name="pointer" size={15} />
          </button>
          <button
            className={`sm icon ghost ${tool === "blade" ? "active" : ""}`}
            role="radio"
            aria-checked={tool === "blade"}
            title="Corte (C): clique num trecho de vídeo ou áudio para dividir"
            onClick={() => onToolChange("blade")}
          >
            <Icon name="scissors" size={15} />
          </button>
        </div>
        <div className="tl-zoom">
          <button className="sm icon ghost" title="Diminuir zoom" onClick={() => zoomTo(zoom / 1.4)}>
            <Icon name="zoomOut" size={15} />
          </button>
          <div className="slider">
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={zoomSlider}
              aria-label="Zoom da timeline"
              style={{ "--fill": `${zoomSlider * 100}%` } as React.CSSProperties}
              onChange={(e) => zoomTo(Math.pow(MAX_ZOOM, Number(e.target.value)))}
            />
          </div>
          <button className="sm icon ghost" title="Aumentar zoom (Ctrl + roda)" onClick={() => zoomTo(zoom * 1.4)}>
            <Icon name="zoomIn" size={15} />
          </button>
          <button className="sm ghost" title="Ajustar à largura" onClick={() => zoomTo(1)} disabled={zoom === 1}>
            <Icon name="fit" size={14} /> Ajustar
          </button>
        </div>
      </div>

      <div
        className={`tl-scroll ${dropAt !== null ? "dropping" : ""} ${tool === "blade" ? "tool-blade" : ""}`}
        ref={scrollRef}
        onPointerMove={(e) => {
          if (tool === "blade") setBladeAt(bladeTime(e.clientX));
        }}
        onPointerLeave={() => setBladeAt(null)}
        onDragOver={(e) => {
          const types = Array.from(e.dataTransfer.types);
          const isAsset = types.includes(ASSET_DRAG_TYPE);
          if (!isAsset && !types.includes("Files")) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setDropAt(timeAt(e.clientX));
          if (isAsset) {
            const kind = types.find((t) => t.startsWith(ASSET_KIND_PREFIX))?.slice(ASSET_KIND_PREFIX.length);
            setDropTrack(kind ? libraryDropTarget(kind) : null);
          } else {
            const item = e.dataTransfer.items[0];
            const kind = item ? mediaKindOf("", item.type) : null;
            setDropTrack(kind ? dropTarget(kind, trackAt(e.target), null) : null);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDropAt(null);
            setDropTrack(null);
          }
        }}
        onDrop={(e) => {
          setDropAt(null);
          setDropTrack(null);
          if (e.dataTransfer.files.length > 0) {
            e.preventDefault();
            onDropFiles(Array.from(e.dataTransfer.files), timeAt(e.clientX), trackAt(e.target));
            return;
          }
          const raw = e.dataTransfer.getData(ASSET_DRAG_TYPE);
          if (!raw) return;
          e.preventDefault();
          try {
            onDropAsset(JSON.parse(raw) as Asset, timeAt(e.clientX));
          } catch {
            // payload inválido: ignora
          }
        }}
      >
        <div
          className="tl-grid"
          ref={gridRef}
          onPointerDownCapture={(e) => {
            const el = modifierTarget(e);
            if (el) onMultiSelect(toggleInSelection(multiSelection, el.dataset.sel!));
          }}
          // o clique que vem depois não abre o item (a legenda seleciona no click)
          onClickCapture={(e) => void modifierTarget(e)}
          style={{
            gridTemplateColumns: `${HEAD_W}px ${contentW}px`,
            gridTemplateRows: [
              ROW.ruler,
              ...recipe.layerOrder.map((l) => LAYER_ROW[l]),
              ROW.clipAudio,
              ROW.music,
              ROW.sfx,
            ]
              .map((h) => `${h}px`)
              .join(" "),
          }}
        >
          {/* régua */}
          <div className="tl-head ruler-head">tempo</div>
          <div className="tl-ruler" ref={rulerRef} onPointerDown={startScrub}>
            {ticks}
          </div>

          {recipe.layerOrder.map((layer) => (
            <React.Fragment key={layer}>{visualLanes[layer]}</React.Fragment>
          ))}

          {/* áudio do vídeo: mesmos trechos da trilha de vídeo (cortar um corta o outro) */}
          {head("trk-video-audio", "Áudio do vídeo", recipe.audio.useEnhanced ? "tratado" : "")}
          <div className={`tl-lane ${laneDrop("videoAudio")}`} data-track="videoAudio" onPointerDown={laneDown}>
            {segments.map((seg, i) => {
              const width = (seg.sourceEnd - seg.sourceStart) * pxPerSec;
              return (
                <div
                  key={seg.id}
                  data-sel={`segment:${seg.id}`}
                  className={`clip clip-audio ${selectedSegment === seg.id ? "selected" : ""} ${inMulti(`segment:${seg.id}`)}`}
                  style={{ left: segmentPositions[i] * pxPerSec, width }}
                  title={`Áudio de ${sourceLabel(seg.sourceId)} · ${seg.sourceStart.toFixed(2)}s → ${seg.sourceEnd.toFixed(2)}s (bruto)`}
                  onPointerDown={(e) => segmentPointerDown(e, seg)}
                >
                  {waveforms?.[seg.sourceId] && (
                    <WaveCanvas
                      waveform={waveforms[seg.sourceId]}
                      sourceStart={seg.sourceStart}
                      sourceEnd={seg.sourceEnd}
                      width={width}
                      height={ROW.clipAudio - 10}
                    />
                  )}
                  <div className="handle handle-l" onPointerDown={(e) => startEdgeDrag(e, i, "start")} />
                  <div className="handle handle-r" onPointerDown={(e) => startEdgeDrag(e, i, "end")} />
                </div>
              );
            })}
          </div>

          {/* música e efeitos: clipes soltos no tempo do vídeo final */}
          {head(
            "trk-audio",
            "Música",
            recipe.audio.narration ? "+ narração" : musicClips.length || ""
          )}
          <div className={`tl-lane ${laneDrop("music")}`} data-track="music" onPointerDown={laneDown}>
            {musicClips.length === 0 && (
              <span className="lane-empty">Arraste uma música da Biblioteca para cá</span>
            )}
            {musicClips.map(renderAudioClip)}
          </div>

          {head("trk-sfx", "Efeitos", sfxClips.length || "")}
          <div className={`tl-lane alt ${laneDrop("sfx")}`} data-track="sfx" onPointerDown={laneDown}>
            {sfxClips.length === 0 && <span className="lane-empty">Arraste efeitos sonoros para cá</span>}
            {sfxClips.map(renderAudioClip)}
          </div>

          {marquee && (
            <div className="tl-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />
          )}

          {/* playhead: camada sobre todas as trilhas, abaixo dos cabeçalhos */}
          <div className="tl-ph-layer">
            <div className="tl-playhead" style={{ left: clamp(playheadSeconds, 0, duration) * pxPerSec }}>
              <span className="tl-playhead-head" />
            </div>
            {dropAt !== null && <div className="tl-drop" style={{ left: dropAt * pxPerSec }} />}
            {tool === "blade" && bladeAt !== null && (
              <div className="tl-blade" style={{ left: bladeAt * pxPerSec }} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
