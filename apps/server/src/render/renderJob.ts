import path from "node:path";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { ensureTransitionSfx, recipeMediaFiles, type Recipe } from "@vision/recipe";
import { loadCatalog } from "../library/catalog";
import { projectDir } from "../paths";
import { freeTempBytes, getServeUrl, MIN_FREE_BYTES, syncBundleMedia } from "./bundle";
import { ensureWorkingSources } from "../pipeline/normalize";
import { saveRecipe } from "../project";

const COMPOSITION_ID = "Vision";

export interface RenderResult {
  outputPath: string;
}

export async function renderRecipe(
  recipe: Recipe,
  onProgress?: (fraction: number) => void
): Promise<RenderResult> {
  // folga de disco: sem ela o render falha no meio (ENOSPC) e deixa lixo para trás
  const free = freeTempBytes();
  if (free !== null && free < MIN_FREE_BYTES) {
    throw new Error(
      `pouco espaço em disco para renderizar (${(free / 1024 ** 3).toFixed(1)} GB livres, mínimo ${(MIN_FREE_BYTES / 1024 ** 3).toFixed(0)} GB): rode a limpeza (npm run cli -- retention) ou libere espaço`
    );
  }
  // projeto criado antes da conversão na entrada: arquivo de câmera é lido mais
  // escuro pelo render do que pelo navegador; converte antes (uma vez só)
  const ensured = await ensureWorkingSources(recipe, (msg) => console.log(`[render ${recipe.projectId}] ${msg}`));
  if (ensured.changed) saveRecipe(ensured.recipe);
  recipe = ensured.recipe;
  // toda transição vai com som (projeto salvo sem ele, biblioteca vazia na hora de aceitar...)
  const withSfx = ensureTransitionSfx(recipe, loadCatalog().assets);
  if (withSfx !== recipe) {
    saveRecipe(withSfx);
    recipe = withSfx;
  }

  // um bundle por processo (não copia a mídia de novo a cada render)
  const serveUrl = await getServeUrl();
  // Windows: o bundle é uma cópia de media/ da hora em que nasceu; leva o que é novo
  const synced = syncBundleMedia(serveUrl, recipeMediaFiles(recipe));
  if (synced > 0) console.log(`[render ${recipe.projectId}] ${synced} arquivo(s) novo(s) copiado(s) para o bundle`);

  const inputProps = { recipe };
  const composition = await selectComposition({
    serveUrl,
    id: COMPOSITION_ID,
    inputProps,
  });

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  const outputPath = path.join(
    projectDir(recipe.projectId),
    "renders",
    `render-${timestamp}.mp4`
  );

  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: outputPath,
    inputProps,
    onProgress: ({ progress }) => onProgress?.(progress),
  });

  return { outputPath };
}
