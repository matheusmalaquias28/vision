import type { Recipe } from "@vision/recipe";
import React, { useEffect, useState } from "react";
import {
  enhanceAudioApi,
  generateNarrationApi,
  listMusic,
  listSfx,
  type MusicTrack,
} from "../api";

interface AudioPanelProps {
  recipe: Recipe;
  playheadSeconds: number;
  onChange: (recipe: Recipe) => void;
  /** Substitui a receita por uma versão vinda do servidor (limpa o dirty) */
  onServerUpdate: (recipe: Recipe) => void;
}

export const AudioPanel: React.FC<AudioPanelProps> = ({
  recipe,
  playheadSeconds,
  onChange,
  onServerUpdate,
}) => {
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [sfxFiles, setSfxFiles] = useState<MusicTrack[]>([]);
  const [script, setScript] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const music = recipe.audio.music;

  useEffect(() => {
    listMusic().then(setTracks).catch(() => setTracks([]));
    listSfx().then(setSfxFiles).catch(() => setSfxFiles([]));
  }, []);

  const runServer = async (label: string, fn: () => Promise<Recipe>) => {
    setBusy(label);
    setError(null);
    try {
      onServerUpdate(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const addSfx = (file: string) => {
    onChange({
      ...recipe,
      sfx: [
        ...recipe.sfx,
        {
          id: `sfx_${Date.now().toString(36)}`,
          file,
          at: Math.round(playheadSeconds * 100) / 100,
          volume: 0.8,
        },
      ],
    });
  };

  const setMusic = (patch: Partial<NonNullable<Recipe["audio"]["music"]>>) => {
    if (!music) return;
    onChange({
      ...recipe,
      audio: { ...recipe.audio, music: { ...music, ...patch } },
    });
  };

  const selectTrack = (file: string) => {
    if (file === "") {
      onChange({ ...recipe, audio: { ...recipe.audio, music: null } });
      return;
    }
    onChange({
      ...recipe,
      audio: {
        ...recipe.audio,
        music: {
          file,
          volume: music?.volume ?? 0.15,
          fadeInSeconds: music?.fadeInSeconds ?? 1,
          fadeOutSeconds: music?.fadeOutSeconds ?? 2,
          startOffsetSeconds: music?.startOffsetSeconds ?? 0,
        },
      },
    });
  };

  return (
    <section className="panel">
      <h2>Áudio</h2>
      <label className="field">
        Música de fundo
        <select
          value={music?.file ?? ""}
          onChange={(e) => selectTrack(e.target.value)}
        >
          <option value="">(sem música)</option>
          {tracks.map((t) => (
            <option key={t.file} value={t.file}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      {music && (
        <>
          <label className="field">
            Volume da música: {Math.round(music.volume * 100)}%
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={music.volume}
              onChange={(e) => setMusic({ volume: Number(e.target.value) })}
            />
          </label>
          <div className="field-row">
            <label className="field">
              Fade in (s)
              <input
                type="number"
                min={0}
                step={0.5}
                value={music.fadeInSeconds}
                onChange={(e) =>
                  setMusic({ fadeInSeconds: Math.max(0, Number(e.target.value)) })
                }
              />
            </label>
            <label className="field">
              Fade out (s)
              <input
                type="number"
                min={0}
                step={0.5}
                value={music.fadeOutSeconds}
                onChange={(e) =>
                  setMusic({ fadeOutSeconds: Math.max(0, Number(e.target.value)) })
                }
              />
            </label>
            <label className="field">
              Offset da faixa (s)
              <input
                type="number"
                min={0}
                step={1}
                value={music.startOffsetSeconds}
                onChange={(e) =>
                  setMusic({
                    startOffsetSeconds: Math.max(0, Number(e.target.value)),
                  })
                }
              />
            </label>
          </div>
        </>
      )}
      <label className="field">
        Volume da fala original: {Math.round(recipe.audio.originalVolume * 100)}%
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={recipe.audio.originalVolume}
          onChange={(e) =>
            onChange({
              ...recipe,
              audio: { ...recipe.audio, originalVolume: Number(e.target.value) },
            })
          }
        />
      </label>

      <div className="field-row">
        <label className="field checkbox-field">
          <span>
            <input
              type="checkbox"
              checked={recipe.audio.useEnhanced}
              disabled={recipe.sources.every((s) => s.enhancedAudio === null)}
              onChange={(e) =>
                onChange({
                  ...recipe,
                  audio: { ...recipe.audio, useEnhanced: e.target.checked },
                })
              }
            />{" "}
            Usar áudio tratado
          </span>
        </label>
        <button
          disabled={busy !== null}
          onClick={() => runServer("enhance", () => enhanceAudioApi(recipe.projectId))}
        >
          {busy === "enhance" ? "Tratando..." : "Tratar áudio (ruído + volume)"}
        </button>
      </div>

      {sfxFiles.length > 0 && (
        <label className="field">
          Efeito sonoro no playhead ({playheadSeconds.toFixed(1)}s)
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) addSfx(e.target.value);
            }}
          >
            <option value="">+ adicionar SFX...</option>
            {sfxFiles.map((s) => (
              <option key={s.file} value={s.file}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {recipe.sfx.length > 0 && (
        <p className="muted">
          {recipe.sfx.length} SFX na timeline —{" "}
          <button
            className="link-btn"
            onClick={() => onChange({ ...recipe, sfx: [] })}
          >
            limpar todos
          </button>
        </p>
      )}

      <label className="field">
        Narração (TTS)
        <textarea
          rows={3}
          placeholder="Roteiro da narração em pt-BR..."
          value={script}
          onChange={(e) => setScript(e.target.value)}
        />
      </label>
      <div className="field-row">
        <button
          disabled={busy !== null || script.trim().length === 0}
          onClick={() =>
            runServer("narration", () =>
              generateNarrationApi(recipe.projectId, script.trim())
            )
          }
        >
          {busy === "narration" ? "Gerando..." : "Gerar narração + legenda"}
        </button>
        {recipe.audio.narration && (
          <button
            className="danger"
            onClick={() =>
              onChange({
                ...recipe,
                audio: { ...recipe.audio, narration: null },
                captions: {
                  ...recipe.captions,
                  blocks: recipe.captions.blocks.filter((b) => b.sourceId !== null),
                },
              })
            }
          >
            Remover narração
          </button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );
};
