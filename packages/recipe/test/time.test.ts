import { describe, expect, it } from "vitest";
import {
  applyCutToSegments,
  insertClipSegment,
  outputDuration,
  outputToSource,
  restoreSourceRange,
  sourceToOutput,
} from "../src/time";
import type { Segment } from "../src/schema";

const segments: Segment[] = [
  { id: "a", sourceId: "src_01", sourceStart: 0, sourceEnd: 10 },
  { id: "b", sourceId: "src_02", sourceStart: 5, sourceEnd: 15 },
];

describe("outputDuration", () => {
  it("soma as durações dos segmentos", () => {
    expect(outputDuration(segments)).toBe(20);
  });
});

describe("outputToSource", () => {
  it("mapeia para a fonte certa", () => {
    expect(outputToSource(segments, 5)).toEqual({ sourceId: "src_01", seconds: 5 });
    expect(outputToSource(segments, 12)).toEqual({ sourceId: "src_02", seconds: 7 });
  });
  it("retorna null além do fim", () => {
    expect(outputToSource(segments, 20)).toBeNull();
  });
});

describe("sourceToOutput", () => {
  it("considera o sourceId", () => {
    expect(sourceToOutput(segments, "src_01", 5)).toBe(5);
    expect(sourceToOutput(segments, "src_02", 7)).toBe(12);
    // 7s existe em src_01 (0-10) mas não como tempo de src_02 fora de 5-15
    expect(sourceToOutput(segments, "src_02", 3)).toBeNull();
  });
  it("retorna null em trecho cortado", () => {
    expect(sourceToOutput(segments, "src_01", 12)).toBeNull();
  });
});

describe("applyCutToSegments", () => {
  it("corta apenas segmentos da fonte alvo", () => {
    const result = applyCutToSegments(segments, "src_01", 3, 5);
    expect(result).toEqual([
      { id: "a", sourceId: "src_01", sourceStart: 0, sourceEnd: 3 },
      { id: "ab", sourceId: "src_01", sourceStart: 5, sourceEnd: 10 },
      { id: "b", sourceId: "src_02", sourceStart: 5, sourceEnd: 15 },
    ]);
  });

  it("não toca fontes diferentes mesmo com faixa sobreposta", () => {
    const result = applyCutToSegments(segments, "src_02", 6, 8);
    expect(result[0]).toEqual(segments[0]);
    expect(result).toHaveLength(3);
  });

  it("remove segmento engolido e mantém id na sobra direita", () => {
    const swallowed = applyCutToSegments(segments, "src_01", 0, 11);
    expect(swallowed).toEqual([segments[1]]);
    const rightOnly = applyCutToSegments(segments, "src_01", 0, 5);
    expect(rightOnly[0]).toEqual({
      id: "a",
      sourceId: "src_01",
      sourceStart: 5,
      sourceEnd: 10,
    });
  });
});

describe("ids de segmento", () => {
  it("cortes repetidos no mesmo segmento não geram ids duplicados", () => {
    const one: Segment[] = [{ id: "seg_01", sourceId: "src_01", sourceStart: 0, sourceEnd: 10 }];
    let r = applyCutToSegments(one, "src_01", 6, 7);
    r = applyCutToSegments(r, "src_01", 2, 3);
    r = applyCutToSegments(r, "src_01", 8, 9);
    const ids = r.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.length <= "seg_01b99".length)).toBe(true);
  });
});

describe("restoreSourceRange", () => {
  const base: Segment[] = [{ id: "seg_01", sourceId: "src_01", sourceStart: 0, sourceEnd: 10 }];

  it("desfaz um corte e funde de volta num segmento só", () => {
    const cut = applyCutToSegments(base, "src_01", 3, 5);
    expect(restoreSourceRange(cut, "src_01", 3, 5)).toEqual(base);
  });

  it("restaura só parte do corte, na posição certa", () => {
    const cut = applyCutToSegments(base, "src_01", 3, 7);
    const r = restoreSourceRange(cut, "src_01", 3, 4);
    expect(r.map((s) => [s.sourceStart, s.sourceEnd])).toEqual([
      [0, 4],
      [7, 10],
    ]);
  });

  it("fecha buracos minúsculos ao fundir", () => {
    const cut = applyCutToSegments(base, "src_01", 3, 5);
    const r = restoreSourceRange(cut, "src_01", 3.02, 5);
    expect(r).toEqual(base);
  });

  it("restaura trecho do começo do clipe antes do primeiro segmento", () => {
    const cut = applyCutToSegments(base, "src_01", 0, 2);
    expect(restoreSourceRange(cut, "src_01", 0, 2)).toEqual(base);
  });

  it("não mexe em outras fontes", () => {
    const r = restoreSourceRange(segments, "src_02", 15, 18);
    expect(r[0]).toEqual(segments[0]);
    expect(r[1]).toMatchObject({ sourceId: "src_02", sourceStart: 5, sourceEnd: 18 });
  });
});

describe("insertClipSegment", () => {
  const clip: Segment = { id: "clip", sourceId: "src_new", sourceStart: 0, sourceEnd: 3 };

  it("divide o segmento e insere o clipe no meio", () => {
    // 12s cai 2s dentro do segmento b (10s..20s), fonte src_02 em 5+2=7
    expect(insertClipSegment(segments, clip, 12)).toEqual([
      { id: "a", sourceId: "src_01", sourceStart: 0, sourceEnd: 10 },
      { id: "b", sourceId: "src_02", sourceStart: 5, sourceEnd: 7 },
      clip,
      { id: "bb", sourceId: "src_02", sourceStart: 7, sourceEnd: 15 },
    ]);
  });

  it("insere na borda entre segmentos sem dividir", () => {
    expect(insertClipSegment(segments, clip, 10)).toEqual([segments[0], clip, segments[1]]);
  });

  it("insere no início quando at = 0", () => {
    expect(insertClipSegment(segments, clip, 0)).toEqual([clip, ...segments]);
  });

  it("anexa no fim quando at >= duração", () => {
    expect(insertClipSegment(segments, clip, 20)).toEqual([...segments, clip]);
    expect(insertClipSegment(segments, clip, 999)).toEqual([...segments, clip]);
  });
});
