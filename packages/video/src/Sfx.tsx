import React from "react";
import { Audio, Sequence, useVideoConfig } from "remotion";
import type { Recipe } from "@vision/recipe";
import { mediaSrc } from "./media";

/** Duração máxima reservada para um efeito sonoro (s) */
const SFX_MAX_SECONDS = 4;

export const SfxTrack: React.FC<{ recipe: Recipe }> = ({ recipe }) => {
  const { fps, durationInFrames } = useVideoConfig();
  return (
    <>
      {recipe.sfx.map((s) => {
        const from = Math.round(s.at * fps);
        if (from >= durationInFrames) return null;
        return (
          <Sequence
            key={s.id}
            from={from}
            durationInFrames={Math.min(
              Math.round(SFX_MAX_SECONDS * fps),
              durationInFrames - from
            )}
          >
            <Audio src={mediaSrc(s.file)} volume={s.volume} />
          </Sequence>
        );
      })}
    </>
  );
};
