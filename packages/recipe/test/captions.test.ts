import { describe, expect, it } from "vitest";
import { groupWordsIntoBlocks, regroupBlocks } from "../src/captions";
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
      { id: "x", words: [word("depois", 5, 5.5)] },
      { id: "y", words: [word("antes", 0, 0.5)] },
    ];
    const regrouped = regroupBlocks(blocks, 4);
    const texts = regrouped.flatMap((b) => b.words.map((w) => w.text));
    expect(texts).toEqual(["antes", "depois"]);
  });
});
