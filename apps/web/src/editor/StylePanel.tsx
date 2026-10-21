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
