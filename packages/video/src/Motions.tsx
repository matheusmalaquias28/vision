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
import { resolveMotionAccent, type CaptionStyle, type MotionOf, type PlacedMotion } from "@vision/recipe";
import { AnnotationMotion, CalloutMotion, ChartMotion, ShineSweep, SpeedLinesMotion } from "./ElementsMotions";
import { IllustrationMotion } from "./IllustrationMotion";
import { ScreenMotion } from "./ScreenMotion";
import { TransitionMotion } from "./TransitionMotion";
import { useGoogleFont } from "./fonts";
import { AtPoint, dragProps } from "./Positioned";

/**
 * Componentes da biblioteca fechada de motions (metadados em
 * packages/recipe/src/motionRegistry.ts). Tudo é função do frame: o mesmo
 * componente desenha o Player do editor e o MP4. As variantes padrão dos
 * tipos antigos (pop, bar, bold, flash normal) mantêm o visual original.
 *
 * Área segura em 9:16: legenda ocupa ~78–90% da altura; os motions ficam
 * entre o topo (8%) e o peito (~54–70%).
 */

/** Frames de saída comuns a todos os motions de tela */
const EXIT_FRAMES = 6;

/**
 * Posição "centro" dos motions: abaixo do rosto e acima da legenda
 * (terço inferior). Em vídeo vertical de pessoa falando, 50% cobre a boca.
 */
const CHEST_TOP = "54%";

/** Fonte de apoio (rótulos, legendas pequenas) */
const UI_FONT = "Inter";
const uiStack = `'${UI_FONT}', 'Segoe UI', system-ui, sans-serif`;

/** Curvas: cada família de motion tem o seu ritmo (não o mesmo spring para tudo) */
const EASE_OUT_EXPO = Easing.bezier(0.16, 1, 0.3, 1);
const EASE_IN_CUBIC = Easing.in(Easing.cubic);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

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

/** Posição livre (arrastada no preview) ou a faixa padrão do tipo */
const Place: React.FC<{
  m: { placement: { x: number; y: number } | null };
  top: string;
  align?: "center" | "left";
  children: React.ReactNode;
}> = ({ m, top, align, children }) =>
  m.placement ? (
    <AtPoint at={m.placement}>{children}</AtPoint>
  ) : (
    <Band top={top} align={align}>
      {children}
    </Band>
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

/** Saída suave (0 → 1 nos últimos `frames`), com aceleração */
function useExit(frames = 9): number {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return interpolate(frame, [durationInFrames - frames, durationInFrames], [0, 1], {
    ...clamp,
    easing: EASE_IN_CUBIC,
  });
}

/** Progresso 0→1 de `from` a `from+len` frames, com a curva dada */
function useRamp(from: number, len: number, easing = EASE_OUT_EXPO): number {
  const frame = useCurrentFrame();
  return interpolate(frame, [from, from + Math.max(1, len)], [0, 1], { ...clamp, easing });
}

const SIZE = { subtle: 76, normal: 96, strong: 116 } as const;

/** Quebra linhas com comprimentos parecidos: nada de palavra órfã na 2ª linha */
const BALANCE = { textWrap: "balance" } as React.CSSProperties;

/** Tamanho que encolhe com o comprimento do texto (cabe sem quebrar demais) */
const fitSize = (text: string, base: number, min: number) =>
  Math.round(Math.max(min, Math.min(base, base * (14 / Math.max(14, text.length)) ** 0.5)));

/** Sombra para texto claro sobre vídeo, sem contorno pesado */
const SOFT_SHADOW = "0 6px 28px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.45)";

// ─── Palavra-chave ───────────────────────────────────────────────────

const Keyword: React.FC<{ m: MotionOf<"keyword">; style: CaptionStyle }> = ({ m, style }) => {
  const top = m.params.position === "top" ? "9%" : CHEST_TOP;
  if (m.params.variant === "slide") return <KeywordSlide m={m} style={style} top={top} />;
  if (m.params.variant === "underline") return <KeywordUnderline m={m} style={style} top={top} />;
  if (m.params.variant === "marker") return <KeywordMarker m={m} style={style} top={top} />;
  return <KeywordPop m={m} style={style} top={top} />;
};

/** Visual original: selo inclinado com spring */
const KeywordPop: React.FC<{ m: MotionOf<"keyword">; style: CaptionStyle; top: string }> = ({ m, style, top }) => {
  const { enter, exit } = useEnterExit();
  const size = m.params.intensity === "normal" ? 96 : SIZE[m.params.intensity];
  return (
    <Place m={m} top={top}>
      <div
        {...dragProps(`motion:${m.id}`)}
        style={{
          fontFamily: fontStack(style),
          fontWeight: 900,
          fontSize: size,
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
    </Place>
  );
};

/** Pílula escura que desliza, com ponto de cor: limpo, para o tom equilibrado */
const KeywordSlide: React.FC<{ m: MotionOf<"keyword">; style: CaptionStyle; top: string }> = ({ m, style, top }) => {
  const enter = useRamp(0, 14);
  const exit = useExit();
  const size = fitSize(m.params.text, SIZE[m.params.intensity] * 0.82, 52);
  return (
    <Place m={m} top={top}>
      <div
        {...dragProps(`motion:${m.id}`)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 22,
          maxWidth: "86%",
          padding: `${size * 0.24}px ${size * 0.5}px`,
          borderRadius: 999,
          background: "rgba(12,14,20,0.78)",
          boxShadow: "0 18px 50px rgba(0,0,0,0.4)",
          opacity: Math.min(1, enter * 1.4) * (1 - exit),
          transform: `translateX(${(1 - enter) * -80 + exit * 40}px)`,
        }}
      >
        <span
          style={{
            width: Math.max(24, size * 0.3),
            height: Math.max(24, size * 0.3),
            borderRadius: "50%",
            background: style.highlightColor,
            flexShrink: 0,
            transform: `scale(${interpolate(enter, [0.3, 1], [0, 1], clamp)})`,
          }}
        />
        <span
          style={{
            fontFamily: fontStack(style),
            fontWeight: 900,
            fontSize: size,
            lineHeight: 1.05,
            textTransform: "uppercase",
            textAlign: "center",
            color: "#FFFFFF",
            letterSpacing: `${interpolate(enter, [0, 1], [0.08, 0.01])}em`,
            ...BALANCE,
          }}
        >
          {m.params.text}
        </span>
      </div>
    </Place>
  );
};

/** Texto livre com sublinhado de cor que se desenha: elegante, sem caixa */
const KeywordUnderline: React.FC<{ m: MotionOf<"keyword">; style: CaptionStyle; top: string }> = ({ m, style, top }) => {
  const rise = useRamp(0, 16);
  const line = useRamp(8, 14);
  const exit = useExit();
  const size = SIZE[m.params.intensity];
  return (
    <Place m={m} top={top}>
      <div
        {...dragProps(`motion:${m.id}`)}
        style={{
          maxWidth: "86%",
          textAlign: "center",
          opacity: 1 - exit,
          transform: `translateY(${exit * -16}px)`,
        }}
      >
        <div style={{ overflow: "hidden", paddingBottom: 6 }}>
          <div
            style={{
              fontFamily: fontStack(style),
              fontWeight: 900,
              fontSize: size,
              lineHeight: 1.04,
              textTransform: "uppercase",
              color: "#FFFFFF",
              textShadow: SOFT_SHADOW,
              transform: `translateY(${(1 - rise) * 105}%)`,
              ...BALANCE,
            }}
          >
            {m.params.text}
          </div>
        </div>
        <div
          style={{
            height: Math.max(8, size * 0.1),
            marginTop: size * 0.08,
            borderRadius: 99,
            background: style.highlightColor,
            boxShadow: "0 4px 18px rgba(0,0,0,0.35)",
            transform: `scaleX(${line})`,
            transformOrigin: "left center",
          }}
        />
      </div>
    </Place>
  );
};

/** Marca-texto: faixa de cor pintada atrás do texto, da esquerda para a direita */
const KeywordMarker: React.FC<{ m: MotionOf<"keyword">; style: CaptionStyle; top: string }> = ({ m, style, top }) => {
  const paint = useRamp(0, 12, Easing.out(Easing.quad));
  const text = useRamp(4, 10);
  const exit = useExit();
  const size = SIZE[m.params.intensity];
  return (
    <Place m={m} top={top}>
      <div
        {...dragProps(`motion:${m.id}`)}
        style={{ position: "relative", maxWidth: "86%", opacity: 1 - exit, transform: `scale(${1 - exit * 0.04})` }}
      >
        <div
          style={{
            position: "absolute",
            inset: `${size * 0.12}px ${-size * 0.18}px`,
            background: style.highlightColor,
            borderRadius: size * 0.08,
            transform: `scaleX(${paint}) skewX(-6deg)`,
            transformOrigin: "left center",
            boxShadow: "0 12px 34px rgba(0,0,0,0.35)",
          }}
        />
        <div
          style={{
            position: "relative",
            fontFamily: fontStack(style),
            fontWeight: 900,
            fontSize: size,
            lineHeight: 1.12,
            textTransform: "uppercase",
            textAlign: "center",
            color: contrastText(style.highlightColor),
            opacity: text,
            transform: `translateY(${(1 - text) * 14}px)`,
            ...BALANCE,
          }}
        >
          {m.params.text}
        </div>
      </div>
    </Place>
  );
};

// ─── Frase cinética ──────────────────────────────────────────────────

const sameWord = (a: string, b: string) =>
  a.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "") === b.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

const Kinetic: React.FC<{ m: MotionOf<"kinetic">; style: CaptionStyle }> = ({ m, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const exit = useExit(10);
  const words = m.params.text.split(/\s+/).filter(Boolean);
  const longest = Math.max(...words.map((w) => w.length));
  // encolhe para a palavra mais longa caber em ~86% da largura
  const size = Math.min(124, Math.max(64, 1400 / Math.max(longest, 6)));
  const accent = (w: string) => m.params.emphasis !== "" && sameWord(w, m.params.emphasis);
  const top = m.params.position === "top" ? "10%" : "30%";
  const variant = m.params.variant;

  // máscara: faixa de cor varre, recua e revela a frase
  const sweep = variant === "mask" ? interpolate(frame, [0, 9, 18], [0, 1, 0], clamp) : 0;
  const sweepFrom = variant === "mask" && frame > 9 ? "right" : "left";
  const reveal = variant === "mask" ? interpolate(frame, [9, 20], [0, 1], { ...clamp, easing: EASE_OUT_EXPO }) : 1;

  return (
    <Place m={m} top={top}>
      <div
        {...dragProps(`motion:${m.id}`)}
        style={{
          position: "relative",
          maxWidth: "88%",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          columnGap: size * 0.28,
          rowGap: size * 0.04,
          opacity: 1 - exit,
          transform: `translateY(${exit * -20}px)`,
        }}
      >
        {variant === "mask" && (
          <div
            style={{
              position: "absolute",
              inset: "-4% -3%",
              background: style.highlightColor,
              borderRadius: 10,
              transform: `scaleX(${sweep})`,
              transformOrigin: `${sweepFrom} center`,
              zIndex: 2,
            }}
          />
        )}
        {words.map((w, i) => {
          const delay = variant === "mask" ? 0 : i * 3;
          const local = frame - delay;
          let wordStyle: React.CSSProperties = {};
          if (variant === "rise") {
            const s = spring({ frame: local, fps, config: { damping: 15, stiffness: 170, mass: 0.7 } });
            wordStyle = { transform: `translateY(${(1 - s) * 110}%)`, opacity: Math.min(1, s * 2) };
          } else if (variant === "blur") {
            const t = interpolate(local, [0, 14], [0, 1], { ...clamp, easing: EASE_OUT_EXPO });
            wordStyle = {
              opacity: t,
              filter: `blur(${(1 - t) * 18}px)`,
              transform: `scale(${1.18 - t * 0.18})`,
            };
          } else {
            wordStyle = { clipPath: `inset(0 ${(1 - reveal) * 100}% 0 0)` };
          }
          return (
            <span key={i} style={{ overflow: variant === "rise" ? "hidden" : "visible", display: "inline-block", paddingBottom: 4 }}>
              <span
                style={{
                  display: "inline-block",
                  fontFamily: fontStack(style),
                  fontWeight: 900,
                  fontSize: size,
                  lineHeight: 1.02,
                  textTransform: "uppercase",
                  color: accent(w) ? style.highlightColor : "#FFFFFF",
                  textShadow: SOFT_SHADOW,
                  WebkitTextStroke: variant === "rise" ? `${Math.round(style.strokeWidthPx * 0.45)}px ${style.strokeColor}` : undefined,
                  paintOrder: "stroke",
                  ...wordStyle,
                }}
              >
                {w}
              </span>
            </span>
          );
        })}
      </div>
    </Place>
  );
};

// ─── Chamada premium ─────────────────────────────────────────────────

const Statement: React.FC<{ m: MotionOf<"statement">; style: CaptionStyle }> = ({ m, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const eyebrow = useRamp(0, 12);
  const rule = useRamp(5, 16);
  const text = useRamp(7, 20);
  const exit = useExit(10);
  const { variant } = m.params;
  const left = variant === "left";
  const len = m.params.text.length;
  const size = len > 40 ? 70 : len > 24 ? 82 : 94;

  if (variant === "cta") {
    const pop = spring({ frame: frame - 6, fps, config: { damping: 13, stiffness: 150 } });
    // pulso discreto e periódico: chama o olho sem piscar
    const pulse = 1 + Math.max(0, Math.sin(((frame - 24) / fps) * Math.PI * 1.6)) * 0.025 * Number(frame > 24);
    return (
      // abaixo do rosto e acima da legenda (a seta do combo fica logo abaixo)
      <Place m={m} top="50%">
        <div
          {...dragProps(`motion:${m.id}`)}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 22,
            maxWidth: "88%",
            opacity: 1 - exit,
            transform: `translateY(${exit * -18}px)`,
          }}
        >
          {m.params.eyebrow && (
            <div
              style={{
                fontFamily: uiStack,
                fontWeight: 800,
                fontSize: 36,
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                color: "#FFFFFF",
                textShadow: SOFT_SHADOW,
                opacity: eyebrow,
                transform: `translateY(${(1 - eyebrow) * 12}px)`,
              }}
            >
              {m.params.eyebrow}
            </div>
          )}
          <div
            style={{
              fontFamily: fontStack(style),
              fontWeight: 900,
              fontSize: size * 0.8,
              lineHeight: 1.08,
              textAlign: "center",
              ...BALANCE,
              textTransform: "uppercase",
              color: contrastText(style.highlightColor),
              background: style.highlightColor,
              padding: "26px 52px",
              borderRadius: 999,
              boxShadow: "0 22px 60px rgba(0,0,0,0.45)",
              opacity: Math.min(1, pop * 1.5),
              transform: `scale(${interpolate(pop, [0, 1], [0.7, 1]) * pulse})`,
              position: "relative",
            }}
          >
            {m.params.text}
            {m.params.shine && <ShineSweep startFrame={16} />}
          </div>
        </div>
      </Place>
    );
  }

  return (
    // terço superior: acima da cabeça em vídeo vertical de pessoa falando
    <Place m={m} top="12%" align={left ? "left" : "center"}>
      <div
        {...dragProps(`motion:${m.id}`)}
        style={{
          position: "relative",
          marginLeft: left && !m.placement ? "8%" : 0,
          maxWidth: left ? "80%" : "86%",
          display: "flex",
          flexDirection: "column",
          alignItems: left ? "flex-start" : "center",
          textAlign: left ? "left" : "center",
          padding: left ? "6px 0 6px 34px" : "34px 40px",
          // véu escuro suave só atrás do bloco: legível sem caixa dura
          background: left
            ? "none"
            : `radial-gradient(ellipse at center, rgba(0,0,0,${0.42 * text}) 0%, rgba(0,0,0,0) 72%)`,
          opacity: 1 - exit,
          transform: `translateY(${exit * -16}px)`,
        }}
      >
        {left && (
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: 8,
              borderRadius: 8,
              background: style.highlightColor,
              transform: `scaleY(${rule})`,
              transformOrigin: "top center",
            }}
          />
        )}
        {m.params.eyebrow && (
          <div
            style={{
              fontFamily: uiStack,
              fontWeight: 800,
              fontSize: 34,
              letterSpacing: "0.24em",
              textTransform: "uppercase",
              color: style.highlightColor,
              textShadow: "0 2px 12px rgba(0,0,0,0.6)",
              opacity: eyebrow,
              transform: `translateY(${(1 - eyebrow) * 10}px)`,
              marginBottom: 14,
            }}
          >
            {m.params.eyebrow}
          </div>
        )}
        {!left && (
          <div
            style={{
              width: 96,
              height: 5,
              borderRadius: 5,
              background: style.highlightColor,
              marginBottom: 22,
              transform: `scaleX(${rule})`,
            }}
          />
        )}
        <div style={{ overflow: "hidden", paddingBottom: 8 }}>
          <div
            style={{
              fontFamily: fontStack(style),
              fontWeight: 800,
              fontSize: size,
              lineHeight: 1.08,
              letterSpacing: "-0.01em",
              color: "#FFFFFF",
              textShadow: SOFT_SHADOW,
              transform: `translateY(${(1 - text) * 100}%)`,
              ...BALANCE,
            }}
          >
            {m.params.text}
          </div>
        </div>
      </div>
    </Place>
  );
};

// ─── Emoji ───────────────────────────────────────────────────────────

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
  const emoji = (
    <div
      {...dragProps(`motion:${m.id}`)}
      style={{
        fontSize: 220,
        lineHeight: 1,
        filter: "drop-shadow(0 12px 24px rgba(0,0,0,0.45))",
        transform: `translateY(${bob}px) scale(${enter * exit}) rotate(${wobble}deg)`,
      }}
    >
      {m.params.emoji}
    </div>
  );
  if (m.placement) return <AtPoint at={m.placement}>{emoji}</AtPoint>;
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", ...pos, display: "flex", justifyContent: "center" }}>{emoji}</div>
    </AbsoluteFill>
  );
};

// ─── Nome/cargo ──────────────────────────────────────────────────────

const LowerThird: React.FC<{ m: MotionOf<"lowerThird">; style: CaptionStyle }> = ({ m, style }) =>
  m.params.variant === "minimal" ? <LowerThirdMinimal m={m} style={style} /> : <LowerThirdBar m={m} style={style} />;

/** Visual original: barra de cor + cartão escuro deslizando */
const LowerThirdBar: React.FC<{ m: MotionOf<"lowerThird">; style: CaptionStyle }> = ({ m, style }) => {
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
    <Place m={m} top="7%" align="left">
      <div
        {...dragProps(`motion:${m.id}`)}
        style={{
          // na posição livre o elemento é centralizado no ponto: sem recuo
          marginLeft: m.placement ? 0 : "6%",
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
    </Place>
  );
};

/** Sem caixa: nome que sobe de uma máscara, fio de cor e cargo em fonte de apoio */
const LowerThirdMinimal: React.FC<{ m: MotionOf<"lowerThird">; style: CaptionStyle }> = ({ m, style }) => {
  const line = useRamp(0, 14);
  const name = useRamp(4, 16);
  const sub = useRamp(10, 14);
  const exit = useExit(10);
  return (
    <Place m={m} top="8%" align="left">
      <div
        {...dragProps(`motion:${m.id}`)}
        style={{
          marginLeft: m.placement ? 0 : "7%",
          maxWidth: "84%",
          opacity: 1 - exit,
          transform: `translateX(${exit * -30}px)`,
        }}
      >
        <div style={{ overflow: "hidden" }}>
          <div
            style={{
              fontFamily: fontStack(style),
              fontWeight: 800,
              fontSize: 60,
              lineHeight: 1.08,
              color: "#FFFFFF",
              textShadow: SOFT_SHADOW,
              transform: `translateY(${(1 - name) * 100}%)`,
            }}
          >
            {m.params.title}
          </div>
        </div>
        <div
          style={{
            width: 120,
            height: 5,
            borderRadius: 5,
            margin: "12px 0 12px",
            background: style.highlightColor,
            transform: `scaleX(${line})`,
            transformOrigin: "left center",
          }}
        />
        {m.params.subtitle && (
          <div
            style={{
              fontFamily: uiStack,
              fontWeight: 600,
              fontSize: 40,
              letterSpacing: "0.03em",
              color: "rgba(255,255,255,0.86)",
              textShadow: "0 2px 12px rgba(0,0,0,0.6)",
              opacity: sub,
              transform: `translateY(${(1 - sub) * 10}px)`,
            }}
          >
            {m.params.subtitle}
          </div>
        )}
      </div>
    </Place>
  );
};

// ─── Número ──────────────────────────────────────────────────────────

function useCount(m: MotionOf<"counter">): { value: string; progress: number } {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const progress = interpolate(frame, [0, Math.max(1, durationInFrames * 0.6)], [0, 1], {
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const { from, to, decimals } = m.params;
  const value = (from + (to - from) * progress).toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return { value, progress };
}

const Counter: React.FC<{ m: MotionOf<"counter">; style: CaptionStyle }> = ({ m, style }) =>
  m.params.variant === "card" ? <CounterCard m={m} style={style} /> : <CounterBold m={m} style={style} />;

/** Visual original: número grande com contorno */
const CounterBold: React.FC<{ m: MotionOf<"counter">; style: CaptionStyle }> = ({ m, style }) => {
  const { enter, exit } = useEnterExit();
  const { value } = useCount(m);
  const { prefix, suffix, label } = m.params;
  return (
    <Place m={m} top="8%">
      <div
        {...dragProps(`motion:${m.id}`)}
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
    </Place>
  );
};

/** Cartão escuro com número em contagem e barra de progresso (% enche até o valor) */
const CounterCard: React.FC<{ m: MotionOf<"counter">; style: CaptionStyle }> = ({ m, style }) => {
  const card = useRamp(0, 14);
  const exit = useExit(10);
  const { value, progress } = useCount(m);
  const { prefix, suffix, label, to } = m.params;
  const isPercent = suffix.trim().startsWith("%");
  const fill = (isPercent ? Math.min(Math.max(to, 0), 100) / 100 : 1) * progress;
  return (
    <Place m={m} top="9%">
      <div
        {...dragProps(`motion:${m.id}`)}
        style={{
          minWidth: 520,
          maxWidth: "84%",
          padding: "38px 54px 40px",
          borderRadius: 36,
          background: "rgba(12,14,20,0.8)",
          boxShadow: "0 24px 70px rgba(0,0,0,0.45)",
          textAlign: "center",
          opacity: card * (1 - exit),
          transform: `translateY(${(1 - card) * 30 - exit * 20}px) scale(${0.94 + card * 0.06})`,
        }}
      >
        <div
          style={{
            fontFamily: fontStack(style),
            fontWeight: 900,
            fontSize: 150,
            lineHeight: 1,
            letterSpacing: "-0.02em",
            color: style.highlightColor,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {prefix}
          {value}
          {suffix}
        </div>
        {label && (
          <div
            style={{
              fontFamily: uiStack,
              fontWeight: 700,
              fontSize: 44,
              lineHeight: 1.2,
              color: "rgba(255,255,255,0.88)",
              marginTop: 14,
            }}
          >
            {label}
          </div>
        )}
        <div style={{ height: 12, borderRadius: 12, background: "rgba(255,255,255,0.14)", marginTop: 28, overflow: "hidden" }}>
          <div
            style={{
              height: "100%",
              width: "100%",
              borderRadius: 12,
              background: style.highlightColor,
              transform: `scaleX(${fill})`,
              transformOrigin: "left center",
            }}
          />
        </div>
      </div>
    </Place>
  );
};

// ─── Lista de benefícios ─────────────────────────────────────────────

const ListMotion: React.FC<{ m: MotionOf<"list">; style: CaptionStyle }> = ({ m, style }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const panel = useRamp(0, 12);
  const exit = useExit(10);
  const { items, title, variant } = m.params;
  // itens distribuídos no tempo disponível, sem passar de 14 frames entre eles
  const step = Math.min(14, Math.max(5, Math.floor((durationInFrames - 30) / items.length)));
  const ink = contrastText(style.highlightColor);
  return (
    <Place m={m} top={m.params.position === "top" ? "9%" : "22%"}>
      <div
        {...dragProps(`motion:${m.id}`)}
        style={{
          width: "80%",
          maxWidth: 860,
          padding: "40px 46px",
          borderRadius: 36,
          background: "rgba(12,14,20,0.8)",
          boxShadow: "0 24px 70px rgba(0,0,0,0.45)",
          opacity: panel * (1 - exit),
          transform: `translateY(${(1 - panel) * 26 - exit * 18}px)`,
        }}
      >
        {title && (
          <div
            style={{
              fontFamily: uiStack,
              fontWeight: 800,
              fontSize: 36,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: style.highlightColor,
              marginBottom: 26,
            }}
          >
            {title}
          </div>
        )}
        {/* todas as linhas ocupam espaço desde o início: nada pula quando um item entra */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {items.map((item, i) => {
            const at = 8 + i * step;
            const s = spring({ frame: frame - at, fps, config: { damping: 16, stiffness: 160 } });
            const draw = interpolate(frame, [at + 4, at + 14], [0, 1], { ...clamp, easing: EASE_OUT_EXPO });
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 26,
                  opacity: Math.min(1, s * 1.6),
                  transform: `translateX(${(1 - s) * -36}px)`,
                }}
              >
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: "50%",
                    flexShrink: 0,
                    background: style.highlightColor,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transform: `scale(${0.6 + s * 0.4})`,
                  }}
                >
                  {variant === "number" ? (
                    <span style={{ fontFamily: fontStack(style), fontWeight: 900, fontSize: 36, color: ink }}>{i + 1}</span>
                  ) : (
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M4.5 12.5l5 5L19.5 7"
                        stroke={ink}
                        strokeWidth={3.2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        pathLength={1}
                        strokeDasharray={1}
                        strokeDashoffset={1 - draw}
                      />
                    </svg>
                  )}
                </div>
                <div
                  style={{
                    fontFamily: fontStack(style),
                    fontWeight: 800,
                    fontSize: 52,
                    lineHeight: 1.12,
                    color: "#FFFFFF",
                  }}
                >
                  {item}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Place>
  );
};

// ─── Mensagem ────────────────────────────────────────────────────────

const Bubble: React.FC<{ m: MotionOf<"bubble">; style: CaptionStyle }> = ({ m, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const exit = useExit(10);
  const right = m.params.side === "right";
  const pop = spring({ frame, fps, config: { damping: 14, stiffness: 190 } });
  // "digitando…" nos primeiros frames, depois a mensagem
  const typing = frame < 14;
  const textIn = useRamp(14, 10);
  const bg = right ? style.highlightColor : "#FFFFFF";
  const ink = right ? contrastText(style.highlightColor) : "#14161C";
  return (
    <Place m={m} top="16%">
      <div
        {...dragProps(`motion:${m.id}`)}
        style={{
          width: "84%",
          display: "flex",
          flexDirection: "column",
          alignItems: right ? "flex-end" : "flex-start",
          opacity: 1 - exit,
          transform: `translateY(${exit * -16}px)`,
        }}
      >
        {m.params.sender && (
          <div
            style={{
              fontFamily: uiStack,
              fontWeight: 700,
              fontSize: 36,
              color: "rgba(255,255,255,0.92)",
              textShadow: "0 2px 12px rgba(0,0,0,0.6)",
              margin: right ? "0 18px 10px 0" : "0 0 10px 18px",
              opacity: Math.min(1, pop * 1.5),
            }}
          >
            {m.params.sender}
          </div>
        )}
        <div
          style={{
            maxWidth: "88%",
            padding: typing ? "30px 38px" : "28px 38px",
            borderRadius: 40,
            [right ? "borderBottomRightRadius" : "borderBottomLeftRadius"]: 10,
            background: bg,
            boxShadow: "0 18px 50px rgba(0,0,0,0.38)",
            transform: `scale(${0.55 + pop * 0.45})`,
            transformOrigin: right ? "bottom right" : "bottom left",
            opacity: Math.min(1, pop * 1.6),
          }}
        >
          {typing ? (
            <div style={{ display: "flex", gap: 12, padding: "4px 2px" }}>
              {[0, 1, 2].map((d) => (
                <span
                  key={d}
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    background: ink,
                    opacity: 0.35 + 0.55 * Math.max(0, Math.sin(((frame - d * 3) / fps) * Math.PI * 4)),
                  }}
                />
              ))}
            </div>
          ) : (
            <div
              style={{
                fontFamily: uiStack,
                fontWeight: 600,
                fontSize: 52,
                lineHeight: 1.26,
                color: ink,
                opacity: textIn,
                transform: `translateY(${(1 - textIn) * 8}px)`,
                ...BALANCE,
              }}
            >
              {m.params.text}
            </div>
          )}
        </div>
      </div>
    </Place>
  );
};

// ─── Seta ────────────────────────────────────────────────────────────

const ARROW_ROTATION = { down: 0, left: 90, up: 180, right: 270 } as const;

const Arrow: React.FC<{ m: MotionOf<"arrow">; style: CaptionStyle }> = ({ m, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const draw = useRamp(0, 16, Easing.inOut(Easing.cubic));
  const head = useRamp(12, 8);
  const label = useRamp(6, 12);
  const exit = useExit(9);
  const { direction, variant } = m.params;
  // leve vaivém na direção da seta depois de desenhada
  const nudge = frame > 18 ? Math.sin(((frame - 18) / fps) * Math.PI * 2) * 10 : 0;
  const shaft = variant === "curve" ? "M100 18 C 150 70, 52 118, 100 172" : "M100 18 L 100 172";
  const vertical = direction === "down" || direction === "up";
  const axis = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] }[direction];
  const top = direction === "up" ? "58%" : direction === "down" ? "62%" : "50%";
  return (
    <Place m={m} top={top}>
      <div
        {...dragProps(`motion:${m.id}`)}
        style={{
          display: "flex",
          flexDirection: vertical ? "column" : direction === "left" ? "row-reverse" : "row",
          alignItems: "center",
          gap: 10,
          opacity: 1 - exit,
          transform: `translate(${axis[0] * nudge}px, ${axis[1] * nudge}px)`,
        }}
      >
        {m.params.label && (
          <div
            style={{
              fontFamily: fontStack(style),
              fontWeight: 900,
              fontSize: 52,
              textTransform: "uppercase",
              color: "#FFFFFF",
              WebkitTextStroke: `${Math.round(style.strokeWidthPx * 0.6)}px ${style.strokeColor}`,
              paintOrder: "stroke",
              order: direction === "up" ? 2 : 0,
              opacity: label,
              transform: `translateY(${(1 - label) * 10}px)`,
            }}
          >
            {m.params.label}
          </div>
        )}
        <svg
          width={190}
          height={190}
          viewBox="0 0 200 200"
          style={{
            transform: `rotate(${ARROW_ROTATION[direction]}deg)`,
            filter: "drop-shadow(0 8px 18px rgba(0,0,0,0.45))",
            overflow: "visible",
          }}
        >
          <path
            d={shaft}
            fill="none"
            stroke={style.highlightColor}
            strokeWidth={14}
            strokeLinecap="round"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1 - draw}
          />
          <path
            d="M62 140 L100 180 L138 140"
            fill="none"
            stroke={style.highlightColor}
            strokeWidth={14}
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity={head}
            transform={`translate(0 ${(1 - head) * -14})`}
          />
        </svg>
      </div>
    </Place>
  );
};

// ─── Flash ───────────────────────────────────────────────────────────

const Flash: React.FC<{ m: MotionOf<"flash"> }> = ({ m }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const peak = m.params.intensity === "subtle" ? 0.45 : 0.85;
  const peakAt = Math.min(2, Math.max(1, durationInFrames - 1));
  const opacity =
    durationInFrames < 2
      ? 0
      : interpolate(frame, [0, peakAt, durationInFrames], [0, peak, 0], { extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ background: m.params.color, opacity }} />;
};

/** Um motion de tela (zoom é aplicado no vídeo pela composição) */
export const MotionBody: React.FC<{ m: PlacedMotion["motion"]; style: CaptionStyle }> = ({ m, style }) => {
  switch (m.kind) {
    case "keyword":
      return <Keyword m={m} style={style} />;
    case "emoji":
      return <Emoji m={m} />;
    case "lowerThird":
      return <LowerThird m={m} style={style} />;
    case "counter":
      return <Counter m={m} style={style} />;
    case "flash":
      return <Flash m={m} />;
    case "kinetic":
      return <Kinetic m={m} style={style} />;
    case "statement":
      return <Statement m={m} style={style} />;
    case "list":
      return <ListMotion m={m} style={style} />;
    case "bubble":
      return <Bubble m={m} style={style} />;
    case "arrow":
      return <Arrow m={m} style={style} />;
    case "annotation":
      return <AnnotationMotion m={m} style={style} />;
    case "chart":
      return <ChartMotion m={m} style={style} />;
    case "callout":
      return <CalloutMotion m={m} style={style} />;
    case "speedLines":
      return <SpeedLinesMotion m={m} />;
    case "screen":
      return <ScreenMotion m={m} style={style} />;
    case "transition":
      return <TransitionMotion m={m} />;
    case "illustration":
      return <IllustrationMotion m={m} style={style} />;
    case "zoom":
      return null;
  }
};

/** Carrega as fontes dos motions (a da legenda + a de apoio) */
export function useMotionFonts(style: CaptionStyle): void {
  useGoogleFont(style.fontFamily); // 900: peso dos motions originais
  useGoogleFont(style.fontFamily, 800);
  useGoogleFont(UI_FONT, 600);
  useGoogleFont(UI_FONT, 800);
}

/**
 * Motions de tela (tudo menos zoom, que é aplicado no vídeo pela composição).
 * Recebe os motions já posicionados no tempo final por placeMotions.
 */
export const Motions: React.FC<{
  placed: PlacedMotion[];
  style: CaptionStyle;
  /** Cor padrão dos motions do vídeo (null = a de destaque da legenda) */
  defaultAccent?: string | null;
}> = ({ placed, style, defaultAccent = null }) => {
  const { fps } = useVideoConfig();
  useMotionFonts(style);
  return (
    <>
      {placed.map(({ motion: m, outputStart }) => {
        if (m.kind === "zoom") return null;
        // todos os componentes leem o destaque de highlightColor: resolve aqui, uma vez
        const accent = resolveMotionAccent(m.accentColor, defaultAccent, style.highlightColor);
        const motionStyle = accent === style.highlightColor ? style : { ...style, highlightColor: accent };
        return (
          <Sequence
            key={m.id}
            from={Math.round(outputStart * fps)}
            durationInFrames={Math.max(1, Math.round(m.durationSeconds * fps))}
          >
            <MotionBody m={m} style={motionStyle} />
          </Sequence>
        );
      })}
    </>
  );
};
