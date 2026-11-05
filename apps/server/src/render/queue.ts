import { toRecipePath } from "../paths";
import { loadRecipe } from "../project";
import { renderRecipe } from "./renderJob";

export interface RenderJobInfo {
  id: string;
  projectId: string;
  status: "queued" | "rendering" | "done" | "error";
  progress: number;
  /** Na fila: quantos renders (de qualquer projeto) vêm antes deste */
  ahead?: number;
  outputPath?: string;
  error?: string;
}

const jobs = new Map<string, RenderJobInfo>();
/**
 * Um render por vez (vídeo curto, VPS de 4 vCPU): os jobs entram numa fila
 * encadeada. Render em paralelo dobraria CPU, RAM e disco temporário.
 */
let chain: Promise<void> = Promise.resolve();
let counter = 0;
/** Muda a cada subida do processo: job de antes de um reinício não se confunde com um novo de mesmo número */
const boot = Date.now().toString(36);

const active = (j: RenderJobInfo) => j.status === "queued" || j.status === "rendering";

/**
 * Põe o projeto na fila. Se ele já ESPERA na fila, devolve esse mesmo job
 * (a receita só é lida quando o render começa, então ele já sai com as
 * últimas edições): clicar de novo enquanto aparece 0% enfileirava outro
 * render inteiro do mesmo vídeo, e todo mundo esperava mais. Se ele já está
 * RENDERIZANDO, entra um novo (com as edições feitas depois) — no máximo um.
 */
export function enqueueRender(projectId: string): RenderJobInfo {
  const waiting = [...jobs.values()].find((j) => j.projectId === projectId && j.status === "queued");
  if (waiting) return withAhead(waiting);
  const id = `job_${boot}_${++counter}`;
  const job: RenderJobInfo = { id, projectId, status: "queued", progress: 0 };
  jobs.set(id, job);
  chain = chain.then(async () => {
    job.status = "rendering";
    try {
      const { outputPath } = await renderRecipe(loadRecipe(projectId), (f) => {
        job.progress = f;
      });
      job.status = "done";
      job.progress = 1;
      job.outputPath = toRecipePath(outputPath);
    } catch (err) {
      job.status = "error";
      job.error = err instanceof Error ? err.message : String(err);
      console.warn(`Render de ${projectId} falhou:`, job.error);
    }
  });
  return withAhead(job);
}

/** Cópia do job com a posição na fila (Map guarda a ordem de entrada = ordem da fila) */
function withAhead(job: RenderJobInfo): RenderJobInfo {
  if (job.status !== "queued") return { ...job };
  let ahead = 0;
  for (const j of jobs.values()) {
    if (j === job) break;
    if (active(j)) ahead++;
  }
  return { ...job, ahead };
}

/** Render do projeto na fila ou em andamento */
export function isRendering(projectId: string): boolean {
  for (const j of jobs.values()) {
    if (j.projectId === projectId && active(j)) return true;
  }
  return false;
}

export function getJob(id: string): RenderJobInfo | undefined {
  const job = jobs.get(id);
  return job && withAhead(job);
}

/**
 * Job mais recente ainda ativo do projeto (o editor reaberto ou recarregado
 * volta a acompanhar, em vez de mostrar "Renderizar" e enfileirar outro).
 */
export function activeJobFor(projectId: string): RenderJobInfo | null {
  let found: RenderJobInfo | null = null;
  for (const j of jobs.values()) if (j.projectId === projectId && active(j)) found = j;
  return found && withAhead(found);
}
