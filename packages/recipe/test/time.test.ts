import { describe, expect, it } from "vitest";
import {
  applyCutToSegments,
  outputDuration,
  outputToSource,
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
