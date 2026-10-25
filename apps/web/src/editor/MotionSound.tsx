import {
  attachMotionSfx,
  motionSfxClip,
  removeMotionSfx,
  setMotionSfx,
  sfxForStyle,
  sfxStyleFor,
  sfxStyleLabel,
  type Asset,
  type Motion,
  type Recipe,
} from "@vision/recipe";
import React, { useEffect, useRef, useState } from "react";
import { mediaUrl } from "../api";
import { Prop, Section, Select, Slider, Toggle } from "../ui/controls";
import { Icon } from "./Icon";

/** Toca um SFX da biblioteca (um por vez) */
function usePreview() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const toggle = (file: string) => {
    if (!audio.current) audio.current = new Audio();
    const a = audio.current;
    if (playing === file) {
      a.pause();
      setPlaying(null);
      return;
    }
    a.src = mediaUrl(file);
    a.currentTime = 0;
    a.onended = () => setPlaying(null);
    a.play().catch(() => setPlaying(null));
    setPlaying(file);
  };
  return { playing, toggle };
}

/** Lista para trocar: os do estilo do motion primeiro, depois o resto por pasta */
const SfxOptions: React.FC<{ motion: Motion; sfx: Asset[] }> = ({ motion, sfx }) => {
  const style = sfxStyleFor(motion);
  const suggested = style ? sfxForStyle(style, sfx) : [];
  const rest = sfx.filter((a) => !suggested.includes(a));
  const byCollection = new Map<string, Asset[]>();
  for (const a of rest) {
    const k = a.collection || "Outros";
    byCollection.set(k, [...(byCollection.get(k) ?? []), a]);
  }
  return (
    <>
      {suggested.length > 0 && (
        <optgroup label={`Sugeridos · ${sfxStyleLabel(motion)}`}>
          {suggested.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </optgroup>
      )}
      {[...byCollection.entries()].map(([k, list]) => (
        <optgroup key={k} label={k}>
          {list.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
};

/** Som do motion selecionado: ouvir, trocar, volume, remover ou adicionar */
export const MotionSoundField: React.FC<{
  recipe: Recipe;
  motion: Motion;
  sfx: Asset[];
  onChange: (r: Recipe) => void;
}> = ({ recipe, motion, sfx, onChange }) => {
  const { playing, toggle } = usePreview();
  const clip = motionSfxClip(recipe, motion.id);
  const pick = (id: string) => {
    const a = sfx.find((x) => x.id === id);
    if (a) onChange(setMotionSfx(recipe, motion.id, a));
  };
  if (sfx.length === 0) {
    return (
      <Prop label="Som">
        <span className="prop-hint inline">Biblioteca sem SFX</span>
      </Prop>
    );
  }
  if (motion.status !== "accepted") {
    return (
      <Prop label="Som">
        <span className="prop-hint inline">
          {recipe.motionStyle.autoSfx && sfxStyleFor(motion) ? `Ao aceitar: ${sfxStyleLabel(motion)?.toLowerCase()}` : "Aceite o motion para pôr som"}
        </span>
      </Prop>
    );
  }
  if (!clip) {
    return (
      <Prop label="Som">
        <Select value="" onChange={(e) => e.target.value && pick(e.target.value)} title="Escolha um efeito sonoro da biblioteca">
          <option value="">Sem som · adicionar…</option>
          <SfxOptions motion={motion} sfx={sfx} />
        </Select>
      </Prop>
    );
  }
  const current = sfx.find((a) => a.id === clip.assetId);
  return (
    <>
      <Prop label="Som" hint="Clipe na trilha Efeitos: arraste para ajustar o tempo; acompanha o motion se ele mudar de lugar">
        <button className={`sm icon ${playing === clip.file ? "primary" : "ghost"}`} title="Ouvir" onClick={() => toggle(clip.file)}>
          <Icon name={playing === clip.file ? "pause" : "play"} size={12} />
        </button>
        <Select value={current?.id ?? ""} onChange={(e) => pick(e.target.value)} title="Trocar o efeito sonoro">
          {!current && <option value="">{clip.file.split("/").pop()}</option>}
          <SfxOptions motion={motion} sfx={sfx} />
        </Select>
        <button className="sm icon ghost" title="Tirar o som deste motion" onClick={() => onChange(removeMotionSfx(recipe, motion.id))}>
          <Icon name="trash" size={12} />
        </button>
      </Prop>
      <Prop label="Volume do som">
        <Slider
          value={clip.volume}
          min={0}
          max={1}
          step={0.01}
          unit="%"
          format={(v) => String(Math.round(v * 100))}
          parse={(s) => Number(s) / 100}
          onChange={(v) =>
            onChange({ ...recipe, audioClips: recipe.audioClips.map((c) => (c.id === clip.id ? { ...c, volume: v } : c)) })
          }
        />
      </Prop>
    </>
  );
};

/** Liga/desliga o som automático e ações em lote */
export const MotionSoundSection: React.FC<{ recipe: Recipe; sfx: Asset[]; onChange: (r: Recipe) => void }> = ({ recipe, sfx, onChange }) => {
  const accepted = recipe.motions.filter((m) => m.status === "accepted");
  const withSound = recipe.audioClips.filter((c) => c.motionId).length;
  const silent = accepted.filter((m) => sfxStyleFor(m) && !motionSfxClip(recipe, m.id));
  // peças no mesmo instante (receita) ganham um som só: conta o que entraria de fato
  const withAll = attachMotionSfx(recipe, silent.map((m) => m.id), sfx);
  const adds = withAll.audioClips.length - recipe.audioClips.length;
  return (
    <Section title="Sons dos motions" defaultOpen={false}>
      <Prop label="Automático" hint="Motion aceito ou inserido ganha um efeito sonoro da biblioteca pelo estilo dele">
        <Toggle
          checked={recipe.motionStyle.autoSfx}
          onChange={(v) => onChange({ ...recipe, motionStyle: { ...recipe.motionStyle, autoSfx: v } })}
          label={recipe.motionStyle.autoSfx ? "Ao aceitar ou inserir" : "Desligado"}
        />
      </Prop>
      {sfx.length === 0 && <p className="note">A biblioteca não tem SFX: importe um pack para usar sons.</p>}
      <div className="row">
        <span className="prop-hint inline">{withSound} motion(s) com som</span>
        <span className="spacer" />
        {adds > 0 && (
          <button className="sm" title="Dá som aos motions aceitos que ainda não têm" onClick={() => onChange(withAll)}>
            Dar som a {adds}
          </button>
        )}
        {withSound > 0 && (
          <button
            className="sm ghost"
            title="Tira todos os sons ligados a motions (os outros efeitos ficam)"
            onClick={() => onChange({ ...recipe, audioClips: recipe.audioClips.filter((c) => !c.motionId) })}
          >
            Tirar todos
          </button>
        )}
      </div>
    </Section>
  );
};
