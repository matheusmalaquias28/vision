import {
  acceptAudioClip,
  createAudioClip,
  defaultMusicWant,
  outputDuration,
  rankMusic,
  swapMusicClip,
  type Asset,
  type AudioClip,
  type Recipe,
} from "@vision/recipe";
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
  /** Clipe de música/SFX selecionado na timeline */
  selectedClipId: string | null;
  onSelectClip: (id: string | null) => void;
  /** Músicas da biblioteca (com estilo analisado) para "outra música" */
  musicAssets: Asset[];
}

export const AudioPanel: React.FC<AudioPanelProps> = ({
  recipe,
  playheadSeconds,
  onChange,
  onServerUpdate,
  selectedClipId,
  onSelectClip,
  musicAssets,
}) => {
  /** Faixas já oferecidas nesta sessão: "outra música" não repete */
  const [tried, setTried] = useState<string[]>([]);
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [sfxFiles, setSfxFiles] = useState<MusicTrack[]>([]);
  const [script, setScript] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selected = recipe.audioClips.find((c) => c.id === selectedClipId) ?? null;
  const musicCount = recipe.audioClips.filter((c) => c.kind === "music").length;
  const sfxCount = recipe.audioClips.length - musicCount;
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

  const setClip = (patch: Partial<AudioClip>) => {
    if (!selected) return;
    onChange({
      ...recipe,
      audioClips: recipe.audioClips.map((c) => (c.id === selected.id ? { ...c, ...patch } : c)),
    });
  };

  const addClip = (kind: AudioClip["kind"], file: string) => {
    const clip = createAudioClip({
      id: `aud_${Date.now().toString(36)}`,
      kind,
      file,
      start: playheadSeconds,
      videoDuration: outputDuration(recipe.timeline.segments),
    });
    onChange({ ...recipe, audioClips: [...recipe.audioClips, clip] });
    onSelectClip(clip.id);
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

      {selected && (
        <Section
          title={selected.kind === "music" ? "Música selecionada" : "Efeito selecionado"}
          actions={selected.status === "pending" ? <span className="pill pending">sugestão</span> : null}
        >
          {selected.kind === "music" && (
            <MusicChoice
              clip={selected}
              recipe={recipe}
              musicAssets={musicAssets}
              tried={tried}
              onTried={(id) => setTried((t) => [...t, id])}
              onChange={onChange}
              onReject={() => {
                onChange({ ...recipe, audioClips: recipe.audioClips.filter((c) => c.id !== selected.id) });
                onSelectClip(null);
              }}
            />
          )}
          <p className="note clip-file" title={selected.file}>
            {selected.file.split("/").pop()} · {selected.start.toFixed(2)}s, {selected.duration.toFixed(2)}s
          </p>
          <Prop label="Volume">
            <Slider
              value={selected.volume}
              min={0}
              max={1}
              step={0.01}
              unit="%"
              {...pct}
              onChange={(v) => setClip({ volume: v })}
            />
          </Prop>
          <Prop label="Fade in / out">
            <ScrubNumber
              value={selected.fadeInSeconds}
              min={0}
              max={Math.min(10, selected.duration)}
              step={0.5}
              unit="s"
              pxPerStep={10}
              onChange={(v) => setClip({ fadeInSeconds: v })}
            />
            <ScrubNumber
              value={selected.fadeOutSeconds}
              min={0}
              max={Math.min(10, selected.duration)}
              step={0.5}
              unit="s"
              pxPerStep={10}
              onChange={(v) => setClip({ fadeOutSeconds: v })}
            />
          </Prop>
          <Prop label="Começar o arquivo em" hint="Pula o início do arquivo (o mesmo que aparar a borda esquerda)">
            <ScrubNumber
              value={selected.offset}
              min={0}
              step={0.5}
              unit="s"
              onChange={(v) => setClip({ offset: v })}
            />
          </Prop>
          <Prop label="Repetir" hint="Recomeça o arquivo se o clipe for mais longo que ele">
            <Toggle checked={selected.loop} onChange={(v) => setClip({ loop: v })} label="Repetir em loop" />
          </Prop>
          <div className="row">
            <span className="note">Arraste na timeline para mover ou aparar · C corta · Ctrl+D duplica</span>
            <span className="spacer" />
            <button
              className="sm danger"
              onClick={() => {
                onChange({ ...recipe, audioClips: recipe.audioClips.filter((c) => c.id !== selected.id) });
                onSelectClip(null);
              }}
            >
              <Icon name="trash" size={13} />
              Remover
            </button>
          </div>
        </Section>
      )}

      <Section title="Música de fundo" defaultOpen={!selected}>
        {tracks.length > 0 ? (
          <Prop label="No playhead">
            <Select
              value=""
              onChange={(e) => {
                if (e.target.value) addClip("music", e.target.value);
              }}
            >
              <option value="">+ Adicionar em {playheadSeconds.toFixed(1)}s</option>
              {tracks.map((t) => (
                <option key={t.file} value={t.file}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Prop>
        ) : (
          <p className="note">Coloque arquivos de áudio em media/music para aparecerem aqui.</p>
        )}
        <p className="note">
          {musicCount > 0 ? `${musicCount} na timeline · ` : ""}Ou arraste uma música da Biblioteca direto
          para a trilha.
        </p>
      </Section>

      <Section title="Efeitos sonoros" defaultOpen={sfxCount > 0 && !selected}>
        {sfxFiles.length > 0 ? (
          <Prop label="No playhead">
            <Select
              value=""
              onChange={(e) => {
                if (e.target.value) addClip("sfx", e.target.value);
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
        {sfxCount > 0 && (
          <div className="row">
            <span className="note">{sfxCount} na timeline</span>
            <span className="spacer" />
            <button
              className="sm danger"
              onClick={() =>
                onChange({ ...recipe, audioClips: recipe.audioClips.filter((c) => c.kind !== "sfx") })
              }
            >
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

/**
 * Trilha sugerida pela IA (pendente: toca no preview, não vai para o MP4) ou
 * qualquer música: aceitar, pedir outra (próxima faixa que combina com o que
 * o vídeo pede, pelo estilo analisado da biblioteca) ou recusar.
 */
const MusicChoice: React.FC<{
  clip: AudioClip;
  recipe: Recipe;
  musicAssets: Asset[];
  tried: string[];
  onTried: (assetId: string) => void;
  onChange: (recipe: Recipe) => void;
  onReject: () => void;
}> = ({ clip, recipe, musicAssets, tried, onTried, onChange, onReject }) => {
  const asset = musicAssets.find((a) => a.id === clip.assetId);
  const pending = clip.status === "pending";
  const nextPick = () => {
    const ranked = rankMusic(musicAssets, recipe.musicWant ?? defaultMusicWant(), {
      exclude: [...tried, ...(clip.assetId ? [clip.assetId] : [])],
    });
    return ranked[0] ?? null;
  };
  const analyzed = musicAssets.some((a) => a.music);
  return (
    <div className="music-choice">
      <div className="music-choice-name">
        <Icon name="music" size={13} />
        <strong>{asset?.name ?? clip.file.split("/").pop()}</strong>
      </div>
      {(clip.note || asset?.music) && (
        <p className="prop-hint">
          {clip.note || ""}
          {asset?.music?.description ? `${clip.note ? " — " : ""}${asset.music.description}` : ""}
        </p>
      )}
      {pending && (
        <p className="prop-hint">Sugestão da IA: toca no preview, mas só entra no vídeo final se você aceitar.</p>
      )}
      <div className="row">
        {pending && (
          <button className="sm accept" onClick={() => onChange(acceptAudioClip(recipe, clip.id))}>
            <Icon name="check" size={13} /> Aceitar
          </button>
        )}
        <button
          className="sm"
          disabled={!analyzed}
          title={analyzed ? "Próxima faixa da biblioteca que combina com o vídeo" : "Músicas da biblioteca ainda não analisadas (npm run cli -- library music)"}
          onClick={() => {
            const pick = nextPick();
            if (!pick) return;
            if (clip.assetId) onTried(clip.assetId);
            onChange(swapMusicClip(recipe, clip.id, pick));
          }}
        >
          <Icon name="refresh" size={13} /> Outra música
        </button>
        {pending && (
          <button className="sm reject" onClick={onReject}>
            Recusar
          </button>
        )}
      </div>
    </div>
  );
};
