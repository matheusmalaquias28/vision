import { describe, expect, it } from "vitest";
import { withExtractedAudio } from "../src/audioClips";
import { isNeutralGrade, NEUTRAL_GRADE, sharpenFilter } from "../src/color";
import { segmentFraming } from "../src/framing";
import { parseRecipe } from "../src/schema";
import { applyCutToSegments, restoreSourceRange, splitSegmentAt } from "../src/time";

const recipe = (extra: Record<string, unknown> = {}) =>
  parseRecipe({
    version: 2,
    projectId: "t",
    createdAt: "2026-10-01T00:00:00Z",
    sources: [
      {
        id: "src_01",
        file: "media/a.mp4",
        durationInSeconds: 30,
        width: 1080,
        height: 1920,
        fps: 30,
        framing: { x: 50, y: 50, zoom: 1.2 },
      },
    ],
    timeline: {
      segments: [
        { id: "seg_01", sourceId: "src_01", sourceStart: 0, sourceEnd: 5 },
        { id: "seg_02", sourceId: "src_01", sourceStart: 8, sourceEnd: 14, framing: { x: 50, y: 30, zoom: 1.6 } },
      ],
    },
    captions: { blocks: [] },
    overlays: [
      { id: "ov_1", kind: "video", file: "media/projects/t/assets/b.mp4", start: 2, end: 6, layout: "pip" },
      { id: "ov_2", kind: "image", file: "media/projects/t/assets/c.png", start: 0, end: 2 },
    ],
    render: { width: 1080, height: 1920, fps: 30 },
    ...extra,
  });

describe("escala por trecho", () => {
  it("trecho com enquadramento próprio vence o do vídeo; sem ele, segue o do vídeo", () => {
    const r = recipe();
    const [a, b] = r.timeline.segments;
    expect(segmentFraming(a, r.sources[0])).toEqual({ x: 50, y: 50, zoom: 1.2 });
    expect(segmentFraming(b, r.sources[0])).toEqual({ x: 50, y: 30, zoom: 1.6 });
  });

  it("dividir, cortar e restaurar mantêm o enquadramento do trecho", () => {
    const segs = recipe().timeline.segments;
    const split = splitSegmentAt(segs, 8); // 3 s dentro do segundo trecho
    expect(split.slice(1).map((s) => s.framing?.zoom)).toEqual([1.6, 1.6]);
    const cut = applyCutToSegments(segs, "src_01", 10, 11);
    expect(cut.slice(1).map((s) => s.framing?.zoom)).toEqual([1.6, 1.6]);
    // restaurar a pausa colada antes do trecho 2 absorve o trecho sem perder o zoom dele
    const back = restoreSourceRange(segs, "src_01", 7, 8);
    expect(back[1]).toMatchObject({ id: "seg_02", sourceStart: 7, sourceEnd: 14, framing: { zoom: 1.6 } });
  });
});

describe("nitidez", () => {
  it("0 = sem filtro; projeto antigo (sem o campo) abre sem nitidez", () => {
    expect(sharpenFilter(null)).toBeNull();
    expect(sharpenFilter(NEUTRAL_GRADE)).toBeNull();
    expect(isNeutralGrade({ ...NEUTRAL_GRADE, sharpness: 0.4 })).toBe(false);
    expect(sharpenFilter({ ...NEUTRAL_GRADE, sharpness: 0.4 })).toEqual({ radius: 1.2, amount: 0.6 });
    const old = recipe({}).sources[0];
    expect(old.color).toBeNull();
  });
});

describe("extrair áudio", () => {
  const extracted = { file: "media/projects/t/assets/audio-x.m4a", durationSeconds: 30 };

  it("trecho: clipe de efeito no mesmo instante e ponto do bruto, e o trecho fica mudo", () => {
    const r = withExtractedAudio(recipe(), { kind: "segment", id: "seg_02" }, extracted, "aud_1")!;
    const clip = r.audioClips.find((c) => c.id === "aud_1")!;
    expect(clip).toMatchObject({ kind: "sfx", start: 5, duration: 6, offset: 8, volume: 1, loop: false });
    expect(r.timeline.segments.find((s) => s.id === "seg_02")?.muted).toBe(true);
    expect(r.timeline.segments.find((s) => s.id === "seg_01")?.muted).toBeFalsy();
  });

  it("overlay de vídeo: clipe no início dele, limitado à duração do som; imagem não tem som", () => {
    const r = withExtractedAudio(recipe(), { kind: "overlay", id: "ov_1" }, { ...extracted, durationSeconds: 3 }, "aud_2")!;
    expect(r.audioClips.find((c) => c.id === "aud_2")).toMatchObject({ start: 2, duration: 3, offset: 0 });
    expect(withExtractedAudio(recipe(), { kind: "overlay", id: "ov_2" }, extracted, "aud_3")).toBeNull();
  });
});
