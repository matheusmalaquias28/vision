import { describe, expect, it } from "vitest";
import { activeSplitAt, FramingSchema, framingStyle, isNeutralFraming, isSplitLayout } from "../src/framing";
import { parseRecipe } from "../src/schema";

const overlay = (id: string, layout: string, start: number, end: number | null, kind = "video") => ({
  id,
  kind,
  file: kind === "title" ? null : `media/projects/t/assets/${id}.mp4`,
  text: kind === "title" ? "Título" : "",
  start,
  end,
  layout,
});

const recipe = (overlays: unknown[]) =>
  parseRecipe({
    version: 2,
    projectId: "t",
    createdAt: "2026-10-01T00:00:00Z",
    sources: [{ id: "src_01", file: "media/a.mp4", durationInSeconds: 30, width: 1080, height: 1920, fps: 30 }],
    timeline: { segments: [{ id: "seg_01", sourceId: "src_01", sourceStart: 0, sourceEnd: 30 }] },
    captions: { blocks: [] },
    overlays,
    render: { width: 1080, height: 1920, fps: 30 },
  });

describe("enquadramento", () => {
  it("projeto antigo abre centralizado; subir/descer vira object-position, zoom vira scale", () => {
    const r = recipe([overlay("o1", "pip", 0, 3)]);
    expect(r.sources[0].framing).toBeNull();
    expect(r.overlays[0].framing).toBeNull();
    expect(framingStyle(null)).toEqual({ objectPosition: "50% 50%", transform: undefined, transformOrigin: "50% 50%" });
    expect(framingStyle({ x: 50, y: 20, zoom: 1.4 })).toEqual({ objectPosition: "50% 20%", transform: "scale(1.4)", transformOrigin: "50% 20%" });
    expect(isNeutralFraming(FramingSchema.parse({}))).toBe(true);
    expect(FramingSchema.safeParse({ y: 120 }).success).toBe(false);
  });

  it("split de baixo põe o vídeo principal em cima; split de cima, embaixo — só durante o clipe", () => {
    const r = recipe([overlay("b", "split-bottom", 2, 5), overlay("t", "split-top", 10, null), overlay("tt", "split-bottom", 0, 30, "title")]);
    expect(activeSplitAt(r, 1)).toBeNull();
    expect(activeSplitAt(r, 3)).toMatchObject({ overlay: { id: "b" }, mainHalf: "top" });
    expect(activeSplitAt(r, 5)).toBeNull();
    expect(activeSplitAt(r, 20)).toMatchObject({ overlay: { id: "t" }, mainHalf: "bottom" });
    expect(isSplitLayout("split-top")).toBe(true);
    expect(isSplitLayout("pip")).toBe(false);
  });
});
