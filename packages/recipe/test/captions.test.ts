import { describe, expect, it } from "vitest";
import { groupWordsIntoBlocks, regroupBlocks, spreadCollapsedWords } from "../src/captions";
import type { Word } from "../src/schema";

const word = (text: string, start: number, end: number): Word => ({
  text,
  start,
  end,
});

describe("groupWordsIntoBlocks", () => {
  it("quebra quando o bloco enche", () => {
    const words = [
      word("a", 0, 0.2),
      word("b", 0.2, 0.4),
      word("c", 0.4, 0.6),
    ];
    const blocks = groupWordsIntoBlocks(words, 2);
    expect(blocks.map((b) => b.words.length)).toEqual([2, 1]);
  });

  it("quebra em pausas longas mesmo com bloco vazio", () => {
    const words = [word("a", 0, 0.2), word("b", 2.0, 2.2)];
    const blocks = groupWordsIntoBlocks(words, 4);
    expect(blocks).toHaveLength(2);
  });

  it("gera ids sequenciais", () => {
    const words = [word("a", 0, 0.2), word("b", 2.0, 2.2)];
    const blocks = groupWordsIntoBlocks(words, 1);
    expect(blocks.map((b) => b.id)).toEqual(["cap_01", "cap_02"]);
  });
});

describe("regroupBlocks", () => {
  it("preserva todas as palavras e ordena por start", () => {
    const blocks = [
      { id: "x", sourceId: null, words: [word("depois", 5, 5.5)] },
      { id: "y", sourceId: null, words: [word("antes", 0, 0.5)] },
    ];
    const regrouped = regroupBlocks(blocks, 4);
    const texts = regrouped.flatMap((b) => b.words.map((w) => w.text));
    expect(texts).toEqual(["antes", "depois"]);
  });
});

describe("spreadCollapsedWords", () => {
  it("divide o trecho da palavra anterior com a palavra sem duração", () => {
    const out = spreadCollapsedWords([word("um", 5.42, 5.82), word("pouquinho", 5.82, 5.82), word("sobre", 5.82, 6.06)]);
    expect(out[0].start).toBe(5.42);
    expect(out[1].end).toBe(5.82);
    expect(out[0].end).toBe(out[1].start);
    expect(out[1].end - out[1].start).toBeGreaterThan(out[0].end - out[0].start);
    expect(out[2]).toEqual(word("sobre", 5.82, 6.06));
  });

  it("grupo todo sem duração avança sobre a pausa anterior, sem invadir a palavra", () => {
    const out = spreadCollapsedWords([word("pessoal", 1.56, 1.98), word("boa", 2.4, 2.4), word("tarde", 2.4, 2.4)]);
    expect(out[0]).toEqual(word("pessoal", 1.56, 1.98));
    expect(out[1].start).toBeGreaterThanOrEqual(1.98);
    expect(out[1].end).toBeGreaterThan(out[1].start);
    expect(out[2].end).toBe(2.4);
  });

  it("não mexe em palavras com timing normal", () => {
    const ws = [word("a", 0, 0.2), word("b", 0.2, 0.4)];
    expect(spreadCollapsedWords(ws)).toEqual(ws);
  });
});
