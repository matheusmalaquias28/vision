import React, { useMemo } from "react";
import {
  AbsoluteFill,
  Audio,
  interpolate,
  OffthreadVideo,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  placeMotions,
  zoomScaleAt,
  type Recipe,
  type Segment,
  type Source,
  type VisualLayer,
} from "@vision/recipe";
import { AudioClips } from "./AudioClips";
import { Captions } from "./Captions";
import { Motions } from "./Motions";
import { Overlays } from "./Overlays";
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

// type (não interface): o Composition do Remotion exige props indexáveis
export type VisionCompositionProps = {
  recipe: Recipe;
  /** Editor: mostra motions sugeridos (pendentes) como prévia. Render: false. */
  previewPending?: boolean;
};

export const VisionComposition: React.FC<VisionCompositionProps> = ({
  recipe,
  previewPending = false,
}) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const placed = useMemo(
    () => placeMotions(recipe, previewPending),
    [recipe, previewPending]
  );
  const zoom = zoomScaleAt(placed, frame / fps);
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

  const layers: Record<VisualLayer, React.ReactNode> = {
    video: (
      // origem um pouco acima do centro: enquadra rosto em vídeo vertical
      <AbsoluteFill style={{ transform: `scale(${zoom})`, transformOrigin: "50% 40%" }}>
        {sequences}
      </AbsoluteFill>
    ),
    overlays: <Overlays recipe={recipe} />,
    motions: <Motions placed={placed} style={recipe.captions.style} />,
    captions: <Captions recipe={recipe} />,
  };

  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      {/* do fundo para a frente: layerOrder lista da frente para o fundo */}
      {[...recipe.layerOrder].reverse().map((layer) => (
        <React.Fragment key={layer}>{layers[layer]}</React.Fragment>
      ))}
      {recipe.audio.narration ? (
        <Sequence from={Math.round(recipe.audio.narration.offsetSeconds * fps)}>
          <Audio
            src={mediaSrc(recipe.audio.narration.file)}
            volume={recipe.audio.narration.volume}
          />
        </Sequence>
      ) : null}
      <AudioClips clips={recipe.audioClips} />
    </AbsoluteFill>
  );
};
