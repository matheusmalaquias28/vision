import React from "react";
import { Audio, interpolate, Sequence, useVideoConfig } from "remotion";
import type { AudioClip } from "@vision/recipe";
import { mediaSrc } from "./media";

const ClipAudio: React.FC<{ clip: AudioClip; frames: number }> = ({ clip, frames }) => {
  const { fps } = useVideoConfig();
  const fadeIn = Math.round(clip.fadeInSeconds * fps);
  const fadeOut = Math.round(clip.fadeOutSeconds * fps);
  // frame relativo à Sequence do clipe: fades valem para o clipe, não para o vídeo
  const volume = (frame: number) => {
    let v = clip.volume;
    if (fadeIn > 0) {
      v *= interpolate(frame, [0, fadeIn], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
    }
    if (fadeOut > 0) {
      v *= interpolate(frame, [frames - fadeOut, frames], [1, 0], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
    }
    return v;
  };
  return (
    <Audio
      src={mediaSrc(clip.file)}
      volume={volume}
      trimBefore={Math.round(clip.offset * fps)}
      loop={clip.loop}
    />
  );
};

/** Músicas e efeitos sonoros posicionados na timeline (tempo do vídeo final) */
export const AudioClips: React.FC<{ clips: AudioClip[] }> = ({ clips }) => {
  const { fps, durationInFrames } = useVideoConfig();
  return (
    <>
      {clips.map((clip) => {
        const from = Math.round(clip.start * fps);
        const frames = Math.min(Math.round(clip.duration * fps), durationInFrames - from);
        if (frames <= 0) return null;
        return (
          <Sequence key={clip.id} from={from} durationInFrames={frames}>
            <ClipAudio clip={clip} frames={frames} />
          </Sequence>
        );
      })}
    </>
  );
};
