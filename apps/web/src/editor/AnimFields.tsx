import {
  ANIM_EFFECTS,
  ANIM_LABEL,
  EASING_LABEL,
  EASINGS,
  type AnimEffect,
  type Easing,
  type ElementAnim,
} from "@vision/recipe";
import React from "react";
import { Prop, ScrubNumber, Select } from "../ui/controls";

const NONE = "__none";

/** Uma linha: efeito + duração + curva (efeito "nenhum" esconde o resto) */
const AnimRow: React.FC<{
  label: string;
  value: ElementAnim | null | undefined;
  /** Rótulo de "sem efeito escolhido" (ex.: "Padrão do layout") */
  noneLabel: string;
  onChange: (v: ElementAnim | null) => void;
}> = ({ label, value, noneLabel, onChange }) => (
  <>
    <Prop label={label}>
      <Select
        value={value?.effect ?? NONE}
        onChange={(e) =>
          onChange(
            e.target.value === NONE
              ? null
              : { duration: 0.5, easing: "ease-out", ...value, effect: e.target.value as AnimEffect }
          )
        }
      >
        <option value={NONE}>{noneLabel}</option>
        {ANIM_EFFECTS.map((fx) => (
          <option key={fx} value={fx}>
            {ANIM_LABEL[fx]}
          </option>
        ))}
      </Select>
    </Prop>
    {value && (
      <Prop label="Duração · curva" hint="Ease in: começa devagar · Ease out: termina devagar">
        <ScrubNumber
          value={value.duration}
          min={0.1}
          max={3}
          step={0.1}
          unit="s"
          pxPerStep={8}
          onChange={(v) => onChange({ ...value, duration: v })}
        />
        <Select
          value={value.easing}
          disabled={value.effect === "pop"}
          title={value.effect === "pop" ? "O pop tem a própria curva (quique)" : undefined}
          onChange={(e) => onChange({ ...value, easing: e.target.value as Easing })}
        >
          {EASINGS.map((c) => (
            <option key={c} value={c}>
              {EASING_LABEL[c]}
            </option>
          ))}
        </Select>
      </Prop>
    )}
  </>
);

/** Entrada e saída padronizadas de um elemento da timeline (trecho, mídia, texto) */
export const AnimFields: React.FC<{
  enter: ElementAnim | null | undefined;
  exit: ElementAnim | null | undefined;
  noneLabel: string;
  onChange: (p: { enter?: ElementAnim | null; exit?: ElementAnim | null }) => void;
}> = ({ enter, exit, noneLabel, onChange }) => (
  <>
    <AnimRow label="Entrada" value={enter} noneLabel={noneLabel} onChange={(v) => onChange({ enter: v })} />
    <AnimRow label="Saída" value={exit} noneLabel={noneLabel} onChange={(v) => onChange({ exit: v })} />
  </>
);
