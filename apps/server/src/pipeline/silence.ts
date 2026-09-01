import type { Recipe, SuggestedCut } from "@vision/recipe";
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

interface SilenceRange {
  start: number;
  end: number;
}

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

/** Roda a detecção em todas as fontes e grava as sugestões na receita */
export async function suggestCuts(
  recipe: Recipe,
  opts: SilenceOptions = defaultSilenceOptions
): Promise<Recipe> {
  const suggestions: SuggestedCut[] = [];
  for (const source of recipe.sources) {
    const ranges = await detectSilences(fromRecipePath(source.file), opts);
    for (const r of ranges) {
      const cutStart = r.start + opts.paddingSeconds;
      const cutEnd = r.end - opts.paddingSeconds;
      if (cutEnd - cutStart < 0.3) continue;
      const silenceDur = r.end - r.start;
      suggestions.push({
        id: `sug_${String(suggestions.length + 1).padStart(2, "0")}`,
        sourceId: source.id,
        sourceStart: Math.round(cutStart * 1000) / 1000,
        sourceEnd: Math.round(cutEnd * 1000) / 1000,
        reason: "silence",
        confidence:
          Math.round(
            Math.min(0.95, 0.6 + (silenceDur - opts.minSilenceSeconds) * 0.15) *
              100
          ) / 100,
        status: "pending",
      });
    }
  }
  return {
    ...recipe,
    timeline: { ...recipe.timeline, suggestedCuts: suggestions },
  };
}
