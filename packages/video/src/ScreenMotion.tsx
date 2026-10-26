/**
 * Tela cheia: quebra o quadro do vídeo com um fundo animado (papel, grid,
 * pontos, gradiente) e uma frase grande entrando palavra a palavra — ou, no
 * modelo lista, um título e itens entrando um a um. Tudo
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

/** Frase grande entrando palavra a palavra (a partir do frame 6, 3 frames entre palavras) */
const Phrase: React.FC<{
  text: string;
  emphasis: string;
  size: number;
  tone: Tone;
  accent: string;
  ink: string;
  align: "center" | "left";
  fontFamily: string;
}> = ({ text, emphasis, size, tone, accent, ink, align, fontFamily }) => {
  const frame = useCurrentFrame();
  const words = text.split(/\s+/).filter(Boolean);
  const emph = new Set(emphasis.split(/\s+/).map(norm).filter(Boolean));
  return (
    <div
      style={{
        fontFamily: `'${fontFamily}', 'Arial Black', sans-serif`,
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
  );
};

/** Frame em que a frase de `words` palavras termina de entrar */
const phraseEnd = (text: string) => 6 + text.split(/\s+/).filter(Boolean).length * 3 + 10;

const CheckIcon: React.FC<{ color: string; progress: number }> = ({ color, progress }) => (
  <svg width="56%" height="56%" viewBox="0 0 24 24" fill="none">
    <path
      d="M4 12.5l5 5L20 6.5"
      stroke={color}
      strokeWidth={3.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      pathLength={1}
      strokeDasharray={1}
      strokeDashoffset={1 - progress}
    />
  </svg>
);

/**
 * Modelo lista: título (frase com destaque) e 2–5 itens entrando um a um,
 * distribuídos no tempo do motion — o último entra com folga antes da saída.
 * Cada item: marcador na cor de destaque (número ou check desenhado) e um fio
 * que se desenha embaixo.
 */
const ListBody: React.FC<{ m: MotionOf<"screen">; accent: string; ink: string; fontFamily: string }> = ({ m, accent, ink, fontFamily }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const { text, emphasis, tone, items, marker, align } = m.params;
  const titleSize = Math.round(Math.max(64, Math.min(108, 108 * Math.sqrt(16 / Math.max(16, text.length)))));
  const longest = Math.max(...items.map((i) => i.length), 1);
  // cabe numa linha: ~760 px livres ao lado do marcador, ~0,6 em por letra (Poppins 800)
  const itemSize = Math.round(Math.max(48, Math.min(72, 760 / (longest * 0.6))));
  const chip = Math.round(itemSize * 1.25);
  const first = phraseEnd(text) - 4;
  // os itens se espalham até ~0,8 s antes da saída (9 frames) para dar tempo de ler o último
  const room = durationInFrames - 9 - 24 - first;
  const gap = Math.max(5, Math.min(16, room / Math.max(items.length, 1)));
  const onChip = contrastText(accent);
  const rule = tone === "light" ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.16)";
  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: align === "left" ? "flex-start" : "center" }}>
      <Phrase text={text} emphasis={emphasis} size={titleSize} tone={tone} accent={accent} ink={ink} align={align} fontFamily={fontFamily} />
      <div style={{ marginTop: Math.round(titleSize * 0.55), display: "flex", flexDirection: "column", gap: Math.round(itemSize * 0.42), alignSelf: "stretch" }}>
        {items.map((item, i) => {
          const start = first + i * gap;
          const p = interpolate(frame, [start, start + 12], [0, 1], { ...clamp, easing: EASE_OUT_EXPO });
          const pop = interpolate(frame, [start, start + 8, start + 14], [0.4, 1.12, 1], clamp);
          const draw = interpolate(frame, [start + 6, start + 20], [0, 1], { ...clamp, easing: EASE_OUT_EXPO });
          return (
            <div
              key={i}
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                gap: Math.round(itemSize * 0.45),
                paddingBottom: Math.round(itemSize * 0.36),
                opacity: p,
                transform: `translateX(${(1 - p) * -60}px)`,
              }}
            >
              <div
                style={{
                  flex: "none",
                  width: chip,
                  height: chip,
                  borderRadius: "50%",
                  background: accent,
                  color: onChip,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: `'${fontFamily}', 'Arial Black', sans-serif`,
                  fontWeight: 900,
                  fontSize: Math.round(chip * 0.5),
                  transform: `scale(${pop})`,
                  boxShadow: tone === "light" ? "0 6px 18px rgba(0,0,0,0.12)" : "0 6px 18px rgba(0,0,0,0.4)",
                }}
              >
                {marker === "check" ? <CheckIcon color={onChip} progress={draw} /> : i + 1}
              </div>
              <div
                style={{
                  fontFamily: `'${fontFamily}', 'Arial Black', sans-serif`,
                  fontWeight: 800,
                  fontSize: itemSize,
                  lineHeight: 1.1,
                  letterSpacing: "-0.01em",
                  color: ink,
                  textWrap: "balance",
                } as React.CSSProperties}
              >
                {item}
              </div>
              {/* fio que se desenha embaixo do item */}
              <span
                style={{
                  position: "absolute",
                  left: chip + Math.round(itemSize * 0.45),
                  right: 0,
                  bottom: 0,
                  height: 4,
                  borderRadius: 2,
                  background: rule,
                  transform: `scaleX(${draw})`,
                  transformOrigin: "left center",
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const ScreenMotion: React.FC<{ m: MotionOf<"screen">; style: CaptionStyle }> = ({ m, style }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const { text, eyebrow, emphasis, variant, tone, transition, align } = m.params;
  const accent = style.highlightColor;
  const ink = tone === "light" ? "#151515" : "#ffffff";
  const isList = m.params.layout === "list" && m.params.items.length > 0;

  // entrada/saída que quebram o quadro: a tela sobe por cima do vídeo e sai subindo
  const enter = interpolate(frame, [0, 11], [0, 1], { ...clamp, easing: EASE_OUT_EXPO });
  const leave = interpolate(frame, [durationInFrames - 9, durationInFrames], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
  const sheet: React.CSSProperties =
    transition === "slide"
      ? { transform: `translateY(${(1 - enter) * 100 - leave * 100}%)` }
      : { opacity: enter * (1 - leave) };

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
        {isList ? (
          <ListBody m={m} accent={accent} ink={ink} fontFamily={style.fontFamily} />
        ) : (
          <Phrase text={text} emphasis={emphasis} size={size} tone={tone} accent={accent} ink={ink} align={align} fontFamily={style.fontFamily} />
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
