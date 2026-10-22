import { describe, expect, it } from "vitest";
import { parseRecipe, type Recipe, type Word } from "../src/schema";
import { mergeSuggestions, reviewSuggestions } from "../src/suggestions";
import { applyCutToSegments, restoreSourceRange } from "../src/time";
import {
  detectFillers,
  detectEdgePauses,
  detectPauses,
  PAUSE_PACES,
  refineWordsWithSilences,
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
    // "ééé" (som de hesitação) e o "então" solto antes de 1.1s de pausa
    expect(fillers.map((f) => [f.note, f.confidence])).toEqual([
      ["\"ééé\"", 0.85],
      ["\"então\"", 0.5],
    ]);
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
    // ritmo normal: 0.1s de respiro de cada lado
    expect(pauses[0].sourceStart).toBeCloseTo(3.5);
    expect(pauses[0].sourceEnd).toBeCloseTo(4.4);
  });
});

describe("mergeSuggestions / reviewSuggestions", () => {
  it("dedupe por sobreposição e respeita prioridade", () => {
    const r = recipeWith(speech);
    const merged = mergeSuggestions(r, detectTranscriptCuts(r), ["filler", "repeat", "pause"]);
    const reasons = merged.timeline.suggestedCuts.map((c) => c.reason).sort();
    // vícios: "ééé" e o "então" solto (o corte dele já leva a pausa até "vamos",
    // então a pausa entre os dois sai no dedupe); pausas: antes de "Olá" e o fim mudo
    expect(reasons).toEqual(["filler", "filler", "pause", "pause", "repeat"]);
    const ids = merged.timeline.suggestedCuts.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("não ressuscita sugestão rejeitada nem sugere trecho já cortado", () => {
    const r = recipeWith(speech);
    let merged = mergeSuggestions(r, detectTranscriptCuts(r), ["filler", "repeat", "pause"]);
    const filler = merged.timeline.suggestedCuts.find((c) => c.reason === "filler")!;
    merged = reviewSuggestions(merged, [filler.id], false);
    const pause = merged.timeline.suggestedCuts.find((c) => c.reason === "pause" && c.note.includes(" antes de "))!;
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
    // o "ééé" rejeitado continua rejeitado (não volta como pendente)
    expect(cuts.filter((c) => c.note === "\"ééé\"").map((c) => c.status)).toEqual(["rejected"]);
    expect(cuts.some((c) => c.reason === "pause" && c.note.includes(" antes de "))).toBe(false);
  });

  it("aceitar aplica o corte e as palavras somem da timeline", () => {
    const r = recipeWith(speech);
    const merged = mergeSuggestions(r, detectTranscriptCuts(r), ["filler"]);
    const accepted = reviewSuggestions(merged, merged.timeline.suggestedCuts.map((c) => c.id), true);
    const words = transcriptWords(accepted);
    expect(words.filter((x) => !isWordKept(accepted.timeline.segments, x)).map((x) => x.text)).toEqual(["ééé", "então"]);
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

describe("refineWordsWithSilences (Whisper estica palavras sobre pausas)", () => {
  // trecho real: "Se você for chamado [1.8s] na delegacia como [1.9s] testemunha"
  const whisper = [
    w("Se", 0, 0.3),
    w("você", 0.3, 0.9),
    w("chamado", 1.04, 1.54),
    w("na", 1.54, 3.54),
    w("delegacia", 3.54, 4.26),
    w("como", 4.26, 6.86),
    w("que", 11.04, 12.0),
  ];
  const silences = [
    { start: 0, end: 0.633 },
    { start: 1.58, end: 3.387 },
    { start: 4.294, end: 6.239 },
    { start: 11.198, end: 11.92 },
  ];
  const fixed = refineWordsWithSilences(whisper, silences);

  it("silêncio na borda sai da palavra e abre a lacuna da pausa", () => {
    expect(fixed[3]).toMatchObject({ text: "na", start: 3.387, end: 3.54 });
    expect(fixed[5]).toMatchObject({ text: "como", start: 6.239, end: 6.86 });
    expect(fixed[6]).toMatchObject({ text: "que", start: 11.04, end: 11.198 });
  });

  it("palavra inteira no silêncio inicial vai para onde a fala começa", () => {
    expect(fixed[0]).toMatchObject({ text: "Se", start: 0.633, end: 0.633 });
    expect(fixed[1]).toMatchObject({ text: "você", start: 0.633, end: 0.9 });
  });

  it("não mexe em silêncio curto nem em palavra sem silêncio; é idempotente", () => {
    expect(fixed[2]).toBe(whisper[2]);
    expect(fixed[4]).toBe(whisper[4]);
    const again = refineWordsWithSilences(fixed, silences);
    again.forEach((x, i) => expect(x).toBe(fixed[i]));
  });

  it("com as palavras aparadas, as pausas aparecem", () => {
    const words = transcriptWords(recipeWith(fixed));
    const pauses = detectPauses(words);
    expect(pauses.map((p) => [p.sourceStart, p.sourceEnd])).toEqual([
      [1.64, 3.287], // a pausa de 1.8s que o Whisper escondeu dentro de "na"
      [4.36, 6.139], // a de 1.9s escondida dentro de "como"
      [6.96, 10.94],
    ]);
    expect(pauses[0].note).toContain("\"chamado\" e \"na\"");
  });
});

describe("detectEdgePauses", () => {
  it("corta o ar antes da primeira e depois da última palavra", () => {
    const words = transcriptWords(recipeWith([w("oi", 1.2, 1.5), w("gente", 1.5, 2.0)]));
    const edges = detectEdgePauses(words, 4);
    expect(edges.map((e) => [e.sourceStart, e.sourceEnd])).toEqual([
      [0, 1.1],
      [2.1, 4],
    ]);
  });

  it("não corta quando a fala encosta nas bordas", () => {
    const words = transcriptWords(recipeWith([w("oi", 0.1, 0.5), w("gente", 0.5, 3.8)]));
    expect(detectEdgePauses(words, 4)).toEqual([]);
  });
});

describe("detectFillers: muletas e transições pelo contexto", () => {
  const notes = (ws: Word[]) => detectFillers(transcriptWords(recipeWith(ws))).map((f) => f.note);

  it("hesitações escritas de vários jeitos", () => {
    expect(notes([w("eeee", 0, 0.5), w("aaah", 0.5, 1), w("hmmm", 1, 1.5), w("ããã", 1.5, 2), w("ok", 2, 2.2)])).toEqual([
      '"eeee"',
      '"aaah"',
      '"hmmm"',
      '"ããã"',
    ]);
  });

  it("vogal esticada é hesitação; curta é verbo/conjunção", () => {
    expect(notes([w("é", 0, 0.6), w("isso", 0.6, 1)])).toEqual(['"é"']);
    expect(notes([w("isso", 0, 0.3), w("é", 0.3, 0.45), w("bom", 0.45, 0.7)])).toEqual([]);
  });

  it("'então' no meio da frase fica; solto entre pausas ou abrindo a fala sai", () => {
    expect(notes([w("e", 0, 0.1), w("então", 0.1, 0.4), w("ele", 0.4, 0.6), w("foi", 0.6, 0.8)])).toEqual([]);
    expect(notes([w("Então", 0, 0.4), w("hoje", 0.5, 0.8), w("vou", 0.8, 1)])).toEqual(['"Então"']);
    expect(notes([w("foi", 0, 0.3), w("então", 0.6, 0.9), w("ele", 1.2, 1.4)])).toEqual(['"então"']);
  });

  it("'né' quase sempre sai; 'assim que' e 'tipo de' ficam", () => {
    expect(notes([w("difícil", 0, 0.5), w("né", 0.5, 0.7), w("mas", 0.7, 0.9)])).toEqual(['"né"']);
    expect(notes([w("assim", 0, 0.3), w("que", 0.3, 0.4), w("chegar", 0.4, 0.8)])).toEqual([]);
    expect(notes([w("esse", 0, 0.2), w("tipo", 0.2, 0.4), w("de", 0.4, 0.5), w("caso", 0.5, 0.8)])).toEqual([]);
  });

  it("expressões de duas palavras saem juntas", () => {
    expect(notes([w("e", 0, 0.1), w("tipo", 0.1, 0.3), w("assim", 0.3, 0.6), w("ele", 0.6, 0.8)])).toEqual([
      '"tipo assim"',
    ]);
  });
});

describe("PAUSE_PACES", () => {
  const words = transcriptWords(recipeWith([w("um", 0, 0.3), w("dois", 0.6, 0.9), w("três", 1.6, 1.9)]));

  it("acelerado corta pausas curtas e deixa menos respiro", () => {
    expect(detectPauses(words, PAUSE_PACES.suave)).toHaveLength(1);
    expect(detectPauses(words, PAUSE_PACES.acelerado).map((p) => [p.sourceStart, p.sourceEnd])).toEqual([
      [0.36, 0.54],
      [0.96, 1.54],
    ]);
  });
});

describe("detectFillers: tempos que o Whisper espremeu", () => {
  const notes = (ws: Word[]) => detectFillers(transcriptWords(recipeWith(ws))).map((f) => f.note);

  it("artigo 'o' longo não é hesitação (caso real: o tempo era de 'imóvel')", () => {
    expect(notes([w("alugar", 57.84, 58.3), w("o", 58.3, 59.08), w("imóvel", 59.08, 59.08), w("quer", 59.32, 59.5)])).toEqual([]);
  });

  it("'é' longo ao lado de palavra espremida também fica", () => {
    expect(notes([w("isso", 0, 0.3), w("é", 0.3, 0.9), w("bom", 0.9, 0.9), w("demais", 1, 1.4)])).toEqual([]);
  });
});
