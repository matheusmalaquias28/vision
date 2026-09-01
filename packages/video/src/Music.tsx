import React from "react";
import { Audio, interpolate, useVideoConfig } from "remotion";
import type { Music as MusicConfig } from "@vision/recipe";
import { mediaSrc } from "./media";

export const Music: React.FC<{ music: MusicConfig }> = ({ music }) => {
  const { fps, durationInFrames } = useVideoConfig();
  const fadeInFrames = Math.round(music.fadeInSeconds * fps);
  const fadeOutFrames = Math.round(music.fadeOutSeconds * fps);

  const volume = (frame: number) => {
    let v = music.volume;
    if (fadeInFrames > 0) {
      v *= interpolate(frame, [0, fadeInFrames], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
    }
    if (fadeOutFrames > 0) {
      v *= interpolate(
        frame,
        [durationInFrames - fadeOutFrames, durationInFrames],
        [1, 0],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
      );
    }
    return v;
  };

  return (
    <Audio
      src={mediaSrc(music.file)}
      volume={volume}
      trimBefore={Math.round(music.startOffsetSeconds * fps)}
      loop
    />
  );
};
