import type { Recipe } from "@vision/recipe";
import React, { useEffect, useState } from "react";
import {
  enhanceAudioApi,
  generateNarrationApi,
  listMusic,
  listSfx,
  type MusicTrack,
} from "../api";
import { Prop, ScrubNumber, Section, Select, Slider, Toggle } from "../ui/controls";
import { Icon } from "./Icon";

const pct = {
  format: (v: number) => String(Math.round(v * 100)),
  parse: (s: string) => Number(s) / 100,
};

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
  const noEnhanced = recipe.sources.every((s) => s.enhancedAudio === null);

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

  const setAudio = (patch: Partial<Recipe["audio"]>) =>
    onChange({ ...recipe, audio: { ...recipe.audio, ...patch } });

  const setMusic = (patch: Partial<NonNullable<Recipe["audio"]["music"]>>) => {
    if (music) setAudio({ music: { ...music, ...patch } });
  };

  const selectTrack = (file: string) => {
    if (file === "") return setAudio({ music: null });
    setAudio({
      music: {
        file,
        volume: music?.volume ?? 0.15,
        fadeInSeconds: music?.fadeInSeconds ?? 1,
        fadeOutSeconds: music?.fadeOutSeconds ?? 2,
        startOffsetSeconds: music?.startOffsetSeconds ?? 0,
      },
    });
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

  return (
    <>
      <Section title="Fala">
        <Prop label="Volume">
          <Slider
            value={recipe.audio.originalVolume}
            min={0}
            max={1}
            step={0.01}
            unit="%"
            {...pct}
            onChange={(v) => setAudio({ originalVolume: v })}
          />
        </Prop>
        <Prop label="Áudio tratado" hint="Redução de ruído + volume normalizado">
          <Toggle
            checked={recipe.audio.useEnhanced}
            disabled={noEnhanced}
            onChange={(v) => setAudio({ useEnhanced: v })}
            label="Usar áudio tratado"
          />
          <button
            className="sm"
            disabled={busy !== null}
            onClick={() => runServer("enhance", () => enhanceAudioApi(recipe.projectId))}
          >
            <Icon name="wand" size={13} />
            {busy === "enhance" ? "Tratando…" : noEnhanced ? "Tratar" : "Tratar de novo"}
          </button>
        </Prop>
      </Section>

      <Section title="Música de fundo">
        <Prop label="Faixa">
          <Select value={music?.file ?? ""} onChange={(e) => selectTrack(e.target.value)}>
            <option value="">Sem música</option>
            {tracks.map((t) => (
              <option key={t.file} value={t.file}>
                {t.name}
              </option>
            ))}
          </Select>
        </Prop>
        {tracks.length === 0 && (
          <p className="note">Coloque arquivos de áudio em media/music para aparecerem aqui.</p>
        )}
        {music && (
          <>
            <Prop label="Volume">
              <Slider
                value={music.volume}
                min={0}
                max={1}
                step={0.01}
                unit="%"
                {...pct}
                onChange={(v) => setMusic({ volume: v })}
              />
            </Prop>
            <Prop label="Fade in / out">
              <ScrubNumber
                value={music.fadeInSeconds}
                min={0}
                max={10}
                step={0.5}
                unit="s"
                pxPerStep={10}
                onChange={(v) => setMusic({ fadeInSeconds: v })}
              />
              <ScrubNumber
                value={music.fadeOutSeconds}
                min={0}
                max={10}
                step={0.5}
                unit="s"
                pxPerStep={10}
                onChange={(v) => setMusic({ fadeOutSeconds: v })}
              />
            </Prop>
            <Prop label="Começar a faixa em" hint="Pula o início da música">
              <ScrubNumber
                value={music.startOffsetSeconds}
                min={0}
                step={1}
                unit="s"
                onChange={(v) => setMusic({ startOffsetSeconds: v })}
              />
            </Prop>
          </>
        )}
      </Section>

      <Section title="Efeitos sonoros" defaultOpen={recipe.sfx.length > 0}>
        {sfxFiles.length > 0 ? (
          <Prop label="No playhead">
            <Select
              value=""
              onChange={(e) => {
                if (e.target.value) addSfx(e.target.value);
              }}
            >
              <option value="">+ Adicionar em {playheadSeconds.toFixed(1)}s</option>
              {sfxFiles.map((s) => (
                <option key={s.file} value={s.file}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Prop>
        ) : (
          <p className="note">Coloque arquivos de áudio em media/sfx para aparecerem aqui.</p>
        )}
        {recipe.sfx.length > 0 && (
          <div className="row">
            <span className="note">{recipe.sfx.length} na timeline</span>
            <span className="spacer" />
            <button className="sm danger" onClick={() => onChange({ ...recipe, sfx: [] })}>
              Limpar todos
            </button>
          </div>
        )}
      </Section>

      <Section title="Narração (TTS)" defaultOpen={recipe.audio.narration !== null}>
        <textarea
          rows={4}
          placeholder="Roteiro da narração em pt-BR…"
          value={script}
          onChange={(e) => setScript(e.target.value)}
        />
        <div className="row">
          {recipe.audio.narration && (
            <button
              className="sm danger"
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
          <span className="spacer" />
          <button
            className="sm primary"
            disabled={busy !== null || script.trim().length === 0}
            onClick={() =>
              runServer("narration", () => generateNarrationApi(recipe.projectId, script.trim()))
            }
          >
            <Icon name="mic" size={13} />
            {busy === "narration" ? "Gerando…" : "Gerar narração + legenda"}
          </button>
        </div>
      </Section>
      {error && <p className="note error" style={{ padding: "8px 12px" }}>{error}</p>}
    </>
  );
};
