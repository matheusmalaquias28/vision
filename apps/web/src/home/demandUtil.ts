/** Tom visual da prioridade (texto livre do War) */
export function priorityTone(p: string | null): "high" | "mid" | "low" | null {
  if (!p) return null;
  const s = p.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
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

export function fmtDay(iso: string | null): string {
  if (!iso) return "—";
  // "2026-10-28" puro é um dia, não meia-noite UTC (que no Brasil vira o dia 27)
  const day = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
}

export function fmtDateTime(iso: string): string {
  return new Date(iso)
    .toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    .replace(".", "");
}
