import type { AnimEffect, Easing, ElementAnim, Segment } from "./schema";

/**
 * Entradas/saídas padronizadas dos elementos (trecho de vídeo, overlay,
 * texto) e curvas dos fades de áudio. Tudo é função do tempo: o render e o
 * preview calculam o mesmo quadro.
 */

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** Progresso 0→1 pela curva (ease-in: começa devagar; ease-out: termina devagar) */
export function ease(curve: Easing, t: number): number {
  const x = clamp01(t);
  switch (curve) {
    case "linear":
      return x;
    case "ease-in":
      return x * x * x;
    case "ease-out":
      return 1 - (1 - x) ** 3;
    case "ease-in-out":
      return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
  }
}

/** Passa um pouco do fim e volta (quique do pop) */
function backOut(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = clamp01(t) - 1;
  return 1 + c3 * x * x * x + c1 * x * x;
}

/** CSS de um quadro da animação; propriedades vazias = sem efeito */
export interface AnimCss {
  opacity: number;
  transform: string;
  filter: string;
  clipPath: string;
}

const NONE: AnimCss = { opacity: 1, transform: "", filter: "", clipPath: "" };

/**
 * Aparência com visibilidade `v` (0 = fora, 1 = no lugar). Na saída o
 * movimento segue a direção do nome: slide-up entra subindo e sai subindo.
 */
function effectCss(effect: AnimEffect, v: number, phase: "enter" | "exit"): AnimCss {
  const out = 1 - v;
  const sign = phase === "enter" ? 1 : -1;
  // deslizar: a opacidade chega a 1 na metade do caminho (sem "piscar" no fim)
  const slideOpacity = Math.min(1, v * 2);
  switch (effect) {
    case "fade":
      return { ...NONE, opacity: v };
    case "slide-up":
      return { ...NONE, opacity: slideOpacity, transform: `translateY(${sign * out * 100}%)` };
    case "slide-down":
      return { ...NONE, opacity: slideOpacity, transform: `translateY(${-sign * out * 100}%)` };
    case "slide-left":
      return { ...NONE, opacity: slideOpacity, transform: `translateX(${sign * out * 100}%)` };
    case "slide-right":
      return { ...NONE, opacity: slideOpacity, transform: `translateX(${-sign * out * 100}%)` };
    case "zoom-in":
      // entra crescendo até o tamanho; sai crescendo além dele
      return { ...NONE, opacity: v, transform: `scale(${phase === "enter" ? 0.6 + 0.4 * v : 1 + 0.4 * out})` };
    case "zoom-out":
      // entra encolhendo até o tamanho; sai encolhendo
      return { ...NONE, opacity: v, transform: `scale(${phase === "enter" ? 1.4 - 0.4 * v : 0.6 + 0.4 * v})` };
    case "blur":
      return { ...NONE, opacity: v, filter: `blur(${out * 24}px)` };
    case "pop":
      return { ...NONE, opacity: Math.min(1, v * 3), transform: `scale(${0.3 + 0.7 * backOut(v)})` };
    case "wipe":
      // revela da esquerda para a direita; sai escondendo na mesma direção
      return {
        ...NONE,
        clipPath: phase === "enter" ? `inset(0 ${out * 100}% 0 0)` : `inset(0 0 0 ${out * 100}%)`,
      };
  }
}

/**
 * Efeito no instante `t` (segundos desde o início do elemento) de um elemento
 * de `total` segundos. null = fora da entrada e da saída (aparência normal).
 * Entrada + saída mais longas que o elemento dividem o tempo dele na proporção.
 */
export function animAt(
  enter: ElementAnim | null | undefined,
  exit: ElementAnim | null | undefined,
  t: number,
  total: number
): AnimCss | null {
  let inDur = enter?.duration ?? 0;
  let outDur = exit?.duration ?? 0;
  if (total <= 0) return null;
  if (inDur + outDur > total) {
    const k = total / (inDur + outDur);
    inDur *= k;
    outDur *= k;
  }
  if (enter && inDur > 0 && t < inDur) {
    const raw = t / inDur;
    // o pop tem a própria curva (quique); os outros seguem a escolhida
    const v = enter.effect === "pop" ? raw : ease(enter.easing, raw);
    return effectCss(enter.effect, clamp01(v), "enter");
  }
  if (exit && outDur > 0 && t > total - outDur) {
    const raw = (t - (total - outDur)) / outDur;
    const v = exit.effect === "pop" ? 1 - raw : 1 - ease(exit.easing, raw);
    return effectCss(exit.effect, clamp01(v), "exit");
  }
  return null;
}

/** Ganho do fade de entrada do áudio: 0→1 em `seconds`, pela curva */
export function fadeInGain(curve: Easing, elapsed: number, seconds: number): number {
  if (seconds <= 0) return 1;
  return ease(curve, elapsed / seconds);
}

/**
 * Ganho do fade de saída: 1→0 nos últimos `seconds`; `remaining` = quanto
 * falta para o fim. A curva vale para o movimento (ease-in: demora a baixar).
 */
export function fadeOutGain(curve: Easing, remaining: number, seconds: number): number {
  if (seconds <= 0) return 1;
  return 1 - ease(curve, 1 - remaining / seconds);
}

/** Pedaço da esquerda de um trecho dividido: fica com a entrada, perde a saída */
export function segmentHead(s: Segment): Segment {
  if (s.exit == null) return s;
  const { exit: _exit, ...rest } = s;
  return rest;
}

/** Pedaço da direita de um trecho dividido: fica com a saída, perde a entrada */
export function segmentTail(s: Segment): Segment {
  if (s.enter == null) return s;
  const { enter: _enter, ...rest } = s;
  return rest;
}

/** Nomes no editor */
export const ANIM_LABEL: Record<AnimEffect, string> = {
  fade: "Fade",
  "slide-up": "Deslizar ↑",
  "slide-down": "Deslizar ↓",
  "slide-left": "Deslizar ←",
  "slide-right": "Deslizar →",
  "zoom-in": "Zoom crescendo",
  "zoom-out": "Zoom encolhendo",
  blur: "Desfoque",
  pop: "Pop (quique)",
  wipe: "Revelar (wipe)",
};

export const EASING_LABEL: Record<Easing, string> = {
  linear: "Linear",
  "ease-in": "Ease in",
  "ease-out": "Ease out",
  "ease-in-out": "Ease in-out",
};
