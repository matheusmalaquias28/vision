import { MOTION_REGISTRY } from "./motionRegistry";
import type { Motion, Point, Recipe } from "./schema";

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

/** Motion com tamanho ajustável: texto e elementos (câmera e tela cheia ocupam o quadro todo) */
export function motionResizable(m: Pick<Motion, "kind">): boolean {
  const layer = MOTION_REGISTRY[m.kind].layer;
  return layer === "text" || layer === "element";
}

/** O alvo tem tamanho ajustável (legenda, texto livre, sticker, motion de texto/elemento) */
export function canResize(recipe: Recipe, target: string): boolean {
  if (target === "caption") return true;
  const [kind, id] = splitTarget(target);
  if (kind === "overlay") {
    const o = recipe.overlays.find((x) => x.id === id);
    return o?.kind === "title" || o?.layout === "sticker";
  }
  if (kind === "motion") {
    const m = recipe.motions.find((x) => x.id === id);
    return !!m && motionResizable(m);
  }
  return false;
}

/**
 * Multiplica o tamanho do alvo por `factor` (alça do preview): fonte da legenda
 * e do texto livre, largura do sticker, `size` do motion. Cada campo fica nos
 * limites do schema; mexer num motion sugerido conta como aceitá-lo.
 */
export function resizeTarget(recipe: Recipe, target: string, factor: number): Recipe {
  if (!canResize(recipe, target) || !(factor > 0)) return recipe;
  const lim = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
  if (target === "caption") {
    const style = recipe.captions.style;
    const fontSizePx = Math.round(lim(style.fontSizePx * factor, 16, 220));
    return { ...recipe, captions: { ...recipe.captions, style: { ...style, fontSizePx } } };
  }
  const [kind, id] = splitTarget(target);
  if (kind === "overlay") {
    return {
      ...recipe,
      overlays: recipe.overlays.map((o) => {
        if (o.id !== id) return o;
        if (o.kind === "title") {
          const fontSize = Math.round(lim(o.titleStyle.fontSize * factor, 16, 240));
          return { ...o, titleStyle: { ...o.titleStyle, fontSize } };
        }
        return { ...o, scale: Math.round(lim(o.scale * factor, 0.05, 1) * 100) / 100 };
      }),
    };
  }
  return {
    ...recipe,
    motions: recipe.motions.map((m) =>
      m.id === id
        ? {
            ...m,
            size: Math.round(lim(m.size * factor, 0.3, 3) * 100) / 100,
            status: m.status === "pending" ? "accepted" : m.status,
          }
        : m
    ),
  };
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
