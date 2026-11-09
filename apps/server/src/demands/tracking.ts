import { getStore, type NewWorkEvent } from "./store";
import type { Demand } from "./types";

/**
 * Medição do trabalho para o painel de desempenho. Nada aqui pode derrubar
 * a ação que mediu (render, entrega, webhook): falha vira aviso no log.
 */

const HOUR_MS = 3_600_000;

/** Teto de um batimento do editor (o editor manda a cada 60 s) */
export const MAX_BEAT_SECONDS = 90;

/** Último batimento aceito por pessoa: duas abas abertas não contam em dobro */
const lastBeat = new Map<string, number>();

/**
 * Quanto do batimento vale: nunca mais que o tempo desde o último batimento
 * da mesma pessoa (+2 s de folga de rede), nem mais que o teto.
 */
export function clampBeat(userId: string, seconds: number, now = Date.now(), beats = lastBeat): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  const last = beats.get(userId);
  const allowed = last === undefined ? MAX_BEAT_SECONDS : Math.min(MAX_BEAT_SECONDS, (now - last) / 1000 + 2);
  beats.set(userId, now);
  return Math.max(0, Math.min(seconds, allowed));
}

export async function recordEditSeconds(userId: string, projectId: string, seconds: number, now = Date.now()) {
  const s = Math.round(clampBeat(userId, seconds, now));
  if (s < 1) return 0;
  const hour = new Date(Math.floor(now / HOUR_MS) * HOUR_MS).toISOString();
  await getStore().addEditSeconds(userId, projectId, hour, s);
  return s;
}

export async function recordWork(e: Partial<NewWorkEvent> & Pick<NewWorkEvent, "kind">) {
  try {
    await getStore().addWorkEvent({
      userId: null,
      userName: null,
      projectId: null,
      demandId: null,
      ok: true,
      seconds: null,
      detail: null,
      ...e,
    });
  } catch (err) {
    console.warn(`Painel: não registrou ${e.kind}:`, err instanceof Error ? err.message : err);
  }
}

/** A demanda ganhou data de entrega agora (antes não tinha) */
export async function noteDueDate(prev: Demand | null, next: Demand) {
  if (!next.dueDate || prev?.dueDate) return;
  await recordWork({ kind: "due-date", demandId: next.id, detail: next.dueDate });
}

let backfilled = false;

/**
 * Demandas que já tinham data antes da medição: acha no histórico de
 * webhooks o primeiro payload com dueDate (uma vez por processo). Sem
 * nenhum, marca na criação (conta como "chegou com data").
 */
export async function backfillDueDates(demands: Demand[]) {
  if (backfilled) return;
  const store = getStore();
  const known = new Set((await store.listWorkEvents("1970-01-01T00:00:00Z", "due-date")).map((e) => e.demandId));
  if (!store.trackingReady()) return;
  backfilled = true;
  for (const d of demands) {
    if (!d.dueDate || known.has(d.id)) continue;
    const events = await store.listEvents(d.id);
    const first = events
      .filter((e) => e.direction === "in")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .find((e) => {
        const due = (e.payload as { dueDate?: unknown } | null)?.dueDate;
        return typeof due === "string" && due.trim() !== "";
      });
    await recordWork({
      kind: "due-date",
      demandId: d.id,
      detail: d.dueDate,
      createdAt: first?.createdAt ?? d.createdAt,
    });
  }
}
