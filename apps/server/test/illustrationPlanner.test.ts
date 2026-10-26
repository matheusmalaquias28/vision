import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseRecipe } from "@vision/recipe";
import { placeIllustrations, suggestIllustrations, type IllustrationPick } from "../src/creative/illustrationPlanner";

/** 60 s de fala, uma palavra a cada 0,5 s */
function recipe(withWords = true) {
  const words = Array.from({ length: 120 }, (_, i) => ({ text: `palavra${i}`, start: i * 0.5, end: i * 0.5 + 0.4 }));
  return parseRecipe({
    version: 2,
    projectId: "__teste-imagens",
    createdAt: "2026-10-01T00:00:00Z",
    briefing: "adicionar imagens para ilustrar",
    sources: [{ id: "src_01", file: "media/a.mp4", durationInSeconds: 61, width: 1080, height: 1920, fps: 30 }],
    timeline: { segments: [{ id: "seg_01", sourceId: "src_01", sourceStart: 0, sourceEnd: 61 }] },
    captions: withWords
      ? { blocks: [{ id: "b1", sourceId: "src_01", start: 0, end: 61, text: words.map((w) => w.text).join(" "), words }] }
      : { blocks: [] },
    render: { width: 1080, height: 1920, fps: 30 },
  });
}

const pick = (word: number, subject: string): IllustrationPick => ({ word, subject, label: "", position: "top" });

describe("botão Sugerir imagens", () => {
  it("ancora nas palavras escolhidas e respeita máx. 3 e 8 s de espaço", () => {
    const out = placeIllustrations(recipe(), [
      pick(10, "martelo de juiz"),
      pick(12, "perto demais"),
      pick(40, "contrato assinado"),
      pick(70, "celular com mensagem"),
      pick(100, "a quarta imagem"),
    ]);
    expect(out.added).toHaveLength(3);
    const ill = out.recipe.motions.filter((m) => m.kind === "illustration");
    expect(ill.map((m) => m.sourceTime)).toEqual([5, 20, 35]);
    expect(ill.every((m) => m.status === "pending" && m.origin === "ai")).toBe(true);
    expect(out.rejected.map((r) => r.reason)).toEqual(
      // a 1 s da primeira: cai na camada ocupada (antes da regra dos 8 s)
      [expect.stringMatching(/camada text ocupada|perto demais/), expect.stringMatching(/máximo de 3/)]
    );
  });

  const prevKey = process.env.MAGNIFIC_API_KEY;
  beforeAll(() => delete process.env.MAGNIFIC_API_KEY);
  afterAll(() => {
    if (prevKey !== undefined) process.env.MAGNIFIC_API_KEY = prevKey;
  });

  it("sugestão entra mesmo se a imagem falhar (erro no relatório); sem transcrição, recusa", async () => {
    const { recipe: r, report } = await suggestIllustrations(recipe(), {
      pick: async () => [pick(10, "martelo de juiz"), pick(40, "contrato assinado")],
    });
    expect(report).toMatchObject({ proposed: 2, added: 2, images: 0 });
    expect(report.errors[0]).toMatch(/MAGNIFIC_API_KEY/);
    expect(r.motions.filter((m) => m.kind === "illustration")).toHaveLength(2);
    await expect(suggestIllustrations(recipe(false), { pick: async () => [] })).rejects.toThrow(/Transcreva/);
  });
});

describe("imagem tem prioridade sobre sugestão de motion da IA", () => {
  const withMotions = (status: "pending" | "accepted", origin: "ai" | "manual") =>
    parseRecipe({
      ...recipe(),
      motions: [
        // texto sugerido exatamente onde a imagem vai cair (palavra 10 = 5 s)
        // id "mo_01": a imagem nova herda esse id ao entrar (tem que contar como nova)
        { id: "mo_01", kind: "keyword", sourceId: "src_01", sourceTime: 5, durationSeconds: 2, status, origin, params: { text: "PALAVRA" } },
        // combo sugerido: o zoom do mesmo grupo sai junto com o texto
        { id: "z", kind: "zoom", sourceId: "src_01", sourceTime: 5, durationSeconds: 1, status, origin, group: "impact-hook:1", params: {} },
        { id: "k2", kind: "kinetic", sourceId: "src_01", sourceTime: 5.2, durationSeconds: 2, status, origin, group: "impact-hook:1", params: { text: "Frase" } },
        // longe da imagem: fica
        { id: "far", kind: "keyword", sourceId: "src_01", sourceTime: 30, durationSeconds: 2, status, origin, params: { text: "LONGE" } },
      ],
    });

  it("sugestão da IA no caminho sai (com o combo); a imagem entra", () => {
    const out = placeIllustrations(withMotions("pending", "ai"), [pick(10, "martelo de juiz")], 2);
    expect(out.added).toHaveLength(1);
    expect(out.displaced).toBe(3);
    expect(out.recipe.motions.map((m) => m.id).filter((id) => id !== out.added[0])).toEqual(["far"]);
  });

  it("motion aceito ou posto à mão nunca sai: aí a imagem é que é recusada", () => {
    const out = placeIllustrations(withMotions("accepted", "manual"), [pick(10, "martelo de juiz")], 2);
    expect(out.added).toHaveLength(0);
    expect(out.displaced).toBe(0);
    expect(out.rejected[0].reason).toMatch(/camada text ocupada/);
  });
});
