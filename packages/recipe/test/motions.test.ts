import { describe, expect, it } from "vitest";
import {
  mergeMotionSuggestions,
  placeMotions,
  reviewMotions,
  zoomScaleAt,
  type MotionCandidate,
} from "../src/motions";
import { parseRecipe, RecipeSchema, type Recipe } from "../src/schema";
import { applyCutToSegments } from "../src/time";

function recipe(motions: unknown[] = []): Recipe {
  return parseRecipe({
    version: 2,
    projectId: "t",
    createdAt: "2026-10-01T00:00:00Z",
    sources: [
      { id: "src_01", file: "media/a.mp4", durationInSeconds: 30, width: 1080, height: 1920, fps: 30 },
    ],
    timeline: { segments: [{ id: "seg_01", sourceId: "src_01", sourceStart: 0, sourceEnd: 30 }] },
    captions: {},
    motions,
    render: { width: 1080, height: 1920, fps: 30 },
  });
}

const zoom = (id: string, sourceTime: number, extra: Record<string, unknown> = {}) => ({
  id,
  kind: "zoom",
  sourceId: "src_01",
  sourceTime,
  durationSeconds: 2,
  ...extra,
});

const keyword = (sourceTime: number, text = "PRAZO"): MotionCandidate => ({
  kind: "keyword",
  sourceId: "src_01",
  sourceTime,
  durationSeconds: 1.5,
  note: "",
  params: { text, position: "top" },
});

describe("MotionSchema", () => {
  it("aplica defaults por tipo e valida parâmetros", () => {
    const r = recipe([zoom("m1", 3)]);
    expect(r.motions[0]).toMatchObject({
      status: "accepted",
      origin: "manual",
      params: { scale: 1.15, style: "punch" },
    });
    const bad = { ...zoom("m1", 3), kind: "keyword", params: {} };
    expect(() => recipe([bad])).toThrow();
  });

  it("rejeita motion apontando para fonte inexistente", () => {
    const raw = { ...recipe(), motions: [{ ...zoom("m1", 3), sourceId: "src_99" }] };
    expect(RecipeSchema.safeParse(raw).success).toBe(false);
  });
});

describe("placeMotions", () => {
  it("acompanha cortes antes da âncora e some se a âncora for cortada", () => {
    let r = recipe([zoom("m1", 10), zoom("m2", 20)]);
    r = { ...r, timeline: { ...r.timeline, segments: applyCutToSegments(r.timeline.segments, "src_01", 2, 4) } };
    expect(placeMotions(r, false).map((p) => p.outputStart)).toEqual([8, 18]);
    r = { ...r, timeline: { ...r.timeline, segments: applyCutToSegments(r.timeline.segments, "src_01", 19, 21) } };
    expect(placeMotions(r, false).map((p) => p.motion.id)).toEqual(["m1"]);
  });

  it("pendentes só entram como prévia; rejeitados nunca", () => {
    const r = recipe([zoom("a", 1), zoom("p", 5, { status: "pending" }), zoom("x", 9, { status: "rejected" })]);
    expect(placeMotions(r, false).map((p) => p.motion.id)).toEqual(["a"]);
    expect(placeMotions(r, true).map((p) => p.motion.id)).toEqual(["a", "p"]);
  });
});

describe("zoomScaleAt", () => {
  const r = recipe([zoom("m1", 10, { params: { scale: 1.2, style: "punch" } })]);
  const placed = placeMotions(r, false);

  it("fora do zoom é 1, no meio atinge a escala alvo", () => {
    expect(zoomScaleAt(placed, 9.9)).toBe(1);
    expect(zoomScaleAt(placed, 11)).toBeCloseTo(1.2);
    expect(zoomScaleAt(placed, 12.1)).toBe(1);
  });

  it("punch entra rápido e sai antes do fim", () => {
    expect(zoomScaleAt(placed, 10.06)).toBeGreaterThan(1.05);
    expect(zoomScaleAt(placed, 11.95)).toBeLessThan(1.05);
  });
});

describe("mergeMotionSuggestions / reviewMotions", () => {
  it("troca só as pendentes da IA e mantém manuais e revisadas", () => {
    const r = recipe([
      zoom("man", 2),
      zoom("old", 5, { status: "pending", origin: "ai" }),
      zoom("rej", 8, { status: "rejected", origin: "ai" }),
    ]);
    const merged = mergeMotionSuggestions(r, [keyword(15)]);
    expect(merged.motions.map((m) => m.id).sort()).toEqual(["man", "mo_01", "rej"]);
    expect(merged.motions.find((m) => m.id === "mo_01")).toMatchObject({ status: "pending", origin: "ai" });
  });

  it("não repete sugestão rejeitada nem ancora em trecho cortado", () => {
    let r = recipe([{ ...keyword(10), id: "k", status: "rejected", origin: "ai" }]);
    r = { ...r, timeline: { ...r.timeline, segments: applyCutToSegments(r.timeline.segments, "src_01", 19, 21) } };
    const merged = mergeMotionSuggestions(r, [keyword(10.5, "OUTRA"), keyword(20)]);
    expect(merged.motions).toHaveLength(1);
  });

  it("não sobrepõe dois motions de texto", () => {
    const r = recipe();
    const counter: MotionCandidate = {
      kind: "counter",
      sourceId: "src_01",
      sourceTime: 5.5,
      durationSeconds: 2,
      note: "",
      params: { from: 0, to: 2, decimals: 0, prefix: "", suffix: " meses", label: "" },
    };
    const merged = mergeMotionSuggestions(r, [keyword(5), counter]);
    expect(merged.motions.map((m) => m.kind)).toEqual(["keyword"]);
  });

  it("aceitar/rejeitar só mexe em pendentes", () => {
    const r = mergeMotionSuggestions(recipe([zoom("man", 2)]), [keyword(10)]);
    const accepted = reviewMotions(r, ["mo_01", "man"], true);
    expect(accepted.motions.map((m) => m.status)).toEqual(["accepted", "accepted"]);
    const rejected = reviewMotions(r, ["mo_01"], false);
    expect(rejected.motions.find((m) => m.id === "mo_01")?.status).toBe("rejected");
  });
});
