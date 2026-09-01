import path from "node:path";
import type { Recipe } from "@vision/recipe";
import { fromRecipePath, projectDir, toRecipePath } from "../paths";
import { ffmpegPath, runOrThrow } from "./ffbin";

/**
 * Trata o áudio de cada fonte: redução de ruído (afftdn) + normalização
 * de loudness (EBU R128, alvo de fala). Gera um arquivo por fonte e
 * grava o caminho em source.enhancedAudio; o render usa quando
 * audio.useEnhanced está ligado.
 */
export async function enhanceAudio(recipe: Recipe): Promise<Recipe> {
  const dir = projectDir(recipe.projectId);
  const sources = [];
  for (const source of recipe.sources) {
    const outAbs = path.join(dir, `enhanced-${source.id}.m4a`);
    await runOrThrow(ffmpegPath, [
      "-y",
      "-i", fromRecipePath(source.file),
      "-vn",
      "-af", "afftdn=nf=-25,loudnorm=I=-16:TP=-1.5:LRA=11",
      "-c:a", "aac",
      "-b:a", "192k",
      outAbs,
    ]);
    sources.push({ ...source, enhancedAudio: toRecipePath(outAbs) });
  }
  return {
    ...recipe,
    sources,
    audio: { ...recipe.audio, useEnhanced: true },
  };
}
