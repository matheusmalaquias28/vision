import type { Segment } from "./schema";
import { segmentDuration } from "./time";

/**
 * Transições rápidas: 5 modelos escolhidos da biblioteca (pack-viral), todos
 * com até 1,3 s. O motion guarda só o modelo; arquivo, mescla e som vêm daqui.
 * Sem a biblioteca na máquina, o render pula a transição (não quebra) e o
 * planner não oferece o tipo.
 */
export const TRANSITION_STYLES = ["flare", "burn", "glitch", "swipe", "paper"] as const;
export type TransitionStyle = (typeof TRANSITION_STYLES)[number];

export interface TransitionPreset {
  label: string;
  /** Quando usar (vai para a IA e para o painel) */
  use: string;
  assetId: string;
  file: string;
  /** screen: some o preto e só a luz passa · normal: vídeo com transparência */
  blend: "screen" | "normal";
  alpha: boolean;
  /** Duração do arquivo (o motion dura isso) */
  seconds: number;
  /** Estilo do som (motionSfx) */
  sfx: string;
}

const DIR = "media/library/pack-viral/transition";

export const TRANSITION_PRESETS: Record<TransitionStyle, TransitionPreset> = {
  flare: {
    label: "Luz",
    use: "luz quente rápida: leve e positiva, combina com quase tudo",
    assetId: "transition_lut-15",
    file: `${DIR}/transition_lut-15.mp4`,
    blend: "screen",
    alpha: false,
    seconds: 0.67,
    sfx: "whooshSoft",
  },
  burn: {
    label: "Queima de filme",
    use: "analógico, nostálgico: virada na história",
    assetId: "transition_burn-transition-01",
    file: `${DIR}/transition_burn-transition-01.mp4`,
    blend: "screen",
    alpha: false,
    seconds: 0.91,
    sfx: "whooshFast",
  },
  glitch: {
    label: "Glitch",
    use: "digital: tecnologia ou quebra de expectativa (“mas espera…”)",
    assetId: "transition_glitch-transition-05",
    file: `${DIR}/transition_glitch-transition-05.mp4`,
    blend: "screen",
    alpha: false,
    seconds: 1.07,
    sfx: "glitch",
  },
  swipe: {
    label: "Varrida de luz",
    use: "energia: passar para a próxima parte ou para o CTA",
    assetId: "transition_10",
    file: `${DIR}/transition_10.mp4`,
    blend: "screen",
    alpha: false,
    seconds: 1,
    sfx: "whooshFast",
  },
  paper: {
    label: "Papel",
    use: "didático, caderno: combina com a tela cheia de papel",
    assetId: "transition_paper-transition-green-screen",
    file: `${DIR}/transition_paper-transition-green-screen.webm`,
    blend: "normal",
    alpha: true,
    seconds: 1.27,
    sfx: "paper",
  },
};

/** No máximo 3 por vídeo, bem espaçadas, longe do começo e do fim */
export const MAX_TRANSITIONS = 3;
export const TRANSITION_GAP_SECONDS = 10;
export const TRANSITION_EDGE_SECONDS = 1.5;
/** Até onde a transição pode "andar" da palavra escolhida até um corte */
export const TRANSITION_SNAP_SECONDS = 1.5;

/** Instantes de corte no vídeo final (fronteiras entre trechos, sem o 0) */
function cutsOf(segments: Segment[]): number[] {
  const out: number[] = [];
  let acc = 0;
  segments.forEach((s, i) => {
    if (i > 0) out.push(acc);
    acc += segmentDuration(s);
  });
  return out;
}

/**
 * Transição só em corte (fronteira real entre trechos): leva o instante pedido
 * ao corte mais próximo e centraliza a transição nele. null = nenhum corte perto.
 */
export function snapToCut(segments: Segment[], at: number, duration: number, tolerance = TRANSITION_SNAP_SECONDS): number | null {
  let best: number | null = null;
  for (const c of cutsOf(segments)) {
    if (Math.abs(c - at) <= tolerance && (best === null || Math.abs(c - at) < Math.abs(best - at))) best = c;
  }
  return best === null ? null : Math.max(0, Math.round((best - duration / 2) * 1000) / 1000);
}
