import { describe, expect, it } from "vitest";
import { migrateRecipeData } from "../src/migrate";
import { motionGroupLabel } from "../src/motionCombos";
import {
  captionHiddenRanges,
  mergeMotionSuggestions,
  placeMotions,
  PUNCH_IN_GROUP,
  withPunchIn,
  retimeMotion,
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
  group: null,
  accentColor: null,
  params: { text, position: "top", variant: "pop", intensity: "normal" },
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
      group: null,
      accentColor: null,
      params: { from: 0, to: 2, decimals: 0, prefix: "", suffix: " meses", label: "", variant: "bold" },
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

describe("retimeMotion", () => {
  it("move o motion: a âncora vai para o instante do bruto sob o novo início", () => {
    // corte de 10s→15s: o vídeo final pula do 10 para o 15 do bruto
    let r = recipe([zoom("m1", 3)]);
    r = { ...r, timeline: { ...r.timeline, segments: applyCutToSegments(r.timeline.segments, "src_01", 10, 15) } };
    r = retimeMotion(r, "m1", 12, 2);
    expect(r.motions[0]).toMatchObject({ sourceId: "src_01", sourceTime: 17, durationSeconds: 2 });
  });

  it("limita a duração e o início ao vídeo e aceita sugestão", () => {
    let r = recipe([{ ...zoom("m1", 3), status: "pending", origin: "ai" }]);
    r = retimeMotion(r, "m1", -4, 40);
    expect(r.motions[0]).toMatchObject({ sourceTime: 0, durationSeconds: 15, status: "accepted" });
    r = retimeMotion(r, "m1", 99, 0.01);
    expect(r.motions[0].sourceTime).toBeCloseTo(29.95, 2);
    expect(r.motions[0].durationSeconds).toBe(0.1);
  });
});

describe("zoom nos cortes (antigo effects.punchIn)", () => {
  const raw = () => ({
    version: 2,
    projectId: "t",
    createdAt: "2026-10-01T00:00:00Z",
    template: "dinamico",
    sources: [{ id: "src_01", file: "media/a.mp4", durationInSeconds: 30, width: 1080, height: 1920, fps: 30 }],
    timeline: {
      segments: [
        { id: "seg_01", sourceId: "src_01", sourceStart: 1, sourceEnd: 5 },
        { id: "seg_02", sourceId: "src_01", sourceStart: 7.5, sourceEnd: 12 },
        { id: "seg_03", sourceId: "src_01", sourceStart: 14, sourceEnd: 20 },
      ],
    },
    captions: { blocks: [] },
    motions: [{ id: "k1", kind: "keyword", sourceId: "src_01", sourceTime: 3, params: { text: "OI" } }],
    effects: { punchIn: true },
    render: { width: 1080, height: 1920, fps: 30 },
  });

  it("projeto antigo: o zoom escondido vira um motion de zoom por trecho, visível na timeline", () => {
    const r = parseRecipe(migrateRecipeData(raw()));
    expect(r.effects.punchIn).toBe(false);
    const punch = r.motions.filter((m) => m.group === PUNCH_IN_GROUP);
    expect(punch).toHaveLength(3);
    expect(punch.every((m) => m.kind === "zoom" && m.status === "accepted")).toBe(true);
    // cada um começa exatamente no início do trecho no vídeo final
    const starts = placeMotions(r, false).filter((p) => p.motion.group === PUNCH_IN_GROUP).map((p) => p.outputStart);
    expect(starts).toEqual([0, 4, 8.5]);
    expect(r.motions.find((m) => m.id === "k1")).toBeTruthy();
    // migrar de novo não duplica
    expect(migrateRecipeData(r)).toBe(r);
  });

  it("ligar/desligar recria ou remove só os zooms nos cortes", () => {
    const r = parseRecipe(migrateRecipeData(raw()));
    const off = withPunchIn(r, false);
    expect(off.motions.map((m) => m.id)).toEqual(["k1"]);
    const on = withPunchIn(off, true);
    expect(on.motions.filter((m) => m.group === PUNCH_IN_GROUP)).toHaveLength(3);
    expect(motionGroupLabel(PUNCH_IN_GROUP)).toBe("Zoom nos cortes");
  });
});

describe("tela cheia esconde a legenda (opção do motion)", () => {
  it("só enquanto está no ar e só com hideCaptions", () => {
    const base = parseRecipe({
      version: 2,
      projectId: "t",
      createdAt: "2026-10-01T00:00:00Z",
      sources: [{ id: "src_01", file: "media/a.mp4", durationInSeconds: 30, width: 1080, height: 1920, fps: 30 }],
      timeline: { segments: [{ id: "seg_01", sourceId: "src_01", sourceStart: 0, sourceEnd: 30 }] },
      captions: { blocks: [] },
      motions: [
        { id: "s1", kind: "screen", sourceId: "src_01", sourceTime: 4, durationSeconds: 2.5, params: { text: "Oi" } },
        { id: "s2", kind: "screen", sourceId: "src_01", sourceTime: 20, durationSeconds: 2, params: { text: "Tchau", hideCaptions: false } },
      ],
      render: { width: 1080, height: 1920, fps: 30 },
    });
    expect(captionHiddenRanges(placeMotions(base, false))).toEqual([[4, 6.5]]);
  });
});
