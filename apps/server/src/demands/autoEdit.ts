import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { projectDir, projectsDir, recipePath } from "../paths";
import { createProject, slugify } from "../project";
import { probeDuration } from "../pipeline/probe";
import { uploadProblem } from "@vision/recipe";
import { readAnalysis, startAutoAnalysis } from "../creative/autoAnalyze";
import { renderBusy } from "../render/queue";
import { MIN_FREE_BYTES } from "../render/bundle";
import { driveAccount, downloadDriveFile, listDriveFiles } from "./drive";
import { armAutoEdit, MAX_ATTEMPTS, planClips, RETRY_MS, SETTLE_MS, videoItemsFrom } from "./autoEditRules";
import { getStore } from "./store";
import { recordWork } from "./tracking";
import type { AutoEdit, Demand, DemandVideo } from "./types";

/**
 * Edição automática das demandas: o War manda um link do Drive com os brutos
 * de cada vídeo; 10 min depois do pedido o Vision baixa os brutos, organiza
 * (ordem natural dos nomes), cria o projeto e roda a análise automática
 * (cortes aplicados, legenda, motions/imagens/música pendentes). Um vídeo por
 * vez e nunca durante um render (VPS de 4 vCPU). Só roda no processo com
 * VISION_AUTO_EDIT=on (a VPS): o dev nunca baixa nada sozinho.
 *
 * O resultado fica em demand_videos.auto; quem mexer na receita depois que o
 * Vision terminou fica em demand_videos.manual_edit (noteProjectWrite).
 */

const AUTHOR = "Vision";
const TICK_MS = 60_000;
/** Erros sem jeito de melhorar esperando (link errado, sem acesso, Drive desconectado) */
const PERMANENT = /inválido|não achou|não tem acesso|não conectado|GOOGLE_CLIENT/;
/** Falha passageira (rede, Drive fora): tenta de novo até isso */
const MAX_FAILURES = 3;

export const autoEditEnabled = () => process.env.VISION_AUTO_EDIT === "on";

const pad2 = (n: number) => String(n).padStart(2, "0");
const hhmm = (ms: number) =>
  new Date(ms).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: process.env.VISION_TZ ?? "America/Sao_Paulo",
  });

/** sha1 do recipe.json como está no disco */
export function recipeFingerprint(projectId: string): string | null {
  try {
    return crypto.createHash("sha1").update(fs.readFileSync(recipePath(projectId))).digest("hex");
  } catch {
    return null;
  }
}

async function videoOf(demandId: string, index: number): Promise<DemandVideo | null> {
  return (await getStore().listVideos(demandId)).find((v) => v.index === index) ?? null;
}

/** Grava o estado relendo a linha (entrega/edição feita enquanto isso não some) */
async function saveAuto(demandId: string, index: number, auto: AutoEdit | null, extra: Partial<DemandVideo> = {}) {
  const cur = await videoOf(demandId, index);
  if (!cur) return;
  await getStore().upsertVideo({ ...cur, ...extra, auto, updatedAt: new Date().toISOString() });
}

// ─── Entrada: o War mandou (ou atualizou) a demanda ──────────────────

/** Links de brutos por vídeo (posição i = vídeo i+1), lidos do payload guardado */
export const videoItemsOf = (d: Demand) => videoItemsFrom(d.raw, d.videoCount);
export const rawLinksOf = (d: Demand) => videoItemsOf(d).map((v) => v.link);

/** Arma a edição automática dos vídeos que ganharam link (chamado no webhook) */
export async function armFromDemand(demand: Demand) {
  if (!autoEditEnabled()) return;
  const store = getStore();
  const links = rawLinksOf(demand);
  const now = new Date();
  for (const v of await store.listVideos(demand.id)) {
    const next = armAutoEdit(v, links[v.index - 1] ?? null, demand.warCreatedAt, now);
    if (next) await store.upsertVideo({ ...v, auto: next, updatedAt: now.toISOString() });
  }
}

/**
 * "Preparar agora" / "Tentar de novo" na tela da demanda: arma (ou rearma)
 * o vídeo para começar já. Sem VISION_AUTO_EDIT roda só este vídeo aqui.
 */
export async function startAutoEditNow(demandId: string, index: number) {
  const store = getStore();
  const demand = await store.getDemand(demandId);
  const video = await videoOf(demandId, index);
  if (!demand || !video) throw new Error("vídeo da demanda não encontrado");
  if (video.projectId) throw new Error("esse vídeo já tem um projeto");
  if (video.auto?.status === "downloading" || video.auto?.status === "analyzing") {
    throw new Error("o Vision já está preparando esse vídeo");
  }
  const link = rawLinksOf(demand)[index - 1];
  if (!link) throw new Error("o War não mandou o link do Drive com os brutos deste vídeo");
  const armed = armAutoEdit({ projectId: null, deliveredAt: null, auto: null }, link, null, new Date())!;
  const auto: AutoEdit = { ...armed, notBefore: new Date().toISOString() };
  await saveAuto(demandId, index, auto);
  void tick(autoEditEnabled() ? undefined : { demandId, index });
  return auto;
}

// ─── Fila ────────────────────────────────────────────────────────────

let busy = false;

/**
 * Processa os vídeos vencidos, um por vez. `only` = só este vídeo (botão no
 * processo sem a automação ligada). Render na fila: espera o próximo tick.
 */
export async function tick(only?: { demandId: string; index: number }) {
  if (busy) return;
  busy = true;
  try {
    for (;;) {
      if (renderBusy()) return;
      const now = Date.now();
      const due = (await getStore().listVideos())
        .filter(
          (v) =>
            v.auto?.status === "waiting" &&
            !v.projectId &&
            Date.parse(v.auto.notBefore) <= now &&
            (!only || (v.demandId === only.demandId && v.index === only.index))
        )
        .sort((a, b) => a.auto!.notBefore.localeCompare(b.auto!.notBefore));
      if (due.length === 0) return;
      await processVideo(due[0]);
      if (only) return;
    }
  } catch (err) {
    console.warn("Edição automática:", err instanceof Error ? err.message : err);
  } finally {
    busy = false;
  }
}

/** Reagenda (pasta vazia, ainda subindo, falha passageira) ou desiste com erro */
function retryOrFail(auto: AutoEdit, message: string, waitMs: number, count = true): AutoEdit {
  const attempts = count ? auto.attempts : Math.max(0, auto.attempts - 1);
  if (attempts >= MAX_ATTEMPTS) {
    return { ...auto, status: "error", stage: "Não deu para preparar", error: message, finishedAt: new Date().toISOString() };
  }
  const at = Date.now() + waitMs;
  return {
    ...auto,
    status: "waiting",
    attempts,
    stage: `${message}; tenta de novo às ${hhmm(at)}`,
    notBefore: new Date(at).toISOString(),
  };
}

async function processVideo(v: DemandVideo) {
  const store = getStore();
  const { demandId, index } = v;
  const demand = await store.getDemand(demandId);
  if (!demand) return;
  let auto: AutoEdit = {
    ...v.auto!,
    status: "downloading",
    stage: "Lendo a pasta do Drive",
    startedAt: new Date().toISOString(),
    error: null,
    attempts: v.auto!.attempts + 1,
  };
  // outro processo no mesmo banco (ou o editor) chegou antes
  if (!(await store.claimAutoEdit(demandId, index, "waiting", auto))) return;
  const set = async (patch: Partial<AutoEdit>, extra?: Partial<DemandVideo>) => {
    auto = { ...auto, ...patch };
    await saveAuto(demandId, index, auto, extra);
  };
  const label = `${demand.title || demand.clientName} ${pad2(index)}`;
  const tmp = path.join(os.tmpdir(), "vision-auto", `${slugify(demandId).slice(0, 40)}-${index}`);
  let projectId: string | null = null;

  try {
    if (!(await driveAccount())) throw new Error("Google Drive não conectado (Demandas → Integrações)");
    const files = await listDriveFiles(auto.link);
    const plan = planClips(files, new Date());
    if (plan.take.length === 0) {
      const why = plan.skipped.length > 0 ? "Nenhum vídeo aproveitável na pasta" : "Pasta do Drive sem vídeos";
      await set({ ...retryOrFail(auto, why, RETRY_MS), skipped: plan.skipped });
      return;
    }
    if (plan.settling) {
      // upload em andamento não gasta tentativa
      await set(retryOrFail(auto, "Brutos ainda subindo no Drive", SETTLE_MS + 60_000, false));
      return;
    }

    // cópia no projeto + formato de trabalho + original de câmera ≈ 3× o bruto, mais a folga do render
    const total = plan.take.reduce((a, f) => a + (f.size ?? 0), 0);
    const free = freeBytes();
    if (free !== null && free < total * 3 + MIN_FREE_BYTES) {
      await set(
        retryOrFail(auto, `Pouco espaço em disco (${(free / 1024 ** 3).toFixed(1)} GB livres)`, 3 * RETRY_MS)
      );
      return;
    }

    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    const paths: string[] = [];
    const names: string[] = [];
    const skipped = [...plan.skipped];
    for (let i = 0; i < plan.take.length; i++) {
      const f = plan.take[i];
      await set({ stage: `Baixando ${i + 1}/${plan.take.length}: ${f.name}` });
      const dest = path.join(tmp, `${pad2(i + 1)}${path.extname(f.name).toLowerCase() || ".mp4"}`);
      await downloadDriveFile(f.id, dest);
      // o Drive nem sempre sabe a duração logo depois do upload: confere no arquivo
      const problem = uploadProblem("video", fs.statSync(dest).size, await probeDuration(dest).catch(() => null));
      if (problem) {
        skipped.push({ name: f.path, reason: problem });
        fs.rmSync(dest, { force: true });
        continue;
      }
      paths.push(dest);
      names.push(f.name);
    }
    if (paths.length === 0) throw new Error("nenhum bruto dentro dos limites (1 GB, 3 min)");

    // o editor começou à mão enquanto baixava: o projeto dele vale
    const now = await videoOf(demandId, index);
    if (!now || now.projectId) {
      await saveAuto(demandId, index, null);
      return;
    }

    await set({ stage: "Montando a timeline", files: plan.take.filter((f) => !skipped.some((s) => s.name === f.path)).map((f) => f.path), skipped });
    const briefing = demand.briefing || demand.briefingText || "";
    const base = slugify(demand.title || demand.clientName).slice(0, 36);
    const recipe = await createProject(paths, `${base}-${pad2(index)}`, briefing, names);
    projectId = recipe.projectId;
    await set({ status: "analyzing", stage: "IA analisando" }, { projectId });
    void recordWork({ kind: "start", userName: AUTHOR, projectId, demandId });
    console.log(`Edição automática: ${label} → ${projectId} (${paths.length} brutos)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`Edição automática de ${label} falhou:`, msg);
    if (projectId) {
      await set({ status: "error", stage: "Falhou", error: msg, finishedAt: new Date().toISOString() });
    } else if (PERMANENT.test(msg) || auto.attempts >= MAX_FAILURES) {
      await set({ status: "error", stage: "Não deu para preparar", error: msg, finishedAt: new Date().toISOString() });
      await notify(demand, `Vision não preparou ${label}`, msg);
    } else {
      await set(retryOrFail(auto, `Falhou (${msg})`, RETRY_MS));
    }
    return;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  await finishAnalysis(demand, index, projectId!, true);
}

/**
 * Espera a análise do projeto e registra o resultado. run=false: a análise já
 * terminou (o processo caiu antes de registrar), só registra.
 */
async function finishAnalysis(demand: Demand, index: number, projectId: string, run: boolean) {
  if (run) await startAutoAnalysis(projectId);
  const a = readAnalysis(projectId);
  const ok = a?.status === "done";
  const cur = await videoOf(demand.id, index);
  if (!cur?.auto || cur.projectId !== projectId) return;
  const fingerprint = recipeFingerprint(projectId);
  const auto: AutoEdit = {
    ...cur.auto,
    status: ok ? "done" : "error",
    stage: ok ? "Editado pelo Vision" : "Análise da IA falhou",
    error: ok ? null : (a?.error ?? "análise interrompida"),
    finishedAt: new Date().toISOString(),
    fingerprint,
  };
  await saveAuto(demand.id, index, auto);
  writes.set(projectId, { at: Date.now(), fingerprint, marked: new Map() });
  const label = `${demand.title || demand.clientName} ${pad2(index)}`;
  await notify(
    demand,
    ok ? `Vision editou ${label}` : `Vision baixou ${label}, mas a análise falhou`,
    ok ? "Timeline pronta para revisar" : auto.error
  );
}

async function notify(demand: Demand, title: string, body: string | null) {
  await getStore()
    .addNotification({ demandId: demand.id, kind: "demand", title, body })
    .catch((e) => console.warn("Edição automática: notificação:", e instanceof Error ? e.message : e));
}

function freeBytes(): number | null {
  try {
    const s = fs.statfsSync(fs.existsSync(projectsDir) ? projectsDir : os.tmpdir());
    return s.bavail * s.bsize;
  } catch {
    return null;
  }
}

/**
 * Na subida: o que ficou pela metade quando o processo caiu. Baixando = volta
 * para a fila; analisando com o projeto aqui = retoma a análise.
 */
async function recover() {
  const store = getStore();
  for (const v of await store.listVideos()) {
    if (v.auto?.status === "downloading" && !v.projectId) {
      await saveAuto(v.demandId, v.index, { ...v.auto, status: "waiting", stage: "Retomando (o servidor reiniciou)", notBefore: new Date().toISOString() });
    } else if (v.auto?.status === "analyzing" && v.projectId && fs.existsSync(projectDir(v.projectId))) {
      const demand = await store.getDemand(v.demandId);
      const finished = readAnalysis(v.projectId)?.status === "done";
      if (demand) void finishAnalysis(demand, v.index, v.projectId, !finished);
    }
  }
}

let timer: NodeJS.Timeout | null = null;

/** Liga a fila (server.ts, só fora da Vercel). Sem VISION_AUTO_EDIT=on não faz nada. */
export function startAutoEditLoop() {
  if (!autoEditEnabled() || timer) return;
  console.log("Edição automática: ligada (brutos do Drive das demandas)");
  void recover()
    .catch((e) => console.warn("Edição automática: retomada:", e instanceof Error ? e.message : e))
    .then(() => tick());
  timer = setInterval(() => void tick(), TICK_MS);
  timer.unref();
}

// ─── Alteração manual depois do Vision ───────────────────────────────

/** Por projeto: impressão do que o Vision entregou e quem já foi marcado (evita reler o banco a cada salvamento) */
const writes = new Map<string, { at: number; fingerprint: string | null; marked: Map<string, number> }>();
const CACHE_MS = 5 * 60_000;
/** Mesma pessoa só regrava o "última alteração" a cada 10 min */
const MARK_EVERY_MS = 10 * 60_000;

/**
 * Chamado depois de toda escrita de um usuário num projeto (PUT da receita,
 * passos do servidor). Se o projeto foi editado pelo Vision e a receita não
 * é mais a que ele entregou, registra quem alterou. Nunca derruba a ação.
 */
export async function noteProjectWrite(projectId: string, userName: string) {
  try {
    let c = writes.get(projectId);
    if (!c || Date.now() - c.at > CACHE_MS) {
      const v = await getStore().findVideoByProject(projectId);
      const fp = v?.auto?.status === "done" || v?.auto?.status === "error" ? (v.auto.fingerprint ?? null) : null;
      c = { at: Date.now(), fingerprint: fp, marked: c?.marked ?? new Map() };
      writes.set(projectId, c);
    }
    if (!c.fingerprint) return;
    const last = c.marked.get(userName);
    if (last && Date.now() - last < MARK_EVERY_MS) return;
    if (recipeFingerprint(projectId) === c.fingerprint) return;
    const v = await getStore().findVideoByProject(projectId);
    if (!v?.auto?.fingerprint) return;
    const now = new Date().toISOString();
    const m = v.manualEdit ?? { firstAt: now, lastAt: now, by: [] };
    await getStore().upsertVideo({
      ...v,
      manualEdit: { ...m, lastAt: now, by: m.by.includes(userName) ? m.by : [...m.by, userName] },
      updatedAt: now,
    });
    c.marked.set(userName, Date.now());
  } catch (err) {
    console.warn(`Alteração manual de ${projectId}:`, err instanceof Error ? err.message : err);
  }
}
