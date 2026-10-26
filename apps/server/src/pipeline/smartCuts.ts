import {
  detectTranscriptCuts,
  mergeSuggestions,
  PAUSE_PACES,
  transcriptWords,
  undoAppliedCuts,
  type CutCandidate,
  type CutPace,
  type CutReason,
  type Recipe,
} from "@vision/recipe";
import { applySuggestedCuts } from "./applyCuts";
import { detectRetakes } from "./retakes";
import { refineTranscriptTimings } from "./silence";

export interface SmartCutsOptions {
  /** Pede ao LLM retomadas/começos falsos e muletas pelo sentido (custa uma chamada de API) */
  ai: boolean;
  /** Quanto silêncio sobra entre as frases (ver PAUSE_PACES) */
  pace?: CutPace;
}

/**
 * Sugestões de corte baseadas na transcrição (com os tempos das palavras
 * corrigidos pelo áudio): pausas, vícios e repetições
 * (determinístico) + retomadas (IA). Os cortes entram já aplicados (ver
 * applySuggestedCuts); a legenda é reagrupada pelo vídeo cortado.
 */
export async function suggestSmartCuts(
  input: Recipe,
  opts: SmartCutsOptions
): Promise<Recipe> {
  if (transcriptWords(input).length === 0) {
    throw new Error("Projeto sem transcrição — rode Transcrever antes");
  }
  // ritmo pode ter mudado: as pausas cortadas antes voltam e são medidas de novo
  // o Whisper esconde pausas dentro das palavras; sem corrigir, elas não
  // viram lacuna e a pausa passa batida (projetos transcritos antes do ajuste)
  const recipe = await refineTranscriptTimings(undoAppliedCuts(input, ["pause"]));
  const candidates: CutCandidate[] = detectTranscriptCuts(recipe, PAUSE_PACES[opts.pace ?? "normal"]);
  const reasons: CutReason[] = ["pause", "filler", "repeat"];
  if (opts.ai) {
    candidates.push(...(await detectRetakes(recipe)));
    reasons.push("retake");
  }
  return applySuggestedCuts(mergeSuggestions(recipe, candidates, reasons), input);
}
