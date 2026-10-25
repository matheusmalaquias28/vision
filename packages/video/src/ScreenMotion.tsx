/**
 * Tela cheia: quebra o quadro do vídeo com um fundo animado (papel, grid,
 * pontos, gradiente) e uma frase grande entrando palavra a palavra. Tudo
 * é função do frame (textura do papel "ferve" trocando a semente a cada 3
 * frames), então o preview é igual ao MP4. Cor de destaque = a do motion.
 */
import React from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { CaptionStyle, MotionOf } from "@vision/recipe";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const EASE_OUT_EXPO = Easing.bezier(0.16, 1, 0.3, 1);
const uiStack = "'Inter', 'Segoe UI', system-ui, sans-serif";

type Tone = "light" | "dark";

const BASE: Record<string, Record<Tone, string>> = {
  paper: { light: "#f1ebdf", dark: "#23211e" },
  grid: { light: "#f5f5f1", dark: "#0d1016" },
  dots: { light: "#f4f2ee", dark: "#101217" },
  gradient: { light: "#f3efe9", dark: "#0b0d12" },
};

function withAlpha(hex: string, a: number): string {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return hex;
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function contrastText(hex: string): string {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return "#000000";
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? "#111111" : "#ffffff";
}

const Vignette: React.FC<{ tone: Tone }> = ({ tone }) => (
  <AbsoluteFill
    style={{
      background:
        tone === "light"
          ? "radial-gradient(ellipse 85% 70% at 50% 45%, rgba(0,0,0,0) 55%, rgba(60,40,20,0.16) 100%)"
          : "radial-gradient(ellipse 85% 70% at 50% 45%, rgba(0,0,0,0) 50%, rgba(0,0,0,0.55) 100%)",
    }}
  />
);

/** Papel: grão que "ferve" (semente nova a cada 3 frames) + manchas suaves de fibra */
const PaperBg: React.FC<{ tone: Tone; id: string }> = ({ tone, id }) => {
  const frame = useCurrentFrame();
  const seed = Math.floor(frame / 3);
  const jitter = (seed % 3) - 1;
  return (
    <AbsoluteFill style={{ backgroundColor: BASE.paper[tone] }}>
      <svg width="100%" height="100%" viewBox="0 0 1080 1920" preserveAspectRatio="none" style={{ position: "absolute", inset: 0 }}>
        <defs>
          <filter id={`grain-${id}`} x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves={2} seed={seed} />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <filter id={`fiber-${id}`} x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.006 0.02" numOctaves={3} seed={7} />
            <feColorMatrix type="saturate" values="0" />
          </filter>
        </defs>
        <rect width="1080" height="1920" filter={`url(#fiber-${id})`} opacity={tone === "light" ? 0.16 : 0.22} style={{ mixBlendMode: tone === "light" ? "multiply" : "screen" }} />
        <rect
          width="1080"
          height="1920"
          filter={`url(#grain-${id})`}
          opacity={tone === "light" ? 0.22 : 0.18}
          transform={`translate(${jitter * 2} ${-jitter * 2})`}
          style={{ mixBlendMode: tone === "light" ? "multiply" : "screen" }}
        />
      </svg>
      <Vignette tone={tone} />
    </AbsoluteFill>
  );
};

/** Grid sutil andando devagar, com um brilho da cor de destaque */
const GridBg: React.FC<{ tone: Tone; accent: string }> = ({ tone, accent }) => {
  const frame = useCurrentFrame();
  // traço grosso o bastante para sobreviver à redução da tela do celular (~2,7×)
  const line = tone === "light" ? "rgba(0,0,0,0.09)" : "rgba(255,255,255,0.09)";
  const major = tone === "light" ? "rgba(0,0,0,0.15)" : "rgba(255,255,255,0.16)";
  const gx = 50 + Math.sin(frame / 40) * 18;
  const gy = 40 + Math.cos(frame / 55) * 10;
  return (
    <AbsoluteFill style={{ backgroundColor: BASE.grid[tone] }}>
      <AbsoluteFill
        style={{
          backgroundImage: `linear-gradient(${major} 4px, transparent 4px), linear-gradient(90deg, ${major} 4px, transparent 4px), linear-gradient(${line} 2px, transparent 2px), linear-gradient(90deg, ${line} 2px, transparent 2px)`,
          backgroundSize: "360px 360px, 360px 360px, 90px 90px, 90px 90px",
          backgroundPosition: `${-frame * 0.6}px ${-frame * 0.35}px`,
        }}
      />
      <AbsoluteFill style={{ background: `radial-gradient(circle at ${gx}% ${gy}%, ${withAlpha(accent, tone === "light" ? 0.16 : 0.22)} 0%, transparent 45%)` }} />
      <Vignette tone={tone} />
    </AbsoluteFill>
  );
};

/** Malha de pontos em diagonal, leve */
const DotsBg: React.FC<{ tone: Tone; accent: string }> = ({ tone, accent }) => {
  const frame = useCurrentFrame();
  const dot = tone === "light" ? "rgba(0,0,0,0.2)" : "rgba(255,255,255,0.18)";
  return (
    <AbsoluteFill style={{ backgroundColor: BASE.dots[tone] }}>
      <AbsoluteFill
        style={{
          backgroundImage: `radial-gradient(${dot} 4.5px, transparent 5px)`,
          backgroundSize: "54px 54px",
          backgroundPosition: `${frame * 0.5}px ${frame * 0.5}px`,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at ${30 + Math.sin(frame / 50) * 12}% 70%, ${withAlpha(accent, tone === "light" ? 0.14 : 0.2)} 0%, transparent 40%)`,
        }}
      />
      <Vignette tone={tone} />
    </AbsoluteFill>
  );
};

/** Gradiente vivo: três manchas de luz se movendo devagar */
const GradientBg: React.FC<{ tone: Tone; accent: string }> = ({ tone, accent }) => {
  const frame = useCurrentFrame();
  const t = frame / 30;
  const a = withAlpha(accent, tone === "light" ? 0.42 : 0.5);
  const b = tone === "light" ? "rgba(255,190,150,0.45)" : "rgba(80,90,255,0.35)";
  const c = tone === "light" ? "rgba(160,200,255,0.4)" : "rgba(255,60,140,0.25)";
  return (
    <AbsoluteFill
      style={{
        backgroundColor: BASE.gradient[tone],
        backgroundImage: [
          `radial-gradient(circle at ${30 + Math.sin(t * 0.7) * 15}% ${30 + Math.cos(t * 0.5) * 10}%, ${a} 0%, transparent 42%)`,
          `radial-gradient(circle at ${72 + Math.cos(t * 0.6) * 12}% ${62 + Math.sin(t * 0.4) * 12}%, ${b} 0%, transparent 45%)`,
          `radial-gradient(circle at ${45 + Math.sin(t * 0.3) * 20}% ${88 + Math.cos(t * 0.8) * 6}%, ${c} 0%, transparent 40%)`,
        ].join(", "),
      }}
    >
      <Vignette tone={tone} />
    </AbsoluteFill>
  );
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");

export const ScreenMotion: React.FC<{ m: MotionOf<"screen">; style: CaptionStyle }> = ({ m, style }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const { text, eyebrow, emphasis, variant, tone, transition, align } = m.params;
  const accent = style.highlightColor;
  const ink = tone === "light" ? "#151515" : "#ffffff";

  // entrada/saída que quebram o quadro: a tela sobe por cima do vídeo e sai subindo
  const enter = interpolate(frame, [0, 11], [0, 1], { ...clamp, easing: EASE_OUT_EXPO });
  const leave = interpolate(frame, [durationInFrames - 9, durationInFrames], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
  const sheet: React.CSSProperties =
    transition === "slide"
      ? { transform: `translateY(${(1 - enter) * 100 - leave * 100}%)` }
      : { opacity: enter * (1 - leave) };

  const words = text.split(/\s+/).filter(Boolean);
  const emph = new Set(emphasis.split(/\s+/).map(norm).filter(Boolean));
  const size = Math.round(Math.max(84, Math.min(150, 150 * Math.sqrt(12 / Math.max(12, text.length)))));
  const eyebrowIn = interpolate(frame, [4, 14], [0, 1], { ...clamp, easing: EASE_OUT_EXPO });

  return (
    <AbsoluteFill style={{ ...sheet, overflow: "hidden" }}>
      {variant === "paper" ? (
        <PaperBg tone={tone} id={m.id} />
      ) : variant === "grid" ? (
        <GridBg tone={tone} accent={accent} />
      ) : variant === "dots" ? (
        <DotsBg tone={tone} accent={accent} />
      ) : (
        <GradientBg tone={tone} accent={accent} />
      )}
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: align === "left" ? "flex-start" : "center",
          padding: "0 9%",
        }}
      >
        {eyebrow && (
          <div
            style={{
              fontFamily: uiStack,
              fontWeight: 800,
              fontSize: 36,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: tone === "light" && contrastText(accent) === "#111111" ? ink : accent,
              marginBottom: 34,
              opacity: eyebrowIn,
              transform: `translateY(${(1 - eyebrowIn) * 16}px)`,
              display: "flex",
              alignItems: "center",
              gap: 18,
            }}
          >
            <span style={{ width: 54, height: 6, borderRadius: 3, background: accent, display: "inline-block" }} />
            {eyebrow}
          </div>
        )}
        <div
          style={{
            fontFamily: `'${style.fontFamily}', 'Arial Black', sans-serif`,
            fontWeight: 900,
            fontSize: size,
            lineHeight: 1.08,
            letterSpacing: "-0.02em",
            color: ink,
            textAlign: align,
            maxWidth: "100%",
            textWrap: "balance",
          } as React.CSSProperties}
        >
          {words.map((w, i) => {
            const start = 6 + i * 3;
            const p = interpolate(frame, [start, start + 10], [0, 1], { ...clamp, easing: EASE_OUT_EXPO });
            const hot = emph.has(norm(w));
            // destaque: no fundo claro vira marca-texto (amarelo sobre creme não se lê); no escuro, a cor
            const mark = hot && tone === "light";
            const markIn = interpolate(frame, [start + 4, start + 12], [0, 1], { ...clamp, easing: EASE_OUT_EXPO });
            return (
              <React.Fragment key={i}>
                <span
                  style={{
                    display: "inline-block",
                    position: "relative",
                    opacity: p,
                    transform: `translateY(${(1 - p) * 0.35}em)`,
                    color: hot && !mark ? accent : mark ? contrastText(accent) : ink,
                    padding: mark ? "0 0.08em" : undefined,
                  }}
                >
                  {/* marca vem antes no DOM: o texto (posicionado, depois) pinta por cima */}
                  {mark && (
                    <span
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        top: "12%",
                        bottom: "6%",
                        background: accent,
                        borderRadius: "0.08em",
                        transform: `scaleX(${markIn})`,
                        transformOrigin: "left center",
                      }}
                    />
                  )}
                  <span style={{ position: "relative" }}>{w}</span>
                </span>
                {i < words.length - 1 ? " " : ""}
              </React.Fragment>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
