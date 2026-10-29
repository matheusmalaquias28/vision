import { segmentDuration, type ElementAnim, type Recipe } from "@vision/recipe";
import React from "react";
import { Section } from "../ui/controls";
import { AnimFields } from "./AnimFields";

interface SegmentPanelProps {
  recipe: Recipe;
  segmentId: string;
  onChange: (recipe: Recipe) => void;
}

/** Trecho de vídeo selecionado na timeline: entrada e saída dele */
export const SegmentPanel: React.FC<SegmentPanelProps> = ({ recipe, segmentId, onChange }) => {
  const segments = recipe.timeline.segments;
  const seg = segments.find((s) => s.id === segmentId);
  if (!seg) return null;
  const source = recipe.sources.find((s) => s.id === seg.sourceId);
  const patch = (p: { enter?: ElementAnim | null; exit?: ElementAnim | null }) =>
    onChange({
      ...recipe,
      timeline: { ...recipe.timeline, segments: segments.map((s) => (s.id === seg.id ? { ...s, ...p } : s)) },
    });
  return (
    <Section key={seg.id} title="Trecho do vídeo · entrada e saída">
      <p className="prop-hint">
        {source?.name || source?.file.split("/").pop()} · {segmentDuration(seg).toFixed(1)} s. Dividir o trecho deixa a
        entrada no primeiro pedaço e a saída no último.
      </p>
      <AnimFields enter={seg.enter} exit={seg.exit} noneLabel="Nenhum (corte seco)" onChange={patch} />
    </Section>
  );
};
