import { z } from "zod";

/**
 * Ajuste de cor de um vídeo bruto (correção de LOG/flat, exposição, cor).
 * Vira filtro CSS no render (`brightness → contrast → saturate`) mais uma
 * camada de temperatura: o mesmo Chrome desenha o preview e o MP4.
 */
export const ColorGradeSchema = z.object({
  /** Brilho multiplicado (1 = original) */
  exposure: z.number().min(0.3).max(2).default(1),
  /** Contraste em torno do cinza médio (1 = original) */
  contrast: z.number().min(0.3).max(2.5).default(1),
  /** Saturação (1 = original, 0 = preto e branco) */
  saturation: z.number().min(0).max(3).default(1),
  /** Temperatura: -1 frio … 0 original … 1 quente */
  temperature: z.number().min(-1).max(1).default(0),
});

export type ColorGrade = z.infer<typeof ColorGradeSchema>;

export const NEUTRAL_GRADE: ColorGrade = { exposure: 1, contrast: 1, saturation: 1, temperature: 0 };

export function isNeutralGrade(g: ColorGrade | null | undefined): boolean {
  return (
    !g ||
    (Math.abs(g.exposure - 1) < 0.005 &&
      Math.abs(g.contrast - 1) < 0.005 &&
      Math.abs(g.saturation - 1) < 0.005 &&
      Math.abs(g.temperature) < 0.005)
  );
}

export type ColorPresetId = "original" | "log" | "vivid" | "soft";

/** Pontos de partida do painel (o operador ajusta depois) */
export const COLOR_PRESETS: Record<ColorPresetId, { label: string; hint: string; grade: ColorGrade }> = {
  original: { label: "Original", hint: "Sem ajuste", grade: NEUTRAL_GRADE },
  log: {
    label: "Câmera LOG",
    hint: "Vídeo gravado em perfil LOG/flat (acinzentado, sem cor)",
    grade: { exposure: 1.2, contrast: 1.7, saturation: 2, temperature: 0 },
  },
  vivid: {
    label: "Mais vivo",
    hint: "Vídeo normal um pouco apagado",
    grade: { exposure: 1, contrast: 1.12, saturation: 1.25, temperature: 0 },
  },
  soft: {
    label: "Suave",
    hint: "Menos contraste e cor, visual mais leve",
    grade: { exposure: 1.04, contrast: 0.92, saturation: 0.85, temperature: 0.1 },
  },
};

const r2 = (v: number) => Math.round(v * 100) / 100;
const fmt = (v: number) => String(r2(v));

/** Filtro CSS do vídeo; undefined = sem ajuste (nem cria camada de filtro) */
export function colorFilterCss(g: ColorGrade | null | undefined): string | undefined {
  if (!g || isNeutralGrade(g)) return undefined;
  const parts: string[] = [];
  if (Math.abs(g.exposure - 1) >= 0.005) parts.push(`brightness(${fmt(g.exposure)})`);
  if (Math.abs(g.contrast - 1) >= 0.005) parts.push(`contrast(${fmt(g.contrast)})`);
  if (Math.abs(g.saturation - 1) >= 0.005) parts.push(`saturate(${fmt(g.saturation)})`);
  return parts.length ? parts.join(" ") : undefined;
}

/**
 * Temperatura como camada de cor em "soft-light" sobre o vídeo (laranja
 * esquenta, azul esfria). null = sem camada.
 */
export function temperatureLayer(g: ColorGrade | null | undefined): { color: string; opacity: number } | null {
  if (!g || Math.abs(g.temperature) < 0.005) return null;
  return {
    color: g.temperature > 0 ? "rgb(255, 136, 32)" : "rgb(40, 130, 255)",
    opacity: r2(Math.abs(g.temperature) * 0.5),
  };
}

/** Medidas do vídeo (ffmpeg signalstats), luma já normalizada para 0–1 da tela */
export interface ColorStats {
  /** 10º percentil da luma */
  yLow: number;
  /** 90º percentil da luma */
  yHigh: number;
  /** Saturação média em unidades de 8 bits (0–~181) */
  satAvg: number;
}

/** Faixa entre os percentis 10 e 90 num vídeo bem exposto (pessoa falando) */
const TARGET_SPREAD = 0.56;
/** Meio-tom alvo e quanto o automático puxa o meio-tom até ele (0–1) */
const TARGET_MID = 0.45;
const MID_PULL = 0.3;
const TARGET_SAT = 16;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Ajuste automático a partir das medidas. Conservador: só estica o
 * contraste quando a imagem está achatada (LOG/flat; nunca achata o que já
 * tem contraste nem tira cor), puxa o meio-tom só um pouco (fundo claro de propósito não
 * vira cinza) e compensa a saturação. Em CSS a luma sai
 * (in·exposure − 0,5)·contraste + 0,5: inclinação k = exposure·contraste.
 * Temperatura fica com o operador (cena quente de propósito engana o automático).
 */
export function autoGradeFromStats(s: ColorStats): ColorGrade {
  const spread = Math.max(0.02, s.yHigh - s.yLow);
  const k = clamp(TARGET_SPREAD / spread, 1, 2.2);
  const mid = (s.yLow + s.yHigh) / 2;
  const targetMid = mid + (TARGET_MID - mid) * MID_PULL;
  // (y − mid)·k + targetMid  ≡  y·k − (0,5·contraste − 0,5)
  const contrast = clamp(1 - 2 * targetMid + 2 * mid * k, 0.5, 2.5);
  const exposure = clamp(k / contrast, 0.5, 2);
  // brilho e contraste também multiplicam o croma por k
  const saturation = clamp(TARGET_SAT / Math.max(0.5, s.satAvg * k), 1, 2.2);
  return { exposure: r2(exposure), contrast: r2(contrast), saturation: r2(saturation), temperature: 0 };
}
