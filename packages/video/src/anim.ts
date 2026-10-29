import type React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { animAt, type AnimCss, type ElementAnim } from "@vision/recipe";

/**
 * Entrada/saída do elemento no quadro atual. Dentro de uma <Sequence>, o
 * frame e a duração são os dela: o efeito vale para o elemento, não para o vídeo.
 */
export function useElementAnim(
  enter: ElementAnim | null | undefined,
  exit: ElementAnim | null | undefined
): AnimCss | null {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  if (!enter && !exit) return null;
  return animAt(enter, exit, frame / fps, durationInFrames / fps);
}

/**
 * Junta o efeito ao estilo do próprio elemento: o movimento do efeito vem
 * por fora do transform que ele já tem, a opacidade multiplica.
 */
export function withAnim(style: React.CSSProperties, a: AnimCss | null): React.CSSProperties {
  if (!a) return style;
  const transform = [a.transform, style.transform].filter(Boolean).join(" ");
  const filter = [style.filter, a.filter].filter(Boolean).join(" ");
  return {
    ...style,
    opacity: (style.opacity === undefined ? 1 : Number(style.opacity)) * a.opacity,
    transform: transform || undefined,
    filter: filter || undefined,
    clipPath: a.clipPath || style.clipPath,
  };
}
