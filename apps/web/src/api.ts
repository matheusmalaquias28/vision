import type { Catalog, ColorGrade, CutPace, Recipe, Source } from "@vision/recipe";

export interface ProjectSummary {
  id: string;
  createdAt: string;
  updatedAt: string;
  clipCount: number;
  durationInSeconds: number;
  /** a limpeza apagou o vídeo bruto: abre para consulta, não renderiza */
  rawPurgedAt: string | null;
}

/** Análise automática ao subir os brutos (transcrição, cortes e motions no servidor) */
export interface AnalysisStatus {
  status: "queued" | "running" | "done" | "error";
  stage: string;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
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
  // sessão expirada ou ausente: o App volta para a tela de login
  if (res.status === 401 && !res.url.endsWith("/api/auth/login")) {
    window.dispatchEvent(new Event("vision:unauthorized"));
  }
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

export const getAnalysis = (id: string) =>
  fetch(`/api/projects/${id}/analysis`).then((r) => json<AnalysisStatus | null>(r));

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

/** Envio com progresso (fetch não informa o upload); fração 0–1 */
function uploadWithProgress<T>(url: string, file: File, onProgress?: (fraction: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("asset", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onerror = () => reject(new Error("falha de rede no envio"));
    xhr.onload = () => {
      if (xhr.status === 401) window.dispatchEvent(new Event("vision:unauthorized"));
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // resposta sem JSON
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
      else reject(new Error((body as { error?: string } | null)?.error ?? xhr.statusText));
    };
    xhr.send(fd);
  });
}

/** Mídia avulsa do projeto (overlay, música, efeito) */
export const uploadAsset = (id: string, file: File, onProgress?: (fraction: number) => void) =>
  uploadWithProgress<{ file: string; name: string }>(`/api/projects/${id}/assets`, file, onProgress);

/** Sobe um vídeo, faz probe e devolve o Source pronto para virar segmento */
export const addSourceClip = (id: string, file: File, onProgress?: (fraction: number) => void) =>
  uploadWithProgress<{ source: Source }>(`/api/projects/${id}/sources`, file, onProgress);

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
/** Resumo de uma rodada do Creative Planner (1 chamada de IA) */
export interface CreativeReport {
  jobId: string;
  model: string;
  style: "balanced" | "dynamic" | "premium" | "minimal" | "educational";
  styleSource: "briefing" | "ia" | "padrão";
  avoid: string[];
  catalog: { motions: string[]; combos: string[] };
  proposed: number;
  applied: number;
  rejected: { ref: string; reason: string }[];
  tokens: { input: number; output: number; cached: number } | null;
  timings: { prepareMs: number; plannerMs: number; compileMs: number; totalMs: number };
  cacheHit: boolean;
  fallback: string | null;
  promptChars: number;
  /** Trilha sugerida (pendente na trilha Música) */
  music?: { name: string; why: string } | null;
}

export interface FastPathReport {
  stages: { transcribeMs: number; transcribeSkipped: boolean; cutsMs: number; plannerMs: number };
  totalMs: number;
  withinTarget: boolean;
  videoSeconds: number;
  creative: CreativeReport;
}

/** Fast Path: transcrição (se faltar) + cortes + 1 chamada criativa */
export const analyzeApi = (id: string, pace: CutPace) =>
  fetch(`/api/projects/${id}/creative/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pace }),
  }).then((r) => json<{ recipe: Recipe; report: FastPathReport }>(r));

export interface AutoColorResult {
  grade: ColorGrade;
  /** Luma (percentis 10/90, 0–1 da tela) e saturação média medidas pelo ffmpeg */
  stats: { yLow: number; yHigh: number; satAvg: number };
}

/** Mede os vídeos e devolve o ajuste de cor de cada um (não grava a receita) */
export const autoColorApi = (id: string, sourceIds?: string[]) =>
  fetch(`/api/projects/${id}/color/auto`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceIds }),
  }).then((r) => json<{ grades: Record<string, AutoColorResult> }>(r));

/** Ilustração (Magnific, 1:1 em 1K): gera a imagem e devolve o caminho; fresh = outra para a mesma descrição */
export const generateIllustrationApi = (id: string, subject: string, fresh = false) =>
  fetch(`/api/projects/${id}/illustrations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject, fresh }),
  }).then((r) => json<{ file: string; cached: boolean; seconds: number }>(r));

/** Galeria de imagens geradas no projeto (controle de gasto e reaproveitamento) */
export interface IllustrationList {
  items: { file: string; subject: string; createdAt: string }[];
  generated: number;
  limit: number;
  enabled: boolean;
}

export const listIllustrationsApi = (id: string) =>
  fetch(`/api/projects/${id}/illustrations`).then((r) => json<IllustrationList>(r));

export const deleteIllustrationApi = (id: string, file: string) =>
  fetch(`/api/projects/${id}/illustrations?file=${encodeURIComponent(file)}`, { method: "DELETE" }).then((r) =>
    json<Omit<IllustrationList, "enabled">>(r)
  );

/** Resultado do botão "Sugerir imagens" */
export interface IllustrationReport {
  proposed: number;
  added: number;
  images: number;
  errors: string[];
  rejected: { ref: string; reason: string }[];
  seconds: number;
}

/** IA escolhe 2–3 pontos-chave e gera as imagens (Magnific); entram como sugestão */
export const suggestIllustrationsApi = (id: string, instructions = "") =>
  fetch(`/api/projects/${id}/illustrations/suggest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instructions }),
  }).then((r) => json<{ recipe: Recipe; report: IllustrationReport }>(r));

/** Estado da geração de imagem de uma ilustração no editor */
export interface IllustrationJob {
  busy: boolean;
  error: string | null;
}

/** Briefing do War + pedido do editor → motions e receitas pendentes */
export const planCreativeApi = (id: string, instructions = "", force = false) =>
  fetch(`/api/projects/${id}/creative/plan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instructions, force }),
  }).then((r) => json<{ recipe: Recipe; report: CreativeReport }>(r));

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

/** Cópia leve dos brutos para o Player (720p); o render usa sempre o bruto */
export interface PreviewProxies {
  /** caminho do bruto na receita → caminho da cópia leve */
  proxies: Record<string, string>;
  /** cópias ainda sendo geradas no servidor */
  pending: number;
}

export const getPreviewProxies = (id: string) =>
  fetch(`/api/projects/${id}/preview-proxies`).then((r) => json<PreviewProxies>(r));

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
  /** Análise automática do projeto (só nas respostas de demanda) */
  analysis?: AnalysisStatus | null;
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

/** Brutos na ordem da timeline; `briefing` = o do War editado (só vale no Vision) */
export const uploadDemandVideo = (id: string, index: number, files: File[], briefing?: string) => {
  const fd = new FormData();
  for (const f of files) fd.append("videos", f);
  if (briefing !== undefined) fd.append("briefing", briefing);
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
    json<{
      video: DemandVideo;
      delivered: number;
      total: number;
      /** último vídeo entregue: status para onde a demanda foi (ou o erro do War) */
      autoStatus: { status: string; syncError: string | null } | null;
    }>(r)
  );

export const getIntegrations = () => fetch("/api/integrations").then((r) => json<Integrations>(r));

export const disconnectDrive = () => postJson("/api/google/disconnect").then((r) => json<{ ok: true }>(r));

export const addDemandNote = (id: string, texto: string) =>
  postJson(`/api/demands/${encodeURIComponent(id)}/notes`, { texto }).then((r) => json<DemandNote>(r));

export const resendDemandNote = (id: string, criadoEm: string) =>
  postJson(`/api/demands/${encodeURIComponent(id)}/notes/resend`, { criadoEm }).then((r) =>
    json<DemandNote>(r)
  );

export const listNotifications = () =>
  fetch("/api/notifications").then((r) => json<{ unread: number; items: Notification[] }>(r));

export const markNotificationsRead = (demandId?: string) =>
  postJson("/api/notifications/read", { demandId }).then((r) => json<{ ok: true }>(r));

// ─── Login ───────────────────────────────────────────────────────────

export type UserRole = "superadmin" | "admin" | "editor";

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface ManagedUser extends CurrentUser {
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export const getMe = () => fetch("/api/auth/me").then((r) => json<CurrentUser>(r));

export const login = (email: string, password: string) =>
  postJson("/api/auth/login", { email, password }).then((r) => json<CurrentUser>(r));

export const logout = () => postJson("/api/auth/logout").then((r) => json<{ ok: true }>(r));

export const changePassword = (current: string, next: string) =>
  postJson("/api/auth/password", { current, next }).then((r) => json<{ ok: true }>(r));

// ─── Usuários (admin) ────────────────────────────────────────────────

export const listUsers = () => fetch("/api/users").then((r) => json<ManagedUser[]>(r));

export const createUser = (u: { name: string; email: string; role: UserRole; password: string }) =>
  postJson("/api/users", u).then((r) => json<{ user: ManagedUser; generatedPassword: string | null }>(r));

export const updateUser = (id: string, patch: { name?: string; role?: UserRole; active?: boolean }) =>
  fetch(`/api/users/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).then((r) => json<ManagedUser>(r));

export const resetUserPassword = (id: string) =>
  postJson(`/api/users/${id}/password`, {}).then((r) => json<{ generatedPassword: string | null }>(r));
