import React from "react";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { outputDuration, type Overlay, type Recipe } from "@vision/recipe";
import { mediaSrc } from "./media";

const TitleOverlay: React.FC<{ overlay: Overlay; fontFamily: string }> = ({
  overlay,
  fontFamily,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 8 });
  const justify =
    overlay.position === "top"
      ? "flex-start"
      : overlay.position === "center"
        ? "center"
        : "flex-end";
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: justify,
        paddingTop: "8%",
        paddingBottom: "8%",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          maxWidth: "88%",
          textAlign: "center",
          fontFamily: `'${fontFamily}', 'Arial Black', sans-serif`,
          fontWeight: 900,
          fontSize: 58,
          color: "white",
          textTransform: "uppercase",
          WebkitTextStroke: "10px black",
          paintOrder: "stroke",
          transform: `scale(${0.9 + enter * 0.1}) translateY(${(1 - enter) * -30}px)`,
          opacity: enter,
        }}
      >
        {overlay.text}
      </div>
    </AbsoluteFill>
  );
};

const MediaOverlay: React.FC<{ overlay: Overlay }> = ({ overlay }) => {
  if (!overlay.file) return null;
  const src = mediaSrc(overlay.file);
  const media =
    overlay.kind === "video" ? (
      <OffthreadVideo
        src={src}
        pauseWhenBuffering
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    ) : (
      <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    );

  if (overlay.layout === "split-bottom") {
    // metade de baixo da tela para o overlay; o vídeo principal fica em cima
    return (
      <AbsoluteFill style={{ top: "50%" }}>{media}</AbsoluteFill>
    );
  }
  if (overlay.layout === "pip") {
    return (
      <div
        style={{
          position: "absolute",
          right: "4%",
          top: overlay.position === "bottom" ? undefined : "4%",
          bottom: overlay.position === "bottom" ? "22%" : undefined,
          width: "38%",
          aspectRatio: "9 / 16",
          borderRadius: 24,
          overflow: "hidden",
          border: "4px solid white",
          boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
        }}
      >
        {media}
      </div>
    );
  }
  // "overlay": imagem/vídeo em destaque no centro (ex: b-roll, print)
  return (
    <AbsoluteFill
      style={{ alignItems: "center", justifyContent: "center" }}
    >
      <div
        style={{
          width: "86%",
          borderRadius: 24,
          overflow: "hidden",
          boxShadow: "0 12px 50px rgba(0,0,0,0.6)",
        }}
      >
        {media}
      </div>
    </AbsoluteFill>
  );
};

export const Overlays: React.FC<{ recipe: Recipe }> = ({ recipe }) => {
  const { fps } = useVideoConfig();
  const total = outputDuration(recipe.timeline.segments);
  return (
    <>
      {recipe.overlays.map((o) => {
        const end = o.end ?? total;
        const durationInFrames = Math.max(1, Math.round((end - o.start) * fps));
        return (
          <Sequence
            key={o.id}
            from={Math.round(o.start * fps)}
            durationInFrames={durationInFrames}
          >
            {o.kind === "title" ? (
              <TitleOverlay
                overlay={o}
                fontFamily={recipe.captions.style.fontFamily}
              />
            ) : (
              <MediaOverlay overlay={o} />
            )}
          </Sequence>
        );
      })}
    </>
  );
};
