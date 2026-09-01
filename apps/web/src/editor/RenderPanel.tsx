import type { Recipe } from "@vision/recipe";
import React, { useEffect, useRef, useState } from "react";
import { getRenderJob, putRecipe, startRender, type RenderJob } from "../api";

interface RenderPanelProps {
  recipe: Recipe;
  dirty: boolean;
  onSaved: () => void;
}

export const RenderPanel: React.FC<RenderPanelProps> = ({
  recipe,
  dirty,
  onSaved,
}) => {
  const [job, setJob] = useState<RenderJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  const rendering = job !== null && (job.status === "queued" || job.status === "rendering");

  const render = async () => {
    setError(null);
    try {
      // garante que o render usa exatamente o que está na tela
      if (dirty) {
        await putRecipe(recipe);
        onSaved();
      }
      const started = await startRender(recipe.projectId);
      setJob(started);
      pollRef.current = window.setInterval(async () => {
        try {
          const j = await getRenderJob(started.id);
          setJob(j);
          if (j.status === "done" || j.status === "error") {
            if (pollRef.current) window.clearInterval(pollRef.current);
          }
        } catch {
          // erro transitório de rede; tenta de novo no próximo tick
        }
      }, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="panel">
      <h2>Render</h2>
      <button className="primary" disabled={rendering} onClick={render}>
        {rendering
          ? `Renderizando ${Math.round((job?.progress ?? 0) * 100)}%`
          : "Renderizar vídeo final"}
      </button>
      {job?.status === "done" && job.outputPath && (
        <p>
          <a
            href={`/${job.outputPath.replace(/^media\//, "")}`}
            target="_blank"
            rel="noreferrer"
          >
            Abrir vídeo renderizado
          </a>
        </p>
      )}
      {job?.status === "error" && <p className="error">{job.error}</p>}
      {error && <p className="error">{error}</p>}
    </section>
  );
};
