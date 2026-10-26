import { type PlayerRef } from "@remotion/player";
import {
  applyMotionSfxRules,
  ensureTransitionSfx,
  enforceLanes,
  createAudioClip,
  dropTarget,
  insertClipSegment,
  MAX_VIDEO_SECONDS,
  type Overlay,
  type Segment,
  type TrackId,
  deleteTimelineItems,
  copyItems,
  pasteItems,
  reviewMotions,
  selectionFromKeys,
  selectionHas,
  selectionKeys,
  splitItemAt,
  type ClipboardData,
  selectionCount,
  type TimelineSelection,
  duplicateAudioClip,
  duplicateSegment,
  outputDuration,
  outputToSource,
  overlayFromAsset,
  type Asset,
  CUT_PACES,
  type AudioClip,
  type CutPace,
  type Recipe,
} from "@vision/recipe";
import { recipeMetadata } from "@vision/video";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  addSourceClip,
  applyTemplateApi,
  detectSilence,
  getLibrary,
  getRecipe,
  getFilmstrip,
  getProjectDemand,
  getWaveform,
  listTemplates,
  putRecipe,
  planCreativeApi,
  generateIllustrationApi,
  getAnalysis,
  suggestIllustrationsApi,
  type IllustrationJob,
  type IllustrationReport,
  uploadAsset,
  analyzeApi,
  suggestSmartCutsApi,
  transcribe,
  type CreativeReport,
  type ProjectDemand,
  type ProjectSummary,
  type ProjectFilmstrips,
  type ProjectWaveforms,
  type TemplateInfo,
} from "../api";
import { Kbd, Select, Tabs, Toggle, useDismiss, useDragScroll } from "../ui/controls";
import { AudioPanel } from "./AudioPanel";
import { CaptionPanel } from "./CaptionPanel";
import { ColorPanel } from "./ColorPanel";
import { Icon } from "./Icon";
import { LibraryPanel, type LibraryFilter } from "./LibraryPanel";
import { inspectMediaFile } from "./mediaFiles";
import { MediaPanel } from "./MediaPanel";
import { MotionGallery } from "./MotionGallery";
import { insertCombo, insertMotion, MotionPanel } from "./MotionPanel";
import { OverlayPanel } from "./OverlayPanel";
import { PipelineStep } from "./PipelineStep";
import { PlayerPanel } from "./PlayerPanel";
import { RenderPanel } from "./RenderPanel";
import { StylePanel } from "./StylePanel";
import { Timeline, type TimelineItemAction, type TimelineTool } from "./Timeline";
import { TranscriptPanel } from "./TranscriptPanel";
import { Logo } from "../ui/Logo";
import { DragLayer } from "./DragLayer";
import { NotificationBell } from "../home/NotificationBell";

/** Passos de desfazer guardados */
const HISTORY_LIMIT = 100;
/** Mudanças em sequência mais rápida que isso viram um passo só (arrastos) */
const HISTORY_COALESCE_MS = 400;

const TL_HEIGHT_KEY = "vision.timelineHeight";
const CUT_PACE_KEY = "vision.cutPace";

/** Ritmo preferido do operador (vale para todos os projetos neste navegador) */
function readCutPace(): CutPace {
  try {
    const v = window.localStorage.getItem(CUT_PACE_KEY);
    return CUT_PACES.find((p) => p === v) ?? "normal";
  } catch {
    return "normal";
  }
}
const TL_MIN = 170;

type InspectorTab = "motions" | "legenda" | "audio" | "midia" | "cor" | "exportar";

/** Receita sem ajuste de cor (comparar antes/depois no preview) */
function withoutColor(recipe: Recipe): Recipe {
  return { ...recipe, sources: recipe.sources.map((s) => ({ ...s, color: null })) };
}

function readTimelineHeight(): number {
  try {
    const v = Number(window.localStorage.getItem(TL_HEIGHT_KEY));
    return v >= TL_MIN ? v : 350;
  } catch {
    return 350;
  }
}

interface EditorProps {
  projectId: string;
  projects: ProjectSummary[];
  /** Tarefa em segundo plano disparada fora do editor (ex.: diretor IA) */
  backgroundStatus: string | null;
  onOpenProject: (id: string) => void;
  onHome: () => void;
}

export const Editor: React.FC<EditorProps> = ({
  projectId,
  projects,
  backgroundStatus,
  onOpenProject,
  onHome,
}) => {
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [demand, setDemand] = useState<ProjectDemand | null>(null);
  const [creativeReport, setCreativeReport] = useState<CreativeReport | null>(null);
  const [fastPathMs, setFastPathMs] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  const [selectedCaption, setSelectedCaption] = useState<string | null>(null);
  const [selectedOverlay, setSelectedOverlay] = useState<string | null>(null);
  const [selectedMotion, setSelectedMotion] = useState<string | null>(null);
  const [selectedSegment, setSelectedSegment] = useState<string | null>(null);
  const [selectedAudioClip, setSelectedAudioClip] = useState<string | null>(null);
  /** Vários itens da timeline de uma vez (retângulo ou Shift/Ctrl+clique) */
  const [multi, setMulti] = useState<TimelineSelection | null>(null);
  const [tool, setTool] = useState<TimelineTool>("select");
  const [cutPace, setCutPace] = useState<CutPace>(readCutPace);
  const [previewPending, setPreviewPending] = useState(true);
  const [waveforms, setWaveforms] = useState<ProjectWaveforms | null>(null);
  const [filmstrips, setFilmstrips] = useState<ProjectFilmstrips | null>(null);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [tab, setTab] = useState<InspectorTab>("motions");
  const [leftTab, setLeftTab] = useState<"texto" | "biblioteca">("texto");
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>("motions");
  /** Segurando "Ver original" no painel de cor */
  const [showOriginalColor, setShowOriginalColor] = useState(false);
  const [tlHeight, setTlHeight] = useState(readTimelineHeight);
  const [splitDrag, setSplitDrag] = useState(false);
  const [menu, setMenu] = useState<"projects" | "briefing" | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  // passos do topo: em janela estreita a faixa rola por arrasto em vez de cortar botões
  const stepsRef = useDragScroll<HTMLDivElement>();
  const projectMenuRef = useDismiss(menu === "projects", closeMenu);
  const briefingRef = useDismiss(menu === "briefing", closeMenu);
  const playerRef = useRef<PlayerRef>(null);
  const recipeRef = useRef<Recipe | null>(null);
  recipeRef.current = recipe;
  const history = useRef({ past: [] as Recipe[], future: [] as Recipe[], lastPush: 0 });
  const [historySize, setHistorySize] = useState({ past: 0, future: 0 });

  /** SFX da biblioteca: som automático dos motions */
  const sfxRef = useRef<Asset[]>([]);
  const [sfxAssets, setSfxAssets] = useState<Asset[]>([]);
  /** Músicas da biblioteca com o estilo analisado ("outra música" da IA) */
  const [musicAssets, setMusicAssets] = useState<Asset[]>([]);
  useEffect(() => {
    getLibrary()
      .then((c) => {
        sfxRef.current = c.assets.filter((a) => a.type === "sfx");
        setSfxAssets(sfxRef.current);
        setMusicAssets(c.assets.filter((a) => a.type === "music"));
      })
      .catch(() => undefined);
  }, []);

  /**
   * Troca a receita guardando a anterior para desfazer. coalesce=true junta
   * mudanças em rajada (arrasto de borda gera dezenas por segundo). Toda
   * mudança passa pelo vínculo motion→som (o som acompanha, nasce e sai com o
   * motion) e pela regra das camadas (item novo/movido não cai em cima de
   * outro da mesma camada, ver enforceLanes); devolve true se isso mexeu.
   */
  const commit = useCallback((raw: Recipe, coalesce: boolean): boolean => {
    const h = history.current;
    const prev = recipeRef.current;
    const next = applyMotionSfxRules(prev, enforceLanes(prev, raw), sfxRef.current);
    const now = performance.now();
    if (prev && prev !== next && !(coalesce && now - h.lastPush < HISTORY_COALESCE_MS)) {
      h.past = [...h.past, prev].slice(-HISTORY_LIMIT);
      h.future = [];
    }
    h.lastPush = coalesce ? now : 0;
    setHistorySize({ past: h.past.length, future: h.future.length });
    setRecipe(next);
    return next !== raw;
  }, []);

  const undo = useCallback(() => {
    const h = history.current;
    const prev = h.past[h.past.length - 1];
    if (!prev || !recipeRef.current) return;
    h.past = h.past.slice(0, -1);
    h.future = [recipeRef.current, ...h.future];
    h.lastPush = 0;
    setHistorySize({ past: h.past.length, future: h.future.length });
    setRecipe(prev);
    setDirty(true);
  }, []);

  const redo = useCallback(() => {
    const h = history.current;
    const next = h.future[0];
    if (!next || !recipeRef.current) return;
    h.future = h.future.slice(1);
    h.past = [...h.past, recipeRef.current];
    h.lastPush = 0;
    setHistorySize({ past: h.past.length, future: h.future.length });
    setRecipe(next);
    setDirty(true);
  }, []);

  useEffect(() => {
    getRecipe(projectId)
      .then(setRecipe)
      .catch((e) => setError(e.message));
    getProjectDemand(projectId)
      .then(setDemand)
      .catch(() => setDemand(null));
    getWaveform(projectId)
      .then(setWaveforms)
      .catch(() => setWaveforms(null));
    getFilmstrip(projectId)
      .then(setFilmstrips)
      .catch(() => setFilmstrips(null));
    listTemplates().then(setTemplates).catch(() => setTemplates([]));
  }, [projectId]);

  const save = useCallback(async () => {
    const r = recipeRef.current;
    if (!r) return;
    setBusy("salvando");
    setError(null);
    try {
      await putRecipe(r);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);

  const fps = recipe?.render.fps ?? 30;
  const totalFrames = recipe ? recipeMetadata(recipe).durationInFrames : 1;

  const seekFrame = useCallback(
    (f: number) => {
      const target = Math.min(Math.max(Math.round(f), 0), totalFrames - 1);
      playerRef.current?.seekTo(target);
      setFrame(target);
    },
    [totalFrames]
  );

  // o que está selecionado na timeline, lido pelos atalhos sem recriar o listener
  const selectionRef = useRef({ segment: selectedSegment, audio: selectedAudioClip, overlay: selectedOverlay, motion: selectedMotion, multi });
  selectionRef.current = { segment: selectedSegment, audio: selectedAudioClip, overlay: selectedOverlay, motion: selectedMotion, multi };
  /** Playhead em segundos do vídeo final (colar com Ctrl+V) */
  const playheadRef = useRef(0);
  playheadRef.current = frame / fps;

  /** Delete: apaga o item selecionado. false = nada para apagar */
  const deleteSelection = useCallback((): boolean => {
    const r = recipeRef.current;
    const sel = selectionRef.current;
    if (!r) return false;
    if (sel.multi && selectionCount(sel.multi) > 0) {
      // tudo numa mudança só: um Ctrl+Z traz tudo de volta
      commit(deleteTimelineItems(r, sel.multi).recipe, false);
      setMulti(null);
      setSelectedMotion(null);
      setSelectedCaption(null);
      setSelectedOverlay(null);
      setSelectedSegment(null);
      setSelectedAudioClip(null);
    } else if (sel.audio) {
      commit({ ...r, audioClips: r.audioClips.filter((c) => c.id !== sel.audio) }, false);
      setSelectedAudioClip(null);
    } else if (sel.segment) {
      // a timeline precisa de ao menos um trecho
      if (r.timeline.segments.length <= 1) return false;
      const segments = r.timeline.segments.filter((x) => x.id !== sel.segment);
      commit({ ...r, timeline: { ...r.timeline, segments } }, false);
      setSelectedSegment(null);
    } else if (sel.overlay) {
      commit({ ...r, overlays: r.overlays.filter((o) => o.id !== sel.overlay) }, false);
      setSelectedOverlay(null);
    } else if (sel.motion) {
      commit({ ...r, motions: r.motions.filter((m) => m.id !== sel.motion) }, false);
      setSelectedMotion(null);
    } else {
      return false;
    }
    setDirty(true);
    return true;
  }, [commit]);

  // ── Área de transferência da timeline (menu do botão direito, Ctrl+C/X/V) ──
  const clipboardRef = useRef<ClipboardData | null>(null);
  const [hasClipboard, setHasClipboard] = useState(false);

  /** O que está selecionado como chaves "tipo:id" (vários ou o item único) */
  const selectedKeys = useCallback((): string[] => {
    const sel = selectionRef.current;
    if (sel.multi && selectionCount(sel.multi) > 0) return selectionKeys(sel.multi);
    if (sel.audio) return [`audio:${sel.audio}`];
    if (sel.segment) return [`segment:${sel.segment}`];
    if (sel.overlay) return [`overlay:${sel.overlay}`];
    if (sel.motion) return [`motion:${sel.motion}`];
    return [];
  }, []);

  /** Seleciona o que acabou de entrar (colado/duplicado) */
  const selectKeys = useCallback((keys: string[]) => {
    setSelectedSegment(null);
    setSelectedAudioClip(null);
    setSelectedOverlay(null);
    setSelectedMotion(null);
    if (keys.length !== 1) {
      setMulti(keys.length > 1 ? selectionFromKeys(keys) : null);
      return;
    }
    setMulti(null);
    const [kind, id] = [keys[0].slice(0, keys[0].indexOf(":")), keys[0].slice(keys[0].indexOf(":") + 1)];
    if (kind === "segment") setSelectedSegment(id);
    else if (kind === "audio") setSelectedAudioClip(id);
    else if (kind === "overlay") setSelectedOverlay(id);
    else if (kind === "motion") setSelectedMotion(id);
  }, []);

  /** Ações da timeline sobre itens (menu do botão direito e atalhos); `at` = instante no vídeo final */
  const timelineAction = useCallback(
    (action: TimelineItemAction, keys: string[], at: number) => {
      const r = recipeRef.current;
      if (!r) return;
      const apply = (next: Recipe) => {
        if (next === r) return;
        commit(next, false);
        setDirty(true);
      };
      if (action === "copy" || action === "cut") {
        const data = copyItems(r, keys);
        if (data) {
          clipboardRef.current = data;
          setHasClipboard(true);
        }
        if (action === "cut") {
          apply(deleteTimelineItems(r, selectionFromKeys(keys)).recipe);
          selectKeys([]);
        }
      } else if (action === "paste") {
        if (!clipboardRef.current) return;
        const out = pasteItems(r, clipboardRef.current, at);
        apply(out.recipe);
        selectKeys(out.keys);
      } else if (action === "duplicate") {
        const data = copyItems(r, keys);
        if (!data) return;
        const out = pasteItems(r, data, data.from + data.span);
        apply(out.recipe);
        selectKeys(out.keys);
      } else if (action === "split") {
        apply(splitItemAt(r, keys[0], at));
      } else if (action === "delete") {
        apply(deleteTimelineItems(r, selectionFromKeys(keys)).recipe);
        selectKeys([]);
      } else {
        const ids = keys.filter((k) => k.startsWith("motion:")).map((k) => k.slice("motion:".length));
        apply(reviewMotions(r, ids, action === "accept"));
      }
    },
    [commit, selectKeys]
  );

  /** Ctrl+D: cópia do item selecionado logo depois dele (e a cópia fica selecionada) */
  const duplicateSelection = useCallback(() => {
    const r = recipeRef.current;
    const sel = selectionRef.current;
    if (!r) return;
    const id = Date.now().toString(36);
    if (sel.audio) {
      const clip = r.audioClips.find((c) => c.id === sel.audio);
      if (!clip) return;
      const copy: AudioClip = duplicateAudioClip(clip, `aud_${id}`);
      commit({ ...r, audioClips: [...r.audioClips, copy] }, false);
      setSelectedAudioClip(copy.id);
    } else if (sel.segment) {
      const segments = duplicateSegment(r.timeline.segments, sel.segment);
      const copy = segments[segments.findIndex((x) => x.id === sel.segment) + 1];
      commit({ ...r, timeline: { ...r.timeline, segments } }, false);
      setSelectedSegment(copy.id);
    } else if (sel.overlay) {
      const o = r.overlays.find((x) => x.id === sel.overlay);
      // overlay até o fim do vídeo não tem "depois"
      if (!o || o.end === null) return;
      const copy = { ...o, id: `ov_${id}`, start: o.end, end: o.end + (o.end - o.start) };
      commit({ ...r, overlays: [...r.overlays, copy] }, false);
      setSelectedOverlay(copy.id);
    } else if (sel.motion) {
      // logo depois do original; a regra das camadas acha o espaço livre
      timelineAction("duplicate", [`motion:${sel.motion}`], 0);
      return;
    } else {
      return;
    }
    setDirty(true);
  }, [commit, timelineAction]);

  // Atalhos globais (fora de campos de texto):
  // espaço play/pause · Ctrl+Z/Shift+Z/Y desfazer/refazer · Ctrl+S salvar
  // ←/→ 1 frame (Shift = 1s) · Home/End início/fim
  // V seleção · C corte · Esc solta · Delete apaga · Ctrl+D duplica · Ctrl+C/X/V copia/recorta/cola
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === "s") {
        e.preventDefault();
        save();
        return;
      }
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      ) {
        return;
      }
      if (mod && (key === "z" || key === "y")) {
        e.preventDefault();
        if (key === "y" || e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && key === "d") {
        e.preventDefault(); // senão o navegador abre "adicionar favorito"
        duplicateSelection();
        return;
      }
      // Ctrl+C/X: itens selecionados na timeline · Ctrl+V: cola no playhead
      if (mod && (key === "c" || key === "x")) {
        const keys = selectedKeys();
        if (keys.length === 0) return; // sem seleção: cópia normal do navegador
        e.preventDefault();
        timelineAction(key === "x" ? "cut" : "copy", keys, playheadRef.current);
        return;
      }
      if (mod && key === "v") {
        if (!clipboardRef.current) return;
        e.preventDefault();
        timelineAction("paste", [], playheadRef.current);
        return;
      }
      if (!mod && !e.altKey && (key === "c" || key === "v")) {
        setTool(key === "c" ? "blade" : "select");
        return;
      }
      if (e.key === "Escape") {
        setTool("select");
        setSelectedSegment(null);
        setSelectedAudioClip(null);
        setMulti(null);
        return;
      }
      // o editor por texto trata ⌫ antes (e marca defaultPrevented)
      if ((e.key === "Delete" || e.key === "Backspace") && !e.defaultPrevented) {
        if (deleteSelection()) e.preventDefault();
        return;
      }
      const current = playerRef.current?.getCurrentFrame() ?? 0;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (target.getAttribute("role") === "spinbutton") return;
        e.preventDefault();
        const dir = e.key === "ArrowLeft" ? -1 : 1;
        seekFrame(current + dir * (e.shiftKey ? fps : 1));
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        seekFrame(0);
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        seekFrame(totalFrames - 1);
        return;
      }
      if (e.code !== "Space") return;
      e.preventDefault();
      playerRef.current?.toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, save, seekFrame, fps, totalFrames, deleteSelection, duplicateSelection, selectedKeys, timelineAction]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || !recipe) return;
    // ~8 updates/s: mais que isso re-renderiza o editor e engasga o preview
    let lastUpdate = 0;
    const onFrame = (e: { detail: { frame: number } }) => {
      const now = performance.now();
      if (now - lastUpdate < 125) return;
      lastUpdate = now;
      setFrame(e.detail.frame);
    };
    const onSeeked = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    player.addEventListener("frameupdate", onFrame);
    player.addEventListener("seeked", onSeeked);
    return () => {
      player.removeEventListener("frameupdate", onFrame);
      player.removeEventListener("seeked", onSeeked);
    };
  }, [recipe ? recipe.projectId : null]);

  const update = useCallback(
    (next: Recipe) => {
      commit(next, true);
      setDirty(true);
    },
    [commit]
  );

  const serverUpdate = useCallback(
    (next: Recipe) => {
      // o servidor já gravou; só fica "não salvo" se o vínculo de sons mexeu
      setDirty(commit(next, false));
    },
    [commit]
  );

  // projeto aberto com transição sem som (salvo antes da regra, ou aceita com a
  // biblioteca vazia): o som entra assim que receita e biblioteca carregam
  const transitionSfxChecked = useRef<string | null>(null);
  useEffect(() => {
    const r = recipeRef.current;
    if (!r || sfxAssets.length === 0 || transitionSfxChecked.current === r.projectId) return;
    transitionSfxChecked.current = r.projectId;
    const next = ensureTransitionSfx(r, sfxAssets);
    if (next !== r) {
      commit(next, false);
      setDirty(true);
    }
  }, [recipe ? recipe.projectId : null, sfxAssets, commit]);

  /**
   * Ações do servidor leem a receita GRAVADA: sem gravar antes, a resposta
   * voltava sem as edições não salvas (tratar o áudio desfazia a edição).
   * Devolve a receita que foi gravada.
   */
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const saveIfDirty = useCallback(async (): Promise<Recipe | null> => {
    const r = recipeRef.current;
    if (r && dirtyRef.current) {
      await putRecipe(r);
      setDirty(false);
    }
    return r;
  }, []);

  /**
   * Resultado do servidor que só acrescenta campos (ex.: áudio tratado):
   * aplica sobre a receita ATUAL, então o que foi editado enquanto o servidor
   * trabalhava também fica. `saved` = o que estava gravado quando a ação começou.
   */
  const serverPatch = useCallback(
    (saved: Recipe | null, patch: (r: Recipe) => Recipe) => {
      const cur = recipeRef.current;
      if (!cur) return;
      const editedMeanwhile = cur !== saved;
      const touched = commit(patch(cur), false);
      setDirty(editedMeanwhile || touched);
    },
    [commit]
  );

  // ── Análise automática do servidor (subida dos brutos): acompanha e recarrega no fim ──
  const [serverStage, setServerStage] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    let timer: number | undefined;
    let wasRunning = false;
    const tick = async () => {
      try {
        const a = await getAnalysis(projectId);
        if (stop) return;
        if (a && (a.status === "queued" || a.status === "running")) {
          wasRunning = true;
          setServerStage(a.stage);
          setBusy("auto");
          timer = window.setTimeout(tick, 2000);
          return;
        }
        if (wasRunning) {
          // terminou com o editor aberto: traz as sugestões que o servidor gravou
          const r = await getRecipe(projectId);
          if (stop) return;
          serverUpdate(r);
          setBusy(null);
          setTab("motions");
          if (a?.status === "error") setError(`Análise automática falhou: ${a.error}`);
        }
        setServerStage(null);
      } catch {
        if (!stop) timer = window.setTimeout(tick, 4000);
      }
    };
    tick();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [projectId, serverUpdate]);
  /** Seta do fluxo que a análise do servidor está rodando agora */
  const autoStep =
    busy === "auto" ? ({ Transcrevendo: 1, Cortando: 2, "Planejando motions": 3 } as Record<string, number>)[serverStage ?? ""] ?? 0 : 0;

  // ── Ilustrações (Magnific): imagem só por botão (gasta crédito), gravada no motion ──
  const [illustrations, setIllustrations] = useState<Record<string, IllustrationJob>>({});
  const [illustrationReport, setIllustrationReport] = useState<IllustrationReport | null>(null);
  /** Sobe a cada imagem gerada: a galeria do painel recarrega */
  const [imagesVersion, setImagesVersion] = useState(0);

  const generateIllustration = useCallback(
    async (motionId: string, fresh = false) => {
      const m = recipeRef.current?.motions.find((x) => x.id === motionId);
      if (!m || m.kind !== "illustration") return;
      setIllustrations((s) => ({ ...s, [motionId]: { busy: true, error: null } }));
      try {
        const r = await generateIllustrationApi(projectId, m.params.subject, fresh);
        // a receita pode ter mudado nos ~20 s da geração: aplica sobre a atual
        const cur = recipeRef.current;
        const now = cur?.motions.find((x) => x.id === motionId);
        if (cur && now && now.kind === "illustration") {
          commit(
            {
              ...cur,
              motions: cur.motions.map((x) =>
                x.id === motionId ? { ...now, params: { ...now.params, image: r.file } } : x
              ),
            },
            false
          );
          setDirty(true);
        }
        setIllustrations((s) => ({ ...s, [motionId]: { busy: false, error: null } }));
        setImagesVersion((v) => v + 1);
      } catch (e) {
        setIllustrations((s) => ({ ...s, [motionId]: { busy: false, error: (e as Error).message } }));
      }
    },
    [projectId, commit]
  );

  const runStep = async (label: string, fn: () => Promise<Recipe>) => {
    setBusy(label);
    setError(null);
    try {
      setDirty(commit(await fn(), false));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  // seleção na timeline leva o inspetor para a aba certa
  const selectCaption = (id: string | null) => {
    setSelectedCaption(id);
    if (id) {
      setMulti(null);
      setTab("legenda");
    }
  };
  const selectOverlay = (id: string | null) => {
    setSelectedOverlay(id);
    if (id) {
      setMulti(null);
      setSelectedSegment(null);
      setSelectedAudioClip(null);
      setSelectedMotion(null);
      setTab("midia");
    }
  };
  // alvo arrastado no preview leva o inspetor ao painel do elemento
  const [captionPicked, setCaptionPicked] = useState(false);
  const selectFromPreview = (target: string) => {
    const id = target.slice(target.indexOf(":") + 1);
    setCaptionPicked(target === "caption");
    if (target === "caption") setTab("legenda");
    else if (target.startsWith("overlay:")) selectOverlay(id);
    else if (target.startsWith("motion:")) selectMotion(id);
  };
  const previewTarget = captionPicked && tab === "legenda"
    ? "caption"
    : tab === "midia" && selectedOverlay
      ? `overlay:${selectedOverlay}`
      : tab === "motions" && selectedMotion
        ? `motion:${selectedMotion}`
        : null;

  // trecho de vídeo, clipe de áudio, overlay e motion: um selecionado por vez (Delete/Ctrl+D/C/X agem nele)
  const selectSegment = (id: string | null) => {
    setSelectedSegment(id);
    if (id) {
      setMulti(null);
      setSelectedAudioClip(null);
      setSelectedOverlay(null);
      setSelectedMotion(null);
    }
  };
  const selectAudioClip = (id: string | null) => {
    setSelectedAudioClip(id);
    if (id) {
      setMulti(null);
      setSelectedSegment(null);
      setSelectedOverlay(null);
      setSelectedMotion(null);
      setTab("audio");
    }
  };
  const selectMotion = (id: string | null) => {
    setSelectedMotion(id);
    if (id) {
      setMulti(null);
      setSelectedSegment(null);
      setSelectedAudioClip(null);
      setSelectedOverlay(null);
      setTab("motions");
    }
  };

  const startSplitDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const start = tlHeight;
    const max = Math.round(window.innerHeight * 0.65);
    setSplitDrag(true);
    let last = start;
    const onMove = (ev: PointerEvent) => {
      last = Math.min(max, Math.max(TL_MIN, start - (ev.clientY - startY)));
      setTlHeight(last);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setSplitDrag(false);
      try {
        window.localStorage.setItem(TL_HEIGHT_KEY, String(last));
      } catch {
        // armazenamento indisponível: só não lembra a altura
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  if (error && !recipe) {
    return (
      <div className="loading">
        <span className="error">{error}</span>
      </div>
    );
  }
  if (!recipe) return <div className="loading">Abrindo projeto…</div>;

  const meta = recipeMetadata(recipe);
  const playheadOutput = frame / meta.fps;
  const playheadSource = outputToSource(recipe.timeline.segments, playheadOutput);
  const seek = (sec: number) => seekFrame(sec * meta.fps);

  const hasTranscript = recipe.captions.blocks.some((b) => b.sourceId !== null);
  const hasCutSuggestions = recipe.timeline.suggestedCuts.some((c) => c.reason !== "silence");
  const pendingMotions = recipe.motions.filter((m) => m.status === "pending").length;

  const step = (label: string, fn: () => Promise<Recipe>) =>
    runStep(label, async () => {
      if (dirty) await putRecipe(recipe);
      return fn();
    });

  /** Fast Path: tudo de uma vez; o editor revisa as sugestões depois */
  const analyzeAll = () =>
    step("analise", async () => {
      const r = await analyzeApi(projectId, cutPace);
      setCreativeReport(r.report.creative);
      setFastPathMs(r.report.totalMs);
      setTab("motions");
      return r.recipe;
    });

  /** Creative Planner: 1 chamada de IA; o relatório aparece no painel de motions */
  const planMotions = (instructions = "", force = false) =>
    step("motions", async () => {
      const r = await planCreativeApi(projectId, instructions, force);
      setCreativeReport(r.report);
      return r.recipe;
    });

  /** Botão "Sugerir imagens": fora do Analisar e do Sugerir motions (cada imagem gasta crédito) */
  const suggestImages = (instructions = "") =>
    step("imagens", async () => {
      const r = await suggestIllustrationsApi(projectId, instructions);
      setIllustrationReport(r.report);
      setImagesVersion((v) => v + 1);
      return r.recipe;
    });

  /** Item da biblioteca → receita, no instante `at` do vídeo final */
  const addAsset = (asset: Asset, at: number = playheadOutput) => {
    const t = Math.round(at * 100) / 100;
    if (asset.type === "sfx" || asset.type === "music") {
      const clip = createAudioClip({
        id: `aud_${Date.now().toString(36)}`,
        kind: asset.type,
        file: asset.file,
        start: t,
        videoDuration: outputDuration(recipe.timeline.segments),
        mediaDurationSeconds: asset.durationSeconds,
        assetId: asset.id,
      });
      commit({ ...recipe, audioClips: [...recipe.audioClips, clip] }, false);
      setDirty(true);
      selectAudioClip(clip.id);
      return;
    }
    const overlay = overlayFromAsset(asset, t, recipe.timeline.segments, `ov_${Date.now().toString(36)}`);
    if (!overlay) return;
    update({ ...recipe, overlays: [...recipe.overlays, overlay] });
    selectOverlay(overlay.id);
  };

  /**
   * Arquivos soltos do computador na timeline. Cada um é conferido (tipo,
   * tamanho, duração) antes de subir e vai para a trilha da sua camada: áudio
   * só em Música/Efeitos; vídeo vira clipe da sequência (som na trilha do
   * vídeo) ou overlay sem som se solto em Overlays; imagem é overlay.
   */
  const addFiles = async (files: File[], at: number, hovered: TrackId | null) => {
    if (!recipeRef.current) return;
    setError(null);
    let t = at;
    for (const file of files) {
      const info = await inspectMediaFile(file);
      if ("error" in info) {
        setError(info.error);
        continue;
      }
      const target = dropTarget(info.kind, hovered, info.seconds);
      const progress = (f: number) =>
        setBusy(f < 1 ? `envio:Enviando ${file.name} (${Math.round(f * 100)}%)` : `envio:Preparando ${file.name}`);
      progress(0);
      try {
        const id = Date.now().toString(36);
        if (target === "video") {
          const { source } = await addSourceClip(recipeRef.current.projectId, file, progress);
          const r = recipeRef.current;
          const clip: Segment = { id: `seg_clip_${id}`, sourceId: source.id, sourceStart: 0, sourceEnd: source.durationInSeconds };
          const segments = insertClipSegment(r.timeline.segments, clip, t);
          commit({ ...r, sources: [...r.sources, source], timeline: { ...r.timeline, segments } }, false);
          selectSegment(clip.id);
          t += source.durationInSeconds;
          const total = outputDuration(segments);
          if (total > MAX_VIDEO_SECONDS) {
            setError(`Atenção: o vídeo agora tem ${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, "0")}; o limite do Vision é 1:30.`);
          }
        } else {
          const up = await uploadAsset(recipeRef.current.projectId, file, progress);
          const r = recipeRef.current;
          const total = outputDuration(r.timeline.segments);
          const start = Math.round(Math.min(t, Math.max(0, total - 0.1)) * 100) / 100;
          if (target === "music" || target === "sfx") {
            const clip = createAudioClip({
              id: `aud_${id}`,
              kind: target,
              file: up.file,
              start,
              videoDuration: total,
              mediaDurationSeconds: info.seconds,
            });
            commit({ ...r, audioClips: [...r.audioClips, clip] }, false);
            selectAudioClip(clip.id);
          } else {
            const isVideo = info.kind === "video";
            const length = isVideo ? (info.seconds ?? 4) : 3;
            const o: Overlay = {
              id: `ov_${id}`,
              kind: isVideo ? "video" : "image",
              text: "",
              file: up.file,
              start,
              end: Math.round(Math.min(start + length, total) * 100) / 100,
              // vídeo por cima entra sem som (Overlays é trilha visual)
              position: "top",
              layout: isVideo ? "pip" : "sticker",
              blend: "normal",
              opacity: 1,
              scale: isVideo ? 0.45 : 0.38,
              assetId: null,
              mediaDurationSeconds: isVideo ? info.seconds : null,
              placement: null,
              framing: null,
            };
            commit({ ...r, overlays: [...r.overlays, o] }, false);
            selectOverlay(o.id);
          }
        }
        setDirty(true);
      } catch (e) {
        setError(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setBusy(null);
      }
    }
  };

  const leftTabs = (
    <Tabs
      value={leftTab}
      onChange={setLeftTab}
      tabs={[
        { id: "texto", label: "Transcrição" },
        { id: "biblioteca", label: "Biblioteca" },
      ]}
    />
  );

  const busyLabel: Record<string, string> = {
    transcrevendo: "Transcrevendo",
    silencios: "Detectando silêncios",
    cortes: "Cortando",
    motions: "Planejando motions",
    analise: "Analisando: transcrição, cortes, motions e imagens",
    auto: `IA analisando o vídeo: ${serverStage ?? ""}`,
    imagens: "Gerando imagens",
    template: "Aplicando template",
    salvando: "Salvando",
  };

  return (
    <div className="editor" style={{
        "--tl-h": `${tlHeight}px`,
        "--viewer-aspect": meta.width / meta.height,
      } as React.CSSProperties}>
      <header className="topbar">
        <button className="brand" title="Voltar à tela inicial" onClick={onHome}>
          <Logo />
        </button>
        <span className="topbar-sep" />
        <div className="popover-anchor" ref={projectMenuRef}>
          <button
            className="project-switch"
            title="Trocar de projeto"
            onClick={() => setMenu(menu === "projects" ? null : "projects")}
          >
            <span>{recipe.projectId}</span>
            <Icon name="chevronDown" size={12} />
          </button>
          {menu === "projects" && (
            <div className="popover">
              <div className="menu-label">Projetos</div>
              {projects.map((p) => (
                <button
                  key={p.id}
                  className={`menu-item ${p.id === projectId ? "on" : ""}`}
                  onClick={() => {
                    setMenu(null);
                    if (p.id !== projectId) onOpenProject(p.id);
                  }}
                >
                  <Icon name="film" size={14} />
                  {p.id}
                  <span className="menu-meta">{Math.round(p.durationInSeconds)}s</span>
                </button>
              ))}
              <div className="menu-sep" />
              <button className="menu-item" onClick={onHome}>
                <Icon name="plus" size={14} />
                Nova demanda
              </button>
            </div>
          )}
        </div>
        {demand && (
          <span
            className="demand-chip"
            title={`${demand.demand.clientName} · ${demand.demand.title} · vídeo ${demand.video.index} de ${demand.demand.videoCount}`}
          >
            <strong>{demand.demand.clientName}</strong>
            {demand.demand.title} · vídeo {demand.video.index}/{demand.demand.videoCount}
          </span>
        )}
        {recipe.briefing && (
          <div className="popover-anchor" ref={briefingRef}>
            <button
              className="sm ghost"
              onClick={() => setMenu(menu === "briefing" ? null : "briefing")}
            >
              Briefing
            </button>
            {menu === "briefing" && <div className="popover briefing-pop">{recipe.briefing}</div>}
          </div>
        )}
        <span className="topbar-sep" />
        <div className="steps" ref={stepsRef}>
          <button
            className="sm primary analyze-btn"
            disabled={busy !== null}
            title={
              "Fast Path: transcreve (se faltar), sugere cortes e planeja motions com o briefing do War, " +
              "numa chamada de IA. Nada é aplicado sem você aceitar." +
              (fastPathMs !== null ? ` Última análise: ${(fastPathMs / 1000).toFixed(0)} s.` : "")
            }
            onClick={analyzeAll}
          >
            <Icon name="sparkles" size={13} />
            Analisar e aplicar
          </button>
          {/* fluxo em setas: a luz corre na seta que está processando (no Analisar, em todas, em sequência) */}
          <div className="pipeline">
          <PipelineStep
            n={1}
            first
            label="Transcrever"
            runningLabel="Transcrevendo"
            done={hasTranscript}
            running={busy === "transcrevendo" || busy === "analise" || autoStep === 1}
            lightDelay={0}
            disabled={busy !== null}
            onClick={() => step("transcrevendo", () => transcribe(projectId))}
            title="Transcreve a fala palavra a palavra (Whisper)"
          />
          <PipelineStep
            n={2}
            label="Cortar"
            runningLabel="Cortando"
            done={hasCutSuggestions}
            running={busy === "cortes" || busy === "analise" || autoStep === 2}
            lightDelay={0.25}
            disabled={busy !== null || !hasTranscript}
            title={
              hasTranscript
                ? "Corta pausas, vícios, muletas, repetições e retomadas (IA) e reagrupa a legenda. Os cortes entram aplicados: restaure no texto (palavra riscada + ⌫) ou arrastando o trecho."
                : "Transcreva o vídeo antes"
            }
            onClick={() => step("cortes", () => suggestSmartCutsApi(projectId, cutPace))}
          >
            <Select
              className="pace-select"
              value={cutPace}
              disabled={busy !== null}
              aria-label="Ritmo dos cortes"
              title="Quanto silêncio sobra entre as frases. Rode Cortar de novo para aplicar (as pausas são medidas de novo)."
              onChange={(e) => {
                const pace = e.target.value as CutPace;
                setCutPace(pace);
                try {
                  window.localStorage.setItem(CUT_PACE_KEY, pace);
                } catch {
                  // armazenamento indisponível: vale só nesta sessão
                }
              }}
            >
              <option value="suave">Ritmo suave</option>
              <option value="normal">Ritmo normal</option>
              <option value="acelerado">Ritmo acelerado</option>
            </Select>
          </PipelineStep>
          <PipelineStep
            n={3}
            label="Sugerir motions"
            runningLabel="Planejando motions"
            done={recipe.motions.length > 0}
            running={busy === "motions" || busy === "analise" || autoStep === 3}
            lightDelay={0.5}
            disabled={busy !== null || !hasTranscript}
            title={hasTranscript ? "A IA propõe motions presos à fala" : "Transcreva o vídeo antes"}
            onClick={() => {
              setTab("motions");
              planMotions();
            }}
          />
          </div>
          <button
            className="ghost sm"
            disabled={busy !== null}
            title="Silêncios pelo nível de áudio (ffmpeg)"
            onClick={() => step("silencios", () => detectSilence(projectId))}
          >
            Silêncios
          </button>
        </div>

        <span className="spacer" />

        <span
          className={`save-state ${busy ? "busy" : dirty ? "dirty" : ""}`}
          title={dirty ? "Ctrl+S salva" : undefined}
        >
          <span className="save-dot" />
          {busy
            ? `${busyLabel[busy] ?? (busy.startsWith("envio:") ? busy.slice(6) : "Processando")}…`
            : dirty
              ? "Não salvo"
              : "Salvo"}
        </span>
        {dirty && !busy && (
          <button className="sm" onClick={save}>
            Salvar <Kbd>Ctrl S</Kbd>
          </button>
        )}
        <Select
          title="Template visual"
          value={recipe.template ?? ""}
          disabled={busy !== null}
          onChange={(e) => {
            const t = e.target.value;
            if (t) step("template", () => applyTemplateApi(projectId, t));
          }}
        >
          <option value="">Template</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id} title={t.description}>
              {t.name}
            </option>
          ))}
        </Select>
        <button
          className="icon ghost"
          title="Desfazer (Ctrl+Z)"
          disabled={historySize.past === 0}
          onClick={undo}
        >
          <Icon name="undo" size={16} />
        </button>
        <button
          className="icon ghost"
          title="Refazer (Ctrl+Shift+Z)"
          disabled={historySize.future === 0}
          onClick={redo}
        >
          <Icon name="redo" size={16} />
        </button>
        <NotificationBell
          onOpenDemand={(id) => {
            window.location.hash = `#/demandas/${encodeURIComponent(id)}`;
            onHome();
          }}
        />
        <button className="primary" onClick={() => setTab("exportar")}>
          <Icon name="export" size={15} />
          Exportar
        </button>
      </header>

      <div className="editor-banners">
        {error && (
          <div className="banner">
            {error}
            <button className="sm ghost" onClick={() => setError(null)}>
              Fechar
            </button>
          </div>
        )}
        {backgroundStatus && <div className="banner info">{backgroundStatus}…</div>}
        {projects.find((p) => p.id === projectId)?.rawPurgedAt && (
          <div className="banner info">
            O vídeo bruto deste projeto foi apagado pela limpeza automática. Dá para consultar a edição,
            mas não renderizar de novo.
          </div>
        )}
      </div>

      <div className="workspace">
        {leftTab === "texto" ? (
          <TranscriptPanel
            recipe={recipe}
            playheadSource={playheadSource}
            onChange={update}
            onSeek={seek}
            head={leftTabs}
          />
        ) : (
          <LibraryPanel
            playheadSeconds={playheadOutput}
            onAdd={(a) => addAsset(a)}
            head={leftTabs}
            filter={libraryFilter}
            onFilterChange={setLibraryFilter}
            motionGallery={
              <MotionGallery
                style={recipe.captions.style}
                accent={recipe.motionStyle.accentColor}
                previewFile={recipe.sources[0]?.file ?? null}
                canInsert={playheadSource !== null}
                onInsertMotion={(kind) => {
                  if (!playheadSource) return;
                  const out = insertMotion(recipe, kind, playheadSource);
                  update(out.recipe);
                  selectMotion(out.id);
                }}
                onInsertCombo={(id) => {
                  const out = playheadSource ? insertCombo(recipe, id, playheadSource) : null;
                  if (!out) return;
                  update(out.recipe);
                  selectMotion(out.id);
                }}
              />
            }
          />
        )}


        <section className="dock inspector">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "motions", label: "Motions", badge: pendingMotions },
              { id: "legenda", label: "Legenda" },
              { id: "audio", label: "Áudio" },
              { id: "midia", label: "Mídia" },
              { id: "cor", label: "Cor" },
              { id: "exportar", label: "Exportar" },
            ]}
          />
          <div className="dock-body">
            {tab === "motions" && (
              <MotionPanel
                recipe={recipe}
                selectedId={selectedMotion}
                playheadSource={playheadSource}
                suggesting={busy === "motions"}
                report={creativeReport}
                onOpenLibrary={() => {
                  setLeftTab("biblioteca");
                  setLibraryFilter("motions");
                }}
                sfx={sfxAssets}
                illustrations={illustrations}
                onGenerateIllustration={generateIllustration}
                suggestingImages={busy === "imagens"}
                pipelineBusy={busy !== null}
                imagesReport={illustrationReport}
                imagesVersion={imagesVersion}
                onSuggestImages={suggestImages}
                onSuggest={(instructions, force) => planMotions(instructions, force)}
                onChange={update}
                onSelect={setSelectedMotion}
                onSeek={seek}
              />
            )}
            {tab === "legenda" && (
              <>
                <CaptionPanel
                  recipe={recipe}
                  selectedId={selectedCaption}
                  playheadOutputSeconds={playheadOutput}
                  playheadSource={playheadSource}
                  onChange={update}
                  onSelect={setSelectedCaption}
                />
                <StylePanel recipe={recipe} onChange={update} />
              </>
            )}
            {tab === "audio" && (
              <AudioPanel
                recipe={recipe}
                playheadSeconds={playheadOutput}
                onChange={update}
                onServerUpdate={serverUpdate}
                onServerPatch={serverPatch}
                saveIfDirty={saveIfDirty}
                selectedClipId={selectedAudioClip}
                onSelectClip={selectAudioClip}
                musicAssets={musicAssets}
              />
            )}
            {tab === "midia" && (
              <>
                <MediaPanel recipe={recipe} playheadSeconds={playheadOutput} onChange={update} />
                <OverlayPanel
                  recipe={recipe}
                  selectedId={selectedOverlay}
                  playheadSeconds={playheadOutput}
                  onChange={update}
                  onSelect={setSelectedOverlay}
                />
              </>
            )}
            {tab === "cor" && (
              <ColorPanel
                recipe={recipe}
                playheadSource={playheadSource}
                onChange={update}
                onCompare={setShowOriginalColor}
              />
            )}
            {tab === "exportar" && (
              <RenderPanel
                recipe={recipe}
                dirty={dirty}
                onSaved={() => setDirty(false)}
                demand={demand}
                onDelivered={() => getProjectDemand(projectId).then(setDemand).catch(() => {})}
              />
            )}
          </div>
        </section>
      </div>

      <div
        className={`splitter ${splitDrag ? "dragging" : ""}`}
        role="separator"
        aria-orientation="horizontal"
        title="Arraste para redimensionar a timeline"
        onPointerDown={startSplitDrag}
      />

      <Timeline
        recipe={recipe}
        waveforms={waveforms}
        filmstrips={filmstrips}
        playheadSeconds={playheadOutput}
        selectedCaption={selectedCaption}
        selectedOverlay={selectedOverlay}
        selectedMotion={selectedMotion}
        onChange={update}
        onSeek={seek}
        onSelectCaption={selectCaption}
        onSelectOverlay={selectOverlay}
        onSelectMotion={selectMotion}
        onDropAsset={addAsset}
        tool={tool}
        onToolChange={setTool}
        selectedSegment={selectedSegment}
        selectedAudioClip={selectedAudioClip}
        onSelectSegment={selectSegment}
        onSelectAudioClip={selectAudioClip}
        multiSelection={multi}
        onMultiSelect={(s) => {
          setMulti(s);
          // com vários selecionados, Delete age neles (não no item único de antes)
          if (s) {
            setSelectedSegment(null);
            setSelectedAudioClip(null);
            setSelectedOverlay(null);
          }
        }}
        onDeleteMulti={() => {
          if (deleteSelection()) setDirty(true);
        }}
        onItemAction={(action, key, at) => {
          // item de uma seleção múltipla: a ação vale para todos os selecionados
          const keys = key === null ? [] : selectionHas(multi, key) ? selectionKeys(multi) : [key];
          timelineAction(action, keys, at);
        }}
        canPaste={hasClipboard}
        onDropFiles={(files, at, hovered) => void addFiles(files, at, hovered)}
      />

      <section className="dock viewer">
        <header className="dock-head">
          <span className="dock-title">Viewer</span>
          <span className="dock-meta">
            {meta.width}×{meta.height} · {meta.fps}fps
          </span>
          <span className="spacer" />
          <label className="viewer-toggle" title="Mostra motions sugeridos antes de aceitar">
            Prévia das sugestões
            <Toggle checked={previewPending} onChange={setPreviewPending} label="Prévia das sugestões" />
          </label>
        </header>
        <PlayerPanel
          recipe={showOriginalColor ? withoutColor(recipe) : recipe}
          playerRef={playerRef}
          previewPending={previewPending}
        />
        <DragLayer
          recipe={recipe}
          playerRef={playerRef}
          selected={previewTarget}
          onChange={update}
          onSelect={selectFromPreview}
        />
      </section>
    </div>
  );
};
