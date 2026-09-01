import path from "node:path";
import { fileURLToPath } from "node:url";

// apps/server/src -> raiz do repositório
export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".."
);

export const mediaDir = path.join(repoRoot, "media");
export const musicDir = path.join(mediaDir, "music");
export const projectsDir = path.join(mediaDir, "projects");

export function projectDir(projectId: string): string {
  return path.join(projectsDir, projectId);
}

export function recipePath(projectId: string): string {
  return path.join(projectDir(projectId), "recipe.json");
}

/** Converte um caminho absoluto num caminho relativo à raiz, com "/" */
export function toRecipePath(absPath: string): string {
  return path.relative(repoRoot, absPath).split(path.sep).join("/");
}

/** Converte um caminho salvo na receita num caminho absoluto */
export function fromRecipePath(recipeRelPath: string): string {
  return path.join(repoRoot, ...recipeRelPath.split("/"));
}
