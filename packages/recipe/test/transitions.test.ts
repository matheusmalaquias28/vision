import { describe, expect, it } from "vitest";
import { snapToCut, TRANSITION_PRESETS, TRANSITION_STYLES } from "../src/transitions";
import type { Segment } from "../src/schema";

const seg = (id: string, a: number, b: number): Segment => ({ id, sourceId: "src_01", sourceStart: a, sourceEnd: b });

describe("transições", () => {
  it("4 modelos (a varrida de luz saiu), todos de até 1,3 s, com arquivo e som", () => {
    expect(TRANSITION_STYLES).toHaveLength(4);
    expect(TRANSITION_STYLES).not.toContain("swipe");
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

describe("varrida de luz removida", () => {
  it("projeto salvo com ela abre como Luz, centralizada no mesmo corte", async () => {
    const { migrateRecipeData } = await import("../src/migrate");
    const { parseRecipe } = await import("../src/schema");
    const r = parseRecipe(
      migrateRecipeData({
        version: 2,
        projectId: "t",
        createdAt: "2026-10-01T00:00:00Z",
        sources: [{ id: "src_01", file: "media/a.mp4", durationInSeconds: 30, width: 1080, height: 1920, fps: 30 }],
        timeline: { segments: [{ id: "seg_01", sourceId: "src_01", sourceStart: 0, sourceEnd: 30 }] },
        captions: { blocks: [] },
        motions: [{ id: "t1", kind: "transition", sourceId: "src_01", sourceTime: 9.5, durationSeconds: 1, params: { style: "swipe" } }],
        render: { width: 1080, height: 1920, fps: 30 },
      })
    );
    const t = r.motions[0];
    expect(t.kind === "transition" && t.params.style).toBe("flare");
    expect(t.durationSeconds).toBe(TRANSITION_PRESETS.flare.seconds);
    // centro continua em 10 s (o corte)
    expect(t.sourceTime + t.durationSeconds / 2).toBeCloseTo(10, 2);
  });
});
