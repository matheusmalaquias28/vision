import express from "express";
import { getStore } from "./demands/store";
import type { Demand, DemandVideo } from "./demands/types";

/**
 * Presença (barra superior): quem está com o Vision aberto agora e onde
 * (painel, demandas, editando o vídeo X…). Cada aba manda um batimento a cada
 * 20 s e ao trocar de tela; fica só na memória do processo (reiniciou = some
 * até o próximo batimento). Aba sem batimento há `PRESENCE_TTL_MS` sai.
 */

/** Aba some depois disso sem batimento (aba escondida o navegador atrasa o timer até 1 min) */
export const PRESENCE_TTL_MS = 90_000;

export const PRESENCE_VIEWS = ["painel", "demandas", "demanda", "clientes", "projetos", "usuarios", "editor", "lab"] as const;
export type PresenceView = (typeof PRESENCE_VIEWS)[number];

export interface PresenceBeat {
  userId: string;
  name: string;
  tabId: string;
  view: PresenceView;
  projectId: string | null;
  demandId: string | null;
  /** aba visível e mouse/teclado nos últimos 2 min (ou preview tocando) */
  active: boolean;
  /** último batimento */
  at: number;
  /** último batimento ativo (null = nunca ativo nesta aba) */
  activeAt: number | null;
  /** desde quando está nesta tela */
  since: number;
}

export interface PresencePlace {
  view: PresenceView;
  /** "Editando", "No painel"… */
  label: string;
  /** o quê: título da demanda · vídeo NN, projeto avulso… */
  detail: string | null;
  projectId: string | null;
  demandId: string | null;
  active: boolean;
  since: string;
}

export interface PresenceUser {
  userId: string;
  name: string;
  /** alguma aba em uso agora */
  active: boolean;
  /** último uso (null = abas abertas mas paradas desde que abriram) */
  lastActiveAt: string | null;
  /** telas abertas, a mais recente em uso primeiro */
  places: PresencePlace[];
}

const VIEW_LABEL: Record<PresenceView, string> = {
  painel: "No painel",
  demandas: "Nas demandas",
  demanda: "Vendo a demanda",
  clientes: "Em clientes",
  projetos: "Em projetos",
  usuarios: "Em usuários",
  editor: "Editando",
  lab: "No laboratório de motions",
};

export interface PresenceLookup {
  demands: Pick<Demand, "id" | "title" | "clientName">[];
  videos: Pick<DemandVideo, "demandId" | "index" | "projectId">[];
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** O que a pessoa está vendo, com nome de gente (título da demanda, vídeo NN) */
export function describePlace(b: Pick<PresenceBeat, "view" | "projectId" | "demandId">, lookup: PresenceLookup) {
  const demandById = new Map(lookup.demands.map((d) => [d.id, d]));
  let demandId = b.demandId;
  let detail: string | null = null;
  if (b.view === "editor" && b.projectId) {
    const v = lookup.videos.find((x) => x.projectId === b.projectId);
    const d = v ? demandById.get(v.demandId) : undefined;
    if (v && d) {
      demandId = d.id;
      detail = `${d.title || "Sem título"} · vídeo ${pad2(v.index)}`;
    } else {
      detail = `${b.projectId} (avulso)`;
    }
  } else if (b.view === "demanda" && b.demandId) {
    const d = demandById.get(b.demandId);
    detail = d ? d.title || "Sem título" : null;
  }
  const client = demandId ? demandById.get(demandId)?.clientName : undefined;
  return { label: VIEW_LABEL[b.view], detail: detail && client ? `${detail} — ${client}` : detail, demandId };
}

/** Quem está online agora, agrupado por pessoa: em uso primeiro, depois quem usou por último */
export function buildPresence(beats: PresenceBeat[], now: number, lookup: PresenceLookup): PresenceUser[] {
  const live = beats.filter((b) => now - b.at <= PRESENCE_TTL_MS);
  const byUser = new Map<string, PresenceBeat[]>();
  for (const b of live) byUser.set(b.userId, [...(byUser.get(b.userId) ?? []), b]);
  const users = [...byUser.values()].map((tabs) => {
    const sorted = [...tabs].sort(
      (a, b) => Number(b.active) - Number(a.active) || (b.activeAt ?? 0) - (a.activeAt ?? 0) || b.at - a.at
    );
    const lastActive = Math.max(...tabs.map((t) => t.activeAt ?? 0));
    // a mesma tela em duas abas aparece uma vez
    const seen = new Set<string>();
    const places: PresencePlace[] = [];
    for (const t of sorted) {
      const key = `${t.view}:${t.projectId ?? ""}:${t.demandId ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const { label, detail, demandId } = describePlace(t, lookup);
      places.push({
        view: t.view,
        label,
        detail,
        projectId: t.projectId,
        demandId,
        active: t.active,
        since: new Date(t.since).toISOString(),
      });
    }
    return {
      userId: sorted[0].userId,
      name: sorted[0].name,
      active: tabs.some((t) => t.active),
      lastActiveAt: lastActive > 0 ? new Date(lastActive).toISOString() : null,
      places,
    };
  });
  return users.sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      (b.lastActiveAt ?? "").localeCompare(a.lastActiveAt ?? "") ||
      a.name.localeCompare(b.name, "pt-BR")
  );
}

// ─── estado do processo ──────────────────────────────────────────────

const tabs = new Map<string, PresenceBeat>();
const keyOf = (userId: string, tabId: string) => `${userId}:${tabId}`;

const str = (v: unknown, max = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** Registra o batimento de uma aba (entrada já validada contra o formato) */
export function notePresence(
  user: { id: string; name: string },
  body: unknown,
  now = Date.now(),
  store: Map<string, PresenceBeat> = tabs
): PresenceBeat | null {
  const b = (body ?? {}) as Record<string, unknown>;
  const tabId = str(b.tabId, 64);
  const view = PRESENCE_VIEWS.find((v) => v === b.view);
  if (!tabId || !view) return null;
  const projectId = view === "editor" ? str(b.projectId) : null;
  const demandId = view === "demanda" ? str(b.demandId) : null;
  const active = b.active === true;
  const key = keyOf(user.id, tabId);
  const prev = store.get(key);
  const samePlace = prev && prev.view === view && prev.projectId === projectId && prev.demandId === demandId;
  const beat: PresenceBeat = {
    userId: user.id,
    name: user.name,
    tabId,
    view,
    projectId,
    demandId,
    active,
    at: now,
    activeAt: active ? now : (prev?.activeAt ?? null),
    since: samePlace ? prev.since : now,
  };
  store.set(key, beat);
  // limpeza preguiçosa das abas que sumiram
  for (const [k, t] of store) if (now - t.at > PRESENCE_TTL_MS) store.delete(k);
  return beat;
}

export function leavePresence(userId: string, tabId: unknown, store: Map<string, PresenceBeat> = tabs) {
  const id = str(tabId, 64);
  if (id) store.delete(keyOf(userId, id));
}

// títulos das demandas para os rótulos: o banco no máximo a cada 20 s
const LOOKUP_TTL_MS = 20_000;
let lookupCache: { at: number; value: Promise<PresenceLookup> } | null = null;

function presenceLookup(): Promise<PresenceLookup> {
  if (lookupCache && Date.now() - lookupCache.at < LOOKUP_TTL_MS) return lookupCache.value;
  const store = getStore();
  const value = Promise.all([store.listDemands(), store.listVideos()]).then(([demands, videos]) => ({ demands, videos }));
  lookupCache = { at: Date.now(), value };
  value.catch(() => {
    lookupCache = null;
  });
  return value;
}

export const presenceRouter = express.Router();

/** Batimento da aba → quem está online (todas as pessoas, inclusive quem pediu) */
presenceRouter.post("/api/presence", async (req, res, next) => {
  try {
    if (!req.user) {
      res.status(401).end();
      return;
    }
    notePresence(req.user, req.body);
    const lookup = await presenceLookup().catch((): PresenceLookup => ({ demands: [], videos: [] }));
    res.json({ me: req.user.id, users: buildPresence([...tabs.values()], Date.now(), lookup) });
  } catch (err) {
    next(err);
  }
});

/** Aba fechada (sendBeacon no pagehide): sai na hora em vez de esperar o prazo */
presenceRouter.post("/api/presence/leave", (req, res) => {
  if (req.user) leavePresence(req.user.id, (req.body as { tabId?: unknown } | undefined)?.tabId);
  res.status(204).end();
});
