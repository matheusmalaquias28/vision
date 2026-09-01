import { regroupBlocks, type Recipe } from "@vision/recipe";
import React from "react";

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

  const customFont = !GOOGLE_FONTS.includes(style.fontFamily);

  return (
    <section className="panel">
      <h2>Estilo da legenda</h2>
      <div className="field-row">
        <label className="field">
          Fonte (Google Fonts)
          <select
            value={customFont ? "__custom" : style.fontFamily}
            onChange={(e) => {
              if (e.target.value !== "__custom") {
                setStyle({ fontFamily: e.target.value });
              }
            }}
          >
            {GOOGLE_FONTS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
            <option value="__custom">Outra...</option>
          </select>
        </label>
        <label className="field">
          Nome exato da fonte
          <input
            value={style.fontFamily}
            onChange={(e) => setStyle({ fontFamily: e.target.value })}
            placeholder="ex: Luckiest Guy"
          />
        </label>
      </div>
      <label className="field">
        Tamanho: {style.fontSizePx}px
        <input
          type="range"
          min={32}
          max={140}
          step={2}
          value={style.fontSizePx}
          onChange={(e) => setStyle({ fontSizePx: Number(e.target.value) })}
        />
      </label>
      <div className="field-row">
        <label className="field">
          Cor da letra
          <input
            type="color"
            value={style.textColor}
            onChange={(e) => setStyle({ textColor: e.target.value })}
          />
        </label>
        <label className="field">
          Cor de destaque
          <input
            type="color"
            value={style.highlightColor}
            onChange={(e) => setStyle({ highlightColor: e.target.value })}
          />
        </label>
        <label className="field">
          Posição
          <select
            value={style.position}
            onChange={(e) =>
              setStyle({ position: e.target.value as "center" | "bottom-third" })
            }
          >
            <option value="bottom-third">Terço inferior</option>
            <option value="center">Centro</option>
          </select>
        </label>
      </div>
      <div className="field-row">
        <label className="field checkbox-field">
          <span>
            <input
              type="checkbox"
              checked={style.uppercase}
              onChange={(e) => setStyle({ uppercase: e.target.checked })}
            />{" "}
            CAIXA ALTA
          </span>
        </label>
        <label className="field">
          Palavras por linha (0 = auto)
          <input
            type="number"
            min={0}
            max={8}
            value={style.wordsPerLine}
            onChange={(e) =>
              setStyle({
                wordsPerLine: Math.max(0, Math.min(8, Number(e.target.value))),
              })
            }
          />
        </label>
        <label className="field">
          Largura máx: {style.maxWidthPct}%
          <input
            type="range"
            min={40}
            max={100}
            step={5}
            value={style.maxWidthPct}
            onChange={(e) => setStyle({ maxWidthPct: Number(e.target.value) })}
          />
        </label>
      </div>
      <div className="field-row">
        <label className="field">
          Contorno: {style.strokeWidthPx}px
          <input
            type="range"
            min={0}
            max={30}
            step={1}
            value={style.strokeWidthPx}
            onChange={(e) => setStyle({ strokeWidthPx: Number(e.target.value) })}
          />
        </label>
        <label className="field">
          Cor do contorno
          <input
            type="color"
            value={style.strokeColor}
            onChange={(e) => setStyle({ strokeColor: e.target.value })}
          />
        </label>
      </div>
      <div className="field-row">
        <label className="field checkbox-field">
          <span>
            <input
              type="checkbox"
              checked={style.animation === "pop"}
              onChange={(e) =>
                setStyle({ animation: e.target.checked ? "pop" : "none" })
              }
            />{" "}
            Animação de entrada (pop)
          </span>
        </label>
        <label className="field checkbox-field">
          <span>
            <input
              type="checkbox"
              checked={style.autoFit}
              onChange={(e) => setStyle({ autoFit: e.target.checked })}
            />{" "}
            Ajustar tamanho à largura
          </span>
        </label>
      </div>
      <div className="field-row regroup-row">
        <label className="field">
          Palavras por bloco
          <input
            type="number"
            min={1}
            max={8}
            value={style.maxWordsPerBlock}
            onChange={(e) =>
              setStyle({
                maxWordsPerBlock: Math.max(1, Math.min(8, Number(e.target.value))),
              })
            }
          />
        </label>
        <button onClick={regroup} disabled={recipe.captions.blocks.length === 0}>
          Reagrupar blocos
        </button>
      </div>
    </section>
  );
};
