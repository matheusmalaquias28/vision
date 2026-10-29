import { describe, expect, it } from "vitest";
import { canResize, getPlacement, resizeTarget, setPlacement } from "../src/positioning";
import { parseRecipe, type Recipe } from "../src/schema";

function recipe(): Recipe {
  return parseRecipe({
    version: 2,
    projectId: "t",
    createdAt: "2026-10-01T00:00:00Z",
    sources: [
      { id: "src_01", file: "media/a.mp4", durationInSeconds: 30, width: 1080, height: 1920, fps: 30 },
    ],
    timeline: { segments: [{ id: "seg_01", sourceId: "src_01", sourceStart: 0, sourceEnd: 30 }] },
    captions: {},
    overlays: [{ id: "ov_1", kind: "title", text: "OI", start: 0 }],
    motions: [
      {
        id: "mo_1",
        kind: "keyword",
        sourceId: "src_01",
        sourceTime: 2,
        status: "pending",
        origin: "ai",
        params: { text: "PRAZO" },
      },
    ],
    render: { width: 1080, height: 1920, fps: 30 },
  });
}

describe("setPlacement", () => {
  it("posiciona legenda, overlay e motion pelo id do alvo", () => {
    let r = recipe();
    r = setPlacement(r, "caption", { x: 50, y: 70 });
    r = setPlacement(r, "overlay:ov_1", { x: 20, y: 10 });
    r = setPlacement(r, "motion:mo_1", { x: 80, y: 30 });
    expect(getPlacement(r, "caption")).toEqual({ x: 50, y: 70 });
    expect(getPlacement(r, "overlay:ov_1")).toEqual({ x: 20, y: 10 });
    expect(getPlacement(r, "motion:mo_1")).toEqual({ x: 80, y: 30 });
  });

  it("arrastar um motion sugerido o aceita", () => {
    const r = setPlacement(recipe(), "motion:mo_1", { x: 50, y: 50 });
    expect(r.motions[0].status).toBe("accepted");
  });

  it("prende ao quadro, arredonda e null volta ao padrão", () => {
    let r = setPlacement(recipe(), "caption", { x: -5, y: 104.37 });
    expect(r.captions.style.placement).toEqual({ x: 0, y: 100 });
    r = setPlacement(r, "caption", { x: 33.333, y: 66.666 });
    expect(r.captions.style.placement).toEqual({ x: 33.3, y: 66.7 });
    r = setPlacement(r, "caption", null);
    expect(r.captions.style.placement).toBeNull();
  });

  it("alvo desconhecido não muda a receita", () => {
    const r = recipe();
    expect(setPlacement(r, "overlay:nada", { x: 1, y: 1 }).overlays).toEqual(r.overlays);
    expect(setPlacement(r, "xyz", { x: 1, y: 1 })).toBe(r);
  });
});

describe("resizeTarget", () => {
  it("muda fonte da legenda e do texto livre, size do motion (e aceita a sugestão)", () => {
    let r = recipe();
    const caption = r.captions.style.fontSizePx;
    r = resizeTarget(r, "caption", 1.5);
    r = resizeTarget(r, "overlay:ov_1", 2);
    r = resizeTarget(r, "motion:mo_1", 1.3);
    expect(r.captions.style.fontSizePx).toBe(Math.round(caption * 1.5));
    expect(r.overlays[0].titleStyle.fontSize).toBe(116);
    expect(r.motions[0]).toMatchObject({ size: 1.3, status: "accepted" });
  });

  it("respeita os limites do schema", () => {
    const r = resizeTarget(recipe(), "motion:mo_1", 10);
    expect(r.motions[0].size).toBe(3);
    expect(resizeTarget(recipe(), "overlay:ov_1", 0.01).overlays[0].titleStyle.fontSize).toBe(16);
  });

  it("zoom de câmera não tem tamanho", () => {
    const base = recipe();
    const r = { ...base, motions: [{ ...base.motions[0], kind: "zoom" } as unknown as (typeof base.motions)[number]] };
    expect(canResize(r, "motion:mo_1")).toBe(false);
    expect(resizeTarget(r, "motion:mo_1", 2)).toBe(r);
  });
});
