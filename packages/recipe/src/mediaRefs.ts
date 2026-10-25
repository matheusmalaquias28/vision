import type { Recipe } from "./schema";
import { TRANSITION_PRESETS } from "./transitions";

/**
 * Todos os arquivos de media/ que o render da receita lê: os citados na
 * receita (fontes, áudio tratado, overlays, músicas/efeitos, imagens das
 * ilustrações...) e os vídeos da biblioteca usados pelas transições, que
 * vêm do código e não da receita. Ordenados e sem repetição.
 */
export function recipeMediaFiles(recipe: Recipe): string[] {
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === "string") {
      if (v.startsWith("media/")) out.add(v);
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (v && typeof v === "object") {
      Object.values(v).forEach(walk);
    }
  };
  walk(recipe);
  for (const m of recipe.motions) {
    if (m.kind === "transition" && m.status !== "rejected") out.add(TRANSITION_PRESETS[m.params.style].file);
  }
  return [...out].sort();
}
