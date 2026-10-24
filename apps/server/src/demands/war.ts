import crypto from "node:crypto";
import { slugify } from "../project";
import { getStore } from "./store";
import { WAR_VIDEO_STATUSES, type Client, type Demand, type DemandNote } from "./types";

/**
 * Integração com o War (war.scalecompany.com.br).
 * - Entrada: POST /api/webhooks/war, header x-webhook-secret. Recebe a demanda
 *   completa (criação/edição) ou o espelho { event: "demanda.status" }.
 * - Saída: POST <callback.url> com x-api-key, body { id, status, updatedBy }.
 * O mesmo DEMANDAS_WEBHOOK_SECRET vale nas duas direções. Entrada nunca dispara
 * saída, então o espelho que o War devolve não vira loop.
 */

const WAR_BASE_URL = process.env.WAR_BASE_URL ?? "https://war.scalecompany.com.br";
const DEFAULT_CALLBACK = `${WAR_BASE_URL}/api/webhooks/demandas/status`;
const UPDATED_BY = "Vision";

type Json = Record<string, unknown>;

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : null;

const iso = (v: unknown): string | null => {
  const s = str(v);
  return s && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : null;
};

export function webhookSecret(): string | null {
  return str(process.env.DEMANDAS_WEBHOOK_SECRET);
}

/** Compara o segredo recebido (x-webhook-secret, x-api-key ou Bearer) em tempo constante */
export function checkSecret(headers: Record<string, string | string[] | undefined>): boolean {
  const secret = webhookSecret();
  if (!secret) return false;
  const bearer = String(headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  const got = String(headers["x-webhook-secret"] ?? headers["x-api-key"] ?? bearer ?? "");
  const a = Buffer.from(got);
  const b = Buffer.from(secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function clientIdFor(warId: string | null, name: string): string {
  return warId ?? `nome:${slugify(name)}`;
}

/** Garante uma linha de vídeo por unidade de quantidadeVideos (nunca apaga as já editadas) */
async function ensureVideos(demand: Demand) {
  const store = getStore();
  const existing = await store.listVideos(demand.id);
  for (let i = 1; i <= Math.max(1, demand.videoCount); i++) {
    if (existing.some((v) => v.index === i)) continue;
    await store.upsertVideo({
      demandId: demand.id,
      index: i,
      projectId: null,
      driveFileId: null,
      driveFileUrl: null,
      deliveredAt: null,
      updatedAt: new Date().toISOString(),
    });
  }
}

/** Cliente estável pelo id do War; sem id, cai para o nome. Migra o "nome:" quando o id aparece. */
async function upsertClientFrom(body: Json): Promise<Client> {
  const store = getStore();
  const cliente = (body.cliente as Json | null) ?? null;
  const warId = str(body.clientId) ?? str(cliente?.id);
  const name = str(cliente?.name) ?? str(body.clientName) ?? "Cliente sem nome";
  const id = clientIdFor(warId, name);
  const now = new Date().toISOString();

  const prev = await store.getClient(id);
  const client: Client = {
    id,
    warClientId: warId,
    name,
    instagram: str(cliente?.instagram) ?? str(body.instagramCliente) ?? prev?.instagram ?? null,
    drive: str(cliente?.drive) ?? prev?.drive ?? null,
    squad: str(cliente?.squad) ?? str(body.squad) ?? prev?.squad ?? null,
    gestor: str(cliente?.gestor) ?? str(body.gestor) ?? prev?.gestor ?? null,
    raw: cliente ?? prev?.raw ?? null,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  };
  await store.upsertClient(client);

  // demandas que chegaram antes do cadastro do cliente existir no War
  if (warId) {
    const byName = clientIdFor(null, name);
    if (byName !== id && (await store.getClient(byName))) {
      for (const d of await store.listDemands({ clientId: byName })) {
        await store.upsertDemand({ ...d, clientId: id, updatedAt: now });
      }
      await store.deleteClient(byName);
    }
  }
  return client;
}

async function handleDemand(body: Json) {
  const store = getStore();
  const id = str(body.id);
  if (!id) throw new Error("payload sem id da demanda");
  const client = await upsertClientFrom(body);
  const b = (body.briefing as Json | null) ?? {};
  const prev = await store.getDemand(id);
  const now = new Date().toISOString();
  const status = str(body.status) ?? prev?.status ?? WAR_VIDEO_STATUSES[0];
  const qty = Number(body.quantidadeVideos ?? b.quantidadeVideos ?? prev?.videoCount ?? 1);

  const demand: Demand = {
    id,
    clientId: client.id,
    clientName: str(body.clientName) ?? client.name,
    title: str(body.titulo) ?? str(b.titulo) ?? prev?.title ?? "",
    priority: str(body.prioridade) ?? str(b.prioridade) ?? null,
    videoCount: Number.isFinite(qty) && qty > 0 ? Math.round(qty) : 1,
    driveEditados: str(body.driveEditados) ?? str(b.driveEditados) ?? str(body.editados) ?? null,
    driveMateriais: str(body.driveMateriais) ?? str(b.driveMateriais) ?? null,
    briefing: str(body.briefingDescricao) ?? str(b.briefing) ?? "",
    briefingText: str(body.briefingTexto),
    instagram: str(body.instagramCliente) ?? str(b.instagramCliente) ?? client.instagram,
    gestor: str(body.gestor),
    solicitante: str(body.solicitante),
    editor: str(body.webdesigner),
    squad: str(body.squad),
    categoria: str(body.categoria),
    status,
    dueDate: str(body.dueDate),
    notas: Array.isArray(body.notas)
      ? mergeNotes(prev?.notas ?? [], (body.notas as DemandNote[]).map((n) => ({ ...n, origem: n.origem ?? "war" })))
      : (prev?.notas ?? []),
    statusPermitidos: Array.isArray(body.statusPermitidos)
      ? (body.statusPermitidos as string[])
      : (prev?.statusPermitidos ?? []),
    callbackUrl: str((body.callback as Json | undefined)?.url) ?? prev?.callbackUrl ?? null,
    warCreatedAt: iso(body.createdAt) ?? prev?.warCreatedAt ?? null,
    warUpdatedAt: iso(body.updatedAt),
    statusChangedAt: iso(body.statusChangedAt) ?? prev?.statusChangedAt ?? null,
    syncState: prev?.syncState ?? "ok",
    syncError: prev?.syncError ?? null,
    raw: body,
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
  };
  await store.upsertDemand(demand);
  await ensureVideos(demand);
  await store.addEvent({
    demandId: id,
    direction: "in",
    kind: prev ? "updated" : "created",
    status,
    previousStatus: prev && prev.status !== status ? prev.status : null,
    by: demand.solicitante,
    payload: body,
    ok: true,
    error: null,
    attempts: 1,
  });
  if (!prev && demand.title) {
    await store.addNotification({
      demandId: id,
      kind: "demand",
      title: `Nova demanda: ${demand.title}`,
      body: `${demand.clientName} · ${demand.videoCount} ${demand.videoCount === 1 ? "vídeo" : "vídeos"}`,
    });
  }
  return demand;
}

/**
 * Junta as notas do War com as locais pela identidade criadoEm. O payload
 * completo do War traz só as notas dele: as do Vision que ele ainda não tem
 * (envio falhou) continuam aqui.
 */
function mergeNotes(local: DemandNote[], incoming: DemandNote[]): DemandNote[] {
  const byId = new Map(local.map((n) => [n.criadoEm, n]));
  for (const n of incoming) byId.set(n.criadoEm, { ...byId.get(n.criadoEm), ...n });
  return [...byId.values()].sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
}

async function handleNoteEvent(body: Json) {
  const store = getStore();
  const id = str(body.id);
  const raw = (body.nota as Json | undefined) ?? {};
  // criadoEm é a identidade da nota: preserva o texto exato que o War mandou
  const criadoEm = str(raw.criadoEm) ?? str(body.createdAt) ?? new Date().toISOString();
  if (!id) throw new Error("evento demanda.nota sem id");
  const note: DemandNote = {
    texto: str(raw.texto) ?? "",
    autor: str(raw.autor) ?? str(body.addedBy) ?? "War",
    criadoEm,
    imagens: Array.isArray(raw.imagens) ? (raw.imagens as unknown[]).filter((u): u is string => typeof u === "string") : [],
    origem: "war",
  };
  let demand = await store.getDemand(id);
  if (!demand) demand = await handleDemand({ id, clientName: body.clientName, tipo: "video" });
  const isNew = !demand.notas.some((n) => n.criadoEm === criadoEm);
  await store.upsertDemand({
    ...demand,
    notas: mergeNotes(demand.notas, [note]),
    updatedAt: new Date().toISOString(),
  });
  if (!isNew) return;
  await store.addEvent({
    demandId: id,
    direction: "in",
    kind: "note",
    status: null,
    previousStatus: null,
    by: note.autor,
    payload: body,
    ok: true,
    error: null,
    attempts: 1,
  });
  await store.addNotification({
    demandId: id,
    kind: "note",
    title: `${note.autor} comentou em ${demand.title || demand.clientName}`,
    body: note.texto || (note.imagens?.length ? "imagem anexada" : null),
  });
}

async function handleStatusEvent(body: Json) {
  const store = getStore();
  const id = str(body.id);
  const status = str(body.status);
  if (!id || !status) throw new Error("evento demanda.status sem id ou status");
  let demand = await store.getDemand(id);
  const now = new Date().toISOString();
  if (!demand) {
    // status de uma demanda que ainda não chegou completa: guarda o mínimo
    demand = await handleDemand({ id, clientName: body.clientName, status, tipo: "video" });
  }
  await store.upsertDemand({
    ...demand,
    status,
    statusChangedAt: iso(body.updatedAt) ?? now,
    updatedAt: now,
  });
  await store.addEvent({
    demandId: id,
    direction: "in",
    kind: "status",
    status,
    previousStatus: str(body.previousStatus),
    by: str(body.updatedBy),
    payload: body,
    ok: true,
    error: null,
    attempts: 1,
  });
}

/** Processa um webhook do War. Arte e vídeo usam o mesmo endpoint: só vídeo entra. */
export async function handleWarWebhook(payload: unknown) {
  const items = (Array.isArray(payload) ? payload : [payload]) as Json[];
  const result = { processed: 0, ignored: 0 };
  for (const body of items) {
    if (!body || typeof body !== "object" || body.tipo !== "video") {
      result.ignored++;
      continue;
    }
    if (body.event === "demanda.status") await handleStatusEvent(body);
    else if (body.event === "demanda.nota") await handleNoteEvent(body);
    else await handleDemand(body);
    result.processed++;
  }
  return result;
}

// ─── Saída: Vision → War ─────────────────────────────────────────────

async function postToWar(url: string, body: Json) {
  const secret = webhookSecret();
  if (!secret) throw new Error("DEMANDAS_WEBHOOK_SECRET não configurado");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": secret },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => {
    throw new Error("não foi possível falar com o War (fora do ar ou sem rede)");
  });
  const json = (await res.json().catch(() => ({}))) as Json;
  if (!res.ok) {
    const allowed = Array.isArray(json.statusPermitidos) ? ` (permitidos: ${json.statusPermitidos.join(", ")})` : "";
    const err = new Error(`War respondeu ${res.status}: ${str(json.error) ?? res.statusText}${allowed}`);
    // 4xx é recusa definitiva (status inválido, demanda não existe): não adianta repetir
    (err as Error & { fatal?: boolean }).fatal = res.status >= 400 && res.status < 500;
    throw err;
  }
  return json;
}

/** Muda o status no Vision e devolve ao War (até 3 tentativas). */
export async function changeStatus(demandId: string, status: string, by?: string) {
  const store = getStore();
  const demand = await store.getDemand(demandId);
  if (!demand) throw new Error("demanda não encontrada");
  const allowed = demand.statusPermitidos.length > 0 ? demand.statusPermitidos : await warStatuses();
  const canonical = allowed.find((s) => s.toLowerCase() === status.toLowerCase());
  if (!canonical) throw new Error(`status "${status}" não é permitido pelo War`);

  const previous = demand.status;
  const body = { id: demand.id, status: canonical, updatedBy: by?.trim() || UPDATED_BY };
  let error: string | null = null;
  let rejected = false;
  let attempts = 0;
  for (const wait of [0, 1000, 3000]) {
    attempts++;
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try {
      await postToWar(demand.callbackUrl ?? DEFAULT_CALLBACK, body);
      error = null;
      break;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      rejected = Boolean((e as { fatal?: boolean }).fatal);
      if (rejected) break;
    }
  }

  const now = new Date().toISOString();
  const updated: Demand = {
    ...demand,
    // recusado pelo War: o quadro continua no status anterior
    status: rejected ? previous : canonical,
    statusChangedAt: now,
    syncState: error ? "error" : "ok",
    syncError: error,
    updatedAt: now,
  };
  await store.upsertDemand(updated);
  await store.addEvent({
    demandId,
    direction: "out",
    kind: "status",
    status: canonical,
    previousStatus: previous,
    by: body.updatedBy,
    payload: body,
    ok: !error,
    error,
    attempts,
  });
  return updated;
}

// ─── Notas: Vision → War ─────────────────────────────────────────────

/** Endpoint de notas do War: vizinho do callback de status da demanda */
function noteUrl(demand: Demand) {
  return demand.callbackUrl?.replace(/\/status\/?$/, "/nota") ?? `${WAR_BASE_URL}/api/webhooks/demandas/nota`;
}

async function pushNote(demand: Demand, note: DemandNote) {
  const body = {
    id: demand.id,
    texto: note.texto,
    autor: note.autor,
    criadoEm: note.criadoEm,
    imagens: note.imagens ?? [],
  };
  let error: string | null = null;
  let attempts = 0;
  for (const wait of [0, 1000, 3000]) {
    attempts++;
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try {
      await postToWar(noteUrl(demand), body);
      error = null;
      break;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      if ((e as { fatal?: boolean }).fatal) break;
    }
  }
  const store = getStore();
  const fresh = (await store.getDemand(demand.id)) ?? demand;
  const saved: DemandNote = { ...note, syncError: error };
  await store.upsertDemand({
    ...fresh,
    notas: mergeNotes(fresh.notas, [saved]),
    updatedAt: new Date().toISOString(),
  });
  await store.addEvent({
    demandId: demand.id,
    direction: "out",
    kind: "note",
    status: null,
    previousStatus: null,
    by: note.autor,
    payload: body,
    ok: !error,
    error,
    attempts,
  });
  return saved;
}

/** Comentário escrito no Vision: guarda e envia ao War (a nota fica mesmo se o envio falhar) */
export async function addNote(demandId: string, texto: string, autor: string) {
  const demand = await getStore().getDemand(demandId);
  if (!demand) throw new Error("demanda não encontrada");
  if (!texto.trim()) throw new Error("escreva o comentário");
  return pushNote(demand, {
    texto: texto.trim(),
    autor: autor.trim() || UPDATED_BY,
    criadoEm: new Date().toISOString(),
    imagens: [],
    origem: "vision",
  });
}

/** Reenvia uma nota do Vision que o War não confirmou */
export async function resendNote(demandId: string, criadoEm: string) {
  const demand = await getStore().getDemand(demandId);
  const note = demand?.notas.find((n) => n.criadoEm === criadoEm && n.origem === "vision");
  if (!demand || !note) throw new Error("nota não encontrada");
  return pushNote(demand, note);
}

// ─── Lista de status ─────────────────────────────────────────────────

let statusCache: { at: number; list: string[] } | null = null;
/** última consulta ao War que falhou: não repete por 1 min (o quadro não espera a cada carga) */
let statusFailedAt = 0;

/** Status permitidos (canônicos + customizados) direto do War, com cache de 5 min. */
export async function warStatuses(): Promise<string[]> {
  if (statusCache && Date.now() - statusCache.at < 5 * 60_000) return statusCache.list;
  const secret = webhookSecret();
  if (secret && Date.now() - statusFailedAt > 60_000) {
    try {
      const res = await fetch(DEFAULT_CALLBACK, {
        headers: { "x-api-key": secret },
        signal: AbortSignal.timeout(4000),
      });
      const json = (await res.json()) as Json;
      if (res.ok && Array.isArray(json.statusPermitidos) && json.statusPermitidos.length > 0) {
        statusCache = { at: Date.now(), list: json.statusPermitidos as string[] };
        return statusCache.list;
      }
      statusFailedAt = Date.now();
    } catch {
      // War fora do ar ou sem rede: usa o que veio nas demandas
      statusFailedAt = Date.now();
    }
  }
  const demands = await getStore().listDemands();
  const latest = demands
    .filter((d) => d.statusPermitidos.length > 0)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return latest?.statusPermitidos ?? WAR_VIDEO_STATUSES;
}

