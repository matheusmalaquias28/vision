import { describe, expect, it } from "vitest";
import { paginateWords } from "../src/captions";
import { CaptionStyleSchema } from "../src/schema";

/** Medida falsa: 10 px por letra; cada palavra ocupa +10 px de espaço */
const opts = (maxWidth: number, maxLines = 2, wordsPerLine = 0) => ({
  maxWidth,
  maxLines,
  wordsPerLine,
  measure: (t: string) => t.length * 10,
  perWord: 10,
});
const words = (text: string) => text.split(" ").map((t, i) => ({ text: t, start: i, end: i + 0.5 }));
const text = (pages: { text: string }[][][]) => pages.map((p) => p.map((l) => l.map((w) => w.text).join(" ")));

describe("legenda com tamanho fixo", () => {
  it("padrão novo: Poppins Black, contorno 6, até 2 linhas, sem encolher", () => {
    const s = CaptionStyleSchema.parse({});
    expect(s).toMatchObject({ fontFamily: "Poppins", fontWeight: 900, strokeWidthPx: 6, maxLines: 2, autoFit: false });
  });

  it("frase que cabe fica numa parte, em linhas equilibradas", () => {
    const pages = paginateWords(words("vamos falar sobre inventario hoje"), opts(200));
    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(2);
    for (const line of pages[0]) {
      expect(line.reduce((a, w) => a + w.text.length * 10 + 10, 0)).toBeLessThanOrEqual(200);
    }
  });

  it("frase longa vira partes que cabem, sem estourar a largura nem as linhas", () => {
    const long = words("se voce perdeu um ente querido e ainda nao deu entrada no inventario procure um advogado agora");
    const pages = paginateWords(long, opts(220, 2));
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      expect(page.length).toBeLessThanOrEqual(2);
      for (const line of page) {
        expect(line.reduce((a, w) => a + w.text.length * 10 + 10, 0)).toBeLessThanOrEqual(220);
      }
    }
    // nenhuma palavra some nem troca de ordem
    expect(pages.flat(2).map((w) => w.text)).toEqual(long.map((w) => w.text));
  });

  it("partes equilibradas: nada de palavra sozinha no fim", () => {
    // 7 palavras, cabem 3 por parte: o guloso faria 3+3+1; o equilíbrio faz 3+2+2
    const pages = paginateWords(words("aa bb cc dd ee ff gg"), opts(90, 1));
    expect(pages).toHaveLength(3);
    expect(pages.every((p) => p.flat().length > 1)).toBe(true);
  });

  it("prefere quebrar na vírgula", () => {
    const pages = paginateWords(words("se precisar de ajuda, me procure agora"), opts(300, 1));
    expect(text(pages)[0][0]).toBe("se precisar de ajuda,");
  });

  it("palavra maior que a linha fica sozinha na linha (o render reduz só ela)", () => {
    const pages = paginateWords(words("um inconstitucionalissimamente dois"), opts(150, 2));
    const lines = pages.flat();
    expect(lines.some((l) => l.length === 1 && l[0].text === "inconstitucionalissimamente")).toBe(true);
  });

  it("respeita palavras por linha", () => {
    const pages = paginateWords(words("a b c d e f"), opts(1000, 2, 2));
    for (const l of pages.flat()) expect(l.length).toBeLessThanOrEqual(2);
  });
});

describe("linhas equilibradas", () => {
  it("palavra sozinha não vai para a linha de cima quando dá para equilibrar", () => {
    // "nesse inventario dentro": a melhor divisão em 2 linhas deixa a linha mais larga menor
    const pages = paginateWords(words("nesse inventario dentro"), opts(200, 2));
    expect(text(pages)).toEqual([["nesse inventario", "dentro"]]);
  });
});
