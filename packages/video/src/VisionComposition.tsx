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
  activeSplitAt,
  captionHiddenRanges,
  colorFilterCss,
  framingStyle,
  placeMotions,
  temperatureLayer,
  zoomAt,
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

/** Vídeo de um segmento com o ajuste de cor da fonte (zoom é sempre motion, visível na timeline) */
const SegmentVideo: React.FC<{
  source: Source;
  segment: Segment;
  originalVolume: number;
  useEnhanced: boolean;
  /** cópia leve do bruto (só no editor) */
  proxyFile?: string;
}> = ({ source, segment, originalVolume, useEnhanced, proxyFile }) => {
  const { fps } = useVideoConfig();
  const enhanced = useEnhanced && source.enhancedAudio !== null;
  const trim = Math.round(segment.sourceStart * fps);
  const temp = temperatureLayer(source.color);
  return (
    <>
      {/* isolado: a camada de temperatura só mistura com o vídeo, nunca com legenda/motions */}
      <AbsoluteFill style={{ isolation: "isolate", overflow: "hidden" }}>
        <OffthreadVideo
          src={mediaSrc(proxyFile ?? source.file)}
          trimBefore={trim}
          volume={enhanced ? 0 : originalVolume}
          muted={enhanced}
          pauseWhenBuffering
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            // enquadramento: o que aparece quando o vídeo é cortado (metade do split, vídeo horizontal)
            ...framingStyle(source.framing),
            filter: colorFilterCss(source.color),
          }}
        />
        {temp && (
          <AbsoluteFill style={{ backgroundColor: temp.color, opacity: temp.opacity, mixBlendMode: "soft-light" }} />
        )}
      </AbsoluteFill>
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
  /**
   * Editor: bruto → cópia leve (720p) para o Player não travar baixando o
   * bruto pesado. Render: nunca (lê sempre `source.file`).
   */
  mediaProxies?: Record<string, string>;
};

export const VisionComposition: React.FC<VisionCompositionProps> = ({
  recipe,
  previewPending = false,
  mediaProxies,
}) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const placed = useMemo(
    () => placeMotions(recipe, previewPending),
    [recipe, previewPending]
  );
  // um único compositor de câmera: escala e foco do zoom dominante
  const camera = zoomAt(placed, frame / fps);
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
          proxyFile={mediaProxies?.[source.file]}
        />
      </Sequence>
    );
  });

  // split ativo: o vídeo principal ocupa só a outra metade (não fica escondido atrás do clipe)
  const split = activeSplitAt(recipe, frame / fps);
  // (AbsoluteFill fixa height 100%: a metade precisa de height explícito)
  const videoArea: React.CSSProperties = !split
    ? {}
    : { height: "50%", top: split.mainHalf === "top" ? 0 : "50%", overflow: "hidden" };

  const layers: Record<VisualLayer, React.ReactNode> = {
    video: (
      <AbsoluteFill style={videoArea}>
        {/* foco padrão um pouco acima do centro: enquadra rosto em vídeo vertical */}
        <AbsoluteFill
          style={{ transform: `scale(${camera.scale})`, transformOrigin: `${camera.focusX}% ${camera.focusY}%` }}
        >
          {sequences}
        </AbsoluteFill>
      </AbsoluteFill>
    ),
    overlays: <Overlays recipe={recipe} />,
    motions: (
      <Motions placed={placed} style={recipe.captions.style} defaultAccent={recipe.motionStyle?.accentColor ?? null} />
    ),
    // tela cheia com texto: a legenda sai enquanto ela está no ar (opção do motion)
    captions: <Captions recipe={recipe} hiddenRanges={captionHiddenRanges(placed)} />,
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
      {/* trilha sugerida pela IA (pendente) só toca no preview, nunca no MP4 */}
      <AudioClips clips={recipe.audioClips.filter((c) => c.status !== "pending" || previewPending)} />
    </AbsoluteFill>
  );
};
