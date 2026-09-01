import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import type { Recipe } from "@vision/recipe";
import { mediaDir, projectDir, repoRoot } from "../paths";

const ENTRY_POINT = path.join(repoRoot, "packages", "video", "src", "index.ts");
const COMPOSITION_ID = "Vision";

export interface RenderResult {
  outputPath: string;
}

export async function renderRecipe(
  recipe: Recipe,
  onProgress?: (fraction: number) => void
): Promise<RenderResult> {
  const serveUrl = await bundle({
    entryPoint: ENTRY_POINT,
    publicDir: mediaDir,
  });

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
