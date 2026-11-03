import { segmentDuration, segmentFraming, type ElementAnim, type Framing, type Recipe, type Segment } from "@vision/recipe";
import React from "react";
import { Prop, Section, Slider, Toggle } from "../ui/controls";
import { AnimFields } from "./AnimFields";
import { FramingFields } from "./FramingFields";

interface SegmentPanelProps {
  recipe: Recipe;
  segmentId: string;
  onChange: (recipe: Recipe) => void;
}

/** Trecho de vídeo selecionado na timeline: escala/enquadramento, entrada e saída dele */
export const SegmentPanel: React.FC<SegmentPanelProps> = ({ recipe, segmentId, onChange }) => {
  const segments = recipe.timeline.segments;
  const seg = segments.find((s) => s.id === segmentId);
  if (!seg) return null;
  const source = recipe.sources.find((s) => s.id === seg.sourceId);
  const patch = (p: Partial<Pick<Segment, "enter" | "exit" | "framing" | "muted" | "volume">>) =>
    onChange({
      ...recipe,
      timeline: { ...recipe.timeline, segments: segments.map((s) => (s.id === seg.id ? { ...s, ...p } : s)) },
    });
  // trechos do mesmo vídeo (para "aplicar a todos")
  const siblings = segments.filter((s) => s.sourceId === seg.sourceId);
  const applyToSiblings = (framing: Framing | null) =>
    onChange({
      ...recipe,
      timeline: {
        ...recipe.timeline,
        segments: segments.map((s) => (s.sourceId === seg.sourceId ? { ...s, framing } : s)),
      },
    });
  const own = seg.framing != null;
  return (
    <>
      <Section
        key={`${seg.id}-framing`}
        title="Trecho do vídeo · escala, enquadramento e som"
        actions={own ? <span className="pill">só este trecho</span> : <span className="cr-muted">o do vídeo</span>}
      >
        <p className="prop-hint">
          {source?.name || source?.file.split("/").pop()} · {segmentDuration(seg).toFixed(1)} s. Mexer aqui muda só
          este pedaço; os outros pedaços do mesmo vídeo ficam como estão.
        </p>
        <FramingFields
          value={segmentFraming(seg, source)}
          // centralizar = escala original neste trecho, mesmo que o vídeo todo tenha zoom
          onChange={(framing) => patch({ framing: framing ?? { x: 50, y: 50, zoom: 1 } })}
        />
        <Prop label="Som do trecho" hint="Desligado quando o áudio foi extraído para a trilha de Efeitos (botão direito → Extrair áudio)">
          <Toggle checked={!seg.muted} onChange={(on) => patch({ muted: on ? null : true })} label="Som do trecho" />
        </Prop>
        {!seg.muted && (
          <Prop label="Volume do trecho" hint="O mesmo da linha amarela na trilha Áudio do vídeo; multiplica o volume geral do vídeo (aba Áudio)">
            <Slider
              value={seg.volume ?? 1}
              min={0}
              max={1}
              step={0.01}
              unit="%"
              format={(v) => String(Math.round(v * 100))}
              parse={(s) => Number(s) / 100}
              onChange={(v) => patch({ volume: v === 1 ? null : v })}
            />
          </Prop>
        )}
        <div className="row row-end">
          {own && (
            <button className="sm ghost" title="Volta a seguir o enquadramento do vídeo todo" onClick={() => patch({ framing: null })}>
              Usar o do vídeo
            </button>
          )}
          {siblings.length > 1 && (
            <button
              className="sm ghost"
              title={`Copia esta escala/enquadramento para os ${siblings.length} trechos deste vídeo`}
              onClick={() => applyToSiblings(seg.framing ?? null)}
            >
              Aplicar a todos os trechos
            </button>
          )}
        </div>
      </Section>
      <Section key={seg.id} title="Trecho do vídeo · entrada e saída">
        <p className="prop-hint">Dividir o trecho deixa a entrada no primeiro pedaço e a saída no último.</p>
        <AnimFields enter={seg.enter} exit={seg.exit} noneLabel="Nenhum (corte seco)" onChange={patch} />
      </Section>
    </>
  );
};
