import fs from "node:fs";
import path from "node:path";
import type { Recipe } from "@vision/recipe";
import { fromRecipePath, projectDir, toRecipePath } from "../paths";
import { ffmpegPath, runOrThrow } from "./ffbin";
import { isHdr, probeFormat, workingVideoFilter, WORKING_COLOR_TAGS } from "./normalize";
import { probeVideo } from "./probe";

/**
 * Cópia leve dos brutos SÓ para o Player do editor: 720p, ~1,5 Mbps, keyframe
 * a cada 1 s e moov no início. O bruto de trabalho (até 1080p, 10–20 Mbps)
 * fazia o preview travar na 1ª reprodução em produção: cada trecho é um
 * <video> próprio e todos baixam o arquivo pesado ao mesmo tempo. O render
 * nunca usa a cópia (lê sempre `source.file`).
 *
 * Nome com carimbo do bruto (tamanho + data): bruto trocado ganha cópia nova
 * e o navegador pode guardar a cópia em cache para sempre.
 */

const PROXY_SIDE = 1280;
/** Bruto já leve (≤ 720p e ≤ 3 Mbps) não ganha cópia */
const LIGHT_BITRATE = 3_000_000;

export interface PreviewProxies {
  /** caminho do bruto na receita → caminho da cópia leve na receita */
  proxies: Record<string, string>;
  /** cópias ainda sendo geradas (o editor pergunta de novo) */
  pending: number;
}

function proxyDir(projectId: string) {
  return path.join(projectDir(projectId), "proxy");
}

function proxyAbsFor(projectId: string, srcAbs: string): string {
  const st = fs.statSync(srcAbs);
  const stamp = `${st.size.toString(36)}${Math.round(st.mtimeMs).toString(36)}`;
  return path.join(proxyDir(projectId), `${path.basename(srcAbs, path.extname(srcAbs))}-${stamp}.mp4`);
}

/** Brutos que não precisam (ou não podem) ter cópia: HDR, já leves ou que falharam */
const skipped = new Set<string>();
const inFlight = new Map<string, Promise<void>>();
/** 1 conversão por vez: não disputa CPU com transcrição e render */
let queue: Promise<unknown> = Promise.resolve();

async function needsProxy(srcAbs: string): Promise<boolean> {
  const f = await probeFormat(srcAbs);
  if (isHdr(f)) return false;
  const { durationInSeconds } = await probeVideo(srcAbs);
  const bitrate = (fs.statSync(srcAbs).size * 8) / durationInSeconds;
  return Math.min(f.width, f.height) > 720 || bitrate > LIGHT_BITRATE;
}

async function buildProxy(srcAbs: string, outAbs: string): Promise<void> {
  if (!(await needsProxy(srcAbs))) {
    skipped.add(outAbs);
    return;
  }
  const f = await probeFormat(srcAbs);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  // grava em .tmp e renomeia: o Player nunca pega uma cópia pela metade
  const tmp = `${outAbs}.tmp.mp4`;
  const t0 = Date.now();
  try {
    await runOrThrow(ffmpegPath, [
      "-y", "-hide_banner", "-loglevel", "error",
      "-i", srcAbs,
      "-map", "0:v:0", "-map", "0:a:0?",
      // mesmo filtro de cor do formato de trabalho: a cópia tem o brilho do render
      "-vf", workingVideoFilter(f, PROXY_SIDE),
      ...WORKING_COLOR_TAGS,
      // mesmos tempos de quadro do bruto: os cortes caem no mesmo lugar
      "-fps_mode", "passthrough",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
      "-maxrate", "2500k", "-bufsize", "5000k",
      // keyframe a cada 1 s: cada trecho começa a tocar rápido no meio do bruto
      "-force_key_frames", "expr:gte(t,n_forced*1)",
      "-c:a", "aac", "-b:a", "128k",
      "-movflags", "+faststart",
      tmp,
    ]);
    fs.renameSync(tmp, outAbs);
    // cópias velhas deste bruto (carimbo antigo) saem
    const base = path.basename(srcAbs, path.extname(srcAbs));
    for (const n of fs.readdirSync(path.dirname(outAbs))) {
      const stamped = n.startsWith(`${base}-`) && /^[a-z0-9]+\.mp4$/.test(n.slice(base.length + 1));
      if (stamped && n !== path.basename(outAbs)) fs.rmSync(path.join(path.dirname(outAbs), n), { force: true });
    }
    const mb = (fs.statSync(outAbs).size / 1e6).toFixed(1);
    console.log(`[preview] ${path.basename(srcAbs)}: cópia leve ${mb} MB em ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/** Põe a cópia leve de um bruto na fila (sem esperar); já pronta = nada a fazer */
export function queuePreviewProxy(projectId: string, srcAbs: string): Promise<void> | null {
  if (!fs.existsSync(srcAbs)) return null;
  const outAbs = proxyAbsFor(projectId, srcAbs);
  if (fs.existsSync(outAbs) || skipped.has(outAbs)) return null;
  let job = inFlight.get(outAbs);
  if (!job) {
    job = queue
      .then(() => buildProxy(srcAbs, outAbs))
      .catch((err) => {
        // sem cópia o Player usa o bruto: nunca derruba nada
        skipped.add(outAbs);
        console.warn(`[preview] ${path.basename(srcAbs)}: ${(err as Error).message}`);
      })
      .finally(() => inFlight.delete(outAbs));
    queue = job;
    inFlight.set(outAbs, job);
  }
  return job;
}

/** Cópias leves prontas dos brutos da receita; as que faltam entram na fila */
export function getPreviewProxies(recipe: Recipe): PreviewProxies {
  const proxies: Record<string, string> = {};
  let pending = 0;
  for (const source of recipe.sources) {
    const srcAbs = fromRecipePath(source.file);
    if (!fs.existsSync(srcAbs)) continue;
    const outAbs = proxyAbsFor(recipe.projectId, srcAbs);
    if (fs.existsSync(outAbs)) proxies[source.file] = toRecipePath(outAbs);
    else if (queuePreviewProxy(recipe.projectId, srcAbs)) pending++;
  }
  return { proxies, pending };
}

/** Pasta das cópias leves (a limpeza de brutos apaga junto) */
export function previewProxyDir(projectId: string): string {
  return proxyDir(projectId);
}
