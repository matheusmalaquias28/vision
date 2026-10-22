import type { Point, Recipe } from "./schema";

/**
 * Alvos que o operador arrasta no preview: "caption" (todas as legendas),
 * "overlay:<id>" e "motion:<id>". Os mesmos ids marcam os elementos no
 * render (atributo data-vision-drag).
 */
export type DragTarget = "caption" | `overlay:${string}` | `motion:${string}`;

/** Posição atual do alvo (null = posição padrão do layout) */
export function getPlacement(recipe: Recipe, target: string): Point | null {
  if (target === "caption") return recipe.captions.style.placement;
  const [kind, id] = splitTarget(target);
  if (kind === "overlay") return recipe.overlays.find((o) => o.id === id)?.placement ?? null;
  if (kind === "motion") return recipe.motions.find((m) => m.id === id)?.placement ?? null;
  return null;
}

/**
 * Grava a posição livre do alvo (null volta à posição padrão). Mexer num
 * motion sugerido conta como aceitá-lo, como editar no painel.
 */
export function setPlacement(recipe: Recipe, target: string, point: Point | null): Recipe {
  const at = point ? { x: round1(clamp(point.x)), y: round1(clamp(point.y)) } : null;
  if (target === "caption") {
    return {
      ...recipe,
      captions: { ...recipe.captions, style: { ...recipe.captions.style, placement: at } },
    };
  }
  const [kind, id] = splitTarget(target);
  if (kind === "overlay") {
    return {
      ...recipe,
      overlays: recipe.overlays.map((o) => (o.id === id ? { ...o, placement: at } : o)),
    };
  }
  if (kind === "motion") {
    return {
      ...recipe,
      motions: recipe.motions.map((m) =>
        m.id === id
          ? { ...m, placement: at, status: m.status === "pending" ? "accepted" : m.status }
          : m
      ),
    };
  }
  return recipe;
}

function splitTarget(target: string): [string, string] {
  const i = target.indexOf(":");
  return i < 0 ? [target, ""] : [target.slice(0, i), target.slice(i + 1)];
}

function clamp(v: number): number {
  return Math.min(100, Math.max(0, v));
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
