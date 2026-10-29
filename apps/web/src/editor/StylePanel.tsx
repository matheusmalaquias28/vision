import { regroupBlocks, type Recipe } from "@vision/recipe";
import React from "react";
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
import { FontFields, WeightField } from "./FontFields";

type CaptionStyle = Recipe["captions"]["style"];

/** Modelos prontos: fonte + contorno + animação de uma vez (o resto do estilo fica) */
const CAPTION_MODELS: { id: string; label: string; title: string; patch: Partial<CaptionStyle> }[] = [
  {
    id: "classico",
    label: "Clássico",
    title: "Poppins Black, contorno grosso, entra com pop (o padrão)",
    patch: { fontFamily: "Poppins", fontWeight: 900, strokeWidthPx: 6, uppercase: true, animation: "pop" },
  },
  {
    id: "suave",
    label: "Suave",
    title: "A frase sobe e aparece com desaceleração; a palavra falada ganha cor aos poucos",
    patch: { fontFamily: "Poppins", fontWeight: 800, strokeWidthPx: 4, uppercase: true, animation: "smooth" },
  },
  {
    id: "palavra",
    label: "Palavra a palavra",
    title: "Cada palavra surge quando é dita, subindo e saindo do desfoque",
    patch: { fontFamily: "Montserrat", fontWeight: 900, strokeWidthPx: 5, uppercase: true, animation: "reveal" },
  },
  {
    id: "caixa",
    label: "Caixa",
    title: "Uma pílula na cor de destaque aparece atrás da palavra falada",
    patch: { fontFamily: "Poppins", fontWeight: 800, strokeWidthPx: 3, uppercase: true, animation: "box" },
  },
  {
    id: "elegante",
    label: "Elegante",
    title: "Serifada, sem contorno, sai do desfoque com as letras se aproximando",
    patch: { fontFamily: "Playfair Display", fontWeight: 700, strokeWidthPx: 0, uppercase: false, animation: "blur" },
  },
];

const ANIMATION_OPTIONS: { value: CaptionStyle["animation"]; label: string }[] = [
  { value: "pop", label: "Pop (padrão)" },
  { value: "smooth", label: "Suave" },
  { value: "reveal", label: "Palavra a palavra" },
  { value: "box", label: "Caixa no destaque" },
  { value: "blur", label: "Desfoque elegante" },
  { value: "none", label: "Nenhuma" },
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

  const activeModel = CAPTION_MODELS.find(
    (m) => m.patch.animation === style.animation && m.patch.fontFamily === style.fontFamily
  )?.id;

  return (
    <>
      <Section title="Modelo da legenda">
        <div className="caption-models">
          {CAPTION_MODELS.map((m) => (
            <button
              key={m.id}
              className={`sm ${activeModel === m.id ? "primary" : ""}`}
              title={m.title}
              onClick={() => setStyle(m.patch)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="prop-hint">Ajusta fonte, contorno e animação; cores, tamanho e posição continuam os seus.</p>
      </Section>
      <Section title="Texto">
        <FontFields value={style.fontFamily} onChange={(f) => f && setStyle({ fontFamily: f })} />
        <WeightField family={style.fontFamily} value={style.fontWeight} onChange={(w) => setStyle({ fontWeight: w })} />
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
        <Prop label="Linhas por vez">
          <Segmented
            value={style.maxLines}
            options={[
              { value: 1, label: "1", title: "Uma linha; frase longa vira mais partes" },
              { value: 2, label: "2" },
              { value: 3, label: "3" },
            ]}
            onChange={(v) => setStyle({ maxLines: v })}
          />
        </Prop>
        <Prop label="Animação">
          <Select
            value={style.animation}
            onChange={(e) => setStyle({ animation: e.target.value as CaptionStyle["animation"] })}
          >
            {ANIMATION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
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
