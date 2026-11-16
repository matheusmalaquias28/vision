import {
  createAudioClip,
  DEFAULT_NARRATION_VOICE,
  NARRATION_MAX_CHARS,
  NARRATION_SPEED_MAX,
  NARRATION_SPEED_MIN,
  NARRATION_TONES,
  NARRATION_VOICES,
  outputDuration,
  type NarrationRequest,
  type NarrationTake,
  type Recipe,
} from "@vision/recipe";
import React, { useState } from "react";
import { generateNarrationApi, mediaUrl } from "../api";
import { Prop, Section, Select, Slider } from "../ui/controls";
import { Icon } from "./Icon";

/** Uma narração gerada nesta sessão, para ouvir e comparar antes de usar */
export interface NarrationDraftTake extends NarrationTake {
  id: string;
  voice: string;
  speed: number;
  tone: string;
  script: string;
}

/** Estado da aba (fica no Editor: trocar de aba não perde roteiro nem gerações) */
export interface NarrationDraft {
  script: string;
  voice: string;
  /** Tom pronto escolhido ("" = direção escrita à mão) */
  tone: string;
  instructions: string;
  speed: number;
  takes: NarrationDraftTake[];
}

export const initialNarrationDraft = (): NarrationDraft => ({
  script: "",
  voice: DEFAULT_NARRATION_VOICE,
  tone: NARRATION_TONES[0].id,
  instructions: NARRATION_TONES[0].instructions,
  speed: 1,
  takes: [],
});

interface NarrationPanelProps {
  recipe: Recipe;
  playheadSeconds: number;
  draft: NarrationDraft;
  onDraftChange: (draft: NarrationDraft) => void;
  onChange: (recipe: Recipe) => void;
  onSelectClip: (id: string) => void;
}

const fmt = (s: number) => {
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s - m * 60)
    .toString()
    .padStart(2, "0")}`;
};

const voiceLabel = (id: string) => NARRATION_VOICES.find((v) => v.id === id)?.label ?? id;
const toneLabel = (id: string) => NARRATION_TONES.find((t) => t.id === id)?.label ?? "Personalizado";

/**
 * Narração por texto, manual: o editor cola o roteiro, gera, ouve aqui e só
 * então põe na timeline (trilha Narração, no playhead). Gerar não mexe na
 * receita; cada geração fica na lista para comparar vozes e tons.
 */
export const NarrationPanel: React.FC<NarrationPanelProps> = ({
  recipe,
  playheadSeconds,
  draft,
  onDraftChange,
  onChange,
  onSelectClip,
}) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<NarrationDraft>) => onDraftChange({ ...draft, ...patch });
  const total = outputDuration(recipe.timeline.segments);
  const tooLong = draft.script.length > NARRATION_MAX_CHARS;

  const generate = async () => {
    setBusy(true);
    setError(null);
    const req: NarrationRequest = {
      script: draft.script.trim(),
      voice: draft.voice,
      instructions: draft.instructions.trim(),
      speed: draft.speed,
    };
    try {
      const take = await generateNarrationApi(recipe.projectId, req);
      const entry: NarrationDraftTake = {
        ...take,
        id: `nt_${Date.now().toString(36)}`,
        voice: req.voice,
        speed: req.speed,
        tone: draft.tone,
        script: req.script,
      };
      // mesmo pedido de novo devolve o mesmo arquivo (cache): não duplica na lista
      onDraftChange({ ...draft, takes: [entry, ...draft.takes.filter((t) => t.file !== take.file)] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const addToTimeline = (take: NarrationDraftTake) => {
    const clip = createAudioClip({
      id: `aud_${Date.now().toString(36)}`,
      kind: "voice",
      file: take.file,
      start: Math.round(playheadSeconds * 100) / 100,
      videoDuration: total,
      mediaDurationSeconds: take.durationSeconds,
    });
    onChange({ ...recipe, audioClips: [...recipe.audioClips, { ...clip, note: `${voiceLabel(take.voice)} · ${toneLabel(take.tone)}` }] });
    onSelectClip(clip.id);
  };

  return (
    <>
      <Section title="Roteiro">
        <textarea
          className="text-edit"
          rows={7}
          placeholder="Cole aqui o texto que a voz vai ler…"
          value={draft.script}
          onChange={(e) => set({ script: e.target.value })}
        />
        <p className={`note ${tooLong ? "error" : ""}`}>
          {draft.script.length} / {NARRATION_MAX_CHARS} caracteres
        </p>
      </Section>

      <Section title="Voz">
        <div className="narr-voices" role="radiogroup" aria-label="Voz">
          {NARRATION_VOICES.map((v) => (
            <button
              key={v.id}
              role="radio"
              aria-checked={draft.voice === v.id}
              className={`narr-voice ${draft.voice === v.id ? "on" : ""}`}
              onClick={() => set({ voice: v.id })}
            >
              <strong>{v.label}</strong>
              <span>{v.description}</span>
            </button>
          ))}
        </div>
        <Prop label="Tom">
          <Select
            value={draft.tone}
            onChange={(e) => {
              const tone = NARRATION_TONES.find((t) => t.id === e.target.value);
              set({ tone: e.target.value, instructions: tone ? tone.instructions : draft.instructions });
            }}
          >
            {NARRATION_TONES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
            <option value="">Personalizado</option>
          </Select>
        </Prop>
        <Prop label="Direção" hint="Como a voz deve falar: emoção, ritmo, sotaque, ênfases" stacked>
          <textarea
            className="text-edit"
            rows={3}
            value={draft.instructions}
            placeholder="Ex.: animado, ritmo rápido, sotaque paulista"
            onChange={(e) => set({ instructions: e.target.value, tone: "" })}
          />
        </Prop>
        <Prop label="Velocidade">
          <Slider
            value={draft.speed}
            min={NARRATION_SPEED_MIN}
            max={NARRATION_SPEED_MAX}
            step={0.05}
            unit="×"
            format={(v) => v.toFixed(2)}
            parse={Number}
            onChange={(speed) => set({ speed })}
          />
        </Prop>
        <div className="row">
          <span className="spacer" />
          <button
            className="sm primary"
            disabled={busy || !draft.script.trim() || tooLong}
            onClick={generate}
          >
            <Icon name="mic" size={13} />
            {busy ? "Gerando…" : "Gerar narração"}
          </button>
        </div>
        {error && <p className="note error">{error}</p>}
      </Section>

      <Section title="Prévia" actions={draft.takes.length ? <span className="note">{draft.takes.length}</span> : null}>
        {draft.takes.length === 0 ? (
          <p className="note">Gere uma narração para ouvir aqui antes de pôr no vídeo.</p>
        ) : (
          <ul className="narr-takes">
            {draft.takes.map((t) => {
              const cut = playheadSeconds + t.durationSeconds > total + 0.05;
              return (
                <li key={t.id} className="narr-take">
                  <div className="narr-take-head">
                    <strong>{voiceLabel(t.voice)}</strong>
                    <span className="note">
                      {toneLabel(t.tone)} · {t.speed.toFixed(2)}× · {fmt(t.durationSeconds)}
                    </span>
                    <span className="spacer" />
                    <button
                      className="sm icon ghost"
                      title="Tirar da lista"
                      aria-label="Tirar da lista"
                      onClick={() => set({ takes: draft.takes.filter((x) => x.id !== t.id) })}
                    >
                      <Icon name="x" size={12} />
                    </button>
                  </div>
                  <p className="narr-take-text" title={t.script}>
                    {t.script}
                  </p>
                  <audio controls preload="metadata" src={mediaUrl(t.file)} />
                  {cut && (
                    <p className="note">
                      Passa do fim do vídeo a partir do playhead ({fmt(playheadSeconds)}): o final fica cortado.
                    </p>
                  )}
                  <div className="row">
                    <span className="spacer" />
                    <button className="sm primary" onClick={() => addToTimeline(t)}>
                      <Icon name="plus" size={13} />
                      Adicionar à timeline
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className="note">Entra na trilha Narração, no ponto do playhead ({fmt(playheadSeconds)}).</p>
      </Section>
    </>
  );
};
