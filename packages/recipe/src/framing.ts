import { z } from "zod";
import type { Overlay, Recipe } from "./schema";
import { outputDuration } from "./time";

/**
 * Enquadramento de um vídeo/imagem dentro da área que ele ocupa (tela cheia,
 * metade do split, janela do PiP): que parte aparece quando a mídia é cortada
 * para caber (object-fit cover) e quanto aproxima. Vale para clipe adicionado
 * (overlay) e para o vídeo principal (por fonte).
 */
export const FramingSchema = z.object({
  /** 0 = mostra a borda esquerda · 50 = centro · 100 = a direita */
  x: z.number().min(0).max(100).default(50),
  /** 0 = mostra o topo · 50 = centro · 100 = a base (subir/descer o vídeo) */
  y: z.number().min(0).max(100).default(50),
  /** Aproximação dentro da área (1 = sem zoom) */
  zoom: z.number().min(1).max(3).default(1),
});

export type Framing = z.infer<typeof FramingSchema>;

export const NEUTRAL_FRAMING: Framing = { x: 50, y: 50, zoom: 1 };

export function isNeutralFraming(f: Framing | null | undefined): boolean {
  return !f || (Math.abs(f.x - 50) < 0.05 && Math.abs(f.y - 50) < 0.05 && Math.abs(f.zoom - 1) < 0.005);
}

/** Estilo CSS do enquadramento para mídia com object-fit cover */
export function framingStyle(f: Framing | null | undefined): {
  objectPosition: string;
  transform?: string;
  transformOrigin: string;
} {
  const g = f ?? NEUTRAL_FRAMING;
  const at = `${g.x}% ${g.y}%`;
  return { objectPosition: at, transform: g.zoom > 1.0005 ? `scale(${g.zoom})` : undefined, transformOrigin: at };
}

export const SPLIT_LAYOUTS = ["split-bottom", "split-top"] as const;

export function isSplitLayout(layout: Overlay["layout"]): boolean {
  return (SPLIT_LAYOUTS as readonly string[]).includes(layout);
}

/**
 * Split ativo no instante `t` do vídeo final. Durante ele o vídeo principal
 * ocupa só a outra metade (e o enquadramento dele escolhe o que aparece).
 * O último da lista vence se houver dois.
 */
export function activeSplitAt(recipe: Recipe, t: number): { overlay: Overlay; mainHalf: "top" | "bottom" } | null {
  const total = outputDuration(recipe.timeline.segments);
  let hit: Overlay | null = null;
  for (const o of recipe.overlays) {
    if (o.kind === "title" || !isSplitLayout(o.layout)) continue;
    if (t >= o.start && t < (o.end ?? total)) hit = o;
  }
  if (!hit) return null;
  return { overlay: hit, mainHalf: hit.layout === "split-top" ? "bottom" : "top" };
}
