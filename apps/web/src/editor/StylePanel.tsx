import { regroupBlocks, type Recipe } from "@vision/recipe";
import React, { useEffect, useState } from "react";
import {
  ColorField,
  Prop,
  ScrubNumber,
  Section,
  Segmented,
  Select,
  Slider,
  Toggle,
} from "../ui/controls";

const GOOGLE_FONTS = [
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

interface StylePanelProps {
  recipe: Recipe;
  onChange: (recipe: Recipe) => void;
}

export const StylePanel: React.FC<StylePanelProps> = ({ recipe, onChange }) => {
  const style = recipe.captions.style;

  const setStyle = (patch: Partial<Recipe["captions"]["style"]>) => {
    onChange({
      ...recipe,
      captions: { ...recipe.captions, style: { ...style, ...patch } },
    });
  };

  const regroup = () => {
    onChange({
      ...recipe,
      captions: {
        ...recipe.captions,
        blocks: regroupBlocks(recipe.captions.blocks, style.maxWordsPerBlock),
      },
    });
  };

  const [customFont, setCustomFont] = useState(!GOOGLE_FONTS.includes(style.fontFamily));
  const [fontDraft, setFontDraft] = useState(style.fontFamily);
  useEffect(() => setFontDraft(style.fontFamily), [style.fontFamily]);
  // fontFamily vazio é inválido no schema: só grava nome não vazio
  const commitFont = () => {
    const name = fontDraft.trim();
    if (name) setStyle({ fontFamily: name });
    else setFontDraft(style.fontFamily);
  };

  return (
    <>
      <Section title="Texto">
        <Prop label="Fonte">
          <Select
            value={customFont ? "__custom" : style.fontFamily}
            onChange={(e) => {
              if (e.target.value === "__custom") {
                setCustomFont(true);
              } else {
                setCustomFont(false);
                setStyle({ fontFamily: e.target.value });
              }
            }}
          >
            {GOOGLE_FONTS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
            <option value="__custom">Outra do Google Fonts…</option>
          </Select>
        </Prop>
        {customFont && (
          <Prop label="Nome exato">
            <input
              value={fontDraft}
              onChange={(e) => setFontDraft(e.target.value)}
              onBlur={commitFont}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              placeholder="ex.: Luckiest Guy"
            />
          </Prop>
        )}
        <Prop label="Peso" hint="Espessura da letra. Pesos que a fonte não tem são simulados pelo navegador.">
          <Select
            value={String(style.fontWeight)}
            onChange={(e) => setStyle({ fontWeight: Number(e.target.value) })}
          >
            {(() => {
              const options = weightOptions(style.fontFamily);
              // peso salvo que não está na lista (ex.: trocou de fonte) continua visível
              if (!options.some((o) => o.value === style.fontWeight)) {
                options.push({ value: style.fontWeight, label: `${WEIGHT_LABEL[style.fontWeight]} · ${style.fontWeight}` });
                options.sort((a, b) => a.value - b.value);
              }
              return options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ));
            })()}
          </Select>
        </Prop>
        <Prop label="Tamanho">
          <Slider
            value={style.fontSizePx}
            min={32}
            max={140}
            step={2}
            unit="px"
            onChange={(v) => setStyle({ fontSizePx: v })}
          />
        </Prop>
        <Prop label="Caixa alta">
          <Toggle checked={style.uppercase} onChange={(v) => setStyle({ uppercase: v })} label="Caixa alta" />
        </Prop>
        <Prop label="Cor">
          <ColorField value={style.textColor} onChange={(v) => setStyle({ textColor: v })} />
        </Prop>
        <Prop label="Destaque" hint="Cor da palavra sendo falada">
          <ColorField value={style.highlightColor} onChange={(v) => setStyle({ highlightColor: v })} />
        </Prop>
      </Section>

      <Section title="Contorno">
        <Prop label="Espessura">
          <Slider
            value={style.strokeWidthPx}
            min={0}
            max={30}
            step={1}
            unit="px"
            onChange={(v) => setStyle({ strokeWidthPx: v })}
          />
        </Prop>
        <Prop label="Cor">
          <ColorField value={style.strokeColor} onChange={(v) => setStyle({ strokeColor: v })} />
        </Prop>
      </Section>

      <Section title="Layout e animação">
        <Prop label="Posição">
          <Segmented
            value={style.position}
            options={[
              { value: "bottom-third", label: "Terço inferior" },
              { value: "center", label: "Centro" },
            ]}
            onChange={(v) => setStyle({ position: v })}
          />
        </Prop>
        <Prop label="Largura máx.">
          <Slider
            value={style.maxWidthPct}
            min={40}
            max={100}
            step={5}
            unit="%"
            onChange={(v) => setStyle({ maxWidthPct: v })}
          />
        </Prop>
        <Prop label="Palavras/linha" hint="0 = automático">
          <ScrubNumber
            value={style.wordsPerLine}
            min={0}
            max={8}
            step={1}
            pxPerStep={12}
            format={(v) => (v === 0 ? "auto" : String(v))}
            parse={(s) => (s === "auto" ? 0 : Number(s))}
            onChange={(v) => setStyle({ wordsPerLine: v })}
          />
        </Prop>
        <Prop label="Ajustar à largura">
          <Toggle checked={style.autoFit} onChange={(v) => setStyle({ autoFit: v })} label="Ajustar à largura" />
        </Prop>
        <Prop label="Entrada">
          <Segmented
            value={style.animation}
            options={[
              { value: "pop", label: "Pop" },
              { value: "none", label: "Nenhuma" },
            ]}
            onChange={(v) => setStyle({ animation: v })}
          />
        </Prop>
        <Prop label="Palavras/bloco">
          <ScrubNumber
            value={style.maxWordsPerBlock}
            min={1}
            max={8}
            step={1}
            pxPerStep={12}
            onChange={(v) => setStyle({ maxWordsPerBlock: v })}
          />
          <button
            className="sm"
            onClick={regroup}
            disabled={recipe.captions.blocks.length === 0}
            title="Redivide os blocos existentes com esse número de palavras"
          >
            Reagrupar
          </button>
        </Prop>
      </Section>
    </>
  );
};
