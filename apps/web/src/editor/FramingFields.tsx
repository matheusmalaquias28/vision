import { isNeutralFraming, NEUTRAL_FRAMING, type Framing } from "@vision/recipe";
import React from "react";
import { Prop, Slider } from "../ui/controls";

const pct = { unit: "%", format: (v: number) => String(Math.round(v)), parse: (s: string) => Number(s) };

/**
 * Enquadramento de um vídeo/imagem dentro da área dele (metade do split,
 * janela do PiP, tela cheia): qual parte aparece quando ele é cortado para
 * caber e quanto aproxima. Centralizado = null na receita.
 */
export const FramingFields: React.FC<{
  value: Framing | null;
  onChange: (f: Framing | null) => void;
}> = ({ value, onChange }) => {
  const f = value ?? NEUTRAL_FRAMING;
  const set = (p: Partial<Framing>) => {
    const next = { ...f, ...p };
    onChange(isNeutralFraming(next) ? null : next);
  };
  return (
    <>
      <Prop label="Subir / descer" hint="Qual parte aparece na área: 0% mostra o topo do vídeo, 100% a base">
        <Slider value={f.y} min={0} max={100} step={1} {...pct} onChange={(v) => set({ y: v })} />
      </Prop>
      <Prop label="Esquerda / direita" hint="0% mostra a borda esquerda, 100% a direita (vídeo mais largo que a área)">
        <Slider value={f.x} min={0} max={100} step={1} {...pct} onChange={(v) => set({ x: v })} />
      </Prop>
      <Prop label="Zoom" hint="Aproxima dentro da área (100% = sem zoom)">
        <Slider
          value={f.zoom}
          min={1}
          max={3}
          step={0.01}
          unit="%"
          format={(v) => String(Math.round(v * 100))}
          parse={(s) => Number(s) / 100}
          onChange={(v) => set({ zoom: v })}
        />
        {value && (
          <button className="sm ghost" title="Volta ao centro, sem zoom" onClick={() => onChange(null)}>
            Centralizar
          </button>
        )}
      </Prop>
    </>
  );
};
