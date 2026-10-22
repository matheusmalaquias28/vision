import fs from "node:fs";
import path from "node:path";
import type { Recipe } from "@vision/recipe";
import { fromRecipePath, projectDir } from "../paths";
import { ffmpegPath, runOrThrow } from "./ffbin";

const WIDTH = 360;

// Evita dois ffmpeg gerando a mesma miniatura quando a home pede várias de uma vez
const inFlight = new Map<string, Promise<string>>();

/** Primeiro frame da primeira fonte do projeto, em JPEG (gerado uma vez e cacheado) */
export function getThumbnail(recipe: Recipe): Promise<string> {
  const outPath = path.join(projectDir(recipe.projectId), "thumbnail.jpg");
  if (fs.existsSync(outPath)) return Promise.resolve(outPath);
  const pending = inFlight.get(outPath);
  if (pending) return pending;
  const job = runOrThrow(ffmpegPath, [
    "-y",
    "-i", fromRecipePath(recipe.sources[0].file),
    "-frames:v", "1",
    "-vf", `scale=${WIDTH}:-2`,
    "-q:v", "4",
    outPath,
  ])
    .then(() => outPath)
    .finally(() => inFlight.delete(outPath));
  inFlight.set(outPath, job);
  return job;
}
