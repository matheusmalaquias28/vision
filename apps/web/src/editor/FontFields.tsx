import React, { useEffect, useState } from "react";
import { Prop, Select } from "../ui/controls";

/** Fontes da lista rápida (qualquer outra do Google Fonts entra pelo nome) */
export const GOOGLE_FONTS = [
  "Archivo Black",
  "Anton",
  "Bebas Neue",
  "Montserrat",
  "Poppins",
  "Inter",
  "Oswald",
  "Roboto Condensed",
  "Rubik",
  "Barlow Condensed",
  "Nunito",
  "Titan One",
  "Playfair Display",
];

const WEIGHT_LABEL: Record<number, string> = {
  100: "Thin",
  200: "ExtraLight",
  300: "Light",
  400: "Regular",
  500: "Medium",
  600: "SemiBold",
  700: "Bold",
  800: "ExtraBold",
  900: "Black",
};
const ALL_WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];

/** Pesos que cada fonte da lista tem no Google Fonts (as outras: todos) */
const FONT_WEIGHTS: Record<string, number[]> = {
  "Archivo Black": [400],
  Anton: [400],
  "Bebas Neue": [400],
  "Titan One": [400],
  Oswald: [200, 300, 400, 500, 600, 700],
  Rubik: [300, 400, 500, 600, 700, 800, 900],
  Nunito: [200, 300, 400, 500, 600, 700, 800, 900],
};

/**
 * Opções de peso da fonte. Fonte de peso único ganha também "negrito
 * simulado" (900): é o que as legendas usavam antes do controle existir.
 */
function weightOptions(family: string): { value: number; label: string }[] {
  const real = FONT_WEIGHTS[family] ?? ALL_WEIGHTS;
  const options = real.map((w) => ({ value: w, label: `${WEIGHT_LABEL[w]} · ${w}` }));
  if (real[real.length - 1] < 700) options.push({ value: 900, label: "Negrito simulado · 900" });
  return options;
}

const INHERIT = "__inherit";
const CUSTOM = "__custom";

/**
 * Fonte (lista rápida ou nome exato do Google Fonts). Com `inherit`, a
 * primeira opção é "usar a fonte de outro lugar" e vale `null`.
 */
export const FontFields: React.FC<{
  value: string | null;
  onChange: (family: string | null) => void;
  /** Rótulo da opção que herda (ex.: "Mesma da legenda · Poppins"); sem ela, sempre há fonte */
  inherit?: string;
}> = ({ value, onChange, inherit }) => {
  const [custom, setCustom] = useState(value !== null && !GOOGLE_FONTS.includes(value));
  const [draft, setDraft] = useState(value ?? "");
  // modelo pronto, desfazer e afins trocam a fonte por fora
  useEffect(() => {
    setDraft(value ?? "");
    setCustom(value !== null && !GOOGLE_FONTS.includes(value));
  }, [value]);
  // nome vazio é inválido no schema: só grava nome não vazio
  const commit = () => {
    const name = draft.trim();
    if (name) onChange(name);
    else setDraft(value ?? "");
  };
  return (
    <>
      <Prop label="Fonte">
        <Select
          value={custom ? CUSTOM : (value ?? INHERIT)}
          onChange={(e) => {
            const v = e.target.value;
            if (v === CUSTOM) setCustom(true);
            else {
              setCustom(false);
              onChange(v === INHERIT ? null : v);
            }
          }}
        >
          {inherit !== undefined && <option value={INHERIT}>{inherit}</option>}
          {GOOGLE_FONTS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
          <option value={CUSTOM}>Outra do Google Fonts…</option>
        </Select>
      </Prop>
      {custom && (
        <Prop label="Nome exato">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            placeholder="ex.: Luckiest Guy"
          />
        </Prop>
      )}
    </>
  );
};

/** Peso da letra conforme os pesos que a fonte tem */
export const WeightField: React.FC<{ family: string; value: number; onChange: (w: number) => void }> = ({
  family,
  value,
  onChange,
}) => {
  const options = weightOptions(family);
  // peso salvo que não está na lista (ex.: trocou de fonte) continua visível
  if (!options.some((o) => o.value === value)) {
    options.push({ value, label: `${WEIGHT_LABEL[value] ?? value} · ${value}` });
    options.sort((a, b) => a.value - b.value);
  }
  return (
    <Prop label="Peso" hint="Espessura da letra. Pesos que a fonte não tem são simulados pelo navegador.">
      <Select value={String(value)} onChange={(e) => onChange(Number(e.target.value))}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </Prop>
  );
};
