import { insertClipSegment, outputToSource, type Recipe, type Segment } from "@vision/recipe";
import React, { useState } from "react";
import { addSourceClip } from "../api";
import { inspectMediaFile } from "./mediaFiles";
import { Prop, Section, Select } from "../ui/controls";
import { FramingFields } from "./FramingFields";
import { Icon } from "./Icon";

interface MediaPanelProps {
  recipe: Recipe;
  /** Playhead no tempo do vídeo final — ponto de inserção do clipe */
  playheadSeconds: number;
  onChange: (recipe: Recipe) => void;
}

/**
 * Insere um vídeo próprio como CLIPE na sequência principal (tela cheia,
 * empurra o resto). A mídia vira uma nova `source` (registrada no servidor via
 * probe) e um `segment` no ponto do playhead. Sobreposições (PiP/split) ficam
 * em Overlays.
 */
export const MediaPanel: React.FC<MediaPanelProps> = ({ recipe, playheadSeconds, onChange }) => {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const insertClip = async (file: File) => {
    setError(null);
    const info = await inspectMediaFile(file);
    if ("error" in info || info.kind !== "video") {
      setError("error" in info ? info.error : `${file.name}: escolha um arquivo de vídeo`);
      return;
    }
    setBusy(true);
    try {
      const { source } = await addSourceClip(recipe.projectId, file, setProgress);
      const clip: Segment = {
        id: `seg_clip_${Date.now().toString(36)}`,
        sourceId: source.id,
        sourceStart: 0,
        sourceEnd: source.durationInSeconds,
      };
      onChange({
        ...recipe,
        sources: [...recipe.sources, source],
        timeline: {
          ...recipe.timeline,
          segments: insertClipSegment(recipe.timeline.segments, clip, playheadSeconds),
        },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // enquadramento do vídeo sob o playhead (ou o escolhido): sobe/desce quando ele é cortado
  const [picked, setPicked] = useState<string | null>(null);
  const atPlayhead = outputToSource(recipe.timeline.segments, playheadSeconds)?.sourceId ?? null;
  const framed = recipe.sources.find((s) => s.id === (picked ?? atPlayhead)) ?? recipe.sources[0];

  return (
    <>
    {framed && (
      <Section title="Enquadramento do vídeo">
        <p className="note">
          Escolhe a parte que aparece quando o vídeo é cortado para caber: na metade de um split, ou
          um vídeo horizontal no quadro vertical. Vale para todos os trechos desse vídeo.
        </p>
        {recipe.sources.length > 1 && (
          <Prop label="Vídeo">
            <Select value={framed.id} onChange={(e) => setPicked(e.target.value)}>
              {recipe.sources.map((s, i) => (
                <option key={s.id} value={s.id}>
                  {`Vídeo ${i + 1}${s.name ? ` · ${s.name}` : ""}`}
                </option>
              ))}
            </Select>
          </Prop>
        )}
        <FramingFields
          value={framed.framing}
          onChange={(framing) =>
            onChange({ ...recipe, sources: recipe.sources.map((s) => (s.id === framed.id ? { ...s, framing } : s)) })
          }
        />
      </Section>
    )}
    <Section title="Inserir clipe na sequência">
      <p className="note">
        Entra em tela cheia no playhead ({playheadSeconds.toFixed(1)}s) e empurra o resto. Para
        sobrepor ao vídeo, use Overlays abaixo. Também dá para arrastar arquivos direto para a
        timeline. Até 60 s e 300 MB por clipe.
      </p>
      <div className="row">
        <label className={`file-btn ${busy ? "disabled" : ""}`}>
          <Icon name="upload" size={14} />
          {busy ? (progress < 1 ? `Enviando ${Math.round(progress * 100)}%` : "Preparando…") : "Escolher vídeo"}
          <input
            type="file"
            accept="video/*"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) insertClip(f).catch(() => undefined);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {error && <p className="note error">{error}</p>}
    </Section>
    </>
  );
};
