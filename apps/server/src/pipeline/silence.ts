import {
  mergeSilenceRanges,
  mergeSuggestions,
  quietRangesFromLevels,
  refineWordsWithSilences,
  type CutCandidate,
  type Recipe,
  type SilenceRange,
} from "@vision/recipe";
import { fromRecipePath } from "../paths";
import { applySuggestedCuts } from "./applyCuts";
import { ffmpegPath, run, runBinaryOut } from "./ffbin";

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
 * Roda a detecção em todas as fontes e aplica os cortes de silêncio (sem
 * aprovação, ver applySuggestedCuts). Cortes de outros motivos ficam intactos.
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
  return applySuggestedCuts(mergeSuggestions(recipe, candidates, ["silence"]));
}

/**
 * Detecção fina para corrigir timestamps de palavras: pega pausas a partir
 * de 0.2s (as sugestões de corte continuam exigindo pausas maiores).
 */
const wordTimingSilence: SilenceOptions = { noiseDb: -35, minSilenceSeconds: 0.2, paddingSeconds: 0 };

const LEVEL_RATE = 16000;
const LEVEL_WINDOW_SECONDS = 0.05;

/** Nível RMS (dB) do áudio em janelas de 50 ms (PCM mono 16 kHz do ffmpeg) */
export async function measureLevels(videoAbsPath: string): Promise<number[]> {
  const pcm = await runBinaryOut(ffmpegPath, [
    "-v", "error",
    "-i", videoAbsPath,
    "-vn", "-ac", "1", "-ar", String(LEVEL_RATE),
    "-f", "s16le", "-",
  ]);
  const perWindow = Math.round(LEVEL_RATE * LEVEL_WINDOW_SECONDS);
  const samples = Math.floor(pcm.length / 2);
  const levels: number[] = [];
  for (let i = 0; i + perWindow <= samples; i += perWindow) {
    let sum = 0;
    for (let j = i; j < i + perWindow; j++) {
      const v = pcm.readInt16LE(j * 2) / 32768;
      sum += v * v;
    }
    levels.push(10 * Math.log10(sum / perWindow + 1e-10));
  }
  return levels;
}

/**
 * Silêncios para corrigir as palavras: o silencedetect de limiar fixo mais o
 * limiar adaptado ao fundo de cada clipe (sala com ruído, ver
 * quietRangesFromLevels).
 */
async function wordTimingSilences(videoAbsPath: string): Promise<SilenceRange[]> {
  const fixed = await detectSilences(videoAbsPath, wordTimingSilence);
  try {
    const adaptive = quietRangesFromLevels(await measureLevels(videoAbsPath), LEVEL_WINDOW_SECONDS, wordTimingSilence.minSilenceSeconds);
    return mergeSilenceRanges(fixed, adaptive);
  } catch {
    return fixed;
  }
}

/**
 * Corrige as palavras do Whisper com os silêncios reais do áudio de cada
 * clipe (ver refineWordsWithSilences). Sem silêncio detectável (música de
 * fundo, ruído alto) as palavras ficam como estão.
 */
export async function refineTranscriptTimings(recipe: Recipe): Promise<Recipe> {
  const bySource = new Map<string, SilenceRange[]>();
  for (const source of recipe.sources) {
    if (!recipe.captions.blocks.some((b) => b.sourceId === source.id)) continue;
    bySource.set(source.id, await wordTimingSilences(fromRecipePath(source.file)));
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
