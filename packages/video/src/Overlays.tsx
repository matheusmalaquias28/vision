import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  Loop,
  OffthreadVideo,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { outputDuration, type Overlay, type Recipe } from "@vision/recipe";
import { mediaSrc } from "./media";
import { AtPoint, dragProps } from "./Positioned";

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
  const title = (
    <div
      {...dragProps(`overlay:${overlay.id}`)}
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
  );
  if (overlay.placement) return <AtPoint at={overlay.placement}>{title}</AtPoint>;
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
      {title}
    </AbsoluteFill>
  );
};

/** Imagem ou vídeo do overlay; vídeo mais curto que o overlay repete em loop */
const Media: React.FC<{ overlay: Overlay; fit: "cover" | "contain" }> = ({ overlay, fit }) => {
  const { fps } = useVideoConfig();
  if (!overlay.file) return null;
  const src = mediaSrc(overlay.file);
  // sticker não tem altura fixa: a mídia define a altura pela própria proporção
  const natural = fit === "contain";
  const style: React.CSSProperties = natural
    ? { width: "100%", height: "auto", display: "block" }
    : { width: "100%", height: "100%", objectFit: fit };
  if (overlay.kind !== "video") return <Img src={src} style={style} />;
  // WebM da biblioteca tem canal alfa (personagens recortados, transições chroma)
  const video = (
    <OffthreadVideo
      src={src}
      muted
      pauseWhenBuffering
      transparent={/\.webm$/i.test(overlay.file)}
      style={style}
    />
  );
  const media = overlay.mediaDurationSeconds;
  return media ? (
    // layout="none": sem isso o Loop envolve em AbsoluteFill e o sticker colapsa a 0px
    <Loop
      durationInFrames={Math.max(1, Math.round(media * fps))}
      layout={natural ? "none" : "absolute-fill"}
    >
      {video}
    </Loop>
  ) : (
    video
  );
};

/** Elemento solto (ícone, personagem): entra com pop, sai com fade */
const Sticker: React.FC<{ overlay: Overlay }> = ({ overlay }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 13, stiffness: 190 } });
  const exit = interpolate(frame, [durationInFrames - 6, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // % de top relativo à ALTURA do quadro (não usar padding-top %: é da largura)
  const top = overlay.position === "top" ? "8%" : overlay.position === "center" ? "30%" : undefined;
  const sticker = (
    <div
      {...dragProps(`overlay:${overlay.id}`)}
      style={{
        width: `${overlay.scale * 100}%`,
        opacity: overlay.opacity * exit,
        transform: `scale(${interpolate(enter, [0, 1], [0.5, 1])})`,
        transformOrigin: overlay.position === "bottom" ? "50% 100%" : "50% 50%",
        mixBlendMode: overlay.blend === "normal" ? undefined : overlay.blend,
      }}
    >
      <Media overlay={overlay} fit="contain" />
    </div>
  );
  if (overlay.placement) return <AtPoint at={overlay.placement}>{sticker}</AtPoint>;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top,
          bottom: overlay.position === "bottom" ? 0 : undefined,
          display: "flex",
          justifyContent: "center",
        }}
      >
        {sticker}
      </div>
    </AbsoluteFill>
  );
};

const MediaOverlay: React.FC<{ overlay: Overlay }> = ({ overlay }) => {
  if (!overlay.file) return null;

  if (overlay.layout === "sticker") return <Sticker overlay={overlay} />;

  if (overlay.layout === "fullscreen") {
    // fundos/transições/molduras: cobrem o quadro e mesclam com o vídeo
    return (
      <AbsoluteFill
        style={{
          opacity: overlay.opacity,
          mixBlendMode: overlay.blend === "normal" ? undefined : overlay.blend,
        }}
      >
        <Media overlay={overlay} fit="cover" />
      </AbsoluteFill>
    );
  }

  const media = <Media overlay={overlay} fit="cover" />;

  if (overlay.layout === "split-bottom") {
    // metade de baixo da tela para o overlay; o vídeo principal fica em cima
    return <AbsoluteFill style={{ top: "50%" }}>{media}</AbsoluteFill>;
  }
  if (overlay.layout === "pip") {
    const box: React.CSSProperties = overlay.placement
      ? // na posição livre a janela mantém 38% da largura do quadro
        { position: "relative", width: "38%" }
      : {
          position: "absolute",
          right: "4%",
          top: overlay.position === "bottom" ? undefined : "4%",
          bottom: overlay.position === "bottom" ? "22%" : undefined,
          width: "38%",
        };
    const pip = (
      <div
        {...dragProps(`overlay:${overlay.id}`)}
        style={{
          ...box,
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
    return overlay.placement ? <AtPoint at={overlay.placement}>{pip}</AtPoint> : pip;
  }
  // "overlay": imagem/vídeo em destaque no centro (ex: b-roll, print)
  const card = (
    <div
      {...dragProps(`overlay:${overlay.id}`)}
      style={{
        width: "86%",
        borderRadius: 24,
        overflow: "hidden",
        boxShadow: "0 12px 50px rgba(0,0,0,0.6)",
      }}
    >
      {media}
    </div>
  );
  if (overlay.placement) return <AtPoint at={overlay.placement}>{card}</AtPoint>;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      {card}
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
            premountFor={Math.round(fps * 1.5)}
          >
            {o.kind === "title" ? (
              <TitleOverlay overlay={o} fontFamily={recipe.captions.style.fontFamily} />
            ) : (
              <MediaOverlay overlay={o} />
            )}
          </Sequence>
        );
      })}
    </>
  );
};
