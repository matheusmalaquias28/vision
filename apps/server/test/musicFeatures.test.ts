import { describe, expect, it } from "vitest";
import { energyLevels, featureHints, featuresFromPcm, type MusicFeatures } from "../src/library/musicFeatures";

const SR = 11025;

/** Bumbo sintético (seno grave com queda rápida) a `bpm`, com ruído leve opcional */
function clickTrack(bpm: number, seconds: number, hit = 1, noise = 0): Float32Array {
  const out = new Float32Array(SR * seconds);
  const period = Math.round((60 / bpm) * SR);
  let seed = 7;
  for (let i = 0; i < out.length; i++) {
    const t = (i % period) / SR;
    seed = (seed * 16807) % 2147483647;
    out[i] = hit * Math.sin(2 * Math.PI * 60 * t) * Math.exp(-t * 30) + noise * ((seed / 2147483647) * 2 - 1);
  }
  return out;
}

describe("medição de música (sem IA)", () => {
  it("acha o andamento de uma batida regular", () => {
    expect(featuresFromPcm(clickTrack(120, 20))!.bpm).toBeGreaterThanOrEqual(117);
    expect(featuresFromPcm(clickTrack(120, 20))!.bpm).toBeLessThanOrEqual(123);
    expect(Math.abs(featuresFromPcm(clickTrack(90, 20)).bpm! - 90)).toBeLessThanOrEqual(3);
  });

  it("batida forte e grave pontuam mais que trilha fraca; energia relativa vai de 1 a 5", () => {
    const strong = featuresFromPcm(clickTrack(128, 15, 1));
    // sem ruído: com chiado a escala log conta ruído como ataque (lofi); por isso a energia final é da IA
    const soft = featuresFromPcm(clickTrack(80, 15, 0.08));
    expect(strong.onset).toBeGreaterThan(soft.onset);
    expect(strong.rmsDb).toBeGreaterThan(soft.rmsDb);
    expect(strong.bass).toBeGreaterThan(0.5);
    const pool: MusicFeatures[] = [0.05, 0.1, 0.2, 0.4, 0.6, 0.8, 1].map((h, i) => featuresFromPcm(clickTrack(80 + i * 10, 12, h)));
    const levels = energyLevels(pool);
    expect(levels[0]).toBe(1);
    expect(levels[levels.length - 1]).toBe(5);
    expect(featureHints(pool[pool.length - 1], pool)).toMatch(/intensidade geral muito alta/);
    expect(energyLevels(pool.slice(0, 3))).toEqual([3, 3, 3]);
  });
});
