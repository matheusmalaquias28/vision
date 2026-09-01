import fs from "node:fs";
import path from "node:path";
import type { Recipe } from "@vision/recipe";
import { fromRecipePath, projectDir } from "../paths";
import { ffmpegPath, runBinaryOut } from "./ffbin";

const SAMPLE_RATE = 8000;
const BINS_PER_SECOND = 50;

export interface WaveformData {
  binsPerSecond: number;
  peaks: number[];
}

export type ProjectWaveforms = Record<string, WaveformData>;

async function computePeaks(mediaAbsPath: string): Promise<WaveformData> {
  const pcm = await runBinaryOut(ffmpegPath, [
    "-i", mediaAbsPath,
    "-vn",
    "-ac", "1",
    "-ar", String(SAMPLE_RATE),
    "-f", "s16le",
    "-acodec", "pcm_s16le",
    "-",
  ]);
  const sampleCount = Math.floor(pcm.length / 2);
  const samplesPerBin = SAMPLE_RATE / BINS_PER_SECOND;
  const binCount = Math.ceil(sampleCount / samplesPerBin);
  const peaks = new Array<number>(binCount).fill(0);
  for (let i = 0; i < sampleCount; i++) {
    const value = Math.abs(pcm.readInt16LE(i * 2)) / 32768;
    const bin = Math.floor(i / samplesPerBin);
    if (value > peaks[bin]) peaks[bin] = value;
  }
  return {
    binsPerSecond: BINS_PER_SECOND,
    peaks: peaks.map((p) => Math.round(p * 1000) / 1000),
  };
}

/** Extrai (e cacheia) os picos de áudio de cada fonte do projeto */
export async function getWaveforms(recipe: Recipe): Promise<ProjectWaveforms> {
  const cachePath = path.join(projectDir(recipe.projectId), "waveform-v2.json");
  const cached: ProjectWaveforms = fs.existsSync(cachePath)
    ? JSON.parse(fs.readFileSync(cachePath, "utf8"))
    : {};
  let changed = false;
  for (const source of recipe.sources) {
    if (!cached[source.id]) {
      cached[source.id] = await computePeaks(fromRecipePath(source.file));
      changed = true;
    }
  }
  if (changed) fs.writeFileSync(cachePath, JSON.stringify(cached), "utf8");
  return cached;
}
