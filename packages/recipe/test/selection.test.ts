import { describe, expect, it } from "vitest";
import { parseRecipe } from "../src/schema";
import {
  deleteTimelineItems,
  mergeSelections,
  selectionCount,
  selectionFromKeys,
  selectionHas,
  toggleInSelection,
} from "../src/selection";

const recipe = () =>
  parseRecipe({
    version: 2,
    projectId: "t",
    createdAt: "2026-10-01T00:00:00Z",
    sources: [{ id: "src_01", file: "media/a.mp4", durationInSeconds: 30, width: 1080, height: 1920, fps: 30 }],
    timeline: {
      segments: [
        { id: "seg_01", sourceId: "src_01", sourceStart: 0, sourceEnd: 10 },
        { id: "seg_02", sourceId: "src_01", sourceStart: 12, sourceEnd: 30 },
      ],
    },
    captions: {
      blocks: [
        { id: "cap_01", sourceId: "src_01", words: [{ text: "oi", start: 1, end: 1.4 }] },
        { id: "cap_02", sourceId: "src_01", words: [{ text: "tudo", start: 5, end: 5.4 }] },
      ],
    },
    motions: [
      { id: "m1", kind: "keyword", sourceId: "src_01", sourceTime: 2, params: { text: "OI" } },
      { id: "m2", kind: "emoji", sourceId: "src_01", sourceTime: 6, params: { emoji: "🔥" } },
    ],
    audioClips: [
      { id: "a1", kind: "sfx", file: "media/sfx/x.wav", start: 2, duration: 1 },
      { id: "a2", kind: "music", file: "media/music/y.mp3", start: 0, duration: 20 },
    ],
    render: { width: 1080, height: 1920, fps: 30 },
  });

describe("seleção de vários itens na timeline", () => {
  it("chaves do retângulo viram seleção por tipo, sem repetir o trecho das duas trilhas", () => {
    const s = selectionFromKeys(["motion:m1", "audio:a1", "segment:seg_01", "segment:seg_01", "caption:cap_02", "lixo"]);
    expect(s).toEqual({ captions: ["cap_02"], motions: ["m1"], overlays: [], segments: ["seg_01"], audio: ["a1"] });
    expect(selectionCount(s)).toBe(4);
    expect(selectionHas(s, "motion:m1")).toBe(true);
    expect(selectionHas(s, "motion:m2")).toBe(false);
  });

  it("Shift+clique põe e tira; Shift+retângulo soma", () => {
    let s = toggleInSelection(null, "motion:m1");
    s = toggleInSelection(s, "audio:a2");
    expect(selectionCount(s)).toBe(2);
    s = toggleInSelection(s, "motion:m1");
    expect(s.motions).toEqual([]);
    expect(mergeSelections(s, selectionFromKeys(["motion:m2", "audio:a2"]))).toMatchObject({ motions: ["m2"], audio: ["a2"] });
  });

  it("apaga tudo de uma vez", () => {
    const { recipe: out, keptAllSegments } = deleteTimelineItems(
      recipe(),
      selectionFromKeys(["motion:m1", "audio:a1", "caption:cap_01", "segment:seg_02"])
    );
    expect(keptAllSegments).toBe(false);
    expect(out.motions.map((m) => m.id)).toEqual(["m2"]);
    expect(out.audioClips.map((c) => c.id)).toEqual(["a2"]);
    expect(out.captions.blocks.map((b) => b.id)).toEqual(["cap_02"]);
    expect(out.timeline.segments.map((s) => s.id)).toEqual(["seg_01"]);
  });

  it("o vídeo nunca fica sem trecho: com todos selecionados, os trechos ficam e o resto sai", () => {
    const { recipe: out, keptAllSegments } = deleteTimelineItems(
      recipe(),
      selectionFromKeys(["segment:seg_01", "segment:seg_02", "motion:m2"])
    );
    expect(keptAllSegments).toBe(true);
    expect(out.timeline.segments).toHaveLength(2);
    expect(out.motions.map((m) => m.id)).toEqual(["m1"]);
  });
});
