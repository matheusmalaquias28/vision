import { mediaKindOf, uploadProblem } from "@vision/recipe";
import type { DriveFile } from "./drive";
import type { AutoEdit, DemandVideo } from "./types";

/**
 * Regras puras da edição automática (sem Drive, disco nem banco): o que vem
 * do War, quando começa, quais brutos entram e em que ordem.
 */

/** Espera depois do pedido (dá tempo de os brutos terminarem de subir) */
export const AUTO_EDIT_DELAY_MS = Number(process.env.VISION_AUTO_EDIT_DELAY_MIN ?? 10) * 60_000;
/** Arquivo mexido há menos que isso = ainda subindo: espera mais */
export const SETTLE_MS = 3 * 60_000;
/** Pasta vazia ou ainda subindo: tenta de novo depois disso */
export const RETRY_MS = 10 * 60_000;
/** Pasta vazia por tantas tentativas (~2 h) = desiste com erro */
export const MAX_ATTEMPTS = 12;
/** Mesmo limite do envio manual de brutos */
export const MAX_CLIPS = 20;

type Json = Record<string, unknown>;

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

const link = (v: unknown): string | null => {
  if (typeof v === "string") return text(v);
  if (v && typeof v === "object") {
    const o = v as Json;
    for (const k of ["driveClipes", "driveBrutos", "brutos", "drive", "link", "url"]) {
      if (text(o[k])) return text(o[k]);
    }
  }
  return null;
};

export interface VideoItem {
  /** pasta do Drive com os clipes daquele vídeo, em ordem */
  link: string | null;
  /** "Vídeo 1" (titulo do item no War) */
  title: string | null;
}

/**
 * Itens de vídeo do War, na ordem (posição i = vídeo i+1). Formato do War:
 * `videos: [{ numero: 1, titulo: "Vídeo 1", driveClipes: "…" }]` (1 a 5).
 * Lista vazia = demanda antiga (um Drive de materiais para todos): sem link
 * por vídeo, nada é automático. Aceita também lista de links.
 */
export function videoItemsFrom(body: unknown, count: number): VideoItem[] {
  const out: VideoItem[] = Array.from({ length: Math.max(1, count) }, () => ({ link: null, title: null }));
  if (!body || typeof body !== "object") return out;
  const b = body as Json;
  const inner = (b.briefing && typeof b.briefing === "object" ? b.briefing : {}) as Json;
  const list = [b, inner]
    .flatMap((o) => [o.videos, o.linksVideos, o.drivesBrutos, o.driveVideos])
    .find((v) => Array.isArray(v) && v.length > 0) as unknown[] | undefined;
  if (!list) return out;
  const taken = new Set<number>();
  list.forEach((item, i) => {
    const o = item && typeof item === "object" ? (item as Json) : null;
    const n = o ? Number(o.numero ?? o.index ?? o.ordem) : NaN;
    const pos = Number.isInteger(n) && n >= 1 ? n - 1 : i;
    if (pos >= out.length || taken.has(pos)) return;
    taken.add(pos);
    out[pos] = { link: link(item), title: o ? text(o.titulo) : null };
  });
  return out;
}

/** Só os links (ver videoItemsFrom) */
export const videoLinksFrom = (body: unknown, count: number) => videoItemsFrom(body, count).map((v) => v.link);

/**
 * Estado novo da edição automática quando o War manda (ou troca) o link do
 * vídeo. null = não mexe: vídeo já tem projeto ou foi entregue, já está na
 * fila/rodando/pronto com o mesmo link. Erro com link novo rearma.
 */
export function armAutoEdit(
  video: Pick<DemandVideo, "projectId" | "deliveredAt" | "auto">,
  rawLink: string | null,
  requestedAt: string | null,
  now: Date
): AutoEdit | null {
  if (!rawLink || video.projectId || video.deliveredAt) return null;
  const prev = video.auto;
  if (prev && (prev.link === rawLink || prev.status !== "error")) {
    // na fila com link trocado: troca o link, mantém o horário
    return prev.status === "waiting" && prev.link !== rawLink ? { ...prev, link: rawLink } : null;
  }
  // 10 min depois do pedido; link que chega depois conta a partir de agora
  const base = Math.max(requestedAt ? Date.parse(requestedAt) || 0 : 0, now.getTime());
  return {
    status: "waiting",
    stage: "Na fila do Vision",
    link: rawLink,
    notBefore: new Date(base + AUTO_EDIT_DELAY_MS).toISOString(),
    startedAt: null,
    finishedAt: null,
    error: null,
    attempts: 0,
    files: [],
    skipped: [],
    fingerprint: null,
  };
}

/** Ordem "natural": C0002 antes de C0010, Dia 2/ antes de Dia 10/ */
const collator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });
export const naturalOrder = (a: string, b: string) => collator.compare(a, b);

export interface ClipPlan {
  /** brutos que entram, na ordem da timeline */
  take: DriveFile[];
  skipped: { name: string; reason: string }[];
  /** algum vídeo mudou há pouco (ainda subindo): melhor esperar */
  settling: boolean;
}

/**
 * Organiza os arquivos da pasta: só vídeo, ordem natural pelo caminho (nome
 * de câmera/celular segue a ordem de gravação; numerar "01, 02…" força a
 * ordem), mesmos limites do envio manual (1 GB, 3 min), no máx. 20.
 */
export function planClips(files: DriveFile[], now: Date): ClipPlan {
  const take: DriveFile[] = [];
  const skipped: ClipPlan["skipped"] = [];
  let settling = false;
  for (const f of [...files].sort((a, b) => naturalOrder(a.path, b.path))) {
    if (mediaKindOf(f.name, f.mimeType) !== "video") {
      skipped.push({ name: f.path, reason: "não é vídeo" });
      continue;
    }
    if (now.getTime() - Date.parse(f.modifiedTime) < SETTLE_MS) settling = true;
    const problem = f.size === null ? "o Drive não informou o tamanho" : uploadProblem("video", f.size, f.durationSeconds);
    if (problem) {
      skipped.push({ name: f.path, reason: problem });
      continue;
    }
    if (take.length >= MAX_CLIPS) {
      skipped.push({ name: f.path, reason: `passou de ${MAX_CLIPS} brutos` });
      continue;
    }
    take.push(f);
  }
  return { take, skipped, settling };
}
