import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AbsoluteFill,
  Easing,
  getRemotionEnvironment,
  interpolate,
  random,
  spring,
  useCurrentFrame,
  useDelayRender,
  useVideoConfig,
} from "remotion";
import type { CaptionStyle, MotionOf } from "@vision/recipe";
import { mediaSrc } from "./media";
import { AtPoint, dragProps } from "./Positioned";

/**
 * Ilustração gerada (Magnific, colagem de papel): cartão de papel com borda
 * rasgada, fita adesiva e sombra, que entra subindo com giro, flutua de leve
 * enquanto a imagem faz um Ken Burns lento e sai encolhendo. A borda rasgada
 * é sorteada pelo id do motion (estável entre preview e MP4).
 *
 * Sem imagem ainda (geração pendente/falhou): nada no MP4; no Player do
 * editor, um cartão tracejado avisa que a imagem falta.
 */

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const EXIT_FRAMES = 9;
const PAPER = "#F2ECDF";
const INK = "#1F1B16";
const fontStack = (style: CaptionStyle) => `'${style.fontFamily}', 'Arial Black', sans-serif`;
/** Grão do papel: ruído SVG leve, multiplicado sobre o cartão */
const GRAIN = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.35 0 0 0 0 0.3 0 0 0 0 0.22 0 0 0 0.5 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>"
)}")`;

/** Borda rasgada: polígono com recortes irregulares nas 4 bordas */
function tornEdge(seed: string): string {
  const n = 16;
  const j = (i: number) => (random(`${seed}-${i}`) * 1.4).toFixed(2);
  const pts: string[] = [];
  for (let i = 0; i < n; i++) pts.push(`${((i / n) * 100).toFixed(2)}% ${j(i)}%`);
  for (let i = 0; i < n; i++) pts.push(`${(100 - +j(100 + i)).toFixed(2)}% ${((i / n) * 100).toFixed(2)}%`);
  for (let i = 0; i < n; i++) pts.push(`${(100 - (i / n) * 100).toFixed(2)}% ${(100 - +j(200 + i)).toFixed(2)}%`);
  for (let i = 0; i < n; i++) pts.push(`${j(300 + i)}% ${(100 - (i / n) * 100).toFixed(2)}%`);
  return `polygon(${pts.join(", ")})`;
}

type ImageState = "loading" | "ok" | "failed";

/**
 * Segura o render no PRÓPRIO <img> da tela até ele carregar e decodificar
 * (o quadro não sai sem a imagem pintada). Se falhar, libera e devolve
 * "failed" (o cartão some no MP4) em vez de travar o render até o timeout:
 * o <Img> do Remotion com onError nunca libera a espera depois do erro.
 * A espera nasce num layout effect, antes de o navegador poder disparar o
 * load (imagem em cache), para não ficar presa.
 */
function useImageGate(src: string | null) {
  const [state, setState] = useState<ImageState>(src ? "loading" : "failed");
  const { delayRender, continueRender } = useDelayRender();
  const handle = useRef<number | null>(null);
  const ref = useRef<HTMLImageElement | null>(null);

  const release = useCallback((s: ImageState) => setState(s), []);

  // libera o render só depois que o DOM já mostra a imagem (ou já tirou o cartão)
  useLayoutEffect(() => {
    if (state !== "loading" && handle.current !== null) {
      continueRender(handle.current);
      handle.current = null;
    }
  }, [state, continueRender]);

  useLayoutEffect(() => {
    if (!src) {
      setState("failed");
      return;
    }
    setState("loading");
    handle.current = delayRender(`Ilustração ${src}`);
    const el = ref.current;
    if (el?.complete) {
      // já veio do cache antes do efeito
      if (el.naturalWidth > 0) void el.decode().catch(() => undefined).finally(() => release("ok"));
      else release("failed");
    }
    return () => {
      if (handle.current !== null) {
        continueRender(handle.current);
        handle.current = null;
      }
    };
  }, [src, delayRender, continueRender, release]);

  return {
    state,
    imgProps: {
      ref,
      onLoad: (e: React.SyntheticEvent<HTMLImageElement>) =>
        void e.currentTarget
          .decode()
          .catch(() => undefined)
          .finally(() => release("ok")),
      onError: () => release("failed"),
    },
  };
}

const Place: React.FC<{ m: MotionOf<"illustration">; children: React.ReactNode }> = ({ m, children }) =>
  m.placement ? (
    <AtPoint at={m.placement}>{children}</AtPoint>
  ) : (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          top: m.params.position === "center" ? "21%" : "8%",
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
        }}
      >
        {children}
      </div>
    </AbsoluteFill>
  );

export const IllustrationMotion: React.FC<{ m: MotionOf<"illustration">; style: CaptionStyle }> = ({ m, style }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const edge = useMemo(() => tornEdge(m.id), [m.id]);
  /** Inclinação de repouso (±3°), sorteada por motion */
  const tilt = (random(`${m.id}-tilt`) - 0.5) * 6;
  const src = m.params.image ? mediaSrc(m.params.image) : null;
  const { state: image, imgProps } = useImageGate(src);

  // no MP4: sem imagem (ou falhou) o cartão não entra; carregando, o render espera
  if ((image === "failed" || !src) && !getRemotionEnvironment().isPlayer) return null;

  const enter = spring({ frame, fps, config: { damping: 14, stiffness: 120, mass: 0.9 } });
  const exit = interpolate(frame, [durationInFrames - EXIT_FRAMES, durationInFrames], [0, 1], {
    ...clamp,
    easing: Easing.in(Easing.cubic),
  });
  const t = frame / fps;
  // flutuação sutil enquanto está na tela
  const driftY = Math.sin(t * 1.7) * 5;
  const sway = Math.sin(t * 1.1 + 0.6) * 0.7;
  const kenBurns = interpolate(frame, [0, durationInFrames], [1, 1.07], clamp);
  const marker = interpolate(frame, [10, 24], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });

  const y = interpolate(enter, [0, 1], [320, 0]) + driftY - exit * 40;
  const rot = interpolate(enter, [0, 1], [tilt + 10, tilt]) + sway + exit * 6;
  const scale = interpolate(enter, [0, 1], [0.82, 1]) * (1 - exit * 0.12);
  const opacity = Math.min(1, enter * 2.5) * (1 - exit);

  return (
    <Place m={m}>
      <div
        {...dragProps(`motion:${m.id}`)}
        style={{
          position: "relative",
          width: 800,
          transform: `translateY(${y}px) rotate(${rot}deg) scale(${scale})`,
          opacity,
          filter: "drop-shadow(0 22px 34px rgba(0,0,0,0.42)) drop-shadow(0 4px 8px rgba(0,0,0,0.3))",
        }}
      >
        <div
          style={{
            clipPath: edge,
            background: PAPER,
            backgroundImage: GRAIN,
            padding: "30px 30px 26px",
          }}
        >
          <div
            style={{
              position: "relative",
              width: "100%",
              aspectRatio: "1 / 1",
              overflow: "hidden",
              background: "#E4DCCB",
              outline: image === "failed" ? "4px dashed rgba(31,27,22,0.35)" : undefined,
              outlineOffset: -18,
            }}
          >
            {src && image !== "failed" && (
              <img
                {...imgProps}
                src={src}
                alt=""
                decoding="sync"
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  transform: `scale(${kenBurns})`,
                  filter: "contrast(1.03) saturate(0.95)",
                  opacity: image === "ok" ? 1 : 0,
                }}
              />
            )}
            {/* carregando: fundo liso (do cache leva 1 quadro; sem piscar aviso) */}
            {image === "failed" && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 18,
                  padding: 60,
                  textAlign: "center",
                  color: "rgba(31,27,22,0.62)",
                  fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
                }}
              >
                <div style={{ fontSize: 44, fontWeight: 800 }}>
                  {m.params.image ? "Imagem não encontrada" : "Imagem ainda não gerada"}
                </div>
                <div style={{ fontSize: 30, fontWeight: 600, lineHeight: 1.3 }}>{m.params.subject}</div>
                <div style={{ fontSize: 24, fontWeight: 600, opacity: 0.8 }}>Não aparece no vídeo final sem a imagem</div>
              </div>
            )}
            {/* vinheta de papel envelhecido por cima da foto */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                background: "radial-gradient(ellipse at center, transparent 55%, rgba(80,60,30,0.22) 100%)",
                mixBlendMode: "multiply",
              }}
            />
          </div>
          {m.params.label ? (
            <div
              style={{
                marginTop: 22,
                textAlign: "center",
                fontFamily: fontStack(style),
                fontWeight: 900,
                fontSize: 54,
                lineHeight: 1.1,
                textTransform: "uppercase",
                color: INK,
              }}
            >
              <span
                style={{
                  padding: "0 14px",
                  backgroundImage: `linear-gradient(${style.highlightColor}, ${style.highlightColor})`,
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "0 78%",
                  backgroundSize: `${marker * 100}% 46%`,
                  boxDecorationBreak: "clone",
                  WebkitBoxDecorationBreak: "clone",
                }}
              >
                {m.params.label}
              </span>
            </div>
          ) : null}
        </div>
        {/* fita adesiva prendendo o cartão */}
        <div
          style={{
            position: "absolute",
            top: -26,
            left: "50%",
            width: 210,
            height: 58,
            marginLeft: -105,
            transform: `rotate(${-tilt * 0.8 - 3}deg)`,
            background: "rgba(232,221,194,0.82)",
            backgroundImage: GRAIN,
            clipPath:
              "polygon(0 8%, 4% 0, 8% 10%, 12% 0, 88% 0, 92% 9%, 96% 0, 100% 10%, 100% 90%, 96% 100%, 92% 90%, 88% 100%, 12% 100%, 8% 91%, 4% 100%, 0 92%)",
            boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.25)",
          }}
        />
      </div>
    </Place>
  );
};
