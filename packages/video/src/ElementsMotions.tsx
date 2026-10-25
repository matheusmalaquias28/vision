/**
 * Motions adaptados do Remotion Elements (remotion.dev/elements): Text
 * Marker, Circle Marker, Strike Through, Crossed Off, Pie/Bar/Column/Line
 * Chart, Wiggling Callout e Speed Lines. O movimento segue o original; o
 * visual foi trocado para vídeo vertical (cartão escuro sobre o vídeo, fonte
 * da legenda, cor de destaque do Vision) e os textos/números vêm da receita.
 * Sem `Interactive` (camada de edição do Studio): no Vision quem edita é o
 * painel de propriedades. Tudo é função do frame (preview = MP4).
 */
import { Circle, CrossedOff, Highlight, StrikeThrough } from "@remotion/rough-notation";
import { makeCallout } from "@remotion/shapes";
import React from "react";
import { AbsoluteFill, Easing, interpolate, random, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { CaptionStyle, MotionOf } from "@vision/recipe";
import { AtPoint, dragProps } from "./Positioned";

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const EASE_OUT_EXPO = Easing.bezier(0.16, 1, 0.3, 1);
const uiStack = "'Inter', 'Segoe UI', system-ui, sans-serif";
const fontStack = (style: CaptionStyle) => `'${style.fontFamily}', 'Arial Black', sans-serif`;
const SOFT_SHADOW = "0 6px 28px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.45)";
const CARD_BG = "rgba(12,14,20,0.82)";
const BALANCE = { textWrap: "balance" } as React.CSSProperties;

/** Posição livre (arrastada) ou faixa na altura dada (% da ALTURA do quadro) */
const Place: React.FC<{ m: { placement: { x: number; y: number } | null }; top: string; children: React.ReactNode }> = ({
  m,
  top,
  children,
}) =>
  m.placement ? (
    <AtPoint at={m.placement}>{children}</AtPoint>
  ) : (
    <AbsoluteFill>
      <div style={{ position: "absolute", top, left: 0, right: 0, display: "flex", justifyContent: "center" }}>{children}</div>
    </AbsoluteFill>
  );

function contrastText(hex: string): string {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return "#000000";
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? "#000000" : "#FFFFFF";
}

function withAlpha(hex: string, alpha: number): string {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return hex;
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function useExit(frames = 9): number {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return interpolate(frame, [durationInFrames - frames, durationInFrames], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
}

const fmt = (v: number) =>
  v.toLocaleString("pt-BR", { maximumFractionDigits: Number.isInteger(v) ? 0 : 1, minimumFractionDigits: 0 });

// ─── Marcação desenhada (Text Marker · Circle Marker · Strike Through · Crossed Off) ───

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");

/** Faixa de palavras da frase que recebe a marcação (padrão: a palavra mais longa) */
function targetRange(words: string[], target: string): [number, number] {
  const t = target.split(/\s+/).map(norm).filter(Boolean);
  if (t.length > 0) {
    for (let i = 0; i + t.length <= words.length; i++) {
      if (t.every((w, k) => norm(words[i + k]) === w)) return [i, i + t.length];
    }
  }
  let best = 0;
  words.forEach((w, i) => {
    if (norm(w).length > norm(words[best]).length) best = i;
  });
  return [best, best + 1];
}

/** Tempo de desenho de cada traço, como no original */
const DRAW = {
  marker: { frames: 22, easing: Easing.out(Easing.cubic) },
  circle: { frames: 30, easing: Easing.bezier(0.42, 0, 0.58, 1) },
  strike: { frames: 14, easing: Easing.inOut(Easing.quad) },
  crossed: { frames: 20, easing: Easing.inOut(Easing.quad) },
} as const;

export const AnnotationMotion: React.FC<{ m: MotionOf<"annotation">; style: CaptionStyle }> = ({ m, style }) => {
  const frame = useCurrentFrame();
  const intro = interpolate(frame, [0, 10], [0, 1], { ...clamp, easing: EASE_OUT_EXPO });
  const exit = useExit();
  const { variant, text } = m.params;
  const words = text.split(/\s+/).filter(Boolean);
  const [a, b] = targetRange(words, m.params.target);
  const accent = style.highlightColor;
  const size = Math.round(Math.max(64, Math.min(104, 104 * (16 / Math.max(16, text.length)) ** 0.5)));
  const draw = DRAW[variant];
  const progress = interpolate(frame, [8, 8 + draw.frames], [0, 1], { ...clamp, easing: draw.easing });
  const target = words.slice(a, b).join(" ");
  const shared = { progress, seed: 7 };
  const mark =
    variant === "marker" ? (
      <Highlight
        {...shared}
        color={withAlpha(accent, 0.92)}
        roughness={2.3}
        maxRandomnessOffset={6}
        bowing={0}
        padding={{ left: 8, right: 8, top: 2, bottom: 2 }}
        style={{ color: contrastText(accent), textShadow: "none" }}
      >
        {target}
      </Highlight>
    ) : variant === "circle" ? (
      <Circle {...shared} color={accent} roughness={1.8} strokeWidth={9} padding={{ left: 14, right: 14, top: 2, bottom: 2 }}>
        {target}
      </Circle>
    ) : variant === "strike" ? (
      <StrikeThrough {...shared} color={accent} strokeWidth={14}>
        {target}
      </StrikeThrough>
    ) : (
      <CrossedOff {...shared} color={accent} strokeWidth={7} iterations={2} roughness={1.6}>
        {target}
      </CrossedOff>
    );
  return (
    <Place m={m} top={m.params.position === "top" ? "10%" : "30%"}>
      <div
        {...dragProps(`motion:${m.id}`)}
        style={{
          maxWidth: "86%",
          textAlign: "center",
          fontFamily: fontStack(style),
          fontWeight: 900,
          fontSize: size,
          lineHeight: variant === "circle" ? 1.42 : 1.2,
          textTransform: "uppercase",
          color: "#FFFFFF",
          textShadow: SOFT_SHADOW,
          opacity: intro * (1 - exit),
          transform: `translateY(${(1 - intro) * 24 - exit * 16}px)`,
          ...BALANCE,
        }}
      >
        {words.slice(0, a).join(" ")}
        {a > 0 ? " " : ""}
        {mark}
        {b < words.length ? " " : ""}
        {words.slice(b).join(" ")}
      </div>
    </Place>
  );
};

// ─── Gráficos (Pie · Horizontal Bar · Vertical Bar · Line Chart) ───────────

const SLICE_GREYS = ["#9ca3af", "#6b7280", "#d1d5db", "#4b5563", "#e5e7eb", "#374151"];

const ChartCard: React.FC<{ m: MotionOf<"chart">; style: CaptionStyle; children: React.ReactNode }> = ({ m, style, children }) => {
  const frame = useCurrentFrame();
  const card = interpolate(frame, [0, 12], [0, 1], { ...clamp, easing: EASE_OUT_EXPO });
  const exit = useExit(10);
  return (
    <Place m={m} top={m.params.position === "top" ? "8%" : "20%"}>
      <div
        {...dragProps(`motion:${m.id}`)}
        style={{
          width: "84%",
          maxWidth: 920,
          boxSizing: "border-box",
          padding: "40px 46px 44px",
          borderRadius: 36,
          background: CARD_BG,
          boxShadow: "0 24px 70px rgba(0,0,0,0.45)",
          color: "#FFFFFF",
          fontVariantNumeric: "tabular-nums",
          opacity: card * (1 - exit),
          transform: `translateY(${(1 - card) * 28 - exit * 18}px) scale(${0.96 + card * 0.04})`,
        }}
      >
        {m.params.title && (
          <div
            style={{
              fontFamily: uiStack,
              fontWeight: 800,
              fontSize: 34,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: style.highlightColor,
              marginBottom: 30,
            }}
          >
            {m.params.title}
          </div>
        )}
        {children}
      </div>
    </Place>
  );
};

const valueText = (m: MotionOf<"chart">, v: number) => `${m.params.prefix}${fmt(v)}${m.params.suffix}`;

/** Barras horizontais: rótulo e valor em cima, barra crescendo embaixo; a maior em destaque */
const BarsChart: React.FC<{ m: MotionOf<"chart">; style: CaptionStyle }> = ({ m, style }) => {
  const frame = useCurrentFrame();
  const items = m.params.items;
  const max = Math.max(...items.map((i) => i.value), 1e-9);
  const top = items.findIndex((i) => i.value === max);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      {items.map((it, i) => {
        const start = 8 + i * 6;
        const grow = interpolate(frame, [start, start + 33], [0, 1], { ...clamp, easing: Easing.bezier(0, 0, 0.58, 1) });
        const labels = interpolate(frame, [start + 14, start + 22], [0, 1], clamp);
        const hot = i === top;
        return (
          <div key={i}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12, opacity: labels }}>
              <span style={{ fontFamily: uiStack, fontWeight: 700, fontSize: 40, color: "rgba(255,255,255,0.88)" }}>{it.label}</span>
              <span style={{ fontFamily: fontStack(style), fontWeight: 900, fontSize: 48, color: hot ? style.highlightColor : "#FFFFFF" }}>
                {valueText(m, it.value)}
              </span>
            </div>
            <div style={{ height: 30, borderRadius: 15, background: "rgba(255,255,255,0.12)", overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${(it.value / max) * 100}%`,
                  borderRadius: 15,
                  background: hot ? style.highlightColor : "rgba(255,255,255,0.55)",
                  transform: `scaleX(${grow})`,
                  transformOrigin: "left center",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

/** Colunas: crescem de baixo, valor aparece no topo; a maior em destaque */
const ColumnsChart: React.FC<{ m: MotionOf<"chart">; style: CaptionStyle }> = ({ m, style }) => {
  const frame = useCurrentFrame();
  const items = m.params.items;
  const max = Math.max(...items.map((i) => i.value), 1e-9);
  const top = items.findIndex((i) => i.value === max);
  const H = 440;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-around", gap: 22, height: H + 140 }}>
      {items.map((it, i) => {
        const start = 8 + i * 6;
        const grow = interpolate(frame, [start, start + 30], [0, 1], { ...clamp, easing: Easing.bezier(0, 0, 0.58, 1) });
        const label = interpolate(frame, [start + 18, start + 26], [0, 1], clamp);
        const hot = i === top;
        const h = Math.max(8, (it.value / max) * H);
        return (
          <div key={i} style={{ flex: 1, maxWidth: 170, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div
              style={{
                fontFamily: fontStack(style),
                fontWeight: 900,
                fontSize: 44,
                marginBottom: 12,
                color: hot ? style.highlightColor : "#FFFFFF",
                opacity: label,
                whiteSpace: "nowrap",
              }}
            >
              {valueText(m, it.value)}
            </div>
            <div
              style={{
                width: "100%",
                height: h,
                borderRadius: "18px 18px 8px 8px",
                background: hot ? style.highlightColor : "rgba(255,255,255,0.5)",
                transform: `scaleY(${grow})`,
                transformOrigin: "bottom center",
              }}
            />
            <div
              style={{
                fontFamily: uiStack,
                fontWeight: 700,
                fontSize: 34,
                marginTop: 14,
                color: "rgba(255,255,255,0.85)",
                textAlign: "center",
                lineHeight: 1.15,
                opacity: label,
              }}
            >
              {it.label}
            </div>
          </div>
        );
      })}
    </div>
  );
};

/** Rosca (pizza) revelada no sentido horário, valor principal no centro, legenda embaixo */
const PieChart: React.FC<{ m: MotionOf<"chart">; style: CaptionStyle }> = ({ m, style }) => {
  const frame = useCurrentFrame();
  const accent = style.highlightColor;
  const given = m.params.items;
  // uma porcentagem só (ex.: 70%): o resto vira a fatia cinza "restante"
  const isPercent = m.params.suffix.trim().startsWith("%");
  const items =
    given.length === 1 && isPercent && given[0].value < 100 ? [...given, { label: "", value: 100 - given[0].value }] : given;
  const total = items.reduce((a, i) => a + i.value, 0) || 1;
  const reveal = interpolate(frame, [8, 50], [0, 360], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  const center = interpolate(frame, [30, 44], [0, 1], { ...clamp, easing: EASE_OUT_EXPO });
  let angle = 0;
  const R = 222;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 34 }}>
      <div style={{ position: "relative", width: 520, height: 520 }}>
        {/* rosca: cada fatia é um trecho do traço de um círculo, começando às 12h */}
        <svg viewBox="0 0 600 600" width={520} height={520} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={300} cy={300} r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={116} />
          {items.map((it, i) => {
            const a0 = angle;
            const a1 = angle + (it.value / total) * 360;
            angle = a1;
            const len = Math.max(0, Math.min(a1, reveal) - a0);
            return (
              <circle
                key={i}
                cx={300}
                cy={300}
                r={R}
                fill="none"
                stroke={i === 0 ? accent : SLICE_GREYS[(i - 1) % SLICE_GREYS.length]}
                strokeWidth={116}
                pathLength={360}
                strokeDasharray={`${len} ${360 - len}`}
                strokeDashoffset={-a0}
                opacity={len > 0 ? 1 : 0}
              />
            );
          })}
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            opacity: center,
            transform: `scale(${0.85 + center * 0.15})`,
          }}
        >
          <div style={{ fontFamily: fontStack(style), fontWeight: 900, fontSize: 104, color: accent, lineHeight: 1 }}>
            {valueText(m, items[0].value)}
          </div>
          <div style={{ fontFamily: uiStack, fontWeight: 700, fontSize: 32, color: "rgba(255,255,255,0.85)", marginTop: 8, maxWidth: 280, textAlign: "center" }}>
            {items[0].label}
          </div>
        </div>
      </div>
      {given.length > 1 && (
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 14 }}>
          {given.map((it, i) => {
            const show = interpolate(frame, [20 + i * 5, 32 + i * 5], [0, 1], clamp);
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 18, opacity: show, transform: `translateX(${(1 - show) * -20}px)` }}>
                <span style={{ width: 26, height: 26, borderRadius: 8, background: i === 0 ? accent : SLICE_GREYS[(i - 1) % SLICE_GREYS.length] }} />
                <span style={{ flex: 1, fontFamily: uiStack, fontWeight: 700, fontSize: 38 }}>{it.label}</span>
                <span style={{ fontFamily: fontStack(style), fontWeight: 900, fontSize: 42 }}>{valueText(m, it.value)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

/** Linha desenhada da esquerda para a direita, pontos surgindo e o último valor em destaque */
const LineChart: React.FC<{ m: MotionOf<"chart">; style: CaptionStyle }> = ({ m, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const accent = style.highlightColor;
  const items = m.params.items;
  const W = 820;
  const H = 380;
  const values = items.map((i) => i.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.18;
  const min = lo - pad;
  const max = hi + pad;
  const pts = items.map((it, i) => ({
    x: items.length === 1 ? W / 2 : (i / (items.length - 1)) * (W - 40) + 20,
    y: ((max - it.value) / (max - min)) * H,
  }));
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const drawEnd = 14 + Math.min(44, items.length * 8);
  const draw = interpolate(frame, [14, drawEnd], [0, 1], { ...clamp, easing: Easing.bezier(0, 0, 0.58, 1) });
  const badge = spring({ frame: frame - drawEnd, fps, config: { damping: 14.5, mass: 0.8, stiffness: 100 } });
  const last = pts[pts.length - 1];
  return (
    <div style={{ position: "relative", height: H + 80 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ overflow: "visible" }}>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} stroke="rgba(255,255,255,0.12)" strokeWidth={2} />
        ))}
        <path
          d={path}
          fill="none"
          stroke={accent}
          strokeWidth={12}
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - draw}
        />
        {pts.map((p, i) => {
          const at = 14 + (i / Math.max(1, pts.length - 1)) * (drawEnd - 14);
          const r = interpolate(frame, [at, at + 8], [0, 11], { ...clamp, easing: Easing.bezier(0.34, 1.56, 0.64, 1) });
          return <circle key={i} cx={p.x} cy={p.y} r={r} fill="#FFFFFF" stroke={accent} strokeWidth={7} />;
        })}
      </svg>
      <div
        style={{
          position: "absolute",
          left: `${(last.x / W) * 100}%`,
          top: last.y,
          transform: `translate(-50%, -150%) scale(${Math.max(0, badge)})`,
          transformOrigin: "bottom center",
          background: accent,
          color: contrastText(accent),
          fontFamily: fontStack(style),
          fontWeight: 900,
          fontSize: 44,
          lineHeight: 1,
          padding: "14px 22px",
          borderRadius: 14,
          whiteSpace: "nowrap",
        }}
      >
        {valueText(m, items[items.length - 1].value)}
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: H + 24, height: 40 }}>
        {items.map((it, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${(pts[i].x / W) * 100}%`,
              transform: "translateX(-50%)",
              fontFamily: uiStack,
              fontWeight: 700,
              fontSize: 30,
              color: "rgba(255,255,255,0.8)",
              whiteSpace: "nowrap",
              opacity: interpolate(frame, [10, 20], [0, 1], clamp),
            }}
          >
            {it.label}
          </div>
        ))}
      </div>
    </div>
  );
};

export const ChartMotion: React.FC<{ m: MotionOf<"chart">; style: CaptionStyle }> = ({ m, style }) => (
  <ChartCard m={m} style={style}>
    {m.params.variant === "pie" ? (
      <PieChart m={m} style={style} />
    ) : m.params.variant === "columns" ? (
      <ColumnsChart m={m} style={style} />
    ) : m.params.variant === "line" ? (
      <LineChart m={m} style={style} />
    ) : (
      <BarsChart m={m} style={style} />
    )}
  </ChartCard>
);

// ─── Selo chamativo (Wiggling Callout) ───────────────────────────────

const POINTER = 70;

export const CalloutMotion: React.FC<{ m: MotionOf<"callout">; style: CaptionStyle }> = ({ m, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const exit = useExit(8);
  const { pointer, text } = m.params;
  const accent = style.highlightColor;
  const bodyW = Math.min(640, Math.max(420, 120 + text.length * 70));
  const bodyH = 260;
  const shape = makeCallout({
    width: bodyW,
    height: bodyH,
    pointerLength: POINTER,
    pointerBaseWidth: 120,
    pointerPosition: 0.5,
    pointerDirection: pointer,
    cornerRadius: 48,
  });
  // corpo do balão dentro da caixa (o bico ocupa POINTER px do lado para onde aponta)
  const body = {
    left: pointer === "left" ? POINTER : 0,
    top: pointer === "up" ? POINTER : 0,
  };
  const pop = spring({ frame, fps, config: { damping: 12, stiffness: 170 } });
  // balanço do original: 0 → 10° → -7° → 3° → 0
  const wiggle = interpolate(frame, [4, 11, 18, 24, 30], [0, 10, -7, 3, 0], { ...clamp, easing: Easing.inOut(Easing.quad) });
  const origin = { down: "50% 100%", up: "50% 0%", left: "0% 50%", right: "100% 50%" }[pointer];
  const size = Math.min(150, Math.round((bodyW - 90) / (text.length * 0.62)));
  return (
    <Place m={m} top={m.params.position === "top" ? "9%" : "34%"}>
      <div
        {...dragProps(`motion:${m.id}`)}
        style={{
          position: "relative",
          width: shape.width,
          height: shape.height,
          transform: `rotate(${wiggle}deg) scale(${(0.5 + pop * 0.5) * (1 - exit * 0.4)})`,
          transformOrigin: origin,
          opacity: Math.min(1, pop * 1.6) * (1 - exit),
          filter: "drop-shadow(0 18px 40px rgba(0,0,0,0.45))",
        }}
      >
        <svg width={shape.width} height={shape.height} viewBox={`0 0 ${shape.width} ${shape.height}`} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
          <path d={shape.path} fill={accent} />
        </svg>
        <div
          style={{
            position: "absolute",
            left: body.left,
            top: body.top,
            width: bodyW,
            height: bodyH,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: fontStack(style),
            fontWeight: 900,
            fontSize: size,
            letterSpacing: "-0.03em",
            lineHeight: 1,
            textTransform: "uppercase",
            color: contrastText(accent),
            whiteSpace: "nowrap",
          }}
        >
          {text}
        </div>
      </div>
    </Place>
  );
};

// ─── Linhas de velocidade (Speed Lines) ──────────────────────────────

export const SpeedLinesMotion: React.FC<{ m: MotionOf<"speedLines"> }> = ({ m }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  // sorteio "semeado" que muda a cada 2 frames: o mesmo frame sempre igual
  const seed = Math.floor(frame / 2);
  const cx = width / 2;
  const cy = height / 2;
  const far = Math.hypot(width, height);
  const color = m.params.tone === "dark" ? "#000000" : "#FFFFFF";
  const peak = m.params.intensity === "subtle" ? 0.45 : 0.85;
  const lines = Array.from({ length: 56 }, (_, i) => {
    const angle = (i / 56) * Math.PI * 2 + random(`angle-${i}-${seed}`) * 0.08;
    const spread = 0.006 + random(`spread-${i}-${seed}`) * 0.014;
    const inner = 0.36 + random(`inner-${i}-${seed}`) * 0.22;
    const x1 = cx + Math.cos(angle - spread) * far;
    const y1 = cy + Math.sin(angle - spread) * far;
    const x2 = cx + Math.cos(angle + spread) * far;
    const y2 = cy + Math.sin(angle + spread) * far;
    const xi = cx + Math.cos(angle) * inner * (width / 2);
    const yi = cy + Math.sin(angle) * inner * (height / 2);
    return `M ${xi} ${yi} L ${x1} ${y1} L ${x2} ${y2} Z`;
  });
  const end = Math.max(4, durationInFrames - 1);
  const opacity = interpolate(frame, [0, Math.min(3, end - 2), Math.max(Math.min(3, end - 2) + 1, end - 5), end], [0, peak, peak, 0], clamp);
  return (
    <AbsoluteFill style={{ opacity, pointerEvents: "none" }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {lines.map((d, i) => (
          <path key={i} d={d} fill={color} />
        ))}
      </svg>
    </AbsoluteFill>
  );
};

// ─── Brilho (Shine) ──────────────────────────────────────────────────

/**
 * Faixa de luz que atravessa o elemento (efeito do Shine, feito em CSS para
 * ficar igual no preview e no render). Passa ao fim da entrada e a cada ~2 s.
 */
export const ShineSweep: React.FC<{ startFrame?: number }> = ({ startFrame = 14 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const period = Math.round(fps * 2);
  const local = frame - startFrame;
  const t = local < 0 ? -1 : (local % period) / Math.round(fps * 0.6);
  const x = t < 0 || t > 1 ? -200 : interpolate(t, [0, 1], [-60, 160], { easing: Easing.inOut(Easing.quad) });
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        borderRadius: "inherit",
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "-50%",
          bottom: "-50%",
          width: "38%",
          left: `${x}%`,
          transform: "rotate(18deg)",
          background: "linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.55) 50%, rgba(255,255,255,0) 100%)",
        }}
      />
    </div>
  );
};
