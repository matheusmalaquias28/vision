import React from "react";
import { AbsoluteFill } from "remotion";
import type { Point } from "@vision/recipe";

/**
 * Atributo que marca o elemento visível de cada legenda/motion/overlay. O
 * editor procura esses elementos no DOM do Player para desenhar as alças de
 * arrastar; no render não tem efeito.
 * Valores: "caption", "motion:<id>", "overlay:<id>".
 */
export const DRAG_ATTR = "data-vision-drag";

export function dragProps(id: string): Record<string, string> {
  return { [DRAG_ATTR]: id };
}

/**
 * Centraliza o conteúdo em (x%, y%) do quadro: x pela largura, y pela ALTURA.
 * A faixa ocupa a largura toda deslocada (left = x - 50%) para o conteúdo ter
 * o quadro inteiro para quebrar linha, em vez de espremer perto da borda.
 */
export const AtPoint: React.FC<{ at: Point; children: React.ReactNode }> = ({ at, children }) => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    <div
      style={{
        position: "absolute",
        left: `${at.x - 50}%`,
        width: "100%",
        top: `${at.y}%`,
        transform: "translateY(-50%)",
        display: "flex",
        justifyContent: "center",
      }}
    >
      {children}
    </div>
  </AbsoluteFill>
);
