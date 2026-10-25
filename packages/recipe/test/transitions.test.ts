import { describe, expect, it } from "vitest";
import { snapToCut, TRANSITION_PRESETS, TRANSITION_STYLES } from "../src/transitions";
import type { Segment } from "../src/schema";

const seg = (id: string, a: number, b: number): Segment => ({ id, sourceId: "src_01", sourceStart: a, sourceEnd: b });

describe("transições", () => {
  it("5 modelos, todos de até 1,3 s, com arquivo e som", () => {
    expect(TRANSITION_STYLES).toHaveLength(5);
    for (const s of TRANSITION_STYLES) {
      const p = TRANSITION_PRESETS[s];
      expect(p.seconds).toBeLessThanOrEqual(1.3);
      expect(p.file).toMatch(/^media\/library\//);
      expect(p.sfx.length).toBeGreaterThan(0);
    }
  });

  it("vai para o corte mais perto e fica centralizada nele; sem corte perto, não entra", () => {
    // cortes no vídeo final em 4 s e 10 s
    const segments = [seg("a", 0, 4), seg("b", 6, 12), seg("c", 20, 30)];
    expect(snapToCut(segments, 4.8, 1)).toBe(3.5);
    expect(snapToCut(segments, 9.2, 0.6)).toBe(9.7);
    expect(snapToCut(segments, 7, 1)).toBeNull();
    expect(snapToCut([seg("a", 0, 30)], 5, 1)).toBeNull();
  });
});
