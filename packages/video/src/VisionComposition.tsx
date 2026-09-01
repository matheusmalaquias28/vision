import React from "react";
import {
  AbsoluteFill,
  Audio,
  interpolate,
  OffthreadVideo,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { Recipe, Segment, Source } from "@vision/recipe";
import { Captions } from "./Captions";
import { Music } from "./Music";
import { Overlays } from "./Overlays";
import { SfxTrack } from "./Sfx";
import { mediaSrc } from "./media";

/** Vídeo de um segmento, com punch-in opcional no início */
const SegmentVideo: React.FC<{
  source: Source;
  segment: Segment;
  originalVolume: number;
  useEnhanced: boolean;
  punchIn: boolean;
}> = ({ source, segment, originalVolume, useEnhanced, punchIn }) => {
  const frame = useCurrentFrame(); // relativo à Sequence
  const { fps } = useVideoConfig();
  const enhanced = useEnhanced && source.enhancedAudio !== null;
  const scale = punchIn
    ? interpolate(frame, [0, Math.round(fps * 0.4)], [1.08, 1], {
        extrapolateRight: "clamp",
      })
    : 1;
  const trim = Math.round(segment.sourceStart * fps);
  return (
    <>
      <OffthreadVideo
        src={mediaSrc(source.file)}
        trimBefore={trim}
        volume={enhanced ? 0 : originalVolume}
        muted={enhanced}
        pauseWhenBuffering
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${scale})`,
        }}
      />
      {enhanced && source.enhancedAudio ? (
        <Audio
          src={mediaSrc(source.enhancedAudio)}
          trimBefore={trim}
          volume={originalVolume}
        />
      ) : null}
    </>
  );
};

export const VisionComposition: React.FC<{ recipe: Recipe }> = ({ recipe }) => {
  const { fps } = useVideoConfig();
  const sourcesById = new Map(recipe.sources.map((s) => [s.id, s]));

  let cursor = 0;
  const sequences = recipe.timeline.segments.map((seg) => {
    const source = sourcesById.get(seg.sourceId);
    const durationInFrames = Math.max(
      1,
      Math.round((seg.sourceEnd - seg.sourceStart) * fps)
    );
    const from = cursor;
    cursor += durationInFrames;
    if (!source) return null;
    return (
      // premountFor monta o <video> do próximo segmento com antecedência —
      // sem isso o preview trava em cada corte
      <Sequence
        key={seg.id}
        from={from}
        durationInFrames={durationInFrames}
        premountFor={Math.round(fps * 3)}
      >
        <SegmentVideo
          source={source}
          segment={seg}
          originalVolume={recipe.audio.originalVolume}
          useEnhanced={recipe.audio.useEnhanced}
          punchIn={recipe.effects.punchIn}
        />
      </Sequence>
    );
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {sequences}
      <Overlays recipe={recipe} />
      <Captions recipe={recipe} />
      {recipe.audio.music ? <Music music={recipe.audio.music} /> : null}
      {recipe.audio.narration ? (
        <Sequence from={Math.round(recipe.audio.narration.offsetSeconds * fps)}>
          <Audio
            src={mediaSrc(recipe.audio.narration.file)}
            volume={recipe.audio.narration.volume}
          />
        </Sequence>
      ) : null}
      <SfxTrack recipe={recipe} />
    </AbsoluteFill>
  );
};
