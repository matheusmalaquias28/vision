import {
  detectTranscriptCuts,
  mergeSuggestions,
  transcriptWords,
  type CutCandidate,
  type CutReason,
  type Recipe,
} from "@vision/recipe";
import { detectRetakes } from "./retakes";

export interface SmartCutsOptions {
  /** Pede ao LLM retomadas/começos falsos (custa uma chamada de API) */
  ai: boolean;
}

/**
 * Sugestões de corte baseadas na transcrição: pausas, vícios e repetições
 * (determinístico) + retomadas (IA). Tudo entra como pendente.
 */
export async function suggestSmartCuts(
  recipe: Recipe,
  opts: SmartCutsOptions
): Promise<Recipe> {
  if (transcriptWords(recipe).length === 0) {
    throw new Error("Projeto sem transcrição — rode Transcrever antes");
  }
  const candidates: CutCandidate[] = detectTranscriptCuts(recipe);
  const reasons: CutReason[] = ["pause", "filler", "repeat"];
  if (opts.ai) {
    candidates.push(...(await detectRetakes(recipe)));
    reasons.push("retake");
  }
  return mergeSuggestions(recipe, candidates, reasons);
}
