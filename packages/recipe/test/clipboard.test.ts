import { describe, expect, it } from "vitest";
import { copyItems, pasteItems, splitItemAt } from "../src/clipboard";
import { placeMotions } from "../src/motions";
import { parseRecipe } from "../src/schema";
import { outputDuration } from "../src/time";

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
    captions: { blocks: [] },
    motions: [
      { id: "m1", kind: "keyword", sourceId: "src_01", sourceTime: 2, durationSeconds: 2, status: "pending", origin: "ai", group: "impact-hook:1", params: { text: "OI" } },
      { id: "m2", kind: "zoom", sourceId: "src_01", sourceTime: 2.5, durationSeconds: 1, status: "accepted", group: "impact-hook:1", params: {} },
    ],
    overlays: [{ id: "o1", kind: "title", text: "A", start: 1, end: 3 }],
    audioClips: [{ id: "a1", kind: "sfx", file: "media/sfx/x.wav", start: 2, duration: 1, motionId: "m1" }],
    render: { width: 1080, height: 1920, fps: 30 },
  });

describe("clipboard", () => {
  it("copia com início relativo e cola o grupo no instante pedido", () => {
    const r = recipe();
    const data = copyItems(r, ["motion:m1", "motion:m2", "overlay:o1", "caption:x"])!;
    expect(data.items.map((i) => [i.kind, i.offset])).toEqual([
      ["overlay", 0],
      ["motion", 1],
      ["motion", 1.5],
    ]);
    const { recipe: out, keys } = pasteItems(r, data, 20);
    expect(keys).toHaveLength(3);
    const placed = placeMotions(out, true).filter((p) => keys.includes(`motion:${p.motion.id}`));
    expect(placed.map((p) => p.outputStart)).toEqual([21, 21.5]);
    // colado vira seu (aceito) e é um combo novo, separado do original
    expect(placed.every((p) => p.motion.status === "accepted" && p.motion.group !== "impact-hook:1")).toBe(true);
    expect(new Set(placed.map((p) => p.motion.group)).size).toBe(1);
    expect(out.overlays.find((o) => keys.includes(`overlay:${o.id}`))).toMatchObject({ start: 20, end: 22 });
  });

  it("som colado não fica preso ao motion original", () => {
    const r = recipe();
    const { recipe: out, keys } = pasteItems(r, copyItems(r, ["audio:a1"])!, 5);
    const clip = out.audioClips.find((c) => keys.includes(`audio:${c.id}`))!;
    expect(clip).toMatchObject({ start: 5, motionId: null });
  });

  it("trecho de vídeo colado entra na emenda mais perto", () => {
    const r = recipe();
    const { recipe: out } = pasteItems(r, copyItems(r, ["segment:seg_01"])!, 9);
    expect(out.timeline.segments.map((s) => s.sourceStart)).toEqual([0, 0, 12]);
    expect(outputDuration(out.timeline.segments)).toBe(38);
    expect(new Set(out.timeline.segments.map((s) => s.id)).size).toBe(3);
  });

  it("divide trecho, áudio e overlay no instante; fora do item não muda", () => {
    const r = recipe();
    expect(splitItemAt(r, "segment:seg_02", 15).timeline.segments).toHaveLength(3);
    expect(splitItemAt(r, "segment:seg_02", 5)).toBe(r);
    expect(splitItemAt(r, "audio:a1", 2.5).audioClips).toHaveLength(2);
    const ov = splitItemAt(r, "overlay:o1", 2).overlays;
    expect(ov.map((o) => [o.start, o.end])).toEqual([
      [1, 2],
      [2, 3],
    ]);
  });

  it("lâmina em motion: dois pedaços, o segundo ancorado no corte", () => {
    const r = recipe();
    const out = splitItemAt(r, "motion:m1", 3);
    const parts = placeMotions(out, true).filter((p) => p.motion.kind === "keyword");
    expect(parts.map((p) => [p.outputStart, p.motion.durationSeconds])).toEqual([
      [2, 1],
      [3, 1],
    ]);
    expect(parts[1].motion).toMatchObject({ group: "impact-hook:1", params: { text: "OI" } });
    // pedaço menor que o mínimo: não divide
    expect(splitItemAt(r, "motion:m1", 2.05)).toBe(r);
  });

  it("lâmina na legenda: palavras vão para o lado do meio delas", () => {
    const base = recipe();
    const r = parseRecipe({
      ...base,
      captions: {
        blocks: [
          {
            id: "b1",
            sourceId: "src_01",
            words: [
              { text: "um", start: 13, end: 13.4 },
              { text: "dois", start: 13.5, end: 14 },
              { text: "três", start: 14.2, end: 14.8 },
            ],
          },
        ],
      },
    });
    // 13.9 s da fonte = 11.9 s do vídeo final (o 1º trecho tem 10 s, o 2º começa em 12)
    const blocks = splitItemAt(r, "caption:b1", 11.9).captions.blocks;
    expect(blocks.map((b) => b.words.map((w) => w.text))).toEqual([["um", "dois"], ["três"]]);
    expect(splitItemAt(r, "caption:b1", 10.5)).toBe(r);
  });

  it("dividir mantém a entrada no 1º pedaço e a saída no 2º", () => {
    const base = recipe();
    const fade = { effect: "fade" as const, duration: 0.5, easing: "ease-out" as const };
    const r = {
      ...base,
      overlays: base.overlays.map((o) => ({ ...o, enter: fade, exit: fade })),
      timeline: {
        ...base.timeline,
        segments: base.timeline.segments.map((s) => ({ ...s, enter: fade, exit: fade })),
      },
    };
    const ov = splitItemAt(r, "overlay:o1", 2).overlays;
    expect(ov.map((o) => [o.enter?.effect ?? null, o.exit?.effect ?? null])).toEqual([
      ["fade", null],
      [null, "fade"],
    ]);
    const segs = splitItemAt(r, "segment:seg_02", 15).timeline.segments.slice(1);
    expect(segs.map((s) => [s.enter?.effect ?? null, s.exit?.effect ?? null])).toEqual([
      ["fade", null],
      [null, "fade"],
    ]);
  });
});
