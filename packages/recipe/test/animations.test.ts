import { describe, expect, it } from "vitest";
import { animAt, ease, fadeInGain, fadeOutGain } from "../src/animations";
import { applyCutToSegments } from "../src/time";
import type { ElementAnim, Segment } from "../src/schema";

const anim = (effect: ElementAnim["effect"], duration = 1, easing: ElementAnim["easing"] = "linear"): ElementAnim => ({
  effect,
  duration,
  easing,
});

describe("ease", () => {
  it("vai de 0 a 1 e respeita a forma da curva", () => {
    for (const c of ["linear", "ease-in", "ease-out", "ease-in-out"] as const) {
      expect(ease(c, 0)).toBe(0);
      expect(ease(c, 1)).toBe(1);
    }
    expect(ease("ease-in", 0.5)).toBeLessThan(0.5);
    expect(ease("ease-out", 0.5)).toBeGreaterThan(0.5);
    expect(ease("ease-in-out", 0.5)).toBeCloseTo(0.5);
  });
});

describe("animAt", () => {
  it("sem efeito fora da entrada e da saída", () => {
    expect(animAt(anim("fade"), anim("fade"), 2, 5)).toBeNull();
    expect(animAt(null, null, 0, 5)).toBeNull();
  });

  it("fade de entrada e de saída", () => {
    expect(animAt(anim("fade"), null, 0.5, 5)?.opacity).toBeCloseTo(0.5);
    expect(animAt(null, anim("fade"), 4.75, 5)?.opacity).toBeCloseTo(0.25);
  });

  it("slide-up entra de baixo e sai por cima", () => {
    expect(animAt(anim("slide-up"), null, 0, 5)?.transform).toBe("translateY(100%)");
    expect(animAt(null, anim("slide-up"), 5, 5)?.transform).toBe("translateY(-100%)");
  });

  it("wipe revela da esquerda para a direita", () => {
    expect(animAt(anim("wipe"), null, 0.25, 5)?.clipPath).toBe("inset(0 75% 0 0)");
  });

  it("entrada + saída maiores que o elemento dividem o tempo dele", () => {
    // 2 s + 2 s num elemento de 2 s: cada um fica com 1 s
    expect(animAt(anim("fade", 2), anim("fade", 2), 0.5, 2)?.opacity).toBeCloseTo(0.5);
    expect(animAt(anim("fade", 2), anim("fade", 2), 1.5, 2)?.opacity).toBeCloseTo(0.5);
  });
});

describe("fades de áudio", () => {
  it("linear é o fade de sempre; ease-in demora a mudar nas duas pontas", () => {
    expect(fadeInGain("linear", 0.5, 1)).toBeCloseTo(0.5);
    expect(fadeOutGain("linear", 0.25, 1)).toBeCloseTo(0.25);
    // entrada ease-in: ainda baixo no meio; saída ease-in: ainda alto no meio
    expect(fadeInGain("ease-in", 0.5, 1)).toBeLessThan(0.5);
    expect(fadeOutGain("ease-in", 0.5, 1)).toBeGreaterThan(0.5);
    expect(fadeOutGain("ease-out", 1, 1)).toBe(1);
    expect(fadeOutGain("ease-out", 0, 1)).toBe(0);
    expect(fadeInGain("linear", 3, 0)).toBe(1);
  });
});

describe("entrada/saída do trecho nos cortes", () => {
  const seg: Segment = {
    id: "s1",
    sourceId: "src",
    sourceStart: 0,
    sourceEnd: 10,
    enter: anim("fade"),
    exit: anim("blur"),
  };
  it("corte no meio: entrada no pedaço da esquerda, saída no da direita", () => {
    const [left, right] = applyCutToSegments([seg], "src", 4, 5);
    expect([left.enter?.effect, left.exit?.effect]).toEqual(["fade", undefined]);
    expect([right.enter?.effect, right.exit?.effect]).toEqual([undefined, "blur"]);
  });
  it("corte que come o começo: a sobra é o trecho inteiro e fica com as duas", () => {
    const [rest] = applyCutToSegments([seg], "src", 0, 2);
    expect([rest.enter?.effect, rest.exit?.effect]).toEqual(["fade", "blur"]);
  });
});
