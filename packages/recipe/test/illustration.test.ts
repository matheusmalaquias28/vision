import { describe, expect, it } from "vitest";
import { getCandidateMotions, interpretBriefing, validateComposition, type RankedCandidate } from "../src/creative";
import { illustrationPrompt, MAX_ILLUSTRATIONS } from "../src/illustration";
import { MOTION_REGISTRY } from "../src/motionRegistry";
import { mergeMotionSuggestions, motionSummary, PUNCH_IN_GROUP } from "../src/motions";
import { sfxStyleFor } from "../src/motionSfx";
import { MotionSchema, parseRecipe } from "../src/schema";

const base = { sourceId: "src_01", durationSeconds: 3 };

describe("ilustração gerada", () => {
  it("prompt: estilo fixo de colagem de papel + o assunto, sem texto na imagem", () => {
    const p = illustrationPrompt("  celular com   mensagem de ameaça ");
    expect(p).toMatch(/paper collage/i);
    expect(p).toMatch(/No text/);
    expect(p.endsWith("celular com mensagem de ameaça")).toBe(true);
  });

  it("schema: imagem começa vazia e posição no topo; assunto é obrigatório", () => {
    const m = MotionSchema.parse({ ...base, id: "il1", kind: "illustration", sourceTime: 4, params: { subject: "balança da justiça" } });
    expect(m.kind === "illustration" && m.params).toEqual({ subject: "balança da justiça", label: "", image: null, position: "top" });
    expect(() => MotionSchema.parse({ ...base, id: "il2", kind: "illustration", sourceTime: 4, params: { subject: " " } })).toThrow();
  });

  it("registry: a IA descreve o que desenhar (slot text → subject); som de papel; resumo usa a legenda", () => {
    const params = MOTION_REGISTRY.illustration.fromSlots({ text: "contrato com carimbo", label: "Contrato", position: "center" });
    expect(params).toMatchObject({ subject: "contrato com carimbo", label: "Contrato", position: "center" });
    const m = MotionSchema.parse({ ...base, id: "il3", kind: "illustration", sourceTime: 1, params: { subject: "martelo", label: "" } });
    expect(motionSummary(m)).toBe("martelo");
    expect(sfxStyleFor(m)).toBe("paper");
  });

  it(`composição: no máximo ${MAX_ILLUSTRATIONS}, com 8 s entre elas`, () => {
    const r = longRecipe();
    const { accepted, rejected } = validateComposition(r, [cand(5, 0), cand(9, 1), cand(15, 2), cand(25, 3), cand(40, 4)], "dynamic");
    expect(accepted.map((a) => a.sourceTime)).toEqual([5, 15, 25]);
    expect(rejected.map((x) => x.reason)).toEqual([
      expect.stringMatching(/perto demais/),
      expect.stringMatching(/máximo de 3/),
    ]);
  });

  it("nunca entra no plano automático (botão próprio), mesmo com o briefing pedindo", () => {
    const pede = interpretBriefing("Colocar legendas, transições e imagens para ilustrar o vídeo.");
    expect(pede.wants).toContain("illustration");
    expect(interpretBriefing("usar imagens ilustrativas").wants).toContain("illustration");
    expect(interpretBriefing("pode usar ilustrações").wants).toContain("illustration");
    expect(interpretBriefing("sem ilustração").avoid).toContain("illustration");
    for (const style of ["balanced", "dynamic", "minimal"] as const) {
      expect(getCandidateMotions({ style, directives: pede, durationSeconds: 60 })).not.toContain("illustration");
    }
  });

  it("botão de imagens mexe só nas ilustrações: sugestões pendentes de outros tipos ficam e ocupam a camada", () => {
    const keyword = MotionSchema.parse({ ...base, id: "kw", kind: "keyword", sourceTime: 20, durationSeconds: 2, status: "pending", origin: "ai", params: { text: "OLHA" } });
    const oldIllus = MotionSchema.parse({ ...base, id: "il-old", kind: "illustration", sourceTime: 40, status: "pending", origin: "ai", params: { subject: "velha" } });
    const r = longRecipe([keyword, oldIllus]);
    const at20 = cand(20, 0);
    expect(validateComposition(r, [at20], "dynamic", { onlyKinds: ["illustration"] }).rejected[0].reason).toMatch(/camada text/);
    expect(validateComposition(r, [at20], "dynamic").accepted).toHaveLength(1);
    const merged = mergeMotionSuggestions(r, [{ ...cand(30, 0), priority: undefined } as never], { onlyKinds: ["illustration"] });
    expect(merged.motions.map((m) => m.id)).toContain("kw");
    expect(merged.motions.map((m) => m.id)).not.toContain("il-old");
  });
});

describe("densidade de motions", () => {
  it("câmera (zooms) e transições não ocupam a cota da janela de 10 s; texto ocupa", () => {
    const zoom = (t: number) =>
      MotionSchema.parse({ ...base, id: `z${t}`, kind: "zoom", sourceTime: t, durationSeconds: 0.8, status: "accepted", origin: "manual", group: PUNCH_IN_GROUP, params: {} });
    const r = longRecipe([zoom(4), zoom(5), zoom(6)]);
    const kw = { ...MotionSchema.parse({ ...base, id: "kw", kind: "keyword", sourceTime: 5, durationSeconds: 1.5, params: { text: "AGORA" } }), priority: 0 } as RankedCandidate;
    expect(validateComposition(r, [kw], "balanced").accepted).toHaveLength(1);
    const manualZoom = longRecipe([{ ...zoom(4), group: null }, { ...zoom(6), id: "z6b", group: null }]);
    expect(validateComposition(manualZoom, [kw], "balanced").accepted).toHaveLength(1);
    // dois textos já na janela: o terceiro é recusado
    const txt = (id: string, t: number) =>
      MotionSchema.parse({ ...base, id, kind: "keyword", sourceTime: t, durationSeconds: 1, status: "accepted", origin: "manual", params: { text: "OI" } });
    const busy = longRecipe([txt("k1", 2), txt("k2", 7.5)]);
    expect(validateComposition(busy, [kw], "balanced").rejected[0].reason).toMatch(/mesma janela/);
  });
});

function longRecipe(motions: unknown[] = []) {
  const words = Array.from({ length: 120 }, (_, i) => ({ text: `w${i}`, start: i * 0.5, end: i * 0.5 + 0.4 }));
  return parseRecipe({
    version: 2,
    projectId: "t",
    createdAt: "2026-10-01T00:00:00Z",
    sources: [{ id: "src_01", file: "media/a.mp4", durationInSeconds: 61, width: 1080, height: 1920, fps: 30 }],
    timeline: { segments: [{ id: "seg_01", sourceId: "src_01", sourceStart: 0, sourceEnd: 61 }] },
    captions: { blocks: [{ id: "b1", sourceId: "src_01", start: 0, end: 61, text: words.map((w) => w.text).join(" "), words }] },
    motions,
    render: { width: 1080, height: 1920, fps: 30 },
  });
}

function cand(t: number, priority: number): RankedCandidate {
  return {
    ...MotionSchema.parse({ ...base, id: `il-${t}`, kind: "illustration", sourceTime: t, params: { subject: `assunto ${t}` } }),
    priority,
  } as RankedCandidate;
}

describe("arquivos que o render lê", () => {
  it("pega os caminhos de media/ da receita (inclusive imagens das ilustrações) e os vídeos das transições", async () => {
    const { recipeMediaFiles } = await import("../src/mediaRefs");
    const { TRANSITION_PRESETS } = await import("../src/transitions");
    const ill = MotionSchema.parse({ ...base, id: "il", kind: "illustration", sourceTime: 5, params: { subject: "martelo", image: "media/projects/t/assets/illus-1.png" } });
    const tr = MotionSchema.parse({ ...base, id: "tr", kind: "transition", sourceTime: 10, durationSeconds: 0.7, params: { style: "burn" } });
    const files = recipeMediaFiles(longRecipe([ill, tr]));
    expect(files).toContain("media/a.mp4");
    expect(files).toContain("media/projects/t/assets/illus-1.png");
    expect(files).toContain(TRANSITION_PRESETS.burn.file);
    expect(new Set(files).size).toBe(files.length);
  });
});
