const plain = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Tom visual da prioridade (texto livre do War) */
export function priorityTone(p: string | null): "high" | "mid" | "low" | null {
  if (!p) return null;
  const s = plain(p);
  if (/urgent|alta|high|critic/.test(s)) return "high";
  if (/media|normal|medium/.test(s)) return "mid";
  return "low";
}

/** "@fulano", "fulano" ou URL → { handle: "@fulano", url } */
export function instagramLink(raw: string | null): { handle: string; url: string } | null {
  if (!raw) return null;
  const s = raw.trim();
  const fromUrl = s.match(/instagram\.com\/([\w.]+)/i)?.[1];
  const handle = (fromUrl ?? s.replace(/^@/, "")).replace(/\/$/, "");
  if (!/^[\w.]+$/.test(handle)) return null;
  return { handle: `@${handle}`, url: `https://www.instagram.com/${handle}/` };
}

/** Só abre links http(s): os campos vêm de texto livre do War */
export function safeUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

/** "2026-10-28" puro é um dia, não meia-noite UTC (que no Brasil vira o dia 27) */
function parseDay(iso: string | null): Date | null {
  if (!iso) return null;
  const day = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDay(iso: string | null): string {
  if (!iso) return "—";
  const d = parseDay(iso);
  if (!d) return iso;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
}

export type DueTone = "late" | "today" | "soon" | "later";

/** Quanto falta para a entrega, em dias de calendário */
export function dueInfo(iso: string | null, now = new Date()): { tone: DueTone; label: string } | null {
  const d = parseDay(iso);
  if (!d) return null;
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diff = Math.round((day - today) / 86_400_000);
  if (diff < -1) return { tone: "late", label: `${-diff} dias atrasada` };
  if (diff === -1) return { tone: "late", label: "venceu ontem" };
  if (diff === 0) return { tone: "today", label: "hoje" };
  if (diff === 1) return { tone: "soon", label: "amanhã" };
  return { tone: diff <= 3 ? "soon" : "later", label: `em ${diff} dias` };
}

/** Cor do card/coluna pelo status do War (texto livre: compara sem acento) */
export type StatusTone =
  | "date"
  | "queue"
  | "manager"
  | "client"
  | "copy"
  | "approved"
  | "adjust"
  | "late"
  | "done"
  | "other";

export function statusTone(status: string): StatusTone {
  const s = plain(status);
  if (/aguardando|definicao de data/.test(s)) return "date";
  if (/fila/.test(s)) return "queue";
  if (/aprovacao do gestor/.test(s)) return "manager";
  if (/aprovacao do cliente/.test(s)) return "client";
  if (/copy/.test(s)) return "copy";
  if (/^aprovad/.test(s)) return "approved";
  if (/ajuste/.test(s)) return "adjust";
  if (/atrasad/.test(s)) return "late";
  if (/conclu|entregue|finaliz/.test(s)) return "done";
  return "other";
}

/** "Ana Paula Souza" → "AS" */
export function initials(name: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : (parts[0][1] ?? "");
  return (first + last).toUpperCase();
}

export function fmtDateTime(iso: string): string {
  return new Date(iso)
    .toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    .replace(".", "");
}

export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

/** Separador de dia da conversa: "Hoje", "Ontem" ou "12 de out" */
export function fmtChatDay(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diff = Math.round((today - day) / 86_400_000);
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Ontem";
  return d
    .toLocaleDateString("pt-BR", {
      day: "numeric",
      month: "short",
      year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
    })
    .replace(".", "");
}

/**
 * Pessoas para "@" na conversa. Os usuários do War ficam em outra plataforma
 * (sem lista pela API): nomes fixos da equipe + gestor/solicitante/editor da demanda.
 */
export const MENTION_NAMES = [
  "Leo",
  "Edgar",
  "Hyandra",
  "Pedro",
  "Pedro Henrique",
  "Kauan",
  "Michelle",
  "Jeferson",
  "Paulo",
  "Andressa",
  "Ellen",
  "Matheus",
  "Quétura",
  "Sergio",
];
