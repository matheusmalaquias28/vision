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
    audioClips: [
      { id: "sfx_01", kind: "sfx", file: "media/sfx/whoosh.mp3", start: 10, duration: 1.2, volume: 0.8 },
    ],
    audio: { originalVolume: 1, useEnhanced: false, narration: null },
    effects: { punchIn: false },
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

  it("aceita os novos motivos de corte e aplica note padrão", () => {
    const raw = validRecipe() as any;
    raw.timeline.suggestedCuts[0].reason = "retake";
    const r = parseRecipe(raw);
    expect(r.timeline.suggestedCuts[0].reason).toBe("retake");
    expect(r.timeline.suggestedCuts[0].note).toBe("");
    raw.timeline.suggestedCuts[0].reason = "qualquer";
    expect(RecipeSchema.safeParse(raw).success).toBe(false);
  });

  it("aplica defaults (overlays, audioClips, effects, narração)", () => {
    const raw = validRecipe() as any;
    delete raw.overlays;
    delete raw.audioClips;
    delete raw.effects;
    raw.audio = {};
    const r = parseRecipe(raw);
    expect(r.overlays).toEqual([]);
    expect(r.audioClips).toEqual([]);
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

describe("migrateRecipeData: reparo de ids de segmento", () => {
  it("renomeia ids duplicados e mantém o resto intacto", () => {
    const raw = {
      version: 2,
      timeline: {
        segments: [
          { id: "seg_01", sourceStart: 0, sourceEnd: 1 },
          { id: "seg_01b", sourceStart: 2, sourceEnd: 3 },
          { id: "seg_01b", sourceStart: 4, sourceEnd: 5 },
          { id: "seg_01b", sourceStart: 6, sourceEnd: 7 },
        ],
      },
    };
    const out = migrateRecipeData(raw) as typeof raw;
    expect(out.timeline.segments.map((s) => s.id)).toEqual(["seg_01", "seg_01b", "seg_01b_2", "seg_01b_3"]);
    expect(out.timeline.segments.map((s) => s.sourceStart)).toEqual([0, 2, 4, 6]);
  });

  it("receita sem duplicados passa intacta (mesma referência)", () => {
    const raw = { version: 2, timeline: { segments: [{ id: "a" }, { id: "b" }] } };
    expect(migrateRecipeData(raw)).toBe(raw);
  });
});

describe("migrateRecipeData: música e sfx viram audioClips", () => {
  it("converte audio.music (loop até o fim) e sfx (instantes)", () => {
    const raw = validRecipe() as any;
    delete raw.audioClips;
    raw.sfx = [{ id: "sfx_01", file: "media/sfx/whoosh.mp3", at: 3, volume: 0.5 }];
    raw.audio = {
      ...raw.audio,
      music: { file: "media/music/a.mp3", volume: 0.1, fadeInSeconds: 1, fadeOutSeconds: 2, startOffsetSeconds: 4 },
    };
    const r = parseRecipe(migrateRecipeData(raw));
    const total = raw.timeline.segments.reduce((a: number, s: any) => a + s.sourceEnd - s.sourceStart, 0);
    expect(r.audioClips).toEqual([
      expect.objectContaining({ kind: "music", file: "media/music/a.mp3", start: 0, duration: total, offset: 4, volume: 0.1, loop: true }),
      expect.objectContaining({ id: "sfx_01", kind: "sfx", start: 3, volume: 0.5 }),
    ]);
    expect((r.audio as any).music).toBeUndefined();
  });

  it("receita já migrada passa direto", () => {
    const raw = validRecipe();
    expect(migrateRecipeData(raw)).toBe(raw);
  });
});

describe("layerOrder", () => {
  it("padrão: legenda na frente, vídeo no fundo", () => {
    expect(parseRecipe(validRecipe()).layerOrder).toEqual(["captions", "motions", "overlays", "video"]);
  });

  it("aceita outra ordem, mas não camada repetida ou faltando", () => {
    const raw = validRecipe() as any;
    raw.layerOrder = ["captions", "motions", "video", "overlays"];
    expect(parseRecipe(raw).layerOrder[3]).toBe("overlays");
    raw.layerOrder = ["captions", "captions", "video", "overlays"];
    expect(RecipeSchema.safeParse(raw).success).toBe(false);
    raw.layerOrder = ["captions", "video", "overlays"];
    expect(RecipeSchema.safeParse(raw).success).toBe(false);
  });
});

describe("captions.style.fontWeight", () => {
  it("padrão 900 (peso que as legendas sempre usaram)", () => {
    expect(parseRecipe(validRecipe()).captions.style.fontWeight).toBe(900);
  });

  it("aceita só pesos CSS de 100 em 100", () => {
    const raw = validRecipe() as any;
    raw.captions.style = { ...raw.captions.style, fontWeight: 300 };
    expect(parseRecipe(raw).captions.style.fontWeight).toBe(300);
    raw.captions.style.fontWeight = 350;
    expect(RecipeSchema.safeParse(raw).success).toBe(false);
    raw.captions.style.fontWeight = 1000;
    expect(RecipeSchema.safeParse(raw).success).toBe(false);
  });
});

describe("placement (posição livre arrastada no preview)", () => {
  it("padrão null em legenda, overlays e motions", () => {
    const r = parseRecipe(validRecipe());
    expect(r.captions.style.placement).toBeNull();
    expect(r.overlays.every((o) => o.placement === null)).toBe(true);
  });

  it("aceita x/y em % do quadro e recusa fora de 0–100", () => {
    const raw = validRecipe() as any;
    raw.captions.style = { ...raw.captions.style, placement: { x: 50, y: 72.5 } };
    raw.overlays[0].placement = { x: 10, y: 90 };
    const r = parseRecipe(raw);
    expect(r.captions.style.placement).toEqual({ x: 50, y: 72.5 });
    expect(r.overlays[0].placement).toEqual({ x: 10, y: 90 });
    raw.overlays[0].placement = { x: 120, y: 50 };
    expect(RecipeSchema.safeParse(raw).success).toBe(false);
  });
});
