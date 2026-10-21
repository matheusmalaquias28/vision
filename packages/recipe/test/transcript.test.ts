import { describe, expect, it } from "vitest";
import { parseRecipe, type Recipe, type Word } from "../src/schema";
import { mergeSuggestions, reviewSuggestions } from "../src/suggestions";
import { applyCutToSegments, restoreSourceRange } from "../src/time";
import {
  detectFillers,
  detectPauses,
  detectRepeats,
  detectTranscriptCuts,
  isWordKept,
  snapRetakeToRestart,
  transcriptWords,
  wordsCutRange,
  wordsRestoreRange,
  type CutCandidate,
} from "../src/transcript";

const w = (text: string, start: number, end: number): Word => ({ text, start, end });

function recipeWith(words: Word[], extra: Partial<Record<string, unknown>> = {}): Recipe {
  return parseRecipe({
    version: 2,
    projectId: "t",
    createdAt: "2026-10-01T00:00:00Z",
    sources: [
      { id: "src_01", file: "media/a.mp4", durationInSeconds: 30, width: 1080, height: 1920, fps: 30 },
    ],
    timeline: {
      segments: [{ id: "seg_01", sourceId: "src_01", sourceStart: 0, sourceEnd: 30 }],
    },
    captions: {
      blocks: [
        { id: "cap_01", sourceId: "src_01", words: words.slice(0, 3) },
        { id: "cap_02", sourceId: "src_01", words: words.slice(3) },
        { id: "cap_n", sourceId: null, words: [w("narração", 0, 1)] },
      ].filter((b) => b.words.length > 0),
    },
    render: { width: 1080, height: 1920, fps: 30 },
    ...extra,
  });
}

const speech = [
  w("Olá", 1.0, 1.4),
  w("ééé", 1.5, 2.0),
  w("pessoal", 2.1, 2.6),
  w("então", 2.7, 3.0),
  w("então", 3.05, 3.4),
  w("vamos", 4.5, 4.8),
  w("lá", 4.85, 5.1),
];

describe("transcriptWords", () => {
  it("achata blocos falados em ordem e ignora narração", () => {
    const words = transcriptWords(recipeWith(speech));
    expect(words.map((x) => x.text)).toEqual(speech.map((x) => x.text));
    expect(words[3]).toMatchObject({ key: "cap_02:0", sourceId: "src_01" });
  });
});

describe("wordsCutRange", () => {
  it("vai do fim da anterior até logo antes da próxima", () => {
    expect(wordsCutRange(speech, 1, 1)).toEqual({ start: 1.45, end: 2.05 });
  });
  it("não invade a palavra vizinha quando estão coladas", () => {
    const glued = [w("a", 0, 1), w("b", 1, 2), w("c", 2, 3)];
    expect(wordsCutRange(glued, 1, 1)).toEqual({ start: 1, end: 2 });
  });
  it("trata bordas do clipe", () => {
    expect(wordsCutRange(speech, 0, 0).start).toBeCloseTo(0.95);
    expect(wordsCutRange(speech, 6, 6).end).toBeCloseTo(5.15);
  });
});

describe("detectores", () => {
  const words = transcriptWords(recipeWith(speech));

  it("detecta vício forte, mas não 'é' verbo nem 'um' artigo", () => {
    const fillers = detectFillers(words);
    expect(fillers).toHaveLength(1);
    expect(fillers[0]).toMatchObject({ reason: "filler", confidence: 0.85 });
    const legit = transcriptWords(recipeWith([w("meu", 0, 0.2), w("nome", 0.2, 0.4), w("é", 0.4, 0.5), w("um", 0.5, 0.6)]));
    expect(detectFillers(legit)).toEqual([]);
  });

  it("'tipo de' não é vício", () => {
    const t = transcriptWords(recipeWith([w("esse", 0, 0.2), w("tipo", 0.2, 0.4), w("de", 0.4, 0.5), w("tipo", 0.6, 0.8), w("isso", 0.8, 1)]));
    const found = detectFillers(t);
    expect(found).toHaveLength(1);
    expect(found[0].sourceStart).toBeGreaterThan(0.5);
  });

  it("detecta repetição e corta a primeira ocorrência", () => {
    const reps = detectRepeats(words);
    expect(reps).toHaveLength(1);
    expect(reps[0].sourceStart).toBeCloseTo(2.65);
    // a próxima começa 0.05s depois: o corte para no fim da primeira
    expect(reps[0].sourceEnd).toBeCloseTo(3.0);
  });

  it("detecta repetição de par de palavras", () => {
    const t = transcriptWords(recipeWith([w("você", 0, 0.2), w("quer", 0.2, 0.4), w("você", 0.4, 0.6), w("quer", 0.6, 0.8), w("ir", 0.8, 1)]));
    const reps = detectRepeats(t);
    expect(reps).toHaveLength(1);
    expect(reps[0].note).toContain("você quer");
  });

  it("detecta pausa entre palavras com respiro dos dois lados", () => {
    const pauses = detectPauses(words);
    expect(pauses).toHaveLength(1);
    expect(pauses[0].sourceStart).toBeCloseTo(3.55);
    expect(pauses[0].sourceEnd).toBeCloseTo(4.35);
  });
});

describe("mergeSuggestions / reviewSuggestions", () => {
  it("dedupe por sobreposição e respeita prioridade", () => {
    const r = recipeWith(speech);
    const merged = mergeSuggestions(r, detectTranscriptCuts(r), ["filler", "repeat", "pause"]);
    const reasons = merged.timeline.suggestedCuts.map((c) => c.reason).sort();
    expect(reasons).toEqual(["filler", "pause", "repeat"]);
    const ids = merged.timeline.suggestedCuts.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("não ressuscita sugestão rejeitada nem sugere trecho já cortado", () => {
    const r = recipeWith(speech);
    let merged = mergeSuggestions(r, detectTranscriptCuts(r), ["filler", "repeat", "pause"]);
    const filler = merged.timeline.suggestedCuts.find((c) => c.reason === "filler")!;
    merged = reviewSuggestions(merged, [filler.id], false);
    const pause = merged.timeline.suggestedCuts.find((c) => c.reason === "pause")!;
    merged = {
      ...merged,
      timeline: {
        ...merged.timeline,
        segments: applyCutToSegments(merged.timeline.segments, "src_01", pause.sourceStart, pause.sourceEnd),
        suggestedCuts: merged.timeline.suggestedCuts.filter((c) => c.id !== pause.id),
      },
    };
    const again = mergeSuggestions(merged, detectTranscriptCuts(merged), ["filler", "repeat", "pause"]);
    const cuts = again.timeline.suggestedCuts;
    expect(cuts.filter((c) => c.reason === "filler").map((c) => c.status)).toEqual(["rejected"]);
    expect(cuts.some((c) => c.reason === "pause")).toBe(false);
  });

  it("aceitar aplica o corte e as palavras somem da timeline", () => {
    const r = recipeWith(speech);
    const merged = mergeSuggestions(r, detectTranscriptCuts(r), ["filler"]);
    const accepted = reviewSuggestions(merged, merged.timeline.suggestedCuts.map((c) => c.id), true);
    const words = transcriptWords(accepted);
    expect(words.filter((x) => !isWordKept(accepted.timeline.segments, x)).map((x) => x.text)).toEqual(["ééé"]);
    expect(accepted.timeline.suggestedCuts.every((c) => c.status === "accepted")).toBe(true);
  });

  it("nunca esvazia a timeline", () => {
    const r = recipeWith(speech);
    const all: CutCandidate = { sourceId: "src_01", sourceStart: 0, sourceEnd: 30, reason: "retake", confidence: 0.9, note: "" };
    const merged = mergeSuggestions(r, [all], ["retake"]);
    const after = reviewSuggestions(merged, [merged.timeline.suggestedCuts[0].id], true);
    expect(after.timeline.segments).toHaveLength(1);
    expect(after.timeline.suggestedCuts[0].status).toBe("pending");
  });
});

describe("wordsRestoreRange", () => {
  it("restaurar uma palavra não traz de volta a pausa seguinte já cortada", () => {
    const ws = [w("sobre", 5.82, 6.06), w("inventário", 6.06, 6.5), w("a", 7.48, 7.54)];
    const r = recipeWith(ws, {
      timeline: {
        segments: [
          { id: "s1", sourceId: "src_01", sourceStart: 0, sourceEnd: 6.675 },
          { id: "s2", sourceId: "src_01", sourceStart: 7.265, sourceEnd: 30 },
        ],
      },
    });
    const words = transcriptWords(r);
    const cut = wordsCutRange(words, 1, 1);
    const afterCut = applyCutToSegments(r.timeline.segments, "src_01", cut.start, cut.end);
    const back = wordsRestoreRange(words, 1, 1);
    const restored = restoreSourceRange(afterCut, "src_01", back.start, back.end);
    expect(isWordKept(restored, words[1])).toBe(true);
    // o silêncio 6.675–7.265 (cortado antes) continua fora
    expect(restored.some((s) => s.sourceStart <= 7 && s.sourceEnd > 7)).toBe(false);
  });
});

describe("palavras sem duração (Whisper colapsado)", () => {
  it("cortar e restaurar a palavra sozinha funciona", () => {
    const ws = [w("um", 5.42, 5.82), w("pouquinho", 5.82, 5.82), w("sobre", 5.82, 6.06), w("inventário", 6.06, 6.5)];
    const r = recipeWith(ws);
    const words = transcriptWords(r);
    const range = wordsCutRange(words, 1, 1);
    expect(range.end - range.start).toBeGreaterThanOrEqual(0.079);
    const cut = applyCutToSegments(r.timeline.segments, "src_01", range.start, range.end);
    expect(isWordKept(cut, words[1])).toBe(false);
    const back = wordsRestoreRange(words, 1, 1);
    const restored = restoreSourceRange(cut, "src_01", back.start, back.end);
    expect(isWordKept(restored, words[1])).toBe(true);
    expect(restored).toEqual(r.timeline.segments);
  });
});

describe("snapRetakeToRestart", () => {
  const ws = "O prazo para dar entrada é de O prazo para dar entrada no inventário".split(" ").map((t, i) => w(t, i, i + 0.5));

  it("encolhe quando o LLM inclui a primeira palavra da versão mantida", () => {
    expect(snapRetakeToRestart(ws, 0, 7)).toBe(6);
  });
  it("estica quando o LLM para cedo demais", () => {
    expect(snapRetakeToRestart(ws, 0, 5)).toBe(6);
  });
  it("mantém o índice certo", () => {
    expect(snapRetakeToRestart(ws, 0, 6)).toBe(6);
  });
  it("sem recomeço (começo falso) não mexe", () => {
    const fs = "Então a gente vai Bom o inventário é".split(" ").map((t, i) => w(t, i, i + 0.5));
    expect(snapRetakeToRestart(fs, 0, 3)).toBe(3);
  });
});
