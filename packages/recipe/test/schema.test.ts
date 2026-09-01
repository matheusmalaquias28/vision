import { describe, expect, it } from "vitest";
import { migrateRecipeData } from "../src/migrate";
import { RecipeSchema, parseRecipe } from "../src/schema";

function validRecipe() {
  return {
    version: 2,
    projectId: "test-project",
    createdAt: "2026-09-01T14:30:00Z",
    briefing: "cortar e legendar",
    template: null,
    sources: [
      {
        id: "src_01",
        file: "media/projects/test-project/source-src_01.mp4",
        durationInSeconds: 87.43,
        width: 1080,
        height: 1920,
        fps: 30,
        enhancedAudio: null,
      },
      {
        id: "src_02",
        file: "media/projects/test-project/source-src_02.mp4",
        durationInSeconds: 20,
        width: 1920,
        height: 1080,
        fps: 30,
        enhancedAudio: null,
      },
    ],
    timeline: {
      segments: [
        { id: "seg_01", sourceId: "src_02", sourceStart: 0, sourceEnd: 10 },
        { id: "seg_02", sourceId: "src_01", sourceStart: 14.1, sourceEnd: 45.8 },
      ],
      suggestedCuts: [
        {
          id: "sug_01",
          sourceId: "src_01",
          sourceStart: 12.42,
          sourceEnd: 14.1,
          reason: "silence",
          confidence: 0.95,
          status: "pending",
        },
      ],
    },
    captions: {
      style: {},
      blocks: [
        {
          id: "cap_01",
          sourceId: "src_01",
          words: [{ text: "Hoje", start: 0.32, end: 0.58 }],
        },
      ],
    },
    overlays: [
      {
        id: "ov_01",
        kind: "title",
        text: "TÍTULO FIXO",
        file: null,
        start: 0,
        end: null,
        position: "top",
        layout: "overlay",
      },
    ],
    sfx: [{ id: "sfx_01", file: "media/sfx/whoosh.mp3", at: 10, volume: 0.8 }],
    audio: { originalVolume: 1, useEnhanced: false, music: null, narration: null },
    effects: { punchIn: true },
    render: { width: 1080, height: 1920, fps: 30, codec: "h264" },
  };
}

describe("RecipeSchema v2", () => {
  it("aceita uma receita válida multi-clipe", () => {
    expect(() => parseRecipe(validRecipe())).not.toThrow();
  });

  it("rejeita segment apontando para fonte inexistente", () => {
    const raw = validRecipe();
    raw.timeline.segments[0].sourceId = "src_99";
    expect(RecipeSchema.safeParse(raw).success).toBe(false);
  });

  it("rejeita caption block apontando para fonte inexistente", () => {
    const raw = validRecipe();
    raw.captions.blocks[0].sourceId = "src_99";
    expect(RecipeSchema.safeParse(raw).success).toBe(false);
  });

  it("aceita caption block com sourceId null (narração, tempo final)", () => {
    const raw = validRecipe();
    (raw.captions.blocks[0] as any).sourceId = null;
    expect(RecipeSchema.safeParse(raw).success).toBe(true);
  });

  it("rejeita overlay title sem texto e image sem arquivo", () => {
    const raw = validRecipe();
    raw.overlays[0].text = "";
    expect(RecipeSchema.safeParse(raw).success).toBe(false);
    const raw2 = validRecipe();
    (raw2.overlays[0] as any) = {
      id: "ov_01",
      kind: "image",
      text: "",
      file: null,
      start: 0,
      end: null,
      position: "top",
      layout: "overlay",
    };
    expect(RecipeSchema.safeParse(raw2).success).toBe(false);
  });

  it("rejeita segmento com duração zero", () => {
    const raw = validRecipe();
    raw.timeline.segments[0].sourceEnd = raw.timeline.segments[0].sourceStart;
    expect(RecipeSchema.safeParse(raw).success).toBe(false);
  });

  it("aplica defaults (overlays, sfx, effects, narração)", () => {
    const raw = validRecipe() as any;
    delete raw.overlays;
    delete raw.sfx;
    delete raw.effects;
    raw.audio = {};
    const r = parseRecipe(raw);
    expect(r.overlays).toEqual([]);
    expect(r.sfx).toEqual([]);
    expect(r.effects.punchIn).toBe(false);
    expect(r.audio.narration).toBeNull();
  });
});

describe("migrateRecipeData v1→v2", () => {
  const v1 = {
    version: 1,
    projectId: "old",
    createdAt: "2026-09-01T14:30:00Z",
    source: {
      file: "media/projects/old/source.mp4",
      durationInSeconds: 10,
      width: 1080,
      height: 1920,
      fps: 30,
    },
    timeline: {
      segments: [{ id: "seg_01", sourceStart: 0, sourceEnd: 10 }],
      suggestedCuts: [
        {
          id: "sug_01",
          sourceStart: 2,
          sourceEnd: 3,
          reason: "silence",
          confidence: 0.8,
          status: "pending",
        },
      ],
    },
    captions: {
      style: {},
      blocks: [{ id: "cap_01", words: [{ text: "oi", start: 0, end: 0.5 }] }],
    },
    audio: { originalVolume: 1, music: null },
    render: { width: 1080, height: 1920, fps: 30, codec: "h264" },
  };

  it("migra e valida no schema v2", () => {
    const r = parseRecipe(migrateRecipeData(v1));
    expect(r.version).toBe(2);
    expect(r.sources[0].id).toBe("src_01");
    expect(r.timeline.segments[0].sourceId).toBe("src_01");
    expect(r.timeline.suggestedCuts[0].sourceId).toBe("src_01");
    expect(r.captions.blocks[0].sourceId).toBe("src_01");
  });

  it("não toca em receitas v2", () => {
    const r = validRecipe();
    expect(migrateRecipeData(r)).toBe(r);
  });
});
