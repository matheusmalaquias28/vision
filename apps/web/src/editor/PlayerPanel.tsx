import { Player, type PlayerRef } from "@remotion/player";
import type { Recipe } from "@vision/recipe";
import { recipeMetadata, VisionComposition } from "@vision/video";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { TransportBar } from "./TransportBar";

interface PlayerPanelProps {
  recipe: Recipe;
  playerRef: React.RefObject<PlayerRef | null>;
  /** Mostra motions sugeridos (pendentes) no preview */
  previewPending: boolean;
}

/** Maior retângulo com a proporção do vídeo que cabe no palco */
function useFitBox(aspect: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const style = getComputedStyle(el);
      const w = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const h = el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      if (w <= 0 || h <= 0) return;
      setBox(w / h > aspect ? { width: h * aspect, height: h } : { width: w, height: w / aspect });
    };
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, [aspect]);
  return { ref, box };
}

/**
 * Memoizado de propósito: o Editor re-renderiza a cada tick do playhead e
 * isso não pode arrastar o Player junto (causa engasgos no preview).
 * inputProps também precisa de identidade estável entre renders.
 */
export const PlayerPanel: React.FC<PlayerPanelProps> = React.memo(
  ({ recipe, playerRef, previewPending }) => {
    const meta = recipeMetadata(recipe);
    const inputProps = useMemo(() => ({ recipe, previewPending }), [recipe, previewPending]);
    const { ref, box } = useFitBox(meta.width / meta.height);
    return (
      <>
        <div className="viewer-stage" ref={ref}>
          <div className="viewer-frame" style={{ width: box.width, height: box.height }}>
            <Player
              ref={playerRef}
              component={VisionComposition}
              inputProps={inputProps}
              durationInFrames={meta.durationInFrames}
              fps={meta.fps}
              compositionWidth={meta.width}
              compositionHeight={meta.height}
              clickToPlay
              style={{ width: "100%", height: "100%" }}
            />
          </div>
        </div>
        <TransportBar
          playerRef={playerRef}
          fps={meta.fps}
          durationInFrames={meta.durationInFrames}
        />
      </>
    );
  }
);
