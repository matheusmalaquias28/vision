import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseRecipe, type Recipe } from "@vision/recipe";

/**
 * Integração do Creative Planner com a OpenAI simulada: briefing do War →
 * transcrição → plano (mock) → compilador → validador → timeline. Cobre
 * resposta válida, resposta inválida/erro (fallback), cache e o que o
 * editor já tinha na timeline.
 */

const parse = vi.fn();
vi.mock("../src/pipeline/transcribe", () => ({
  requireOpenAI: () => ({ beta: { chat: { completions: { parse } } } }),
}));

const { planCreative } = await import("../src/creative/planner");
const { projectDir } = await import("../src/paths");

const PROJECT = "zz-vitest-planner";
const FALA =
  "você está perdendo clientes todos os dias e 70% das empresas não sabem disso " +
  "com o nosso método você ganha tempo economiza dinheiro e vende mais clica no link da bio agora";

function recipe(briefing: string, motions: unknown[] = []): Recipe {
  const words = FALA.split(" ").map((w, i) => ({ text: w, start: i * 0.5, end: i * 0.5 + 0.4 }));
  const total = words.length * 0.5 + 1;
  return parseRecipe({
    version: 2,
    projectId: PROJECT,
    createdAt: "2026-10-01T00:00:00Z",
    briefing,
    sources: [{ id: "src_01", file: "media/a.mp4", durationInSeconds: total, width: 1080, height: 1920, fps: 30 }],
    timeline: { segments: [{ id: "seg_01", sourceId: "src_01", sourceStart: 0, sourceEnd: total }] },
    captions: { blocks: [{ id: "b1", sourceId: "src_01", start: 0, end: total, text: FALA, words }] },
    motions,
    render: { width: 1080, height: 1920, fps: 30 },
  });
}

const okResponse = (events: unknown[], style = "dynamic") => ({
  choices: [{ message: { refusal: null, parsed: { style, events } } }],
  usage: { prompt_tokens: 2900, completion_tokens: 240, prompt_tokens_details: { cached_tokens: 0 } },
});

beforeEach(() => {
  parse.mockReset();
  fs.rmSync(projectDir(PROJECT), { recursive: true, force: true });
  fs.mkdirSync(projectDir(PROJECT), { recursive: true });
});
afterAll(() => fs.rmSync(projectDir(PROJECT), { recursive: true, force: true }));

describe("planCreative", () => {
  it("cenário de aceite: uma chamada, proibições do briefing respeitadas, sugestões editáveis", async () => {
    parse.mockResolvedValue(
      okResponse([
        { type: "combo", id: "statistic-reveal", word: 9, seconds: null, params: [{ k: "number", v: "70" }, { k: "suffix", v: "%" }, { k: "label", v: "das empresas" }] },
        { type: "combo", id: "benefit-stack", word: 18, seconds: 4, params: [{ k: "items", v: "ganha tempo|economiza dinheiro|vende mais" }] },
        { type: "combo", id: "cta-focus", word: 27, seconds: null, params: [{ k: "text", v: "clica no link da bio" }] },
      ])
    );
    const r = recipe("Vídeo dinâmico. Destacar benefícios, a porcentagem e o CTA. Não usar emoji nem flashes.");
    const { recipe: out, report } = await planCreative(r);

    expect(parse).toHaveBeenCalledTimes(1);
    const req = parse.mock.calls[0][0];
    const prompt = req.messages.map((m: { content: string }) => m.content).join("\n");
    expect(prompt).not.toMatch(/- emoji:|- flash:/); // fora do catálogo
    expect(prompt).toContain("PROIBIDO PELO BRIEFING");
    expect(report.style).toBe("dynamic");
    expect(report.styleSource).toBe("briefing");
    expect(report.applied).toBe(3);
    expect(report.tokens).toEqual({ input: 2900, output: 240, cached: 0 });
    expect(out.motions.every((m) => m.status === "pending" && m.origin === "ai")).toBe(true);
    expect(new Set(out.motions.map((m) => m.group))).toEqual(new Set(["statistic-reveal:1", "benefit-stack:1", "cta-focus:1"]));
  });

  it("número inventado pela IA é recusado com motivo", async () => {
    parse.mockResolvedValue(okResponse([{ type: "motion", id: "counter", word: 9, seconds: 2, params: [{ k: "number", v: "93" }] }]));
    const { report } = await planCreative(recipe(""));
    expect(report.applied).toBe(0);
    expect(report.rejected[0].reason).toMatch(/93/);
  });

  it("IA fora do ar: plano básico entra e o editor não perde nada", async () => {
    parse.mockRejectedValue(new Error("timeout"));
    const manual = { id: "man", kind: "keyword", sourceId: "src_01", sourceTime: 12, durationSeconds: 1.5, origin: "manual", params: { text: "MANUAL" } };
    const { recipe: out, report } = await planCreative(recipe("", [manual]));
    expect(report.fallback).toBe("timeout");
    expect(out.motions.find((m) => m.id === "man")).toBeTruthy();
    expect(out.motions.some((m) => m.kind === "counter" && m.status === "pending")).toBe(true); // 70% dito
  });

  it("resposta recusada ou vazia também cai no fallback", async () => {
    parse.mockResolvedValue({ choices: [{ message: { refusal: "não posso", parsed: null } }], usage: null });
    const { report } = await planCreative(recipe(""));
    expect(report.fallback).toMatch(/recusou/);
  });

  it("mesma entrada reaproveita o plano do cache (0 chamadas)", async () => {
    parse.mockResolvedValue(okResponse([{ type: "motion", id: "keyword", word: 2, seconds: null, params: [{ k: "text", v: "PERDENDO CLIENTES" }] }]));
    await planCreative(recipe(""));
    const again = await planCreative(recipe(""));
    expect(parse).toHaveBeenCalledTimes(1);
    expect(again.report.cacheHit).toBe(true);
    const forced = await planCreative(recipe(""), { force: true });
    expect(parse).toHaveBeenCalledTimes(2);
    expect(forced.report.cacheHit).toBe(false);
  });

  it("pedido do editor também proíbe (sem custo extra de IA)", async () => {
    parse.mockResolvedValue(okResponse([{ type: "motion", id: "zoom", word: 2, seconds: null, params: [] }]));
    const { report } = await planCreative(recipe(""), { instructions: "sem zoom" });
    expect(report.catalog.motions).not.toContain("zoom");
    expect(report.applied).toBe(0);
    expect(report.rejected[0].reason).toMatch(/fora do catálogo/);
  });
});

void path;
