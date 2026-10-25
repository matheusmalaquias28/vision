import { TRANSITION_PRESETS, type MotionOf } from "@vision/recipe";
import React from "react";
import { AbsoluteFill, OffthreadVideo } from "remotion";
import { mediaSrc } from "./media";

/**
 * Transição da biblioteca em tela cheia, no corte. "screen" some com o preto
 * (só a luz/queima/glitch passa por cima do vídeo); o papel tem transparência.
 * onError: sem a biblioteca na máquina o vídeo falha e a transição é pulada,
 * em vez de derrubar o render inteiro.
 */
export const TransitionMotion: React.FC<{ m: MotionOf<"transition"> }> = ({ m }) => {
  const preset = TRANSITION_PRESETS[m.params.style];
  return (
    <AbsoluteFill style={{ mixBlendMode: preset.blend === "screen" ? "screen" : undefined, pointerEvents: "none" }}>
      <OffthreadVideo
        src={mediaSrc(preset.file)}
        muted
        transparent={preset.alpha}
        pauseWhenBuffering
        onError={() => undefined}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    </AbsoluteFill>
  );
};
