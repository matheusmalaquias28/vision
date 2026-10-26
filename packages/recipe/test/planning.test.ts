import { describe, expect, it } from "vitest";
import {
  detectEnumerations,
  spokenWords,
  transitionFillers,
  validateComposition,
  withPendingCutsApplied,
  wordsAfterCut,
  type RankedCandidate,
} from "../src/creative";
import { keptCaptionWords, regroupBlocks } from "../src/captions";
import { MOTION_REGISTRY } from "../src/motionRegistry";
import { MotionSchema, parseRecipe } from "../src/schema";
import { applyCutSuggestions, undoAppliedCuts } from "../src/suggestions";
import { outputDuration } from "../src/time";
import { mergeSilenceRanges, quietRangesFromLevels, refineWordsWithSilences } from "../src/transcript";

/** N clipes de 7 s, fala de 1.5 s a 5.5 s em cada (ar nas pontas, como gravação de celular) */
function clips(n: number, cuts: { sourceId: string; sourceStart: number; sourceEnd: number; status: string }[] = []) {
  const ids = Array.from({ length: n }, (_, i) => `src_0${i + 1}`);
  return parseRecipe({
    version: 2,
    projectId: "t",
    createdAt: "2026-10-01T00:00:00Z",
    sources: ids.map((id) => ({ id, file: `media/${id}.mp4`, durationInSeconds: 7, width: 1080, height: 1920, fps: 30 })),
    timeline: {
      segments: ids.map((id, i) => ({ id: `seg_0${i + 1}`, sourceId: id, sourceStart: 0, sourceEnd: 7 })),
      suggestedCuts: cuts.map((c, i) => ({ id: `pau_${i}`, reason: "pause", confidence: 0.85, note: "", ...c })),
    },
    captions: {
      blocks: ids.map((id, i) => ({
        id: `b${i}`,
        sourceId: id,
        words: Array.from({ length: 8 }, (_, k) => ({ text: `w${i}_${k}`, start: 1.5 + k * 0.5, end: 1.9 + k * 0.5 })),
      })),
    },
    render: { width: 1080, height: 1920, fps: 30 },
  });
}

/** Cortes pendentes do ar de cada ponta (o que a análise sugere) */
const edgeCuts = (n: number) =>
  Array.from({ length: n }, (_, i) => [
    { sourceId: `src_0${i + 1}`, sourceStart: 0, sourceEnd: 1.4, status: "pending" },
    { sourceId: `src_0${i + 1}`, sourceStart: 5.5, sourceEnd: 7, status: "pending" },
  ]).flat();

describe("planejar no vídeo já cortado", () => {
  it("aplica só os cortes pendentes (aceitos já estão nos trechos; recusados ficam)", () => {
    const r = clips(2, [
      { sourceId: "src_01", sourceStart: 0, sourceEnd: 1.4, status: "pending" },
      { sourceId: "src_02", sourceStart: 0, sourceEnd: 1.4, status: "rejected" },
    ]);
    const p = withPendingCutsApplied(r);
    expect(outputDuration(p.timeline.segments)).toBeCloseTo(14 - 1.4);
    expect(p.timeline.suggestedCuts).toEqual(r.timeline.suggestedCuts);
    const plain = clips(2);
    expect(withPendingCutsApplied(plain)).toBe(plain);
  });

  it("marca a palavra logo depois de cada troca de clipe", () => {
    const p = withPendingCutsApplied(clips(3, edgeCuts(3)));
    const words = spokenWords(p);
    expect([...wordsAfterCut(p, words)]).toEqual([8, 16]);
  });

  it("transições completadas pelo código caem nas trocas de clipe: máx. 3, 10 s entre elas", () => {
    // 8 clipes de ~4 s depois dos cortes = 32 s; no bruto a troca fica a ~1.6 s da palavra
    const p = withPendingCutsApplied(clips(8, edgeCuts(8)));
    const { accepted } = validateComposition(p, transitionFillers(p, 1000), "dynamic");
    expect(accepted.length).toBeGreaterThanOrEqual(2);
    expect(accepted.length).toBeLessThanOrEqual(3);
    expect(accepted.every((c) => c.kind === "transition")).toBe(true);
    const starts = accepted.map((c) => c.sourceTime);
    // centralizada na troca: começa no fim do trecho de um clipe (5.5 s menos meia transição)
    for (const s of starts) expect(s).toBeGreaterThan(4.5);
  });

  it("variedade: o mesmo tipo solto não domina o vídeo", () => {
    const p = withPendingCutsApplied(clips(8, edgeCuts(8)));
    const kw = (i: number): RankedCandidate => ({
      ...MotionSchema.parse({ id: "x", kind: "keyword", sourceId: `src_0${i + 1}`, sourceTime: 2, durationSeconds: 1.5, params: { text: "OI" } }),
      priority: i,
    }) as RankedCandidate;
    const { accepted, rejected } = validateComposition(p, [0, 2, 4, 6, 7].map(kw), "dynamic");
    expect(accepted.length).toBeLessThan(5);
    expect(rejected.some((r) => /demais no vídeo/.test(r.reason))).toBe(true);
  });
});

describe("cortes entram aplicados", () => {
  it("aplica todos os pendentes de uma vez", () => {
    const r = applyCutSuggestions(clips(2, edgeCuts(2)));
    expect(r.timeline.suggestedCuts.every((c) => c.status === "accepted")).toBe(true);
    expect(outputDuration(r.timeline.segments)).toBeCloseTo(2 * 4.1);
    const done = clips(1);
    expect(applyCutSuggestions(done)).toBe(done);
  });

  it("refazer com outro ritmo devolve as pausas cortadas, mas não ressuscita clipe apagado", () => {
    const cut = applyCutSuggestions(clips(2, edgeCuts(2)));
    // operador apagou o clipe 2 inteiro
    const noClip2 = { ...cut, timeline: { ...cut.timeline, segments: cut.timeline.segments.filter((s) => s.sourceId !== "src_02") } };
    const undone = undoAppliedCuts(noClip2, ["pause"]);
    expect(outputDuration(undone.timeline.segments)).toBeCloseTo(7);
    expect(undone.timeline.segments.every((s) => s.sourceId === "src_01")).toBe(true);
    expect(undone.timeline.suggestedCuts.map((c) => c.sourceId)).toEqual(["src_02", "src_02"]);
  });

  it("legenda reagrupada pelo vídeo cortado: palavra cortada não ocupa lugar no bloco", () => {
    // 8 palavras, a 2ª e a 3ª cortadas (vício): 6 visíveis com limite 4 = 3 + 3
    // (sem contar só as que ficam seria 4 + 4 com 2 invisíveis no primeiro)
    const base = clips(1, [{ sourceId: "src_01", sourceStart: 1.95, sourceEnd: 2.95, status: "pending" }]);
    const r = applyCutSuggestions({ ...base, timeline: { ...base.timeline, suggestedCuts: base.timeline.suggestedCuts.map((c) => ({ ...c, reason: "filler" as const })) } });
    const blocks = regroupBlocks(r.captions.blocks, 4, undefined, r.timeline);
    const visible = blocks.map((b) => keptCaptionWords(r.timeline.segments, b).length);
    expect(visible).toEqual([3, 3]);
    expect(blocks.flatMap((b) => b.words)).toHaveLength(8);
  });

  it("pausa cortada quebra o bloco (era o fim de uma frase)", () => {
    const base = clips(1);
    const words = base.captions.blocks[0].words.map((w, k) => (k >= 3 ? { ...w, start: w.start + 2, end: w.end + 2 } : w));
    const r = applyCutSuggestions({
      ...base,
      timeline: { ...base.timeline, segments: [{ ...base.timeline.segments[0], sourceEnd: 9 }], suggestedCuts: [{ id: "pau_1", sourceId: "src_01", sourceStart: 3, sourceEnd: 4.8, reason: "pause", confidence: 0.85, status: "pending", note: "" }] },
      sources: [{ ...base.sources[0], durationInSeconds: 9 }],
      captions: { ...base.captions, blocks: [{ ...base.captions.blocks[0], words }] },
    });
    const blocks = regroupBlocks(r.captions.blocks, 6, undefined, r.timeline);
    expect(blocks.map((b) => b.words.length)).toEqual([3, 5]);
  });
});

describe("silêncio com limiar do próprio clipe", () => {
  // fundo de sala oscilando -44..-36 dB, fala em -20 dB
  const noisy = (pattern: string) => [...pattern].map((c, i) => (c === "s" ? -20 - (i % 3) : -44 + ((i * 7) % 9)));

  it("acha o silêncio que o limiar fixo perde e apara a palavra esticada pelo Whisper", () => {
    // 1.5 s de fundo, 2 s de fala, 0.5 s de fundo (janelas de 50 ms)
    const levels = noisy("q".repeat(30) + "s".repeat(40) + "q".repeat(10));
    const quiet = quietRangesFromLevels(levels, 0.05);
    expect(quiet[0]).toEqual({ start: 0, end: 1.5 });
    const [a] = refineWordsWithSilences([{ text: "A", start: 0, end: 1.6 }], quiet);
    expect(a.start).toBeCloseTo(1.5);
  });

  it("pico curto no meio do fundo não quebra o silêncio", () => {
    const levels = noisy("q".repeat(20) + "s".repeat(40));
    levels[10] = -25;
    expect(quietRangesFromLevels(levels, 0.05)[0]).toEqual({ start: 0, end: 1 });
  });

  it("sem contraste entre fala e fundo (música, ruído alto) não inventa silêncio", () => {
    expect(quietRangesFromLevels(Array.from({ length: 60 }, (_, i) => -22 - (i % 5)), 0.05)).toEqual([]);
  });

  it("une as detecções sem sobreposição", () => {
    expect(mergeSilenceRanges([{ start: 0, end: 1 }], [{ start: 0.8, end: 1.5 }, { start: 3, end: 4 }])).toEqual([
      { start: 0, end: 1.5 },
      { start: 3, end: 4 },
    ]);
  });
});

describe("palavra posta no silêncio", () => {
  it("vai para a borda sem passar da palavra seguinte (ordem da legenda)", () => {
    const words = [
      { text: "E", start: 0, end: 1.68 },
      { text: "quais", start: 1.68, end: 1.96 },
    ];
    const out = refineWordsWithSilences(words, [{ start: 0, end: 1.75 }]);
    expect(out.map((w) => w.text)).toEqual(["E", "quais"]);
    expect(out[0].start).toBeLessThanOrEqual(out[1].start);
    expect(out[1]).toBe(words[1]);
  });
});

describe("tela cheia: modelo lista", () => {
  const screen = (params: Record<string, unknown>) =>
    MotionSchema.safeParse({ id: "s", kind: "screen", sourceId: "src_01", sourceTime: 1, durationSeconds: 3.5, params: { text: "Documentos", ...params } });

  it("projeto antigo continua frase (padrão não muda)", () => {
    const r = screen({ emphasis: "" });
    expect(r.success && r.data.kind === "screen" && r.data.params).toMatchObject({ layout: "phrase", items: [], marker: "number" });
  });

  it("lista precisa de 2 a 5 itens", () => {
    expect(screen({ layout: "list", items: ["RG"] }).success).toBe(false);
    expect(screen({ layout: "list", items: ["RG", "CPF", "Comprovante"] }).success).toBe(true);
    expect(screen({ layout: "list", items: ["a", "b", "c", "d", "e", "f"] }).success).toBe(false);
  });

  it("IA: itens separados por | viram o modelo lista; sem itens fica frase", () => {
    const list = MOTION_REGISTRY.screen.fromSlots({ text: "O que levar", items: "RG | CPF | comprovante de renda" });
    expect(list).toMatchObject({ layout: "list", items: ["RG", "CPF", "comprovante de renda"], align: "left" });
    expect(MOTION_REGISTRY.screen.fromSlots({ text: "Isso muda tudo" })).not.toHaveProperty("layout");
  });
});

describe("momentos de lista na fala", () => {
  const said = (text: string) =>
    text.split(" ").map((t, i) => ({ word: { text: t, start: i * 0.4, end: i * 0.4 + 0.3, sourceId: "src_01" }, outputTime: i * 0.4 })) as never;

  it("acha as aberturas de lista da copy", () => {
    expect(detectEnumerations(said("A união estável vale em casos de separação, falecimento e herança"))[0]).toMatchObject({ word: 4, cue: "em casos de" });
    expect(detectEnumerations(said("Esses são os pontos que você precisa olhar"))[0].cue).toBe("Esses são os");
    expect(detectEnumerations(said("Precisamos analisar esses tópicos com calma"))[0]).toMatchObject({ word: 2, cue: "esses tópicos" });
    expect(detectEnumerations(said("Os 3 erros que travam suas vendas"))[0].cue).toBe("3 erros");
    expect(detectEnumerations(said("Primeiro você junta os papéis, depois procura o advogado"))[0].cue).toBe("primeiro … segundo");
  });

  it("fala sem lista não dispara; pistas próximas viram uma só", () => {
    expect(detectEnumerations(said("Você vive numa relação de casal mas nunca formalizou"))).toEqual([]);
    expect(detectEnumerations(said("Esses são os pontos em casos de dúvida"))).toHaveLength(1);
  });
});
