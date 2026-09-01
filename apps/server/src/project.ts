import fs from "node:fs";
import path from "node:path";
import {
  migrateRecipeData,
  parseRecipe,
  type Recipe,
  type Source,
} from "@vision/recipe";
import { projectDir, projectsDir, recipePath, toRecipePath } from "./paths";
import { probeVideo } from "./pipeline/probe";

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "projeto";
}

function uniqueProjectId(base: string): string {
  let id = base;
  let n = 2;
  while (fs.existsSync(projectDir(id))) {
    id = `${base}-${n}`;
    n++;
  }
  return id;
}

export async function createProject(
  videoAbsPaths: string[],
  requestedId?: string,
  briefing = ""
): Promise<Recipe> {
  if (videoAbsPaths.length === 0) {
    throw new Error("Nenhum vídeo enviado");
  }
  for (const p of videoAbsPaths) {
    if (!fs.existsSync(p)) throw new Error(`Vídeo não encontrado: ${p}`);
  }
  const base =
    requestedId ??
    slugify(path.basename(videoAbsPaths[0], path.extname(videoAbsPaths[0])));
  const id = uniqueProjectId(base);
  const dir = projectDir(id);
  fs.mkdirSync(path.join(dir, "renders"), { recursive: true });
  fs.mkdirSync(path.join(dir, "assets"), { recursive: true });

  const sources: Source[] = [];
  for (let i = 0; i < videoAbsPaths.length; i++) {
    const srcId = `src_${String(i + 1).padStart(2, "0")}`;
    const ext = path.extname(videoAbsPaths[i]).toLowerCase() || ".mp4";
    const destAbs = path.join(dir, `source-${srcId}${ext}`);
    fs.copyFileSync(videoAbsPaths[i], destAbs);
    const probe = await probeVideo(destAbs);
    sources.push({
      id: srcId,
      file: toRecipePath(destAbs),
      durationInSeconds: probe.durationInSeconds,
      width: probe.width,
      height: probe.height,
      fps: probe.fps,
      enhancedAudio: null,
    });
  }

  const recipe: Recipe = parseRecipe({
    version: 2,
    projectId: id,
    createdAt: new Date().toISOString(),
    briefing,
    template: null,
    sources,
    timeline: {
      segments: sources.map((s, i) => ({
        id: `seg_${String(i + 1).padStart(2, "0")}`,
        sourceId: s.id,
        sourceStart: 0,
        sourceEnd: s.durationInSeconds,
      })),
      suggestedCuts: [],
    },
    captions: { style: {}, blocks: [] },
    overlays: [],
    sfx: [],
    audio: { originalVolume: 1, useEnhanced: false, music: null, narration: null },
    effects: { punchIn: false },
    // saída sempre vertical 9:16; o vídeo é enquadrado com objectFit cover
    render: {
      width: 1080,
      height: 1920,
      fps: Math.max(1, Math.round(sources[0].fps)) || 30,
      codec: "h264",
    },
  });

  saveRecipe(recipe);
  return recipe;
}

export function loadRecipe(projectId: string): Recipe {
  const p = recipePath(projectId);
  if (!fs.existsSync(p)) {
    const available = fs.existsSync(projectsDir)
      ? fs.readdirSync(projectsDir).join(", ")
      : "(nenhum)";
    throw new Error(
      `Projeto "${projectId}" não encontrado. Projetos existentes: ${available}`
    );
  }
  return parseRecipe(migrateRecipeData(JSON.parse(fs.readFileSync(p, "utf8"))));
}

export function saveRecipe(recipe: Recipe): void {
  const validated = parseRecipe(recipe);
  fs.writeFileSync(
    recipePath(recipe.projectId),
    JSON.stringify(validated, null, 2) + "\n",
    "utf8"
  );
}
