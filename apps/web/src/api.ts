import type { Catalog, CutPace, Recipe, Source } from "@vision/recipe";

export interface ProjectSummary {
  id: string;
  createdAt: string;
  updatedAt: string;
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
export const suggestSmartCutsApi = (id: string, pace: CutPace = "normal", ai = true) =>
  fetch(`/api/projects/${id}/smart-cuts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ai, pace }),
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

export interface FileWaveform extends WaveformData {
  durationSeconds: number;
}

// um arquivo de música/SFX costuma aparecer em vários clipes: busca uma vez só
const fileWaveforms = new Map<string, Promise<FileWaveform>>();

export const getFileWaveform = (file: string) => {
  let p = fileWaveforms.get(file);
  if (!p) {
    p = fetch(`/api/waveform?file=${encodeURIComponent(file)}`).then((r) => json<FileWaveform>(r));
    p.catch(() => fileWaveforms.delete(file));
    fileWaveforms.set(file, p);
  }
  return p;
};

export interface FilmstripData {
  /** Sprite horizontal com os frames lado a lado */
  url: string;
  /** Segundos do bruto entre um frame e o próximo */
  interval: number;
  count: number;
}

export type ProjectFilmstrips = Record<string, FilmstripData>;

export const getFilmstrip = (id: string) =>
  fetch(`/api/projects/${id}/filmstrip`).then((r) => json<ProjectFilmstrips>(r));

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

// ─── Demandas (War) ──────────────────────────────────────────────────

export interface DemandNote {
  texto: string;
  autor: string;
  criadoEm: string;
  imagens?: string[];
  apagadoEm?: string;
  origem?: "war" | "vision";
  syncError?: string | null;
}

export interface Notification {
  id: number;
  demandId: string;
  kind: "demand" | "note";
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface DemandVideo {
  demandId: string;
  index: number;
  projectId: string | null;
  driveFileId: string | null;
  driveFileUrl: string | null;
  deliveredAt: string | null;
}

export interface Demand {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  priority: string | null;
  videoCount: number;
  driveEditados: string | null;
  driveMateriais: string | null;
  briefing: string;
  briefingText: string | null;
  instagram: string | null;
  gestor: string | null;
  solicitante: string | null;
  editor: string | null;
  squad: string | null;
  categoria: string | null;
  status: string;
  dueDate: string | null;
  notas: DemandNote[];
  statusPermitidos: string[];
  warCreatedAt: string | null;
  statusChangedAt: string | null;
  syncState: "ok" | "error";
  syncError: string | null;
  createdAt: string;
  updatedAt: string;
  videos: DemandVideo[];
  started: number;
  delivered: number;
}

export interface Client {
  id: string;
  warClientId: string | null;
  name: string;
  instagram: string | null;
  drive: string | null;
  squad: string | null;
  gestor: string | null;
}

export interface ClientStats {
  total: number;
  month: number;
  open: number;
  videos: number;
}

export interface DemandEvent {
  id: number;
  direction: "in" | "out";
  kind: "created" | "updated" | "status" | "note";
  status: string | null;
  previousStatus: string | null;
  by: string | null;
  ok: boolean;
  error: string | null;
  attempts: number;
  createdAt: string;
}

export interface Integrations {
  storage: "postgres" | "local";
  webhookConfigured: boolean;
  drive: { configured: boolean; connected: boolean; email: string | null };
}

const postJson = (url: string, body?: unknown) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export const listDemands = () =>
  fetch("/api/demands").then((r) => json<{ statuses: string[]; demands: Demand[] }>(r));

export const getDemand = (id: string) =>
  fetch(`/api/demands/${encodeURIComponent(id)}`).then((r) =>
    json<{ demand: Demand; client: Client | null; events: DemandEvent[] }>(r)
  );

export const setDemandStatus = (id: string, status: string) =>
  postJson(`/api/demands/${encodeURIComponent(id)}/status`, { status }).then((r) => json<Demand>(r));

export const resyncDemand = (id: string) =>
  postJson(`/api/demands/${encodeURIComponent(id)}/resync`).then((r) => json<Demand>(r));

export const uploadDemandVideo = (id: string, index: number, files: File[]) => {
  const fd = new FormData();
  for (const f of files) fd.append("videos", f);
  return fetch(`/api/demands/${encodeURIComponent(id)}/videos/${index}/project`, {
    method: "POST",
    body: fd,
  }).then((r) => json<Recipe>(r));
};

export const listClients = () =>
  fetch("/api/clients").then((r) => json<(Client & { stats: ClientStats })[]>(r));

export const getClient = (id: string) =>
  fetch(`/api/clients/${encodeURIComponent(id)}`).then((r) =>
    json<{ client: Client; stats: ClientStats; demands: Demand[] }>(r)
  );

export interface ProjectDemand {
  demand: Demand;
  video: DemandVideo;
  /** nome do arquivo no Drive: "Título 01.mp4" */
  deliveryName: string;
}

export const getProjectDemand = (projectId: string) =>
  fetch(`/api/projects/${projectId}/demand`).then((r) => json<ProjectDemand | null>(r));

export const deliverProject = (projectId: string) =>
  postJson(`/api/projects/${projectId}/deliver`).then((r) =>
    json<{ video: DemandVideo; delivered: number; total: number }>(r)
  );

export const getIntegrations = () => fetch("/api/integrations").then((r) => json<Integrations>(r));

export const disconnectDrive = () => postJson("/api/google/disconnect").then((r) => json<{ ok: true }>(r));

export const addDemandNote = (id: string, texto: string, autor: string) =>
  postJson(`/api/demands/${encodeURIComponent(id)}/notes`, { texto, autor }).then((r) => json<DemandNote>(r));

export const resendDemandNote = (id: string, criadoEm: string) =>
  postJson(`/api/demands/${encodeURIComponent(id)}/notes/resend`, { criadoEm }).then((r) =>
    json<DemandNote>(r)
  );

export const listNotifications = () =>
  fetch("/api/notifications").then((r) => json<{ unread: number; items: Notification[] }>(r));

export const markNotificationsRead = (demandId?: string) =>
  postJson("/api/notifications/read", { demandId }).then((r) => json<{ ok: true }>(r));
