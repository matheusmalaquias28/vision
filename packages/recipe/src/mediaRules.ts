/**
 * Regras das camadas da timeline e limites de arquivo enviado pelo editor.
 * Áudio só vive em trilha de áudio (Música, Efeitos, Áudio do vídeo); vídeo e
 * imagem só em trilha visual. Vídeo de overlay entra sem som; o som de um
 * clipe de vídeo inserido na sequência fica na trilha "Áudio do vídeo".
 * Compartilhado pelo editor (checa antes de enviar) e pelo servidor (recusa).
 */

export type MediaKind = "video" | "audio" | "image";

/** Trilhas da timeline (data-track das faixas) */
export type TrackId = "captions" | "motions" | "effects" | "overlays" | "video" | "videoAudio" | "music" | "sfx";

/** Onde um arquivo pode ir parar */
export type DropTarget = "video" | "overlays" | "music" | "sfx";

const MB = 1024 * 1024;

/**
 * Limites por arquivo. Vídeo pesado é aceito: o servidor converte para o
 * formato de trabalho (≤ 1080p) logo na entrada e o Player usa a cópia leve.
 */
export const UPLOAD_LIMITS = {
  video: { maxSeconds: 180, maxBytes: 1024 * MB },
  audio: { maxSeconds: 300, maxBytes: 40 * MB },
  image: { maxSeconds: null, maxBytes: 20 * MB },
} as const satisfies Record<MediaKind, { maxSeconds: number | null; maxBytes: number }>;

/** Vídeo final do Vision: acima disso o editor avisa */
export const MAX_VIDEO_SECONDS = 180;

/** Áudio até aqui é efeito; mais longo é música */
export const SFX_MAX_SECONDS = 20;

const EXT: Record<MediaKind, RegExp> = {
  video: /\.(mp4|mov|m4v|webm|mkv)$/i,
  audio: /\.(mp3|wav|m4a|aac|ogg|flac)$/i,
  image: /\.(png|jpe?g|webp|gif)$/i,
};

export function mediaKindOf(name: string, mime = ""): MediaKind | null {
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  for (const k of ["video", "audio", "image"] as const) if (EXT[k].test(name)) return k;
  return null;
}

/** "300 MB", "1 GB" */
export const formatBytes = (b: number) =>
  b >= 1024 * MB ? `${Math.round((b / (1024 * MB)) * 10) / 10} GB` : `${Math.round(b / MB)} MB`;
/** "45 s", "1:30 min" */
export const formatSeconds = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")} min` : `${Math.round(s)} s`);
const LABEL: Record<MediaKind, string> = { video: "Vídeo", audio: "Áudio", image: "Imagem" };

/** Motivo da recusa (null = pode enviar). `seconds` null = duração desconhecida */
export function uploadProblem(kind: MediaKind, bytes: number, seconds: number | null): string | null {
  const lim = UPLOAD_LIMITS[kind];
  if (bytes > lim.maxBytes) return `${LABEL[kind]} muito pesado (${formatBytes(bytes)}): o limite é ${formatBytes(lim.maxBytes)}`;
  if (lim.maxSeconds !== null && seconds !== null && seconds > lim.maxSeconds + 0.5) {
    return `${LABEL[kind]} muito longo (${formatSeconds(seconds)}): o limite é ${formatSeconds(lim.maxSeconds)}`;
  }
  return null;
}

/**
 * Para onde vai um arquivo solto na timeline. Áudio nunca cai em trilha de
 * vídeo ou texto (vai para Música/Efeitos); vídeo vira clipe da sequência, ou
 * overlay sem som se for solto na trilha Overlays; imagem é sempre overlay.
 */
export function dropTarget(kind: MediaKind, hovered: TrackId | null, seconds: number | null): DropTarget {
  if (kind === "audio") {
    if (hovered === "music" || hovered === "sfx") return hovered;
    return seconds !== null && seconds > SFX_MAX_SECONDS ? "music" : "sfx";
  }
  if (kind === "video") return hovered === "overlays" ? "overlays" : "video";
  return "overlays";
}

/** Trilha que recebe um item da biblioteca (mesma regra: áudio só em áudio) */
export function libraryDropTarget(assetType: string): DropTarget {
  return assetType === "sfx" ? "sfx" : assetType === "music" ? "music" : "overlays";
}
