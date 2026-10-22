import fs from "node:fs";
import path from "node:path";
import type { Recipe } from "@vision/recipe";
import { fromRecipePath, mediaDir, projectDir } from "../paths";
import { ffmpegPath, runOrThrow } from "./ffbin";

/** Altura de cada frame no sprite (a trilha tem ~56px; 2× para telas HiDPI) */
const FRAME_HEIGHT = 112;
const MIN_INTERVAL = 0.5;
/** Teto de frames por fonte: brutos longos ganham intervalo maior */
const MAX_FRAMES = 240;

export interface FilmstripData {
  /** URL do sprite horizontal (frames lado a lado); media/ é a raiz estática */
  url: string;
  /** Segundos do bruto entre um frame e o próximo */
  interval: number;
  count: number;
}

export type ProjectFilmstrips = Record<string, FilmstripData>;

const inFlight = new Map<string, Promise<void>>();

async function buildSprite(srcAbs: string, outAbs: string, interval: number, count: number) {
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  // grava em .tmp e renomeia: um sprite pela metade nunca fica no cache
  const tmp = `${outAbs}.tmp.jpg`;
  await runOrThrow(ffmpegPath, [
    "-y",
    "-i", srcAbs,
    "-an",
    "-vf", `fps=1/${interval},scale=-2:${FRAME_HEIGHT},tile=${count}x1`,
    "-frames:v", "1",
    "-q:v", "5",
    tmp,
  ]);
  fs.renameSync(tmp, outAbs);
}

/** Sprite de frames de cada fonte do projeto (gerado uma vez e cacheado) */
export async function getFilmstrips(recipe: Recipe): Promise<ProjectFilmstrips> {
  const result: ProjectFilmstrips = {};
  for (const source of recipe.sources) {
    const interval = Math.max(MIN_INTERVAL, source.durationInSeconds / MAX_FRAMES);
    const count = Math.max(1, Math.ceil(source.durationInSeconds / interval));
    const outAbs = path.join(projectDir(recipe.projectId), "filmstrip", `${source.id}.jpg`);
    if (!fs.existsSync(outAbs)) {
      let job = inFlight.get(outAbs);
      if (!job) {
        job = buildSprite(fromRecipePath(source.file), outAbs, interval, count).finally(() =>
          inFlight.delete(outAbs)
        );
        inFlight.set(outAbs, job);
      }
      await job;
    }
    const url = "/" + path.relative(mediaDir, outAbs).split(path.sep).join("/");
    result[source.id] = { url, interval, count };
  }
  return result;
}
