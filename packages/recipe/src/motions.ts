import type { Motion, MotionKind, Recipe, Segment } from "./schema";
import { outputDuration, outputToSource, sourceToOutput } from "./time";

export const MOTION_LABEL: Record<MotionKind, string> = {
  zoom: "Zoom",
  keyword: "Palavra-chave",
  emoji: "Emoji",
  lowerThird: "Nome/cargo",
  counter: "Número",
  flash: "Flash",
};

/** Motion sem os campos que o merge/revisão controlam */
/** O que a IA propõe: posição livre é só do operador (arrastada no preview) */
export type MotionCandidate = Omit<Motion, "id" | "status" | "origin" | "placement">;

/** Motion posicionado no vídeo final */
export interface PlacedMotion {
  motion: Motion;
  outputStart: number;
  outputEnd: number;
}

/** Início no vídeo final (null = a âncora caiu num trecho cortado) */
export function motionOutputStart(segments: Segment[], m: Motion): number | null {
  return sourceToOutput(segments, m.sourceId, m.sourceTime);
}

/**
 * Motions que aparecem no vídeo: aceitos (e pendentes, se for prévia),
 * com a âncora presente no corte. Ordenados pelo início.
 */
export function placeMotions(recipe: Recipe, includePending: boolean): PlacedMotion[] {
  const placed: PlacedMotion[] = [];
  for (const motion of recipe.motions) {
    if (motion.status === "rejected") continue;
    if (motion.status === "pending" && !includePending) continue;
    const outputStart = motionOutputStart(recipe.timeline.segments, motion);
    if (outputStart === null) continue;
    placed.push({ motion, outputStart, outputEnd: outputStart + motion.durationSeconds });
  }
  return placed.sort((a, b) => a.outputStart - b.outputStart);
}

function clamp01(v: number): number {
  return Math.min(Math.max(v, 0), 1);
}

/** Curva suave 0→1 (ease-in-out) */
function smoothstep(v: number): number {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

/**
 * Escala do vídeo no instante `t` (tempo final) somando os zooms ativos.
 * punch: entra em 0.12s e sai em 0.2s · smooth: aproxima ao longo de 70% da
 * duração e volta no último 15%. Zooms sobrepostos: vale o maior.
 */
export function zoomScaleAt(placed: PlacedMotion[], t: number): number {
  let scale = 1;
  for (const { motion, outputStart, outputEnd } of placed) {
    if (motion.kind !== "zoom" || t < outputStart || t >= outputEnd) continue;
    const local = t - outputStart;
    const dur = outputEnd - outputStart;
    const { scale: target, style } = motion.params;
    let f: number;
    if (style === "punch") {
      const inT = Math.min(0.12, dur / 3);
      const outT = Math.min(0.2, dur / 3);
      f = Math.min(smoothstep(local / inT), smoothstep((dur - local) / outT));
    } else {
      f = Math.min(smoothstep(local / (dur * 0.7)), smoothstep((dur - local) / (dur * 0.15)));
    }
    scale = Math.max(scale, 1 + (target - 1) * f);
  }
  return scale;
}

/** Motions "de tela" que disputam o mesmo espaço visual */
const TEXT_KINDS: MotionKind[] = ["keyword", "lowerThird", "counter"];

/**
 * Substitui as sugestões PENDENTES da IA pelos candidatos. Motions manuais e
 * os já revisados ficam; candidatos a menos de 1s (no bruto) de um motion do
 * mesmo tipo já existente/rejeitado são descartados, assim como os ancorados
 * em trecho cortado e os de texto que sobrepõem outro de texto.
 */
export function mergeMotionSuggestions(recipe: Recipe, candidates: MotionCandidate[]): Recipe {
  const kept = recipe.motions.filter((m) => !(m.status === "pending" && m.origin === "ai"));
  const taken = new Set(kept.map((m) => m.id));
  let n = 0;
  const nextId = () => {
    let id: string;
    do id = `mo_${String(++n).padStart(2, "0")}`;
    while (taken.has(id));
    taken.add(id);
    return id;
  };

  const segments = recipe.timeline.segments;
  const all: Motion[] = [...kept];
  const placedText = () =>
    all
      .filter((m) => m.status !== "rejected" && TEXT_KINDS.includes(m.kind))
      .map((m) => ({ m, start: motionOutputStart(segments, m) }))
      .filter((x): x is { m: Motion; start: number } => x.start !== null);

  const sorted = [...candidates].sort(
    (a, b) => a.sourceId.localeCompare(b.sourceId) || a.sourceTime - b.sourceTime
  );
  for (const c of sorted) {
    const start = sourceToOutput(segments, c.sourceId, c.sourceTime);
    if (start === null) continue;
    const near = all.some(
      (m) =>
        m.kind === c.kind &&
        m.sourceId === c.sourceId &&
        Math.abs(m.sourceTime - c.sourceTime) < 1
    );
    if (near) continue;
    if (TEXT_KINDS.includes(c.kind)) {
      const end = start + c.durationSeconds;
      const clash = placedText().some(
        ({ m, start: s }) => s < end && start < s + m.durationSeconds
      );
      if (clash) continue;
    }
    all.push({ ...c, id: nextId(), status: "pending", origin: "ai", placement: null } as Motion);
  }
  return { ...recipe, motions: all };
}

export function reviewMotions(recipe: Recipe, ids: string[], accept: boolean): Recipe {
  const status = accept ? ("accepted" as const) : ("rejected" as const);
  return {
    ...recipe,
    motions: recipe.motions.map((m) =>
      ids.includes(m.id) && m.status === "pending" ? { ...m, status } : m
    ),
  };
}

export const MOTION_MIN_SECONDS = 0.1;
export const MOTION_MAX_SECONDS = 15;

/**
 * Reposiciona um motion arrastado na timeline: `outputStart` é o novo início
 * no vídeo final, convertido para a âncora no bruto (o motion continua
 * seguindo os cortes). Mexer numa sugestão conta como aceitá-la.
 */
export function retimeMotion(
  recipe: Recipe,
  id: string,
  outputStart: number,
  durationSeconds: number
): Recipe {
  const segments = recipe.timeline.segments;
  const total = outputDuration(segments);
  const start = Math.min(Math.max(outputStart, 0), Math.max(total - 0.05, 0));
  const anchor = outputToSource(segments, start);
  if (!anchor) return recipe;
  const duration = Math.min(Math.max(durationSeconds, MOTION_MIN_SECONDS), MOTION_MAX_SECONDS);
  return {
    ...recipe,
    motions: recipe.motions.map((m) =>
      m.id === id
        ? {
            ...m,
            sourceId: anchor.sourceId,
            sourceTime: Math.round(anchor.seconds * 1000) / 1000,
            durationSeconds: Math.round(duration * 100) / 100,
            status: m.status === "pending" ? "accepted" : m.status,
          }
        : m
    ),
  };
}

/** Texto curto para listas/timeline */
export function motionSummary(m: Motion): string {
  switch (m.kind) {
    case "zoom":
      return `${m.params.style === "punch" ? "punch" : "suave"} ${Math.round((m.params.scale - 1) * 100)}%`;
    case "keyword":
      return m.params.text;
    case "emoji":
      return m.params.emoji;
    case "lowerThird":
      return m.params.title;
    case "counter":
      return `${m.params.prefix}${m.params.to}${m.params.suffix}`;
    case "flash":
      return "";
  }
}
