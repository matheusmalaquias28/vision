import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  ILLUSTRATION_ASPECT,
  ILLUSTRATION_RESOLUTION,
  ILLUSTRATION_STYLE_VERSION,
  illustrationPrompt,
} from "@vision/recipe";
import { fromRecipePath, projectDir, toRecipePath } from "../paths";

/**
 * Gera a imagem de um motion "Ilustração" na Magnific (Nano Banana Pro Flash),
 * sempre 1:1 em 1K, com o estilo fixo de `illustrationPrompt`. A imagem é
 * baixada para os assets do projeto (a URL da Magnific não tem validade
 * garantida) e fica em cache por assunto: a mesma descrição não gasta crédito
 * de novo, a menos que o operador peça outra ("fresh").
 */

const API = "https://api.magnific.com/v1/ai/text-to-image/nano-banana-pro-flash";
/** Teto de gerações por projeto (inclui "gerar outra" e as apagadas): trava contra gasto descontrolado */
export const MAX_GENERATIONS_PER_PROJECT = 12;
/** MAGNIFIC_MAX_PER_PROJECT no .env muda o teto */
export const maxGenerations = () => Number(process.env.MAGNIFIC_MAX_PER_PROJECT) || MAX_GENERATIONS_PER_PROJECT;
const POLL_MS = 2000;
const TIMEOUT_MS = 120_000;

/** Gerações em andamento por projeto (contam no teto enquanto não terminam) */
const inflight = new Map<string, number>();

interface IndexEntry {
  hash: string;
  subject: string;
  file: string;
  taskId: string;
  createdAt: string;
  /** Apagada no painel: o arquivo some, mas a geração continua contando no teto */
  deletedAt?: string;
}

const indexPath = (projectId: string) => path.join(projectDir(projectId), "illustrations.json");

function readIndex(projectId: string): IndexEntry[] {
  try {
    return JSON.parse(fs.readFileSync(indexPath(projectId), "utf8")) as IndexEntry[];
  } catch {
    return [];
  }
}

function writeIndex(projectId: string, entries: IndexEntry[]): void {
  // Node grava sem BOM (o bundler do Remotion quebra com BOM em JSON)
  fs.writeFileSync(indexPath(projectId), JSON.stringify(entries, null, 2));
}

export function illustrationsEnabled(): boolean {
  return Boolean(process.env.MAGNIFIC_API_KEY?.trim());
}

function apiKey(): string {
  const key = process.env.MAGNIFIC_API_KEY?.trim();
  if (!key) throw new Error("MAGNIFIC_API_KEY ausente no .env: a geração de ilustrações está desligada");
  return key;
}

async function call(url: string, init: RequestInit, fetchImpl: typeof fetch): Promise<any> {
  // 503 (sobrecarga) é comum: duas novas tentativas com espera crescente
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(url, {
      ...init,
      headers: { "x-magnific-api-key": apiKey(), "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    if (res.status === 503 && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) throw new Error("a Magnific recusou a chave (MAGNIFIC_API_KEY)");
    if (!res.ok) throw new Error(`Magnific ${res.status}: ${body?.message ?? res.statusText}`);
    return body;
  }
}

export interface IllustrationResult {
  /** Caminho na receita (assets do projeto) */
  file: string;
  cached: boolean;
  seconds: number;
}

export async function generateIllustration(
  projectId: string,
  subject: string,
  opts: { fresh?: boolean; fetchImpl?: typeof fetch; pollMs?: number } = {}
): Promise<IllustrationResult> {
  const t0 = Date.now();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const prompt = illustrationPrompt(subject);
  const hash = crypto
    .createHash("sha1")
    .update(`${ILLUSTRATION_STYLE_VERSION}|${ILLUSTRATION_ASPECT}|${ILLUSTRATION_RESOLUTION}|${prompt}`)
    .digest("hex")
    .slice(0, 12);
  const index = readIndex(projectId);

  // mesma descrição já gerada: reaproveita (sem crédito), salvo se pediu outra
  if (!opts.fresh) {
    const hit = [...index].reverse().find((e) => e.hash === hash && !e.deletedAt && fs.existsSync(fromRecipePath(e.file)));
    if (hit) return { file: hit.file, cached: true, seconds: 0 };
  }
  if (index.length + (inflight.get(projectId) ?? 0) >= maxGenerations()) {
    throw new Error(`limite de ${maxGenerations()} imagens geradas neste projeto (MAGNIFIC_MAX_PER_PROJECT)`);
  }
  inflight.set(projectId, (inflight.get(projectId) ?? 0) + 1);
  try {
    return await runGeneration(projectId, subject, prompt, hash, t0, fetchImpl, opts);
  } finally {
    inflight.set(projectId, (inflight.get(projectId) ?? 1) - 1);
  }
}

async function runGeneration(
  projectId: string,
  subject: string,
  prompt: string,
  hash: string,
  t0: number,
  fetchImpl: typeof fetch,
  opts: { fresh?: boolean; pollMs?: number }
): Promise<IllustrationResult> {
  const created = await call(
    API,
    { method: "POST", body: JSON.stringify({ prompt, aspect_ratio: ILLUSTRATION_ASPECT, resolution: ILLUSTRATION_RESOLUTION }) },
    fetchImpl
  );
  const taskId: string | undefined = created?.data?.task_id;
  if (!taskId) throw new Error("a Magnific não devolveu task_id");

  let url: string | undefined = created?.data?.status === "COMPLETED" ? created.data.generated?.[0] : undefined;
  const pollMs = opts.pollMs ?? POLL_MS;
  while (!url) {
    if (Date.now() - t0 > TIMEOUT_MS) throw new Error("a Magnific demorou demais para gerar a imagem (2 min)");
    await new Promise((r) => setTimeout(r, pollMs));
    const task = await call(`${API}/${taskId}`, { method: "GET" }, fetchImpl);
    const status = task?.data?.status;
    if (status === "FAILED") throw new Error("a Magnific não conseguiu gerar a imagem (tente outra descrição)");
    if (status === "COMPLETED") {
      url = task.data.generated?.[0];
      if (!url) throw new Error("tarefa concluída sem imagem");
    }
  }

  const img = await fetchImpl(url);
  if (!img.ok) throw new Error(`não consegui baixar a imagem gerada (${img.status})`);
  const type = img.headers.get("content-type") ?? "";
  const ext = type.includes("png") ? ".png" : type.includes("webp") ? ".webp" : ".jpg";
  const name = `illus-${hash}${opts.fresh ? `-${Date.now().toString(36)}` : ""}${ext}`;
  const abs = path.join(projectDir(projectId), "assets", name);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, Buffer.from(await img.arrayBuffer()));

  const file = toRecipePath(abs);
  // relê o índice: outra geração do mesmo projeto pode ter terminado no meio
  writeIndex(projectId, [...readIndex(projectId), { hash, subject, file, taskId, createdAt: new Date().toISOString() }]);
  return { file, cached: false, seconds: Math.round((Date.now() - t0) / 100) / 10 };
}

export interface IllustrationItem {
  file: string;
  subject: string;
  createdAt: string;
}

/** Imagens geradas no projeto (mais nova primeiro) e quanto do teto já foi usado */
export function listIllustrations(projectId: string): { items: IllustrationItem[]; generated: number; limit: number } {
  const index = readIndex(projectId);
  const items = index
    .filter((e) => !e.deletedAt && fs.existsSync(fromRecipePath(e.file)))
    .map(({ file, subject, createdAt }) => ({ file, subject, createdAt }))
    .reverse();
  return { items, generated: index.length, limit: maxGenerations() };
}

/** Apaga uma imagem que nenhum motion da receita salva usa (a geração segue contando no teto) */
export function deleteIllustration(projectId: string, file: string, usedFiles: Set<string>): void {
  const index = readIndex(projectId);
  const entry = index.find((e) => e.file === file && !e.deletedAt);
  if (!entry) throw new Error("imagem não encontrada neste projeto");
  if (usedFiles.has(file)) throw new Error("imagem em uso numa ilustração: remova o motion antes");
  fs.rmSync(fromRecipePath(file), { force: true });
  writeIndex(
    projectId,
    index.map((e) => (e === entry ? { ...e, deletedAt: new Date().toISOString() } : e))
  );
}
