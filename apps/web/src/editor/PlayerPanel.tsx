import { Player, type PlayerRef } from "@remotion/player";
import type { Recipe } from "@vision/recipe";
import { recipeMetadata, VisionComposition } from "@vision/video";
import React, { useMemo } from "react";
import { TransportBar } from "./TransportBar";

interface PlayerPanelProps {
  recipe: Recipe;
  playerRef: React.RefObject<PlayerRef | null>;
}

/**
 * Memoizado de propósito: o Editor re-renderiza a cada tick do playhead e
 * isso não pode arrastar o Player junto (causa engasgos no preview).
 * inputProps também precisa de identidade estável entre renders.
 */
export const PlayerPanel: React.FC<PlayerPanelProps> = React.memo(
  ({ recipe, playerRef }) => {
    const meta = recipeMetadata(recipe);
    const inputProps = useMemo(() => ({ recipe }), [recipe]);
    return (
      <>
        <Player
          ref={playerRef}
          component={VisionComposition}
          inputProps={inputProps}
          durationInFrames={meta.durationInFrames}
          fps={meta.fps}
          compositionWidth={meta.width}
          compositionHeight={meta.height}
          clickToPlay
          style={{ width: "100%", aspectRatio: `${meta.width} / ${meta.height}` }}
        />
        <TransportBar
          playerRef={playerRef}
          fps={meta.fps}
          durationInFrames={meta.durationInFrames}
        />
      </>
    );
  }
);
