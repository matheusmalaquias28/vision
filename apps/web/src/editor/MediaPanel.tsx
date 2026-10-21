import { insertClipSegment, type Recipe, type Segment } from "@vision/recipe";
import React, { useState } from "react";
import { addSourceClip } from "../api";
import { Section } from "../ui/controls";
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
  const [error, setError] = useState<string | null>(null);

  const insertClip = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const { source } = await addSourceClip(recipe.projectId, file);
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

  return (
    <Section title="Inserir clipe na sequência">
      <p className="note">
        Entra em tela cheia no playhead ({playheadSeconds.toFixed(1)}s) e empurra o resto. Para
        sobrepor ao vídeo, use Overlays abaixo.
      </p>
      <div className="row">
        <label className={`file-btn ${busy ? "disabled" : ""}`}>
          <Icon name="upload" size={14} />
          {busy ? "Enviando…" : "Escolher vídeo"}
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
  );
};
