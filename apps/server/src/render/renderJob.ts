import os from "node:os";
import path from "node:path";
import { renderMedia, selectComposition, type ChromiumOptions, type X264Preset } from "@remotion/renderer";
import { ensureTransitionSfx, recipeMediaFiles, type Recipe } from "@vision/recipe";
import { loadCatalog } from "../library/catalog";
import { projectDir } from "../paths";
import { freeTempBytes, getServeUrl, MIN_FREE_BYTES, syncBundleMedia } from "./bundle";
import { ensureWorkingSources } from "../pipeline/normalize";
import { saveRecipe } from "../project";

const COMPOSITION_ID = "Vision";

/**
 * Abas do Chrome em paralelo: núcleos, até 8. Na VPS (4 vCPU) o ganho é
 * pequeno: um Chrome só tira a foto de um quadro por vez (navegador e
 * compositor dele), então mais abas param nessa fila — 2 Chromes em paralelo,
 * medido, também não ganharam. No Windows (16 threads) o padrão do Remotion
 * (metade) deixava CPU parada. RENDER_CONCURRENCY troca (ex.: pouca RAM).
 */
export function renderConcurrency(): number {
  const cpus = os.availableParallelism();
  const env = Number(process.env.RENDER_CONCURRENCY);
  if (Number.isInteger(env) && env > 0) return Math.min(env, cpus);
  return Math.min(8, cpus);
}

/**
 * Preset do x264 (CRF 18 do Remotion em todos). O "medium" padrão comia ~1 dos
 * 4 núcleos da VPS que o Chrome precisa; "veryfast" usa um terço disso:
 * −27% de tempo lá, imagem igual (SSIM 0,994, PSNR 47 dB) e arquivo até menor.
 * RENDER_X264_PRESET troca ("default" = padrão do Remotion).
 */
export function renderX264Preset(): X264Preset | null {
  const env = process.env.RENDER_X264_PRESET;
  if (env === "default") return null;
  return (env as X264Preset) || "veryfast";
}

/**
 * Como o Chrome desenha. Windows (máquina com placa de vídeo): "angle" usa a
 * GPU, 20–27% mais rápido com a mesma imagem (medido: PSNR 44 dB, mesma luma).
 * VPS sem GPU fica no padrão do Remotion. RENDER_GL troca (angle, swangle,
 * swiftshader, egl, vulkan, angle-egl; "default" = padrão do Remotion).
 */
export function renderGl(): ChromiumOptions["gl"] {
  const env = process.env.RENDER_GL;
  if (env === "default") return null;
  if (env) return env as ChromiumOptions["gl"];
  return process.platform === "win32" ? "angle" : null;
}

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

  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);
  const outputPath = path.join(
    projectDir(recipe.projectId),
    "renders",
    `render-${timestamp}.mp4`
  );
  await renderToFile(recipe, outputPath, onProgress);
  return { outputPath };
}

/** Só o render da receita como está (sem preparar fontes nem gravar a receita) */
export async function renderToFile(
  recipe: Recipe,
  outputPath: string,
  onProgress?: (fraction: number) => void
): Promise<void> {
  // um bundle por processo (não copia a mídia de novo a cada render)
  const serveUrl = await getServeUrl();
  // Windows: o bundle é uma cópia de media/ da hora em que nasceu; leva o que é novo
  const synced = syncBundleMedia(serveUrl, recipeMediaFiles(recipe));
  if (synced > 0) console.log(`[render ${recipe.projectId}] ${synced} arquivo(s) novo(s) copiado(s) para o bundle`);

  const inputProps = { recipe };
  const chromiumOptions: ChromiumOptions = { gl: renderGl() };
  const composition = await selectComposition({
    serveUrl,
    id: COMPOSITION_ID,
    inputProps,
    chromiumOptions,
  });

  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: outputPath,
    inputProps,
    concurrency: renderConcurrency(),
    x264Preset: renderX264Preset(),
    chromiumOptions,
    onProgress: ({ progress }) => onProgress?.(progress),
  });
}
