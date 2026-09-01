import { toRecipePath } from "../paths";
import { loadRecipe } from "../project";
import { renderRecipe } from "./renderJob";

export interface RenderJobInfo {
  id: string;
  projectId: string;
  status: "queued" | "rendering" | "done" | "error";
  progress: number;
  outputPath?: string;
  error?: string;
}

const jobs = new Map<string, RenderJobInfo>();
let chain: Promise<void> = Promise.resolve();
let counter = 0;

export function enqueueRender(projectId: string): RenderJobInfo {
  const id = `job_${++counter}`;
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
    }
  });
  return job;
}

export function getJob(id: string): RenderJobInfo | undefined {
  return jobs.get(id);
}
