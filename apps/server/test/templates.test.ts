import { describe, expect, it } from "vitest";
import { parseRecipe, PUNCH_IN_GROUP } from "@vision/recipe";
import { applyTemplate } from "../src/templates";

const recipe = () =>
  parseRecipe({
    version: 2,
    projectId: "t",
    createdAt: "2026-10-01T00:00:00Z",
    sources: [{ id: "src_01", file: "media/a.mp4", durationInSeconds: 30, width: 1080, height: 1920, fps: 30 }],
    timeline: {
      segments: [
        { id: "seg_01", sourceId: "src_01", sourceStart: 0, sourceEnd: 5 },
        { id: "seg_02", sourceId: "src_01", sourceStart: 6, sourceEnd: 10 },
      ],
    },
    captions: { blocks: [] },
    render: { width: 1080, height: 1920, fps: 30 },
  });

describe("templates: nada escondido do operador", () => {
  it("Dinâmico põe o zoom nos cortes como motions na timeline, não como efeito invisível", () => {
    const r = applyTemplate(recipe(), "dinamico");
    expect(r.effects.punchIn).toBe(false);
    expect(r.motions.filter((m) => m.group === PUNCH_IN_GROUP).map((m) => m.sourceTime)).toEqual([0, 6]);
  });

  it("trocar para Clean ou Podcast tira esses zooms; reaplicar não duplica", () => {
    const din = applyTemplate(applyTemplate(recipe(), "dinamico"), "dinamico");
    expect(din.motions.filter((m) => m.group === PUNCH_IN_GROUP)).toHaveLength(2);
    expect(applyTemplate(din, "clean").motions).toEqual([]);
    expect(applyTemplate(din, "podcast").motions).toEqual([]);
  });
});
