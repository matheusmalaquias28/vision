import { outputDuration, placeMotions, type Recipe } from "@vision/recipe";
import React, { useEffect, useRef, useState } from "react";
import {
  deliverProject,
  getRenderJob,
  putRecipe,
  startRender,
  type ProjectDemand,
  type RenderJob,
} from "../api";
import { Section } from "../ui/controls";
import { Icon } from "./Icon";

interface RenderPanelProps {
  recipe: Recipe;
  dirty: boolean;
  onSaved: () => void;
  /** projeto ligado a uma demanda do War: libera o envio ao Drive */
  demand: ProjectDemand | null;
  onDelivered: () => void;
}

export const RenderPanel: React.FC<RenderPanelProps> = ({
  recipe,
  dirty,
  onSaved,
  demand,
  onDelivered,
}) => {
  const [job, setJob] = useState<RenderJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [delivering, setDelivering] = useState(false);
  const [delivered, setDelivered] = useState<string | null>(null);

  const deliver = async () => {
    setError(null);
    setDelivering(true);
    try {
      const r = await deliverProject(recipe.projectId);
      setDelivered(
        r.delivered === r.total
          ? `Enviado. Todos os ${r.total} vídeos da demanda estão no Drive — mude o status no quadro.`
          : `Enviado (${r.delivered}/${r.total} vídeos da demanda no Drive).`
      );
      onDelivered();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDelivering(false);
    }
  };
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

  const duration = outputDuration(recipe.timeline.segments);
  const motionsIn = placeMotions(recipe, false).length;
  const pendingCuts = recipe.timeline.suggestedCuts.filter((c) => c.status === "pending").length;
  const pendingMotions = recipe.motions.filter((m) => m.status === "pending").length;
  const progress = Math.round((job?.progress ?? 0) * 100);

  return (
    <Section title="Exportar vídeo final">
      <dl className="export-summary">
        <dt>Formato</dt>
        <dd>
          {recipe.render.width}×{recipe.render.height} · {recipe.render.fps}fps · H.264
        </dd>
        <dt>Duração</dt>
        <dd>{duration.toFixed(1)}s</dd>
        <dt>Trechos</dt>
        <dd>{recipe.timeline.segments.length}</dd>
        <dt>Motions</dt>
        <dd>{motionsIn} aceitos</dd>
      </dl>

      {(pendingCuts > 0 || pendingMotions > 0) && (
        <div className="warn-box">
          Sem revisão:{" "}
          {[
            pendingCuts > 0 ? `${pendingCuts} ${pendingCuts === 1 ? "corte" : "cortes"}` : "",
            pendingMotions > 0 ? `${pendingMotions} ${pendingMotions === 1 ? "motion" : "motions"}` : "",
          ]
            .filter(Boolean)
            .join(" e ")}
          . Sugestões pendentes não entram no vídeo.
        </div>
      )}

      <button className="primary btn-block" disabled={rendering} onClick={render}>
        <Icon name="export" size={15} />
        {rendering ? `Renderizando ${progress}%` : dirty ? "Salvar e renderizar" : "Renderizar"}
      </button>
      {rendering && (
        <div className="progress" aria-label="Progresso do render">
          <span style={{ width: `${progress}%` }} />
        </div>
      )}
      {job?.status === "done" && job.outputPath && (
        <a
          className="file-btn"
          href={`/${job.outputPath.replace(/\\/g, "/").replace(/^.*?media\//, "")}`}
          target="_blank"
          rel="noreferrer"
        >
          <Icon name="film" size={14} /> Abrir vídeo renderizado
        </a>
      )}
      {demand && (
        <div className="deliver-box">
          <span>
            Entrega no Drive para editados como <code>{demand.deliveryName}</code>
          </span>
          <button
            className="btn-block"
            disabled={delivering || rendering || !demand.demand.driveEditados}
            onClick={deliver}
            title={demand.demand.driveEditados ? "Envia o render mais recente" : "A demanda não tem Drive para editados"}
          >
            <Icon name="cloud" size={15} />
            {delivering
              ? "Enviando ao Drive…"
              : demand.video.deliveredAt
                ? "Reenviar ao Drive (substitui)"
                : "Enviar ao Drive"}
          </button>
          {delivered && <p className="note">{delivered}</p>}
        </div>
      )}
      {job?.status === "error" && <p className="note error">{job.error}</p>}
      {error && <p className="note error">{error}</p>}
    </Section>
  );
};
