import { describe, expect, it } from "vitest";
import { edgeLimits, enforceLanes, fitInLane, laneSpansFor, packRows } from "../src/lanes";
import { placeMotions } from "../src/motions";
import { MotionSchema, parseRecipe, type Motion, type Recipe } from "../src/schema";
import { applyCutToSegments } from "../src/time";

const motion = (id: string, kind: "keyword" | "emoji" | "zoom", sourceTime: number, extra: Partial<Motion> = {}): Motion =>
  MotionSchema.parse({
    id,
    kind,
    sourceId: "src_01",
    sourceTime,
    durationSeconds: 2,
    status: "accepted",
    params: kind === "keyword" ? { text: "OI" } : kind === "emoji" ? { emoji: "🔥" } : {},
    ...extra,
  });

const recipe = (motions: Motion[] = []): Recipe =>
  parseRecipe({
    version: 2,
    projectId: "t",
    createdAt: "2026-10-01T00:00:00Z",
    sources: [{ id: "src_01", file: "media/a.mp4", durationInSeconds: 30, width: 1080, height: 1920, fps: 30 }],
    timeline: { segments: [{ id: "seg_01", sourceId: "src_01", sourceStart: 0, sourceEnd: 30 }] },
    captions: { blocks: [] },
    motions,
    render: { width: 1080, height: 1920, fps: 30 },
  });

const startOf = (r: Recipe, id: string) => placeMotions(r, true).find((p) => p.motion.id === id)?.outputStart;

describe("fitInLane / edgeLimits", () => {
  const spans = [
    { start: 2, end: 4 },
    { start: 6, end: 8 },
  ];
  it("fica onde está se cabe; senão vai para o lado livre mais perto", () => {
    expect(fitInLane(spans, 10, 2, 30)).toBe(10);
    expect(fitInLane(spans, 3, 1, 30)).toBe(4);
    expect(fitInLane(spans, 2.5, 2, 30)).toBe(4);
    expect(fitInLane(spans, 1, 2, 30)).toBe(0);
  });
  it("sem espaço em lugar nenhum = null", () => {
    expect(fitInLane([{ start: 0, end: 10 }], 2, 3, 10)).toBeNull();
  });
  it("bordas param no vizinho", () => {
    expect(edgeLimits(spans, 4.5, 5.5)).toEqual({ minStart: 4, maxEnd: 6 });
    expect(edgeLimits(spans, 9, 10)).toEqual({ minStart: 8, maxEnd: Infinity });
  });
});

describe("enforceLanes", () => {
  it("motion novo em cima de outro da mesma camada vai para o espaço livre", () => {
    const before = recipe([motion("a", "keyword", 5)]);
    const after = enforceLanes(before, { ...before, motions: [...before.motions, motion("b", "keyword", 6)] });
    expect(startOf(after, "b")).toBe(7);
    expect(startOf(after, "a")).toBe(5);
  });

  it("camadas diferentes podem ao mesmo tempo (zoom com palavra-chave)", () => {
    const before = recipe([motion("a", "keyword", 5)]);
    const next = { ...before, motions: [...before.motions, motion("z", "zoom", 5)] };
    expect(enforceLanes(before, next)).toBe(next);
  });

  it("arrastar por cima pula para o lado livre; sem espaço, desfaz", () => {
    const before = recipe([motion("a", "keyword", 5), motion("b", "keyword", 10)]);
    const dragged = { ...before, motions: [before.motions[0], { ...before.motions[1], sourceTime: 5.5 }] };
    expect(startOf(enforceLanes(before, dragged), "b")).toBe(7);
    const full = recipe([motion("a", "keyword", 0, { durationSeconds: 15 }), motion("c", "keyword", 15, { durationSeconds: 15 }), motion("b", "keyword", 20, { durationSeconds: 1 })]);
    const blocked = { ...full, motions: full.motions.map((m) => (m.id === "b" ? { ...m, sourceTime: 3 } : m)) };
    // b estava sobre c (projeto antigo); levado para cima de a sem espaço livre: volta
    const out = enforceLanes(full, blocked);
    expect(out.motions.find((m) => m.id === "b")).toBe(full.motions[2]);
  });

  it("corte não empurra motion (só o que o operador mexeu anda)", () => {
    const before = recipe([motion("a", "keyword", 5), motion("b", "keyword", 9)]);
    const segments = applyCutToSegments(before.timeline.segments, "src_01", 6, 9);
    const next = { ...before, timeline: { ...before.timeline, segments } };
    expect(enforceLanes(before, next)).toBe(next);
  });

  it("editar o texto não mexe na posição", () => {
    const before = recipe([motion("a", "keyword", 5), motion("b", "keyword", 6)]);
    const next = { ...before, motions: before.motions.map((m) => (m.id === "b" ? { ...m, params: { ...m.params, text: "NOVO" } } : m)) as Motion[] };
    expect(enforceLanes(before, next)).toBe(next);
  });

  it("combo anda inteiro", () => {
    const before = recipe([motion("a", "keyword", 5)]);
    const combo = [motion("k", "keyword", 6, { group: "g:1" }), motion("e", "emoji", 6.5, { group: "g:1" })];
    const out = enforceLanes(before, { ...before, motions: [...before.motions, ...combo] });
    expect(startOf(out, "k")).toBe(7);
    expect(startOf(out, "e")).toBe(7.5);
  });

  it("overlays e música também não se sobrepõem", () => {
    const base = recipe();
    const before: Recipe = {
      ...base,
      overlays: [{ ...parseRecipe({ ...base, overlays: [{ id: "o1", kind: "image", file: "media/a.png", start: 0, end: 5 }] }).overlays[0] }],
      audioClips: parseRecipe({ ...base, audioClips: [{ id: "m1", kind: "music", file: "media/m.mp3", start: 0, duration: 10 }] }).audioClips,
    };
    const next: Recipe = {
      ...before,
      overlays: [...before.overlays, { ...before.overlays[0], id: "o2", start: 3, end: 6 }],
      audioClips: [...before.audioClips, { ...before.audioClips[0], id: "m2", start: 4 }],
    };
    const out = enforceLanes(before, next);
    expect(out.overlays.find((o) => o.id === "o2")).toMatchObject({ start: 5, end: 8 });
    expect(out.audioClips.find((c) => c.id === "m2")?.start).toBe(10);
    expect(laneSpansFor(out, "overlay:o2")).toEqual([expect.objectContaining({ start: 0, end: 5 })]);
  });

  it("texto livre (headline) fica onde está, junto de imagens e de outros textos", () => {
    const base = recipe();
    const before = parseRecipe({
      ...base,
      overlays: [{ id: "img", kind: "image", file: "media/a.png", start: 2, end: 6 }],
    });
    const headline = parseRecipe({ ...base, overlays: [{ id: "h", kind: "title", text: "HEADLINE", start: 0, end: null }] })
      .overlays[0];
    const next: Recipe = {
      ...before,
      overlays: [...before.overlays, headline, { ...headline, id: "h2", start: 3, end: 5 }],
    };
    const out = enforceLanes(before, next);
    expect(out.overlays.find((o) => o.id === "h")).toMatchObject({ start: 0, end: null });
    expect(out.overlays.find((o) => o.id === "h2")).toMatchObject({ start: 3, end: 5 });
    expect(laneSpansFor(out, "overlay:h")).toEqual([]);
    expect(headline.titleStyle).toMatchObject({ fontSize: 58, fontFamily: null, uppercase: true, strokeWidth: 10 });
  });
});

describe("packRows", () => {
  it("efeitos sobrepostos ganham sub-linhas", () => {
    const rows = packRows([
      { start: 0, end: 1 },
      { start: 0.5, end: 1.5 },
      { start: 1.2, end: 2 },
    ]).map((x) => x.row);
    expect(rows).toEqual([0, 1, 0]);
  });
});
