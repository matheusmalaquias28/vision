import { describe, expect, it } from "vitest";
import type { SpokenWord } from "@vision/recipe";
import { formatTranscript } from "../src/creative/planner";

const w = (text: string, outputTime: number) => ({ word: { text }, outputTime }) as unknown as SpokenWord;

describe("transcrição do prompt", () => {
  it("marca com ‖ as palavras logo depois de um corte (onde a transição cabe)", () => {
    const words = [w("um", 0), w("dois", 0.5), w("tres", 1.2), w("quatro", 1.6), w("cinco", 6)];
    expect(formatTranscript(words)).not.toContain("‖");
    const out = formatTranscript(words, new Set([2]));
    expect(out).toContain("‖ [2]tres");
    expect(out).not.toContain("‖ [4]");
  });
});
