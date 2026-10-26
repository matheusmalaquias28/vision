import { applyCutSuggestions, applyMotionSfxRules, regroupBlocks, type Recipe } from "@vision/recipe";
import { loadCatalog } from "../library/catalog";

/**
 * Cortes detectados entram já aplicados (sem aprovação). Depois do corte:
 * a legenda é reagrupada pelo vídeo cortado (o limite de palavras conta só
 * as que ficam) e o som de cada motion acompanha o motion. Motions,
 * transições e imagens são planejados DEPOIS disso, sobre o vídeo final.
 * `original` = a receita antes de tudo (se cortes foram desfeitos antes de
 * medir de novo), para os sons dos motions andarem a diferença total.
 */
export function applySuggestedCuts(recipe: Recipe, original: Recipe = recipe): Recipe {
  const cut = applyCutSuggestions(recipe);
  if (cut === original) return original;
  const regrouped: Recipe = {
    ...cut,
    captions: {
      ...cut.captions,
      blocks: regroupBlocks(cut.captions.blocks, cut.captions.style.maxWordsPerBlock, undefined, cut.timeline),
    },
  };
  return applyMotionSfxRules(original, regrouped, loadCatalog().assets);
}
