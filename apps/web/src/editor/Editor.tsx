import { type PlayerRef } from "@remotion/player";
import { applyAcceptedCut, outputToSource, type Recipe } from "@vision/recipe";
import { recipeMetadata } from "@vision/video";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  applyTemplateApi,
  detectSilence,
  getRecipe,
  getWaveform,
  listTemplates,
  putRecipe,
  transcribe,
  type ProjectWaveforms,
  type TemplateInfo,
} from "../api";
import { AudioPanel } from "./AudioPanel";
import { CaptionPanel } from "./CaptionPanel";
import { OverlayPanel } from "./OverlayPanel";
import { PlayerPanel } from "./PlayerPanel";
import { RenderPanel } from "./RenderPanel";
import { StylePanel } from "./StylePanel";
import { Timeline } from "./Timeline";

export const Editor: React.FC<{ projectId: string }> = ({ projectId }) => {
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  const [selectedCaption, setSelectedCaption] = useState<string | null>(null);
  const [selectedOverlay, setSelectedOverlay] = useState<string | null>(null);
  const [waveforms, setWaveforms] = useState<ProjectWaveforms | null>(null);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const playerRef = useRef<PlayerRef>(null);

  useEffect(() => {
    getRecipe(projectId)
      .then(setRecipe)
      .catch((e) => setError(e.message));
    getWaveform(projectId)
      .then(setWaveforms)
      .catch(() => setWaveforms(null));
    listTemplates().then(setTemplates).catch(() => setTemplates([]));
  }, [projectId]);

  // espaço = play/pause fora de campos de texto
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      ) {
        return;
      }
      e.preventDefault();
      playerRef.current?.toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
    player.addEventListener("frameupdate", onFrame);
    return () => player.removeEventListener("frameupdate", onFrame);
  }, [recipe ? recipe.projectId : null]);

  const update = useCallback((next: Recipe) => {
    setRecipe(next);
    setDirty(true);
  }, []);

  const serverUpdate = useCallback((next: Recipe) => {
    setRecipe(next);
    setDirty(false);
  }, []);

  const runStep = async (label: string, fn: () => Promise<Recipe>) => {
    setBusy(label);
    setError(null);
    try {
      setRecipe(await fn());
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (error && !recipe) return <div className="error">{error}</div>;
  if (!recipe) return <div className="empty">Carregando...</div>;

  const meta = recipeMetadata(recipe);
  const playheadOutput = frame / meta.fps;
  const playheadSource = outputToSource(recipe.timeline.segments, playheadOutput);

  const pendingCuts = recipe.timeline.suggestedCuts.filter(
    (c) => c.status === "pending"
  );

  const removeAllSilences = () => {
    let segments = recipe.timeline.segments;
    for (const cut of pendingCuts) {
      const next = applyAcceptedCut(segments, cut);
      // nunca deixa a timeline vazia
      if (next.length > 0) segments = next;
    }
    update({
      ...recipe,
      timeline: {
        segments,
        suggestedCuts: recipe.timeline.suggestedCuts.map((c) =>
          c.status === "pending" ? { ...c, status: "accepted" as const } : c
        ),
      },
    });
  };

  return (
    <div className="editor">
      <header className="toolbar">
        <strong>{recipe.projectId}</strong>
        <button
          disabled={busy !== null}
          onClick={() =>
            runStep("transcrevendo", async () => {
              if (dirty) await putRecipe(recipe);
              return transcribe(projectId);
            })
          }
        >
          {busy === "transcrevendo" ? "Transcrevendo..." : "Transcrever"}
        </button>
        <button
          disabled={busy !== null}
          onClick={() =>
            runStep("silencios", async () => {
              if (dirty) await putRecipe(recipe);
              return detectSilence(projectId);
            })
          }
        >
          {busy === "silencios" ? "Detectando..." : "Detectar silêncios"}
        </button>
        {pendingCuts.length > 0 && (
          <button
            className="primary"
            disabled={busy !== null}
            title="Aceita todas as sugestões de corte pendentes de uma vez"
            onClick={removeAllSilences}
          >
            Remover silêncios ({pendingCuts.length})
          </button>
        )}
        <select
          title="Aplicar template"
          value={recipe.template ?? ""}
          disabled={busy !== null}
          onChange={(e) => {
            const t = e.target.value;
            if (t) {
              runStep("template", async () => {
                if (dirty) await putRecipe(recipe);
                return applyTemplateApi(projectId, t);
              });
            }
          }}
        >
          <option value="">Template...</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id} title={t.description}>
              {t.name}
            </option>
          ))}
        </select>
        <button
          disabled={busy !== null || !dirty}
          onClick={() => runStep("salvando", () => putRecipe(recipe))}
        >
          {dirty ? "Salvar receita*" : "Salvo"}
        </button>
        {error && <span className="error">{error}</span>}
      </header>

      {recipe.briefing && (
        <div className="briefing-bar" title={recipe.briefing}>
          Briefing: {recipe.briefing}
        </div>
      )}

      <div className="editor-body">
        <div className="player-panel">
          <PlayerPanel recipe={recipe} playerRef={playerRef} />
        </div>
        <div className="side-panels">
          <CaptionPanel
            recipe={recipe}
            selectedId={selectedCaption}
            playheadOutputSeconds={playheadOutput}
            playheadSource={playheadSource}
            onChange={update}
            onSelect={setSelectedCaption}
          />
          <OverlayPanel
            recipe={recipe}
            selectedId={selectedOverlay}
            playheadSeconds={playheadOutput}
            onChange={update}
            onSelect={setSelectedOverlay}
          />
          <StylePanel recipe={recipe} onChange={update} />
          <AudioPanel
            recipe={recipe}
            playheadSeconds={playheadOutput}
            onChange={update}
            onServerUpdate={serverUpdate}
          />
          <RenderPanel
            recipe={recipe}
            dirty={dirty}
            onSaved={() => setDirty(false)}
          />
        </div>
      </div>

      <Timeline
        recipe={recipe}
        waveforms={waveforms}
        playheadSeconds={playheadOutput}
        selectedCaption={selectedCaption}
        selectedOverlay={selectedOverlay}
        onChange={update}
        onSeek={(sec) => {
          playerRef.current?.seekTo(Math.round(sec * meta.fps));
          setFrame(Math.round(sec * meta.fps));
        }}
        onSelectCaption={setSelectedCaption}
        onSelectOverlay={setSelectedOverlay}
      />
    </div>
  );
};
