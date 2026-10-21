import { describe, expect, it } from "vitest";
import { AssetSchema, type Asset } from "../src/library";
import { cutPoints, overlayFromAsset } from "../src/placement";
import { OverlaySchema, type Segment } from "../src/schema";

const segs: Segment[] = [
  { id: "a", sourceId: "s", sourceStart: 0, sourceEnd: 4 },
  { id: "b", sourceId: "s", sourceStart: 6, sourceEnd: 10 },
  { id: "c", sourceId: "s", sourceStart: 12, sourceEnd: 20 },
];

const asset = (over: Partial<Asset>): Asset =>
  AssetSchema.parse({
    id: "x",
    type: "icon",
    name: "X",
    file: "media/library/p/icon/x.png",
    pack: "p",
    source: "x.png",
    sourceSize: 1,
    sourceMtimeMs: 1,
    ...over,
  });

describe("cutPoints", () => {
  it("lista as emendas no tempo final", () => {
    expect(cutPoints(segs)).toEqual([4, 8]);
  });
});

describe("overlayFromAsset", () => {
  it("transição gruda centralizada no corte mais próximo, com o modo de mescla do asset", () => {
    const t = asset({ type: "transition", file: "media/library/p/transition/t.mp4", durationSeconds: 1, blend: "screen" });
    const o = overlayFromAsset(t, 7.2, segs, "ov1")!;
    expect(o).toMatchObject({ start: 7.5, end: 8.5, layout: "fullscreen", blend: "screen", kind: "video" });
    expect(OverlaySchema.safeParse(o).success).toBe(true);
  });

  it("transição longe de corte fica no playhead", () => {
    const t = asset({ type: "transition", file: "media/library/p/transition/t.mp4", durationSeconds: 1 });
    expect(overlayFromAsset(t, 12, segs, "ov1")!.start).toBe(12);
  });

  it("ícone vira sticker de 2s; personagem vem embaixo e maior", () => {
    expect(overlayFromAsset(asset({}), 3, segs, "i")).toMatchObject({ layout: "sticker", start: 3, end: 5, kind: "image" });
    const ch = asset({ type: "character", file: "media/library/p/character/c.webm", durationSeconds: 15, hasAlpha: true });
    expect(overlayFromAsset(ch, 3, segs, "c")).toMatchObject({ layout: "sticker", position: "bottom", end: 7, mediaDurationSeconds: 15 });
  });

  it("textura e moldura estática cobrem até o fim; fundo dura 5s", () => {
    expect(overlayFromAsset(asset({ type: "texture", blend: "multiply" }), 2, segs, "t")).toMatchObject({ end: null, opacity: 0.35, blend: "multiply" });
    expect(overlayFromAsset(asset({ type: "overlay" }), 2, segs, "o")!.end).toBeNull();
    expect(overlayFromAsset(asset({ type: "background", file: "media/library/p/background/b.mp4", durationSeconds: 20 }), 2, segs, "b")).toMatchObject({ end: 7, layout: "fullscreen" });
  });

  it("não passa do fim do vídeo e ignora tipos não visuais", () => {
    const bg = asset({ type: "background", file: "media/library/p/background/b.jpg" });
    expect(overlayFromAsset(bg, 15, segs, "b")!.end).toBe(16);
    expect(overlayFromAsset(asset({ type: "sfx", file: "a.wav" }), 1, segs, "s")).toBeNull();
  });
});
