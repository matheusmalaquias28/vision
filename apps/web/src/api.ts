import type { Catalog, Recipe, Source } from "@vision/recipe";

export interface ProjectSummary {
  id: string;
  createdAt: string;
  clipCount: number;
  durationInSeconds: number;
}

export interface DirectorJob {
  id: string;
  projectId: string;
  status: "running" | "done" | "error";
  stage: string;
  error?: string;
}

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
}

export interface MusicTrack {
  name: string;
  file: string;
}

export interface RenderJob {
  id: string;
  projectId: string;
  status: "queued" | "rendering" | "done" | "error";
  progress: number;
  outputPath?: string;
  error?: string;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new Error((body as { error?: string }).error ?? res.statusText);
  }
  return res.json() as Promise<T>;
}

export const listProjects = () =>
  fetch("/api/projects").then((r) => json<ProjectSummary[]>(r));

export const uploadProject = (files: File[], briefing = "") => {
  const fd = new FormData();
  for (const f of files) fd.append("videos", f);
  if (briefing) fd.append("briefing", briefing);
  return fetch("/api/projects", { method: "POST", body: fd }).then((r) =>
    json<Recipe>(r)
  );
};

export const startDirect = (id: string, briefing: string) =>
  fetch(`/api/projects/${id}/direct`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ briefing }),
  }).then((r) => json<DirectorJob>(r));

export const getDirectorJob = (jobId: string) =>
  fetch(`/api/director-jobs/${jobId}`).then((r) => json<DirectorJob>(r));

export const listTemplates = () =>
  fetch("/api/templates").then((r) => json<TemplateInfo[]>(r));

export const applyTemplateApi = (id: string, template: string) =>
  fetch(`/api/projects/${id}/template`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ template }),
  }).then((r) => json<Recipe>(r));

export const enhanceAudioApi = (id: string) =>
  fetch(`/api/projects/${id}/enhance`, { method: "POST" }).then((r) =>
    json<Recipe>(r)
  );

export const generateNarrationApi = (id: string, script: string) =>
  fetch(`/api/projects/${id}/narration`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ script }),
  }).then((r) => json<Recipe>(r));

export const listSfx = () =>
  fetch("/api/sfx").then((r) => json<MusicTrack[]>(r));

export const listAssets = (id: string) =>
  fetch(`/api/projects/${id}/assets`).then((r) => json<MusicTrack[]>(r));

export const uploadAsset = (id: string, file: File) => {
  const fd = new FormData();
  fd.append("asset", file);
  return fetch(`/api/projects/${id}/assets`, { method: "POST", body: fd }).then(
    (r) => json<{ file: string; name: string }>(r)
  );
};

/** Sobe um vídeo, faz probe e devolve o Source pronto para virar segmento */
export const addSourceClip = (id: string, file: File) => {
  const fd = new FormData();
  fd.append("asset", file);
  return fetch(`/api/projects/${id}/sources`, { method: "POST", body: fd }).then(
    (r) => json<{ source: Source }>(r)
  );
};

export const getRecipe = (id: string) =>
  fetch(`/api/projects/${id}/recipe`).then((r) => json<Recipe>(r));

export const putRecipe = (recipe: Recipe) =>
  fetch(`/api/projects/${recipe.projectId}/recipe`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(recipe),
  }).then((r) => json<Recipe>(r));

export const transcribe = (id: string) =>
  fetch(`/api/projects/${id}/transcribe`, { method: "POST" }).then((r) =>
    json<Recipe>(r)
  );

export const detectSilence = (id: string) =>
  fetch(`/api/projects/${id}/silence`, { method: "POST" }).then((r) =>
    json<Recipe>(r)
  );

/** Pausas, vícios e repetições + retomadas (ai=true chama o LLM) */
export const suggestSmartCutsApi = (id: string, ai = true) =>
  fetch(`/api/projects/${id}/smart-cuts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ai }),
  }).then((r) => json<Recipe>(r));

/** Plano de motions da IA (pendentes); instructions = pedido extra do editor */
export const suggestMotionsApi = (id: string, instructions = "") =>
  fetch(`/api/projects/${id}/motions/suggest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instructions }),
  }).then((r) => json<Recipe>(r));

export interface WaveformData {
  binsPerSecond: number;
  peaks: number[];
}

export type ProjectWaveforms = Record<string, WaveformData>;

export const getWaveform = (id: string) =>
  fetch(`/api/projects/${id}/waveform`).then((r) => json<ProjectWaveforms>(r));

export const listMusic = () =>
  fetch("/api/music").then((r) => json<MusicTrack[]>(r));

export const startRender = (id: string) =>
  fetch(`/api/projects/${id}/render`, { method: "POST" }).then((r) =>
    json<RenderJob>(r)
  );

export const getRenderJob = (jobId: string) =>
  fetch(`/api/render-jobs/${jobId}`).then((r) => json<RenderJob>(r));

export const getLibrary = () => fetch("/api/library").then((r) => json<Catalog>(r));

/** URL servida de um arquivo de media/ (o servidor expõe media/ na raiz) */
export const mediaUrl = (file: string) => "/" + file.replace(/^media\//, "");
