import fs from "node:fs";
import path from "node:path";
import type { Recipe } from "@vision/recipe";
import { fromRecipePath, toRecipePath } from "../paths";
import { ffmpegPath, ffprobePath, runOrThrow } from "./ffbin";
import { probeVideo } from "./probe";

/**
 * Formato de trabalho: H.264 8 bits 4:2:0, faixa 16–235, BT.709, lado maior
 * ≤ 1920, áudio AAC. Arquivos de câmera (LOG 10 bits 4:2:2, faixa 0–255,
 * sem marcação de cor, PCM) são lidos de um jeito pelo navegador e de outro
 * pelo render do Remotion (render saía mais escuro que o preview). Convertidos
 * uma vez na entrada, preview e MP4 decodificam o mesmo arquivo padrão.
 * Vídeo de celular comum já está nesse formato e passa direto.
 */

const MAX_SIDE = 1920;

export interface VideoFormat {
  codec: string;
  pixFmt: string;
  range: string;
  matrix: string;
  transfer: string;
  width: number;
  height: number;
  audioCodec: string | null;
}

export async function probeFormat(abs: string): Promise<VideoFormat> {
  const { stdout } = await runOrThrow(ffprobePath, [
    "-v", "error",
    "-show_entries", "stream=codec_type,codec_name,pix_fmt,color_range,color_space,color_transfer,width,height",
    "-of", "json",
    abs,
  ]);
  const streams: any[] = JSON.parse(stdout).streams ?? [];
  const v = streams.find((s) => s.codec_type === "video") ?? {};
  const a = streams.find((s) => s.codec_type === "audio");
  return {
    codec: String(v.codec_name ?? ""),
    pixFmt: String(v.pix_fmt ?? ""),
    range: String(v.color_range ?? "unknown"),
    matrix: String(v.color_space ?? "unknown"),
    transfer: String(v.color_transfer ?? "unknown"),
    width: Number(v.width ?? 0),
    height: Number(v.height ?? 0),
    audioCodec: a ? String(a.codec_name) : null,
  };
}

/** HDR (iPhone HLG/PQ) precisa de tone mapping: fica como está, o render já trata */
const HDR_TRANSFERS = ["smpte2084", "arib-std-b67"];
const BROWSER_AUDIO = ["aac", "mp3", "opus"];

/** Por que o arquivo precisa virar formato de trabalho; null = já serve */
export function normalizeReason(f: VideoFormat): string | null {
  if (HDR_TRANSFERS.includes(f.transfer)) return null;
  if (f.codec !== "h264") return `codec ${f.codec}`;
  if (f.pixFmt !== "yuv420p") return `pixels ${f.pixFmt}`;
  if (f.range === "pc") return "faixa de cor completa (0–255)";
  if (Math.max(f.width, f.height) > MAX_SIDE) return `${f.width}×${f.height}`;
  if (f.audioCodec && !BROWSER_AUDIO.includes(f.audioCodec)) return `áudio ${f.audioCodec}`;
  return null;
}

function inMatrix(f: VideoFormat): string {
  if (f.matrix === "bt709") return "bt709";
  if (f.matrix === "bt470bg" || f.matrix === "smpte170m") return "bt601";
  if (f.matrix.startsWith("bt2020")) return "bt2020";
  // sem marcação: HD e acima é BT.709 (é o que o navegador assume)
  return Math.min(f.width, f.height) >= 720 ? "bt709" : "bt601";
}

/** Converte `abs` para o formato de trabalho em `out` */
async function transcode(abs: string, out: string, f: VideoFormat): Promise<void> {
  // 1º reduz (barato, no formato original), depois converte faixa e matriz em 1080p
  const fit = `scale=w='if(gte(iw,ih),min(${MAX_SIDE},iw),-2)':h='if(gte(iw,ih),-2,min(${MAX_SIDE},ih))':flags=bilinear`;
  const color = `scale=in_range=${f.range === "pc" ? "pc" : "tv"}:in_color_matrix=${inMatrix(f)}:out_range=tv:out_color_matrix=bt709,format=yuv420p`;
  await runOrThrow(ffmpegPath, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-i", abs,
    "-map", "0:v:0", "-map", "0:a:0?",
    "-vf", `${fit},${color}`,
    "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
    "-c:v", "libx264", "-preset", "superfast", "-crf", "18",
    // keyframe a cada ~2 s: busca rápida no preview
    "-g", "48",
    "-c:a", "aac", "-b:a", "192k",
    "-movflags", "+faststart",
    out,
  ]);
}

export interface NormalizeResult {
  /** Arquivo final (pode mudar a extensão para .mp4) */
  abs: string;
  converted: boolean;
  reason: string | null;
}

/**
 * Garante o formato de trabalho no lugar: o original fica ao lado como
 * `original-<nome>` (a limpeza de brutos apaga os dois). Mesmos tempos: a
 * receita continua valendo.
 */
export async function normalizeVideo(abs: string): Promise<NormalizeResult> {
  const f = await probeFormat(abs);
  const reason = normalizeReason(f);
  if (!reason) return { abs, converted: false, reason: null };
  const dir = path.dirname(abs);
  const ext = path.extname(abs);
  const base = path.basename(abs, ext);
  const tmp = path.join(dir, `.work-${base}.mp4`);
  try {
    await transcode(abs, tmp, f);
    const [before, after] = await Promise.all([probeVideo(abs), probeVideo(tmp)]);
    if (Math.abs(before.durationInSeconds - after.durationInSeconds) > 0.25) {
      throw new Error(`conversão mudou a duração (${before.durationInSeconds}s → ${after.durationInSeconds}s)`);
    }
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
  fs.renameSync(abs, path.join(dir, `original-${base}${ext}`));
  const finalAbs = path.join(dir, `${base}.mp4`);
  fs.renameSync(tmp, finalAbs);
  return { abs: finalAbs, converted: true, reason };
}

/** Original guardado ao lado de uma fonte convertida (para a limpeza de brutos) */
export function originalsOf(abs: string): string[] {
  const dir = path.dirname(abs);
  const base = path.basename(abs, path.extname(abs));
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => n.startsWith(`original-${base}.`))
    .map((n) => path.join(dir, n));
}

/**
 * Converte as fontes da receita que ainda não estão no formato de trabalho
 * (projetos criados antes desta conversão). Devolve a receita com caminhos e
 * dimensões atualizados; `changed` diz se precisa gravar.
 */
export async function ensureWorkingSources(
  recipe: Recipe,
  log: (msg: string) => void = () => undefined
): Promise<{ recipe: Recipe; changed: boolean }> {
  let changed = false;
  const sources = [];
  for (const s of recipe.sources) {
    const abs = fromRecipePath(s.file);
    if (!fs.existsSync(abs)) {
      sources.push(s);
      continue;
    }
    const t0 = Date.now();
    const r = await normalizeVideo(abs);
    if (!r.converted) {
      sources.push(s);
      continue;
    }
    const probe = await probeVideo(r.abs);
    log(`${s.id}: convertido para formato de trabalho (${r.reason}) em ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    sources.push({ ...s, file: toRecipePath(r.abs), width: probe.width, height: probe.height, fps: probe.fps });
    changed = true;
  }
  return { recipe: changed ? { ...recipe, sources } : recipe, changed };
}
