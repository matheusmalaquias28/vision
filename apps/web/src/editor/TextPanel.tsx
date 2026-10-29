import { DEFAULT_TITLE_STYLE, outputDuration, type Overlay, type Recipe, type TitleStyle } from "@vision/recipe";
import React, { useEffect, useState } from "react";
import { ColorField, Prop, ScrubNumber, Section, Segmented, Slider, Toggle } from "../ui/controls";
import { AnimFields } from "./AnimFields";
import { FontFields, WeightField } from "./FontFields";
import { Icon } from "./Icon";

interface TextPanelProps {
  recipe: Recipe;
  selectedId: string | null;
  playheadSeconds: number;
  onChange: (recipe: Recipe) => void;
  onSelect: (id: string | null) => void;
}

/** Headline: o vídeo todo, no topo, faixa preta atrás de cada linha */
const HEADLINE_STYLE: TitleStyle = {
  ...DEFAULT_TITLE_STYLE,
  fontSize: 64,
  fontWeight: 800,
  uppercase: false,
  strokeWidth: 0,
  boxColor: "#000000",
  maxWidth: 86,
};

function newId(overlays: Overlay[]): string {
  return `tx_${String(overlays.length + 1).padStart(2, "0")}_${Date.now().toString(36)}`;
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
}

/** Campo do texto: dá para apagar tudo e redigitar (vazio não vale no schema, então só grava com texto) */
const TextField: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => {
  const [draft, setDraft] = useState(value);
  // desfazer/refazer e outras mudanças de fora aparecem no campo
  useEffect(() => {
    setDraft((d) => (d.trim() && d !== value ? value : d));
  }, [value]);
  return (
    <textarea
      className="text-edit"
      rows={3}
      value={draft}
      placeholder="Digite o texto · Enter quebra a linha"
      onChange={(e) => {
        setDraft(e.target.value);
        if (e.target.value.trim()) onChange(e.target.value);
      }}
    />
  );
};

/**
 * Textos livres sobre o vídeo (overlay "title"): headline do início ao fim,
 * avisos, chamadas. À parte da legenda automática: transcrever, cortar ou
 * reagrupar a legenda nunca mexe neles, e eles têm trilha própria (Textos).
 */
export const TextPanel: React.FC<TextPanelProps> = ({ recipe, selectedId, playheadSeconds, onChange, onSelect }) => {
  const texts = recipe.overlays.filter((o) => o.kind === "title").sort((a, b) => a.start - b.start);
  const text = texts.find((o) => o.id === selectedId) ?? null;
  const duration = outputDuration(recipe.timeline.segments);

  const patch = (p: Partial<Overlay>) => {
    if (!text) return;
    onChange({ ...recipe, overlays: recipe.overlays.map((o) => (o.id === text.id ? ({ ...o, ...p } as Overlay) : o)) });
  };
  const setStyle = (p: Partial<TitleStyle>) => text && patch({ titleStyle: { ...text.titleStyle, ...p } });

  const add = (headline: boolean) => {
    const start = headline ? 0 : Math.round(playheadSeconds * 100) / 100;
    const o: Overlay = {
      id: newId(recipe.overlays),
      kind: "title",
      text: headline ? "Sua headline aqui" : "TEXTO",
      file: null,
      start,
      end: headline ? null : Math.min(Math.round((start + 4) * 100) / 100, duration),
      position: "top",
      layout: "overlay",
      blend: "normal",
      opacity: 1,
      scale: 0.4,
      assetId: null,
      mediaDurationSeconds: null,
      placement: null,
      framing: null,
      titleStyle: headline ? HEADLINE_STYLE : DEFAULT_TITLE_STYLE,
      enter: null,
      exit: null,
    };
    onChange({ ...recipe, overlays: [...recipe.overlays, o] });
    onSelect(o.id);
  };

  const remove = () => {
    if (!text) return;
    onChange({ ...recipe, overlays: recipe.overlays.filter((o) => o.id !== text.id) });
    onSelect(null);
  };

  const s = text?.titleStyle;

  return (
    <>
      <Section
        title={`Textos (${texts.length})`}
        actions={
          <>
            <button className="sm" onClick={() => add(true)} title="Do início ao fim do vídeo, no topo">
              <Icon name="text" size={13} /> Headline
            </button>
            <button className="sm" onClick={() => add(false)} title="Texto de 4 s no playhead">
              <Icon name="plus" size={13} /> Texto
            </button>
          </>
        }
      >
        {texts.length === 0 ? (
          <p className="empty-hint">
            Texto à parte da legenda: uma <strong>headline</strong> do início ao fim ou um <strong>texto</strong> no
            playhead. A legenda automática nunca mexe neles.
          </p>
        ) : (
          <div className="list">
            {texts.map((o) => (
              <div
                key={o.id}
                className={`list-row ${o.id === selectedId ? "selected" : ""}`}
                onClick={() => onSelect(o.id === selectedId ? null : o.id)}
              >
                <span className="lr-time">{fmtTime(o.start)}</span>
                <Icon name="text" size={13} />
                <span className="lr-main">{o.text.replace(/\s+/g, " ")}</span>
                {o.start <= 0.05 && o.end === null && <span className="pill">vídeo todo</span>}
              </div>
            ))}
          </div>
        )}
      </Section>

      {text && s && (
        <>
          <Section
            key={text.id}
            title="Texto · conteúdo"
            actions={
              <button className="sm ghost danger" onClick={remove} title="Apagar este texto">
                <Icon name="trash" size={13} />
              </button>
            }
          >
            <Prop label="Texto" stacked>
              <TextField value={text.text} onChange={(v) => patch({ text: v })} />
            </Prop>
            <Prop label="Início">
              <ScrubNumber
                value={text.start}
                min={0}
                max={duration}
                step={0.1}
                unit="s"
                onChange={(v) => patch({ start: v })}
              />
            </Prop>
            <Prop label="Até o fim do vídeo">
              <Toggle
                checked={text.end === null}
                onChange={(v) => patch({ end: v ? null : Math.min(Math.round((text.start + 4) * 10) / 10, duration) })}
                label="Até o fim do vídeo"
              />
              {text.end !== null && (
                <ScrubNumber
                  value={text.end}
                  min={text.start + 0.1}
                  max={duration}
                  step={0.1}
                  unit="s"
                  onChange={(v) => patch({ end: v })}
                />
              )}
            </Prop>
            <Prop label="Posição" hint="Arraste no preview para posição livre">
              <Segmented
                size="sm"
                value={text.placement ? "free" : text.position}
                options={[
                  { value: "top", label: "Topo" },
                  { value: "center", label: "Meio" },
                  { value: "bottom", label: "Base" },
                  ...(text.placement ? [{ value: "free" as const, label: "Livre" }] : []),
                ]}
                onChange={(v) => v !== "free" && patch({ position: v, placement: null })}
              />
            </Prop>
          </Section>

          <Section title="Texto · estilo">
            <FontFields
              value={s.fontFamily}
              onChange={(f) => setStyle({ fontFamily: f })}
              inherit={`Mesma da legenda · ${recipe.captions.style.fontFamily}`}
            />
            <Prop label="Tamanho" hint="Também pela alça no canto do texto, no preview">
              <Slider
                value={s.fontSize}
                min={16}
                max={240}
                step={2}
                unit="px"
                onChange={(v) => setStyle({ fontSize: v })}
              />
            </Prop>
            <WeightField
              family={s.fontFamily ?? recipe.captions.style.fontFamily}
              value={s.fontWeight}
              onChange={(w) => setStyle({ fontWeight: w })}
            />
            <Prop label="Alinhar">
              <Segmented
                size="sm"
                value={s.align}
                options={[
                  { value: "left", label: "Esq." },
                  { value: "center", label: "Centro" },
                  { value: "right", label: "Dir." },
                ]}
                onChange={(v) => setStyle({ align: v })}
              />
            </Prop>
            <Prop label="Caixa alta">
              <Toggle checked={s.uppercase} onChange={(v) => setStyle({ uppercase: v })} label="Caixa alta" />
            </Prop>
            <Prop label="Cor">
              <ColorField value={s.color} onChange={(v) => setStyle({ color: v })} />
            </Prop>
            <Prop label="Contorno">
              <Slider
                value={s.strokeWidth}
                min={0}
                max={30}
                step={1}
                unit="px"
                onChange={(v) => setStyle({ strokeWidth: v })}
              />
            </Prop>
            {s.strokeWidth > 0 && (
              <Prop label="Cor do contorno">
                <ColorField value={s.strokeColor} onChange={(v) => setStyle({ strokeColor: v })} />
              </Prop>
            )}
            <Prop label="Faixa atrás">
              <Toggle
                checked={s.boxColor !== null}
                onChange={(v) => setStyle({ boxColor: v ? "#000000" : null })}
                label="Faixa atrás do texto"
              />
              {s.boxColor !== null && <ColorField value={s.boxColor} onChange={(v) => setStyle({ boxColor: v })} />}
            </Prop>
            <Prop label="Largura máx.">
              <Slider
                value={s.maxWidth}
                min={20}
                max={100}
                step={1}
                unit="%"
                onChange={(v) => setStyle({ maxWidth: v })}
              />
            </Prop>
          </Section>

          <Section title="Texto · entrada e saída">
            <AnimFields enter={text.enter} exit={text.exit} noneLabel="Padrão do texto" onChange={patch} />
          </Section>
        </>
      )}
    </>
  );
};
