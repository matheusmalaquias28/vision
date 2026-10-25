import path from "node:path";
import { repoRoot } from "../paths";
import { ffmpegPath, runBinaryOut } from "../pipeline/ffbin";

/**
 * Medições objetivas de uma música (sem IA): andamento, força da batida,
 * volume, graves e brilho. A IA de áudio sozinha errava energia/gênero (um
 * hip hop pesado saiu "jazz calmo"); estas medidas são estáveis e, comparadas
 * entre as faixas da biblioteca, dão a energia 1–5 (`energyLevels`).
 */

export interface MusicFeatures {
  /** BPM estimado (dobrado/metade dobrado para 70–160) */
  bpm: number | null;
  /** Força média dos ataques (fluxo espectral): batida, percussão */
  onset: number;
  /** Volume médio (RMS, dBFS) */
  rmsDb: number;
  /** Centroide espectral médio (Hz): brilho */
  centroidHz: number;
  /** Fração da energia abaixo de ~160 Hz: graves */
  bass: number;
}

const SR = 11025;
const WIN = 1024;
const HOP = 256;
const FPS = SR / HOP;

/** FFT radix-2 in-place (re/im), tamanho potência de 2 */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** Medidas a partir de PCM mono em `sampleRate` (testável sem arquivo) */
export function featuresFromPcm(samples: Float32Array, sampleRate = SR): MusicFeatures {
  const hann = new Float64Array(WIN).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WIN - 1)));
  const bins = WIN / 2;
  const binHz = sampleRate / WIN;
  const bassBin = Math.max(1, Math.round(160 / binHz));
  const frames = Math.max(0, Math.floor((samples.length - WIN) / HOP));
  const flux = new Float64Array(frames);
  let prev = new Float64Array(bins);
  let rmsSum = 0;
  let centroidSum = 0;
  let centroidN = 0;
  let bassE = 0;
  let totalE = 0;
  const re = new Float64Array(WIN);
  const im = new Float64Array(WIN);
  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    let sq = 0;
    for (let i = 0; i < WIN; i++) {
      const s = samples[off + i];
      sq += s * s;
      re[i] = s * hann[i];
      im[i] = 0;
    }
    rmsSum += Math.sqrt(sq / WIN);
    fft(re, im);
    const mag = new Float64Array(bins);
    let num = 0;
    let den = 0;
    let fl = 0;
    for (let k = 1; k < bins; k++) {
      const e = re[k] * re[k] + im[k] * im[k];
      // escala log: separa bem batida forte (hip hop, eletrônica) de trilha calma;
      // lofi também pontua alto (batida + chiado), por isso a energia final é da IA
      const m = Math.log1p(1000 * Math.sqrt(e));
      mag[k] = m;
      const d = m - prev[k];
      if (d > 0) fl += d;
      num += k * binHz * e;
      den += e;
      totalE += e;
      if (k <= bassBin) bassE += e;
    }
    flux[f] = fl / bins;
    if (den > 1e-9) {
      centroidSum += num / den;
      centroidN++;
    }
    prev = mag;
  }
  const rms = frames ? rmsSum / frames : 0;
  return {
    bpm: estimateBpm(flux),
    onset: frames ? round(flux.reduce((a, b) => a + b, 0) / frames, 4) : 0,
    rmsDb: round(20 * Math.log10(Math.max(rms, 1e-6)), 1),
    centroidHz: centroidN ? Math.round(centroidSum / centroidN) : 0,
    bass: totalE > 0 ? round(bassE / totalE, 3) : 0,
  };
}

/** Autocorrelação do fluxo de ataques em 60–180 BPM, dobrada para 70–160 */
function estimateBpm(flux: Float64Array): number | null {
  const n = flux.length;
  if (n < FPS * 8) return null;
  const mean = flux.reduce((a, b) => a + b, 0) / n;
  const x = flux.map((v) => v - mean);
  let best = 0;
  let bestLag = 0;
  const minLag = Math.floor((60 * FPS) / 180);
  const maxLag = Math.ceil((60 * FPS) / 60);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += x[i] * x[i + lag];
    s /= n - lag;
    if (s > best) {
      best = s;
      bestLag = lag;
    }
  }
  if (!bestLag || best <= 0) return null;
  let bpm = (60 * FPS) / bestLag;
  while (bpm < 70) bpm *= 2;
  while (bpm > 160) bpm /= 2;
  return Math.round(bpm);
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** Decodifica até 60 s a partir de 25% da faixa e mede */
export async function measureMusic(file: string, durationSeconds: number | null): Promise<MusicFeatures> {
  const dur = durationSeconds ?? 90;
  const start = Math.max(0, Math.min(dur * 0.25, dur - 61));
  const pcm = await runBinaryOut(ffmpegPath, [
    "-hide_banner", "-loglevel", "error",
    "-ss", start.toFixed(2), "-t", "60",
    "-i", path.join(repoRoot, ...file.split("/")),
    "-vn", "-ac", "1", "-ar", String(SR), "-f", "f32le", "-",
  ]);
  // cópia alinhada (o Buffer pode começar fora de múltiplo de 4)
  const n = Math.floor(pcm.byteLength / 4);
  const samples = new Float32Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + n * 4));
  return featuresFromPcm(samples);
}

/**
 * Intensidade 1–5 RELATIVA à biblioteca (ataques, volume, andamento; quintis).
 * Vai como pista para a IA, que decide a energia final: nenhuma fórmula de
 * sinal acerta todos os gêneros (lofi pontua alto pela batida + chiado).
 */
export function energyLevels(all: MusicFeatures[]): number[] {
  if (all.length < 5) return all.map(() => 3);
  const z = (vals: number[]) => {
    const m = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / vals.length) || 1;
    return vals.map((v) => (v - m) / sd);
  };
  const zo = z(all.map((f) => f.onset));
  const zr = z(all.map((f) => f.rmsDb));
  const zb = z(all.map((f) => f.bpm ?? 110));
  const raw = all.map((_, i) => zo[i] + 0.5 * zr[i] + 0.3 * zb[i]);
  const sorted = [...raw].sort((a, b) => a - b);
  return raw.map((v) => {
    const rank = sorted.indexOf(v) / Math.max(1, sorted.length - 1);
    return Math.min(5, 1 + Math.floor(rank * 5));
  });
}

/** Palavras para a IA de áudio usar como apoio (níveis relativos à biblioteca) */
export function featureHints(f: MusicFeatures, all: MusicFeatures[]): string {
  const level = (v: number, vals: number[], words: [string, string, string]) => {
    const s = [...vals].sort((a, b) => a - b);
    const r = s.findIndex((x) => x >= v) / Math.max(1, s.length - 1);
    return r < 0.33 ? words[0] : r < 0.66 ? words[1] : words[2];
  };
  const pool = all.length >= 5 ? all : [f];
  const i = all.indexOf(f);
  const intensity = i >= 0 && all.length >= 5 ? energyLevels(all)[i] : null;
  return [
    intensity !== null ? `intensidade geral ${["muito baixa", "baixa", "média", "alta", "muito alta"][intensity - 1]}` : null,
    f.bpm ? `andamento medido ~${f.bpm} BPM` : null,
    `batida/percussão ${level(f.onset, pool.map((x) => x.onset), ["fraca", "média", "forte"])}`,
    `graves ${level(f.bass, pool.map((x) => x.bass), ["leves", "médios", "fortes"])}`,
    `brilho ${level(f.centroidHz, pool.map((x) => x.centroidHz), ["escuro", "médio", "brilhante"])}`,
  ]
    .filter(Boolean)
    .join(", ");
}
