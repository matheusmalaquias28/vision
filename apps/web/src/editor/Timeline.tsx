import {
  CUT_REASON_LABEL,
  MOTION_LABEL,
  motionSummary,
  outputDuration,
  placeMotions,
  reviewSuggestions,
  sourceToOutput,
  type Asset,
  type Overlay,
  type Recipe,
  type Segment,
  type SuggestedCut,
} from "@vision/recipe";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ProjectWaveforms, WaveformData } from "../api";
import { Icon } from "./Icon";
import { ASSET_DRAG_TYPE } from "./LibraryPanel";

const MIN_SEGMENT = 0.1;
const HEAD_W = 148;
const MAX_ZOOM = 30;
/** Maior canvas de waveform desenhado; acima disso o CSS estica */
const MAX_WAVE_PX = 8000;

const ROW = { ruler: 26, video: 72, caption: 30, motion: 30, overlay: 30, audio: 36 };

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
}> = ({ waveform, sourceStart, sourceEnd, width, height }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const w = clamp(Math.floor(width), 1, MAX_WAVE_PX);
    canvas.width = w;
    canvas.height = height;
    ctx.clearRect(0, 0, w, height);
    ctx.fillStyle = "oklch(0.86 0.05 250 / 0.55)";
    // normaliza pelo pico máximo do clipe (o mais alto ocupa a altura toda)
    let maxPeak = 0.01;
    for (const p of waveform.peaks) if (p > maxPeak) maxPeak = p;
    const gain = Math.min(1 / maxPeak, 25);
    const firstBin = sourceStart * waveform.binsPerSecond;
    const binSpan = (sourceEnd - sourceStart) * waveform.binsPerSecond;
    const mid = height / 2;
    for (let x = 0; x < w; x++) {
      const bin = Math.floor(firstBin + (x / w) * binSpan);
      const peak = Math.min((waveform.peaks[bin] ?? 0) * gain, 1);
      const barHalf = Math.max(Math.pow(peak, 0.7) * (mid - 1), 0.5);
      ctx.fillRect(x, mid - barHalf, 1, barHalf * 2);
    }
  }, [waveform, sourceStart, sourceEnd, width, height]);
  return <canvas ref={ref} className="wave-canvas" style={{ height }} />;
};

interface TimelineProps {
  recipe: Recipe;
  waveforms: ProjectWaveforms | null;
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
}

export const Timeline: React.FC<TimelineProps> = ({
  recipe,
  waveforms,
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
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = useState(900);
  const [zoom, setZoom] = useState(1);
  /** Instante sob o cursor durante um arrastar da biblioteca */
  const [dropAt, setDropAt] = useState<number | null>(null);
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

  /** Clique no fundo vazio de uma trilha = seek */
  const laneSeek = (e: React.PointerEvent) => {
    if (e.target === e.currentTarget) startScrub(e);
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

  const zoomSlider = Math.log(zoom) / Math.log(MAX_ZOOM);

  const head = (cls: string, name: string, meta: React.ReactNode) => (
    <div className={`tl-head ${cls}`}>
      <span className="th-swatch" />
      <span className="th-name">{name}</span>
      <span className="th-meta">{meta}</span>
    </div>
  );

  return (
    <div className="timeline">
      <div className="tl-toolbar">
        <span className="tl-stats">
          {segments.length} {segments.length === 1 ? "trecho" : "trechos"} ·{" "}
          {pendingCuts.length > 0 ? `${pendingCuts.length} cortes sugeridos · ` : ""}
          {duration.toFixed(1)}s no corte
        </span>
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
        className={`tl-scroll ${dropAt !== null ? "dropping" : ""}`}
        ref={scrollRef}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(ASSET_DRAG_TYPE)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
          setDropAt(timeAt(e.clientX));
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropAt(null);
        }}
        onDrop={(e) => {
          const raw = e.dataTransfer.getData(ASSET_DRAG_TYPE);
          setDropAt(null);
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
          style={{
            gridTemplateColumns: `${HEAD_W}px ${contentW}px`,
            gridTemplateRows: `${ROW.ruler}px ${ROW.video}px ${ROW.caption}px ${ROW.motion}px ${ROW.overlay}px ${ROW.audio}px`,
          }}
        >
          {/* régua */}
          <div className="tl-head ruler-head">tempo</div>
          <div className="tl-ruler" ref={rulerRef} onPointerDown={startScrub}>
            {ticks}
          </div>

          {/* vídeo */}
          {head("trk-video", "Vídeo", segments.length)}
          <div className="tl-lane" onPointerDown={laneSeek}>
            {segments.map((seg, i) => {
              const width = (seg.sourceEnd - seg.sourceStart) * pxPerSec;
              return (
                <div
                  key={seg.id}
                  className="clip"
                  style={{ left: segmentPositions[i] * pxPerSec, width }}
                  title={`${seg.sourceId} · ${seg.sourceStart.toFixed(2)}s → ${seg.sourceEnd.toFixed(2)}s (bruto)`}
                  onPointerDown={(e) => {
                    if (e.target === e.currentTarget) startScrub(e);
                  }}
                >
                  {waveforms?.[seg.sourceId] && (
                    <WaveCanvas
                      waveform={waveforms[seg.sourceId]}
                      sourceStart={seg.sourceStart}
                      sourceEnd={seg.sourceEnd}
                      width={width}
                      height={ROW.video - 22}
                    />
                  )}
                  {width > 46 && (
                    <span className="clip-label">
                      {multiClip ? `${seg.sourceId} · ` : ""}
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

          {/* legenda */}
          {head("trk-caption", "Legenda", spoken)}
          <div className="tl-lane alt" onPointerDown={laneSeek}>
            {spoken === 0 && <span className="lane-empty">Transcreva para gerar a legenda</span>}
            {recipe.captions.blocks.map((block) => {
              const start = blockOutputStart(segments, block.sourceId, block.words[0].start);
              if (start === null) return null;
              const endRaw = blockOutputStart(
                segments,
                block.sourceId,
                block.words[block.words.length - 1].end - 0.01
              );
              const end = endRaw ?? start + 0.3;
              const text = block.words.map((w) => w.text).join(" ");
              return (
                <div
                  key={block.id}
                  className={`blk cap-blk ${selectedCaption === block.id ? "selected" : ""} ${block.sourceId === null ? "narration" : ""}`}
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

          {/* motions */}
          {head("trk-motion", "Motions", recipe.motions.filter((m) => m.status !== "rejected").length)}
          <div className="tl-lane" onPointerDown={laneSeek}>
            {placedMotions.length === 0 && <span className="lane-empty">Sem motions</span>}
            {placedMotions.map(({ motion: m, outputStart }) => (
              <div
                key={m.id}
                className={`blk mo-blk kind-${m.kind} status-${m.status} ${selectedMotion === m.id ? "selected" : ""}`}
                style={{
                  left: outputStart * pxPerSec,
                  width: Math.max(m.durationSeconds * pxPerSec, 12),
                }}
                title={`${MOTION_LABEL[m.kind]}${m.status === "pending" ? " (sugestão)" : ""} · ${motionSummary(m)}${m.note ? ` · ${m.note}` : ""}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onSelectMotion(m.id === selectedMotion ? null : m.id)}
              >
                {motionSummary(m) || MOTION_LABEL[m.kind]}
              </div>
            ))}
          </div>

          {/* overlays */}
          {head("trk-overlay", "Overlays", recipe.overlays.length)}
          <div className="tl-lane alt" onPointerDown={laneSeek}>
            {recipe.overlays.length === 0 && <span className="lane-empty">Sem overlays</span>}
            {recipe.overlays.map((o) => {
              const end = o.end ?? duration;
              return (
                <div
                  key={o.id}
                  className={`blk ov-blk ${selectedOverlay === o.id ? "selected" : ""}`}
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

          {/* áudio */}
          {head(
            "trk-audio",
            "Áudio",
            recipe.sfx.length > 0 ? `${recipe.sfx.length} sfx` : ""
          )}
          <div className="tl-lane" onPointerDown={laneSeek}>
            {recipe.audio.music ? (
              <div className="music-bar" style={{ left: 0, width: duration * pxPerSec }}>
                <Icon name="music" size={12} />
                {recipe.audio.music.file.split("/").pop()} · {Math.round(recipe.audio.music.volume * 100)}%
                {recipe.audio.narration ? " · + narração" : ""}
                {recipe.audio.useEnhanced ? " · áudio tratado" : ""}
              </div>
            ) : (
              <span className="lane-empty">
                {recipe.audio.narration ? "Narração" : "Sem música"}
                {recipe.audio.useEnhanced ? " · áudio tratado" : ""}
              </span>
            )}
            {recipe.sfx.map((s) => (
              <span
                key={s.id}
                className="sfx-marker"
                style={{ left: s.at * pxPerSec }}
                title={`${s.file.split("/").pop()} @ ${s.at.toFixed(2)}s`}
              />
            ))}
          </div>

          {/* playhead: camada sobre todas as trilhas, abaixo dos cabeçalhos */}
          <div className="tl-ph-layer">
            <div className="tl-playhead" style={{ left: clamp(playheadSeconds, 0, duration) * pxPerSec }}>
              <span className="tl-playhead-head" />
            </div>
            {dropAt !== null && <div className="tl-drop" style={{ left: dropAt * pxPerSec }} />}
          </div>
        </div>
      </div>
    </div>
  );
};
