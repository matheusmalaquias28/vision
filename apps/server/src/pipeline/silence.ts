import {
  mergeSuggestions,
  refineWordsWithSilences,
  type CutCandidate,
  type Recipe,
  type SilenceRange,
} from "@vision/recipe";
import { fromRecipePath } from "../paths";
import { ffmpegPath, run } from "./ffbin";

export interface SilenceOptions {
  /** Nível abaixo do qual é considerado silêncio (dB) */
  noiseDb: number;
  /** Duração mínima de silêncio para virar sugestão (s) */
  minSilenceSeconds: number;
  /** Respiro mantido em cada borda do corte, para não engolir fala (s) */
  paddingSeconds: number;
}

export const defaultSilenceOptions: SilenceOptions = {
  noiseDb: -35,
  minSilenceSeconds: 0.8,
  paddingSeconds: 0.15,
};

export async function detectSilences(
  videoAbsPath: string,
  opts: SilenceOptions
): Promise<SilenceRange[]> {
  const { stderr, code } = await run(ffmpegPath, [
    "-i", videoAbsPath,
    "-af", `silencedetect=noise=${opts.noiseDb}dB:d=${opts.minSilenceSeconds}`,
    "-f", "null",
    "-",
  ]);
  if (code !== 0) {
    throw new Error(`ffmpeg silencedetect falhou:\n${stderr.slice(-2000)}`);
  }
  const ranges: SilenceRange[] = [];
  let currentStart: number | null = null;
  for (const line of stderr.split(/\r?\n/)) {
    const startMatch = line.match(/silence_start:\s*([\d.]+)/);
    if (startMatch) {
      currentStart = Number(startMatch[1]);
      continue;
    }
    const endMatch = line.match(/silence_end:\s*([\d.]+)/);
    if (endMatch && currentStart !== null) {
      ranges.push({ start: currentStart, end: Number(endMatch[1]) });
      currentStart = null;
    }
  }
  return ranges;
}

/**
 * Roda a detecção em todas as fontes e grava as sugestões na receita.
 * Só substitui silêncios pendentes — sugestões de outros motivos e as já
 * revisadas pelo operador ficam intactas.
 */
export async function suggestCuts(
  recipe: Recipe,
  opts: SilenceOptions = defaultSilenceOptions
): Promise<Recipe> {
  const candidates: CutCandidate[] = [];
  for (const source of recipe.sources) {
    const ranges = await detectSilences(fromRecipePath(source.file), opts);
    for (const r of ranges) {
      const cutStart = r.start + opts.paddingSeconds;
      const cutEnd = r.end - opts.paddingSeconds;
      if (cutEnd - cutStart < 0.3) continue;
      const silenceDur = r.end - r.start;
      candidates.push({
        sourceId: source.id,
        sourceStart: Math.round(cutStart * 1000) / 1000,
        sourceEnd: Math.round(cutEnd * 1000) / 1000,
        reason: "silence",
        confidence:
          Math.round(
            Math.min(0.95, 0.6 + (silenceDur - opts.minSilenceSeconds) * 0.15) *
              100
          ) / 100,
        note: `${silenceDur.toFixed(1)}s de silêncio`,
      });
    }
  }
  return mergeSuggestions(recipe, candidates, ["silence"]);
}

/**
 * Detecção fina para corrigir timestamps de palavras: pega pausas a partir
 * de 0.2s (as sugestões de corte continuam exigindo pausas maiores).
 */
const wordTimingSilence: SilenceOptions = { noiseDb: -35, minSilenceSeconds: 0.2, paddingSeconds: 0 };

/**
 * Corrige as palavras do Whisper com os silêncios reais do áudio de cada
 * clipe (ver refineWordsWithSilences). Sem silêncio detectável (música de
 * fundo, ruído alto) as palavras ficam como estão.
 */
export async function refineTranscriptTimings(recipe: Recipe): Promise<Recipe> {
  const bySource = new Map<string, SilenceRange[]>();
  for (const source of recipe.sources) {
    if (!recipe.captions.blocks.some((b) => b.sourceId === source.id)) continue;
    bySource.set(source.id, await detectSilences(fromRecipePath(source.file), wordTimingSilence));
  }
  let changed = false;
  const blocks = recipe.captions.blocks.map((b) => {
    const silences = b.sourceId ? bySource.get(b.sourceId) : undefined;
    if (!silences || silences.length === 0) return b;
    const words = refineWordsWithSilences(b.words, silences);
    if (words.every((w, i) => w === b.words[i])) return b;
    changed = true;
    return { ...b, words };
  });
  return changed ? { ...recipe, captions: { ...recipe.captions, blocks } } : recipe;
}
