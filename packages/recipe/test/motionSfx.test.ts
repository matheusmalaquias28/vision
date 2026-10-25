import { describe, expect, it } from "vitest";
import type { Asset } from "../src/library";
import { PUNCH_IN_GROUP } from "../src/motions";
import {
  applyMotionSfxRules,
  attachMotionSfx,
  motionSfxClip,
  pickMotionSfx,
  removeMotionSfx,
  setMotionSfx,
  sfxStyleFor,
} from "../src/motionSfx";
import { MotionSchema, parseRecipe, type Motion, type Recipe } from "../src/schema";

/** Nomes reais do pack de SFX da biblioteca */
const asset = (name: string, durationSeconds: number): Asset => ({
  id: `sfx_${name.toLowerCase().replace(/\W+/g, "-")}`,
  type: "sfx",
  name,
  collection: "",
  file: `media/library/pack-viral/sfx/${name}.wav`,
  thumb: null,
  width: null,
  height: null,
  durationSeconds,
  hasAlpha: false,
  blend: "normal",
  tags: [],
  description: "",
  license: "ok",
  pack: "pack-viral",
  source: `${name}.wav`,
  sourceSize: 1,
  sourceMtimeMs: 0,
  music: null,
});
const LIB = [
  asset("click moderno", 3.1),
  asset("plin", 3),
  asset("fast woosh 1", 0.3),
  asset("fast woosh 2", 0.3),
  asset("Light Whoosh", 2.6),
  asset("BOOM 01", 13),
  asset("Cam shutter", 1.6),
  asset("SOUND LAPIS", 4.2),
  asset("Gears 1", 1.4),
];

const motion = (id: string, kind: string, sourceTime: number, params: Record<string, unknown> = {}, extra: Partial<Motion> = {}): Motion =>
  ({ ...MotionSchema.parse({ id, kind, sourceId: "src_01", sourceTime, params, status: "accepted" }), ...extra }) as Motion;

function recipe(motions: Motion[], segments = [{ id: "seg_01", sourceId: "src_01", sourceStart: 0, sourceEnd: 30 }]): Recipe {
  return parseRecipe({
    version: 2,
    projectId: "t",
    createdAt: "2026-10-01T00:00:00Z",
    sources: [{ id: "src_01", file: "media/a.mp4", durationInSeconds: 30, width: 1080, height: 1920, fps: 30 }],
    timeline: { segments },
    captions: { blocks: [] },
    motions,
    render: { width: 1080, height: 1920, fps: 30 },
  });
}

describe("som dos motions", () => {
  it("estilo pelo tipo e variante; zoom suave e zooms nos cortes ficam sem som", () => {
    expect(sfxStyleFor(motion("a", "keyword", 1, { text: "OI" }))).toBe("pop");
    expect(sfxStyleFor(motion("a", "keyword", 1, { text: "OI", variant: "slide" }))).toBe("whooshFast");
    expect(sfxStyleFor(motion("a", "statement", 1, { text: "Clica", variant: "cta" }))).toBe("ding");
    expect(sfxStyleFor(motion("a", "zoom", 1, { style: "punch" }))).toBe("impact");
    expect(sfxStyleFor(motion("a", "zoom", 1, { style: "smooth" }))).toBeNull();
    expect(sfxStyleFor(motion("a", "zoom", 1, { style: "punch" }, { group: PUNCH_IN_GROUP }))).toBeNull();
    expect(sfxStyleFor(motion("a", "flash", 1))).toBe("shutter");
    expect(sfxStyleFor(motion("a", "annotation", 1, { text: "Isso muda tudo" }))).toBe("pencil");
    expect(sfxStyleFor(motion("a", "screen", 1, { text: "O segredo" }))).toBe("whooshSoft");
    expect(sfxStyleFor(motion("a", "transition", 1, { style: "paper" }))).toBe("paper");
    expect(sfxStyleFor(motion("a", "transition", 1, { style: "glitch" }))).toBe("glitch");
  });

  it("escolha estável entre os sons do estilo", () => {
    const m = motion("mo_x", "kinetic", 2, { text: "Você está perdendo" });
    const a = pickMotionSfx(m, LIB)!;
    expect(a.name).toMatch(/fast woosh/);
    expect(pickMotionSfx(m, LIB)).toBe(a);
    expect(pickMotionSfx(m, [])).toBeNull();
  });

  it("som nasce no motion (whoosh adiantado), BOOM longo vira impacto curto com fade", () => {
    const r = recipe([motion("k", "kinetic", 4, { text: "Frase" }), motion("z", "zoom", 10, { style: "punch" })]);
    const out = attachMotionSfx(r, ["k", "z"], LIB);
    const k = motionSfxClip(out, "k")!;
    expect(k).toMatchObject({ kind: "sfx", motionId: "k", start: 3.95 });
    const z = motionSfxClip(out, "z")!;
    expect(z).toMatchObject({ assetId: "sfx_boom-01", start: 10, duration: 2.5, fadeOutSeconds: 0.3 });
    // não duplica
    expect(attachMotionSfx(out, ["k"], LIB)).toBe(out);
  });

  it("receita com duas peças no mesmo instante toca um som só", () => {
    const r = recipe([motion("s", "statement", 5, { text: "Clica no link", variant: "cta" }), motion("ar", "arrow", 5.05, { direction: "down" })]);
    const out = attachMotionSfx(r, ["s", "ar"], LIB);
    expect(out.audioClips.map((c) => c.motionId)).toEqual(["s"]);
  });

  it("motion inserido ou aceito ganha som; desligado no vídeo, não", () => {
    const before = recipe([motion("p", "keyword", 3, { text: "OI" }, { status: "pending", origin: "ai" })]);
    const accepted = { ...before, motions: before.motions.map((m) => ({ ...m, status: "accepted" as const })) };
    expect(applyMotionSfxRules(before, accepted, LIB).audioClips).toHaveLength(1);
    const inserted = { ...before, motions: [...before.motions, motion("n", "emoji", 8, { emoji: "🔥" })] };
    expect(motionSfxClip(applyMotionSfxRules(before, inserted, LIB), "n")).not.toBeNull();
    const off = { ...accepted, motionStyle: { ...accepted.motionStyle, autoSfx: false } };
    expect(applyMotionSfxRules(before, off, LIB).audioClips).toEqual([]);
  });

  it("som acompanha o motion arrastado e o corte; som mexido pelo operador fica onde ele pôs", () => {
    const r0 = attachMotionSfx(recipe([motion("k", "keyword", 10, { text: "OI" })]), ["k"], LIB);
    // operador adiantou o som 0,3 s (mudança só no clipe)
    const nudged = { ...r0, audioClips: r0.audioClips.map((c) => ({ ...c, start: 9.7 })) };
    expect(motionSfxClip(applyMotionSfxRules(r0, nudged, LIB), "k")!.start).toBe(9.7);
    // motion arrastado +2 s: som vai junto, mantendo a distância
    const dragged = { ...nudged, motions: nudged.motions.map((m) => ({ ...m, sourceTime: 12 })) };
    expect(motionSfxClip(applyMotionSfxRules(nudged, dragged, LIB), "k")!.start).toBe(11.7);
    // corte de 3 s antes do motion: som recua 3 s
    const cut = { ...nudged, timeline: { ...nudged.timeline, segments: [
      { id: "seg_01", sourceId: "src_01", sourceStart: 0, sourceEnd: 2 },
      { id: "seg_02", sourceId: "src_01", sourceStart: 5, sourceEnd: 30 },
    ] } };
    expect(motionSfxClip(applyMotionSfxRules(nudged, cut, LIB), "k")!.start).toBe(6.7);
  });

  it("motion apagado ou recusado leva o som; som apagado pelo operador não volta", () => {
    const r0 = attachMotionSfx(recipe([motion("k", "keyword", 10, { text: "OI" }), motion("e", "emoji", 20, { emoji: "🔥" })]), ["k", "e"], LIB);
    const deleted = { ...r0, motions: r0.motions.filter((m) => m.id !== "k") };
    expect(applyMotionSfxRules(r0, deleted, LIB).audioClips.map((c) => c.motionId)).toEqual(["e"]);
    const rejected = { ...r0, motions: r0.motions.map((m) => (m.id === "e" ? { ...m, status: "rejected" as const } : m)) };
    expect(applyMotionSfxRules(r0, rejected, LIB).audioClips.map((c) => c.motionId)).toEqual(["k"]);
    const noSound = removeMotionSfx(r0, "k");
    const later = { ...noSound, motions: noSound.motions.map((m) => (m.id === "k" ? { ...m, durationSeconds: 3 } : m)) };
    expect(motionSfxClip(applyMotionSfxRules(noSound, later, LIB), "k")).toBeNull();
  });

  it("trocar o som mantém início e volume ajustados", () => {
    const r0 = attachMotionSfx(recipe([motion("k", "keyword", 10, { text: "OI" })]), ["k"], LIB);
    const tuned = { ...r0, audioClips: r0.audioClips.map((c) => ({ ...c, start: 9.8, volume: 0.3 })) };
    const swapped = setMotionSfx(tuned, "k", LIB.find((a) => a.name === "plin")!);
    expect(motionSfxClip(swapped, "k")).toMatchObject({ assetId: "sfx_plin", start: 9.8, volume: 0.3 });
    expect(swapped.audioClips).toHaveLength(1);
  });
});
