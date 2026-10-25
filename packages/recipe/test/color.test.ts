import { describe, expect, it } from "vitest";
import {
  autoGradeFromStats,
  COLOR_PRESETS,
  ColorGradeSchema,
  colorFilterCss,
  isNeutralGrade,
  NEUTRAL_GRADE,
  temperatureLayer,
} from "../src/color";
import { parseRecipe } from "../src/schema";

/** O que o CSS faz com a luma: brightness → contrast (saturate não mexe na luma) */
const cssLuma = (y: number, g: { exposure: number; contrast: number }) => (y * g.exposure - 0.5) * g.contrast + 0.5;

describe("ajuste de cor", () => {
  it("projeto antigo abre sem ajuste; campos faltando viram neutros", () => {
    const r = parseRecipe({
      version: 2,
      projectId: "t",
      createdAt: "2026-10-01T00:00:00Z",
      sources: [{ id: "src_01", file: "media/a.mp4", durationInSeconds: 10, width: 1080, height: 1920, fps: 30 }],
      timeline: { segments: [{ id: "seg_01", sourceId: "src_01", sourceStart: 0, sourceEnd: 10 }] },
      captions: { blocks: [] },
      render: { width: 1080, height: 1920, fps: 30 },
    });
    expect(r.sources[0].color).toBeNull();
    expect(ColorGradeSchema.parse({ contrast: 1.4 })).toEqual({ ...NEUTRAL_GRADE, contrast: 1.4 });
    expect(ColorGradeSchema.safeParse({ contrast: 9 }).success).toBe(false);
  });

  it("filtro CSS só com o que mudou, na ordem brilho → contraste → saturação", () => {
    expect(colorFilterCss(null)).toBeUndefined();
    expect(colorFilterCss(NEUTRAL_GRADE)).toBeUndefined();
    expect(colorFilterCss({ ...NEUTRAL_GRADE, saturation: 1.5, exposure: 1.2 })).toBe("brightness(1.2) saturate(1.5)");
    expect(colorFilterCss({ exposure: 1.1, contrast: 1.6, saturation: 1.8, temperature: 0.3 })).toBe(
      "brightness(1.1) contrast(1.6) saturate(1.8)"
    );
  });

  it("temperatura vira camada laranja (quente) ou azul (frio)", () => {
    expect(temperatureLayer(NEUTRAL_GRADE)).toBeNull();
    expect(temperatureLayer({ ...NEUTRAL_GRADE, temperature: 0.4 })).toEqual({ color: "rgb(255, 136, 32)", opacity: 0.2 });
    expect(temperatureLayer({ ...NEUTRAL_GRADE, temperature: -1 })?.color).toBe("rgb(40, 130, 255)");
    expect(isNeutralGrade({ ...NEUTRAL_GRADE, temperature: 0.2 })).toBe(false);
  });

  it("automático corrige vídeo LOG (medidas reais de um clipe 4K flat)", () => {
    const g = autoGradeFromStats({ yLow: 0.227, yHigh: 0.455, satAvg: 3.99 });
    expect(g.contrast).toBeGreaterThan(1.5);
    expect(g.saturation).toBeGreaterThan(1.6);
    expect(g.temperature).toBe(0);
    // escuros descem, claros sobem: a faixa 10–90% quase dobra
    expect(cssLuma(0.227, g)).toBeLessThan(0.16);
    expect(cssLuma(0.455, g)).toBeGreaterThan(0.6);
    expect(ColorGradeSchema.safeParse(g).success).toBe(true);
  });

  it("vídeo normal de celular com fundo claro quase não muda (medidas reais)", () => {
    const g = autoGradeFromStats({ yLow: 0.306, yHigh: 0.785, satAvg: 14.3 });
    expect(g.exposure).toBeGreaterThan(0.9);
    expect(g.contrast).toBeLessThan(1.3);
    expect(g.saturation).toBeLessThan(1.15);
    // o meio-tom claro continua claro
    expect(cssLuma(0.545, g)).toBeGreaterThan(0.5);
  });

  it("bem exposto fica neutro; nunca achata contraste; limites seguram extremos", () => {
    const ok = autoGradeFromStats({ yLow: 0.17, yHigh: 0.73, satAvg: 18 });
    for (const v of [ok.exposure, ok.contrast, ok.saturation]) expect(v).toBeCloseTo(1, 1);
    const contrasty = autoGradeFromStats({ yLow: 0.02, yHigh: 0.98, satAvg: 60 });
    expect(contrasty.exposure * contrasty.contrast).toBeGreaterThanOrEqual(0.99);
    expect(contrasty.saturation).toBe(1);
    expect(ColorGradeSchema.safeParse(autoGradeFromStats({ yLow: 0.5, yHigh: 0.5, satAvg: 0 })).success).toBe(true);
  });

  it("predefinições são válidas", () => {
    for (const p of Object.values(COLOR_PRESETS)) expect(ColorGradeSchema.parse(p.grade)).toEqual(p.grade);
  });
});
