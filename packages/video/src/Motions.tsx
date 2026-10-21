import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  Sequence,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { CaptionStyle, MotionOf, PlacedMotion } from "@vision/recipe";
import { useGoogleFont } from "./fonts";

/** Frames de saída comuns a todos os motions de tela */
const EXIT_FRAMES = 6;

/**
 * Posição "centro" dos motions: abaixo do rosto e acima da legenda
 * (terço inferior). Em vídeo vertical de pessoa falando, 50% cobre a boca.
 */
const CHEST_TOP = "54%";

/**
 * Faixa horizontal posicionada pela ALTURA do quadro. (padding-top em % é
 * relativo à largura — num vídeo vertical isso joga tudo para cima.)
 */
const Band: React.FC<{ top: string; align?: "center" | "left"; children: React.ReactNode }> = ({
  top,
  align = "center",
  children,
}) => (
  <AbsoluteFill>
    <div
      style={{
        position: "absolute",
        top,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: align === "left" ? "flex-start" : "center",
      }}
    >
      {children}
    </div>
  </AbsoluteFill>
);

/** Texto preto ou branco, o que contrastar mais com o fundo */
function contrastText(hex: string): string {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return "#000000";
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.55 ? "#000000" : "#FFFFFF";
}

function fontStack(style: CaptionStyle): string {
  return `'${style.fontFamily}', 'Arial Black', sans-serif`;
}

/** 0→1 na entrada (spring) e 1→0 nos últimos frames */
function useEnterExit(stiffness = 180): { enter: number; exit: number } {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 12, stiffness } });
  const exit = interpolate(
    frame,
    [durationInFrames - EXIT_FRAMES, durationInFrames],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  return { enter, exit };
}

const Keyword: React.FC<{ m: MotionOf<"keyword">; style: CaptionStyle }> = ({ m, style }) => {
  const { enter, exit } = useEnterExit();
  return (
    <Band top={m.params.position === "top" ? "9%" : CHEST_TOP}>
      <div
        style={{
          fontFamily: fontStack(style),
          fontWeight: 900,
          fontSize: 96,
          lineHeight: 1.05,
          textTransform: "uppercase",
          textAlign: "center",
          maxWidth: "86%",
          padding: "18px 36px",
          borderRadius: 22,
          background: style.highlightColor,
          color: contrastText(style.highlightColor),
          boxShadow: "0 14px 40px rgba(0,0,0,0.45)",
          transform: `scale(${interpolate(enter, [0, 1], [0.4, 1]) * exit}) rotate(${interpolate(enter, [0, 1], [-8, -3])}deg)`,
          opacity: Math.min(enter * 2, 1) * exit,
        }}
      >
        {m.params.text}
      </div>
    </Band>
  );
};

const Emoji: React.FC<{ m: MotionOf<"emoji"> }> = ({ m }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { enter, exit } = useEnterExit(220);
  const bob = Math.sin((frame / fps) * Math.PI * 2) * 10;
  const wobble = Math.sin((frame / fps) * Math.PI * 3) * 6;
  const pos: React.CSSProperties =
    m.params.position === "side"
      ? { right: "8%", top: "30%" }
      : m.params.position === "top"
        ? { left: 0, right: 0, top: "12%", textAlign: "center" }
        : { left: 0, right: 0, top: CHEST_TOP, textAlign: "center" };
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          ...pos,
          fontSize: 220,
          lineHeight: 1,
          filter: "drop-shadow(0 12px 24px rgba(0,0,0,0.45))",
          transform: `translateY(${bob}px) scale(${enter * exit}) rotate(${wobble}deg)`,
        }}
      >
        {m.params.emoji}
      </div>
    </AbsoluteFill>
  );
};

const LowerThird: React.FC<{ m: MotionOf<"lowerThird">; style: CaptionStyle }> = ({ m, style }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const slide = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 12 });
  const out = interpolate(frame, [durationInFrames - 10, durationInFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.in(Easing.cubic),
  });
  const x = interpolate(slide, [0, 1], [-110, 0]) - out * 110;
  return (
    <Band top="7%" align="left">
      <div
        style={{
          marginLeft: "6%",
          display: "flex",
          alignItems: "stretch",
          transform: `translateX(${x}%)`,
          maxWidth: "84%",
        }}
      >
        <div style={{ width: 14, borderRadius: 7, background: style.highlightColor }} />
        <div
          style={{
            marginLeft: 18,
            padding: "18px 28px",
            borderRadius: 18,
            background: "rgba(10,12,18,0.82)",
            boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
          }}
        >
          <div
            style={{
              fontFamily: fontStack(style),
              fontWeight: 900,
              fontSize: 58,
              color: "#FFFFFF",
              lineHeight: 1.1,
            }}
          >
            {m.params.title}
          </div>
          {m.params.subtitle && (
            <div
              style={{
                fontFamily: "'Inter', 'Segoe UI', sans-serif",
                fontWeight: 600,
                fontSize: 36,
                color: "rgba(255,255,255,0.78)",
                marginTop: 6,
              }}
            >
              {m.params.subtitle}
            </div>
          )}
        </div>
      </div>
    </Band>
  );
};

const Counter: React.FC<{ m: MotionOf<"counter">; style: CaptionStyle }> = ({ m, style }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const { enter, exit } = useEnterExit();
  const progress = interpolate(frame, [0, Math.max(1, durationInFrames * 0.6)], [0, 1], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const { from, to, decimals, prefix, suffix, label } = m.params;
  const value = (from + (to - from) * progress).toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return (
    <Band top="8%">
      <div
        style={{
          textAlign: "center",
          transform: `scale(${interpolate(enter, [0, 1], [0.6, 1]) * exit})`,
          opacity: exit,
        }}
      >
        <div
          style={{
            fontFamily: fontStack(style),
            fontWeight: 900,
            fontSize: 170,
            lineHeight: 1,
            color: style.highlightColor,
            WebkitTextStroke: `14px ${style.strokeColor}`,
            paintOrder: "stroke",
            fontVariantNumeric: "tabular-nums",
            textShadow: "0 10px 30px rgba(0,0,0,0.5)",
          }}
        >
          {prefix}
          {value}
          {suffix}
        </div>
        {label && (
          <div
            style={{
              fontFamily: fontStack(style),
              fontWeight: 900,
              fontSize: 52,
              color: "#FFFFFF",
              textTransform: "uppercase",
              WebkitTextStroke: `8px ${style.strokeColor}`,
              paintOrder: "stroke",
              marginTop: 8,
            }}
          >
            {label}
          </div>
        )}
      </div>
    </Band>
  );
};

const Flash: React.FC<{ m: MotionOf<"flash"> }> = ({ m }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const opacity = interpolate(frame, [0, 2, durationInFrames], [0, 0.85, 0], {
    extrapolateRight: "clamp",
  });
  return <AbsoluteFill style={{ background: m.params.color, opacity }} />;
};

/**
 * Motions de tela (tudo menos zoom, que é aplicado no vídeo pela composição).
 * Recebe os motions já posicionados no tempo final por placeMotions.
 */
export const Motions: React.FC<{ placed: PlacedMotion[]; style: CaptionStyle }> = ({
  placed,
  style,
}) => {
  const { fps } = useVideoConfig();
  useGoogleFont(style.fontFamily);
  return (
    <>
      {placed.map(({ motion: m, outputStart }) => {
        if (m.kind === "zoom") return null;
        const body =
          m.kind === "keyword" ? (
            <Keyword m={m} style={style} />
          ) : m.kind === "emoji" ? (
            <Emoji m={m} />
          ) : m.kind === "lowerThird" ? (
            <LowerThird m={m} style={style} />
          ) : m.kind === "counter" ? (
            <Counter m={m} style={style} />
          ) : (
            <Flash m={m} />
          );
        return (
          <Sequence
            key={m.id}
            from={Math.round(outputStart * fps)}
            durationInFrames={Math.max(1, Math.round(m.durationSeconds * fps))}
          >
            {body}
          </Sequence>
        );
      })}
    </>
  );
};
