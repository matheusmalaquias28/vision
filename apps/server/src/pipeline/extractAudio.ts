import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fromRecipePath, mediaDir, projectDir, toRecipePath } from "../paths";
import { ffmpegPath, ffprobePath, runOrThrow } from "./ffbin";
import { probeDuration } from "./probe";

export class ExtractAudioError extends Error {
  status = 400;
}

/**
 * Extrai a trilha de áudio de um vídeo (clipe externo, overlay, bruto) para
 * `assets/audio-<hash>.m4a` do projeto, com a qualidade original (AAC 192k
 * estéreo). Mesmo arquivo de novo = mesmo áudio (não refaz).
 */
export async function extractAudio(projectId: string, recipeFile: string): Promise<{ file: string; durationSeconds: number }> {
  const abs = path.resolve(fromRecipePath(recipeFile));
  // só mídia servida pelo Vision (nada fora de media/)
  if (!abs.startsWith(path.resolve(mediaDir) + path.sep) || !fs.existsSync(abs)) {
    throw new ExtractAudioError("arquivo de vídeo não encontrado");
  }
  const { stdout } = await runOrThrow(ffprobePath, [
    "-v", "error",
    "-select_streams", "a",
    "-show_entries", "stream=index",
    "-of", "csv=p=0",
    abs,
  ]);
  if (!stdout.trim()) throw new ExtractAudioError("esse vídeo não tem som para extrair");

  const hash = crypto.createHash("sha1").update(recipeFile).digest("hex").slice(0, 12);
  const out = path.join(projectDir(projectId), "assets", `audio-${hash}.m4a`);
  if (!fs.existsSync(out)) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const tmp = `${out}.part.m4a`;
    await runOrThrow(ffmpegPath, ["-y", "-i", abs, "-vn", "-map", "0:a:0", "-ac", "2", "-c:a", "aac", "-b:a", "192k", tmp]);
    fs.renameSync(tmp, out);
  }
  const durationSeconds = await probeDuration(out);
  if (!durationSeconds) throw new ExtractAudioError("não deu para ler a duração do áudio extraído");
  return { file: toRecipePath(out), durationSeconds: Math.round(durationSeconds * 1000) / 1000 };
}
