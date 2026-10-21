import { type PlayerRef } from "@remotion/player";
import { outputToSource, overlayFromAsset, type Asset, type Recipe } from "@vision/recipe";
import { recipeMetadata } from "@vision/video";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  applyTemplateApi,
  detectSilence,
  getRecipe,
  getWaveform,
  listTemplates,
  putRecipe,
  suggestMotionsApi,
  suggestSmartCutsApi,
  transcribe,
  type ProjectSummary,
  type ProjectWaveforms,
  type TemplateInfo,
} from "../api";
import { Kbd, Select, Tabs, Toggle, useDismiss } from "../ui/controls";
import { AudioPanel } from "./AudioPanel";
import { CaptionPanel } from "./CaptionPanel";
import { Icon } from "./Icon";
import { LibraryPanel } from "./LibraryPanel";
import { MediaPanel } from "./MediaPanel";
import { MotionPanel } from "./MotionPanel";
import { OverlayPanel } from "./OverlayPanel";
import { PlayerPanel } from "./PlayerPanel";
import { RenderPanel } from "./RenderPanel";
import { StylePanel } from "./StylePanel";
import { Timeline } from "./Timeline";
import { TranscriptPanel } from "./TranscriptPanel";

/** Passos de desfazer guardados */
const HISTORY_LIMIT = 100;
/** Mudanças em sequência mais rápida que isso viram um passo só (arrastos) */
const HISTORY_COALESCE_MS = 400;

const TL_HEIGHT_KEY = "vision.timelineHeight";
const TL_MIN = 170;

type InspectorTab = "motions" | "legenda" | "audio" | "midia" | "exportar";

function readTimelineHeight(): number {
  try {
    const v = Number(window.localStorage.getItem(TL_HEIGHT_KEY));
    return v >= TL_MIN ? v : 280;
  } catch {
    return 280;
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
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  const [selectedCaption, setSelectedCaption] = useState<string | null>(null);
  const [selectedOverlay, setSelectedOverlay] = useState<string | null>(null);
  const [selectedMotion, setSelectedMotion] = useState<string | null>(null);
  const [previewPending, setPreviewPending] = useState(true);
  const [waveforms, setWaveforms] = useState<ProjectWaveforms | null>(null);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [tab, setTab] = useState<InspectorTab>("motions");
  const [leftTab, setLeftTab] = useState<"texto" | "biblioteca">("texto");
  const [tlHeight, setTlHeight] = useState(readTimelineHeight);
  const [splitDrag, setSplitDrag] = useState(false);
  const [menu, setMenu] = useState<"projects" | "briefing" | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const projectMenuRef = useDismiss(menu === "projects", closeMenu);
  const briefingRef = useDismiss(menu === "briefing", closeMenu);
  const playerRef = useRef<PlayerRef>(null);
  const recipeRef = useRef<Recipe | null>(null);
  recipeRef.current = recipe;
  const history = useRef({ past: [] as Recipe[], future: [] as Recipe[], lastPush: 0 });
  const [historySize, setHistorySize] = useState({ past: 0, future: 0 });

  /**
   * Troca a receita guardando a anterior para desfazer. coalesce=true junta
   * mudanças em rajada (arrasto de borda gera dezenas por segundo).
   */
  const commit = useCallback((next: Recipe, coalesce: boolean) => {
    const h = history.current;
    const prev = recipeRef.current;
    const now = performance.now();
    if (prev && prev !== next && !(coalesce && now - h.lastPush < HISTORY_COALESCE_MS)) {
      h.past = [...h.past, prev].slice(-HISTORY_LIMIT);
      h.future = [];
    }
    h.lastPush = coalesce ? now : 0;
    setHistorySize({ past: h.past.length, future: h.future.length });
    setRecipe(next);
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
    getWaveform(projectId)
      .then(setWaveforms)
      .catch(() => setWaveforms(null));
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

  // Atalhos globais (fora de campos de texto):
  // espaço play/pause · Ctrl+Z/Shift+Z/Y desfazer/refazer · Ctrl+S salvar
  // ←/→ 1 frame (Shift = 1s) · Home/End início/fim
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
  }, [undo, redo, save, seekFrame, fps, totalFrames]);

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
      commit(next, false);
      setDirty(false);
    },
    [commit]
  );

  const runStep = async (label: string, fn: () => Promise<Recipe>) => {
    setBusy(label);
    setError(null);
    try {
      commit(await fn(), false);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  // seleção na timeline leva o inspetor para a aba certa
  const selectCaption = (id: string | null) => {
    setSelectedCaption(id);
    if (id) setTab("legenda");
  };
  const selectOverlay = (id: string | null) => {
    setSelectedOverlay(id);
    if (id) setTab("midia");
  };
  const selectMotion = (id: string | null) => {
    setSelectedMotion(id);
    if (id) setTab("motions");
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

  /** Item da biblioteca → receita, no instante `at` do vídeo final */
  const addAsset = (asset: Asset, at: number = playheadOutput) => {
    const t = Math.round(at * 100) / 100;
    if (asset.type === "sfx") {
      update({
        ...recipe,
        sfx: [...recipe.sfx, { id: `sfx_${Date.now().toString(36)}`, file: asset.file, at: t, volume: 0.8 }],
      });
      return;
    }
    if (asset.type === "music") {
      const m = recipe.audio.music;
      update({
        ...recipe,
        audio: {
          ...recipe.audio,
          music: {
            file: asset.file,
            volume: m?.volume ?? 0.12,
            fadeInSeconds: m?.fadeInSeconds ?? 1,
            fadeOutSeconds: m?.fadeOutSeconds ?? 2,
            startOffsetSeconds: 0,
          },
        },
      });
      return;
    }
    const overlay = overlayFromAsset(asset, t, recipe.timeline.segments, `ov_${Date.now().toString(36)}`);
    if (!overlay) return;
    update({ ...recipe, overlays: [...recipe.overlays, overlay] });
    selectOverlay(overlay.id);
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
    cortes: "Analisando cortes",
    motions: "Planejando motions",
    template: "Aplicando template",
    salvando: "Salvando",
  };

  return (
    <div className="editor" style={{ "--tl-h": `${tlHeight}px` } as React.CSSProperties}>
      <header className="topbar">
        <button className="brand" title="Voltar à tela inicial" onClick={onHome}>
          <span className="brand-mark" />
          VISION
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
        <div className="steps">
          <button
            className={`step ${hasTranscript ? "done" : ""}`}
            disabled={busy !== null}
            onClick={() => step("transcrevendo", () => transcribe(projectId))}
            title="Transcreve a fala palavra a palavra (Whisper)"
          >
            <span className="step-num">{hasTranscript ? <Icon name="check" size={10} /> : 1}</span>
            Transcrever
          </button>
          <button
            className={`step ${hasCutSuggestions ? "done" : ""}`}
            disabled={busy !== null || !hasTranscript}
            title={
              hasTranscript
                ? "Pausas, vícios, repetições e retomadas (IA). Nada é aplicado sem você aceitar."
                : "Transcreva o vídeo antes"
            }
            onClick={() => step("cortes", () => suggestSmartCutsApi(projectId))}
          >
            <span className="step-num">{hasCutSuggestions ? <Icon name="check" size={10} /> : 2}</span>
            Sugerir cortes
          </button>
          <button
            className={`step ${recipe.motions.length > 0 ? "done" : ""}`}
            disabled={busy !== null || !hasTranscript}
            title={hasTranscript ? "A IA propõe motions presos à fala" : "Transcreva o vídeo antes"}
            onClick={() => {
              setTab("motions");
              step("motions", () => suggestMotionsApi(projectId));
            }}
          >
            <span className="step-num">
              {recipe.motions.length > 0 ? <Icon name="check" size={10} /> : 3}
            </span>
            Sugerir motions
          </button>
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
          {busy ? `${busyLabel[busy] ?? "Processando"}…` : dirty ? "Não salvo" : "Salvo"}
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
        <button className="primary" onClick={() => setTab("exportar")}>
          <Icon name="export" size={15} />
          Exportar
        </button>
      </header>

      <div>
        {error && (
          <div className="banner">
            {error}
            <button className="sm ghost" onClick={() => setError(null)}>
              Fechar
            </button>
          </div>
        )}
        {backgroundStatus && <div className="banner info">{backgroundStatus}…</div>}
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
          <LibraryPanel playheadSeconds={playheadOutput} onAdd={(a) => addAsset(a)} head={leftTabs} />
        )}

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
          <PlayerPanel recipe={recipe} playerRef={playerRef} previewPending={previewPending} />
        </section>

        <section className="dock inspector">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "motions", label: "Motions", badge: pendingMotions },
              { id: "legenda", label: "Legenda" },
              { id: "audio", label: "Áudio" },
              { id: "midia", label: "Mídia" },
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
                onSuggest={(instructions) =>
                  step("motions", () => suggestMotionsApi(projectId, instructions))
                }
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
            {tab === "exportar" && (
              <RenderPanel recipe={recipe} dirty={dirty} onSaved={() => setDirty(false)} />
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
      />
    </div>
  );
};
