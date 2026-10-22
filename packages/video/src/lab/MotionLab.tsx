/**
 * Laboratório de motions: protótipos para o operador escolher ANTES de virarem
 * tipos da biblioteca fechada (Motions.tsx + MotionSchema). Nada aqui é lido
 * pela receita nem pelo render de projetos.
 *
 * Tudo é dirigido por useCurrentFrame(): determinístico no preview e no render.
 */
import { CameraMotionBlur } from "@remotion/motion-blur";
import {
  linearTiming,
  TransitionSeries,
  type TransitionPresentation,
  type TransitionPresentationComponentProps,
} from "@remotion/transitions";
import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  OffthreadVideo,
  random,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { useGoogleFont } from "../fonts";
import { mediaSrc } from "../media";

export const LAB_FPS = 30;
const FONT = "Montserrat";

export interface LabWord {
  text: string;
  /** Segundos no tempo do bruto */
  start: number;
  end: number;
}

export interface MotionLabProps {
  [key: string]: unknown;
  demo: LabDemoId;
  variant: string;
  /** Arquivo do bruto ("media/...") */
  file: string;
  words: LabWord[];
}

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Trecho do bruto a partir de `from` (s), em tela cheia 9:16 */
const Clip: React.FC<{ file: string; from: number; style?: React.CSSProperties }> = ({
  file,
  from,
  style,
}) => (
  <AbsoluteFill style={style}>
    <OffthreadVideo
      src={mediaSrc(file)}
      trimBefore={Math.round(from * LAB_FPS)}
      pauseWhenBuffering
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
  </AbsoluteFill>
);

const heavyText: React.CSSProperties = {
  fontFamily: `'${FONT}', 'Arial Black', sans-serif`,
  fontWeight: 900,
  textTransform: "uppercase",
  color: "#FFFFFF",
  WebkitTextStroke: "12px #000000",
  paintOrder: "stroke",
  lineHeight: 1,
};

// ─── 1. Tipografia cinética ──────────────────────────────────────────

const KINETIC = { from: 10.6, at: 1.2, hold: 2.2, text: "Ente querido" };

/** Bloco centralizado que quebra linha entre palavras (palavras longas não vazam do quadro) */
const kineticBlock: React.CSSProperties = {
  position: "absolute",
  left: "6%",
  right: "6%",
  top: "24%",
  display: "flex",
  flexWrap: "wrap",
  justifyContent: "center",
  columnGap: 34,
  rowGap: 10,
};

const KineticWord: React.FC<{ text: string; variant: string }> = ({ text, variant }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const atF = Math.round(KINETIC.at * fps);
  const endF = atF + Math.round(KINETIC.hold * fps);
  const local = frame - atF;
  if (local < 0) return null;
  const exit = interpolate(frame, [endF - 8, endF], [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
  const words = text.toUpperCase().split(/\s+/);
  // índice global da letra: o atraso escalonado atravessa as palavras
  const offsets = words.map((_, w) => words.slice(0, w).reduce((n, x) => n + x.length, 0));

  if (variant === "blur") {
    // bloco inteiro: entra desfocado, espaçado e grande; assenta com spring
    const s = spring({ frame: local, fps, config: { damping: 14, stiffness: 120 } });
    return (
      <div
        style={{
          ...kineticBlock,
          opacity: Math.min(1, s * 1.6) * (1 - exit),
          filter: `blur(${(1 - s) * 26 + exit * 18}px)`,
          transform: `scale(${interpolate(s, [0, 1], [1.3, 1]) - exit * 0.15})`,
        }}
      >
        {words.map((w, i) => (
          <span
            key={i}
            style={{
              ...heavyText,
              fontSize: 124,
              letterSpacing: `${interpolate(s, [0, 1], [0.35, 0.02])}em`,
            }}
          >
            {w}
          </span>
        ))}
      </div>
    );
  }

  if (variant === "mask") {
    // por palavra: uma faixa de cor varre primeiro; as letras sobem de dentro de uma máscara
    return (
      <div style={kineticBlock}>
        {words.map((word, wi) => {
          const bar = spring({ frame: local - wi * 4, fps, config: { damping: 200 }, durationInFrames: 9 });
          const barOut = interpolate(frame, [endF - 10, endF], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
          return (
            <span key={wi} style={{ position: "relative", display: "inline-block", padding: "10px 22px" }}>
              <span
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "#7CFC9B",
                  borderRadius: 10,
                  transform: `scaleX(${Math.max(0, bar - barOut)})`,
                  transformOrigin: barOut > 0 ? "right" : "left",
                }}
              />
              <span style={{ position: "relative", display: "inline-flex", overflow: "hidden" }}>
                {[...word].map((c, i) => {
                  const k = offsets[wi] + i;
                  const s = spring({ frame: local - 5 - wi * 4 - k * 1.2, fps, config: { damping: 16, stiffness: 160 } });
                  const out = interpolate(frame, [endF - 12 + k * 0.5, endF - 4 + k * 0.5], [0, 1], clamp);
                  return (
                    <span
                      key={i}
                      style={{
                        ...heavyText,
                        fontSize: 96,
                        color: "#0B0B0B",
                        WebkitTextStroke: "0px transparent",
                        display: "inline-block",
                        transform: `translateY(${(1 - s) * 110 - out * 110}%)`,
                      }}
                    >
                      {c}
                    </span>
                  );
                })}
              </span>
            </span>
          );
        })}
      </div>
    );
  }

  // "stagger": letra a letra, cada uma com spring e leve giro
  return (
    <div style={{ ...kineticBlock, opacity: 1 - exit, transform: `translateY(${-exit * 60}px)` }}>
      {words.map((word, wi) => (
        <span key={wi} style={{ display: "inline-flex" }}>
          {[...word].map((c, i) => {
            const k = offsets[wi] + i;
            const s = spring({ frame: local - k * 2, fps, config: { damping: 9, stiffness: 190, mass: 0.6 } });
            return (
              <span
                key={i}
                style={{
                  ...heavyText,
                  fontSize: 104,
                  display: "inline-block",
                  opacity: Math.min(1, Math.max(0, s * 2)),
                  transform: `translateY(${(1 - s) * 90}px) rotate(${(1 - s) * -28}deg) scale(${0.5 + 0.5 * s})`,
                }}
              >
                {c}
              </span>
            );
          })}
        </span>
      ))}
    </div>
  );
};

const KineticDemo: React.FC<MotionLabProps> = ({ file, variant }) => (
  <AbsoluteFill>
    <Clip file={file} from={KINETIC.from} />
    <KineticWord text={KINETIC.text} variant={variant} />
  </AbsoluteFill>
);

// ─── 2. Zoom com motion blur ─────────────────────────────────────────

const ZOOM = { from: 15.6, at: 0.8, hold: 2.2 };

function zoomScale(frame: number, fps: number): number {
  const atF = Math.round(ZOOM.at * fps);
  const endF = atF + Math.round(ZOOM.hold * fps);
  // entra seco (spring rápido, com overshoot), sai suave
  const inS = spring({ frame: frame - atF, fps, config: { damping: 13, stiffness: 260, mass: 0.5 } });
  const out = interpolate(frame, [endF - 10, endF], [0, 1], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  return 1 + 0.42 * inS * (1 - out);
}

/** Tremida de câmera que decai depois do impacto */
function shake(frame: number, fps: number): { x: number; y: number; r: number } {
  const t = frame - Math.round(ZOOM.at * fps);
  if (t < 0) return { x: 0, y: 0, r: 0 };
  const decay = Math.exp(-t / 7);
  return {
    x: Math.sin(t * 1.9) * 22 * decay,
    y: Math.cos(t * 2.3) * 16 * decay,
    r: Math.sin(t * 1.3) * 1.4 * decay,
  };
}

const ZoomedClip: React.FC<{ file: string; withShake: boolean; speedBlur: boolean }> = ({
  file,
  withShake,
  speedBlur,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = zoomScale(frame, fps);
  const k = withShake ? shake(frame, fps) : { x: 0, y: 0, r: 0 };
  // borrão proporcional à velocidade do zoom: um vídeo só, roda liso no preview
  const velocity = Math.abs(s - zoomScale(frame - 1, fps));
  const blur = speedBlur ? Math.min(velocity * 70, 5) : 0;
  return (
    <Clip
      file={file}
      from={ZOOM.from}
      style={{
        transform: `translate(${k.x}px, ${k.y}px) rotate(${k.r}deg) scale(${s})`,
        transformOrigin: "50% 40%",
        filter: blur > 0.3 ? `blur(${blur}px)` : undefined,
      }}
    />
  );
};

const ZoomDemo: React.FC<MotionLabProps> = ({ file, variant }) => {
  if (variant === "real") {
    // CameraMotionBlur mistura subframes (N cópias do vídeo congeladas): borrão
    // de câmera de verdade no render final, mas pesado demais para o preview
    return (
      <CameraMotionBlur shutterAngle={240} samples={6}>
        <ZoomedClip file={file} withShake={false} speedBlur={false} />
      </CameraMotionBlur>
    );
  }
  return (
    <ZoomedClip file={file} withShake={variant === "shake"} speedBlur={variant !== "none"} />
  );
};

// ─── 3. Destaque atrás da palavra ────────────────────────────────────

const HIGHLIGHT = { from: 17.8, until: 21.2, perLine: 3 };

const HighlightDemo: React.FC<MotionLabProps> = ({ file, words, variant }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = HIGHLIGHT.from + frame / fps;
  const inWindow = words.filter((w) => w.start >= HIGHLIGHT.from && w.start < HIGHLIGHT.until);
  const lines: LabWord[][] = [];
  for (let i = 0; i < inWindow.length; i += HIGHLIGHT.perLine) {
    lines.push(inWindow.slice(i, i + HIGHLIGHT.perLine));
  }
  // linha visível: a última que já começou
  const line = [...lines].reverse().find((l) => l[0].start <= t) ?? null;
  const color = variant === "pill" ? "#7CFC9B" : "#FFD400";
  return (
    <AbsoluteFill>
      <Clip file={file} from={HIGHLIGHT.from} />
      {line && (
        <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: "30%" }}>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", justifyContent: "center", maxWidth: "88%" }}>
            {line.map((w, i) => {
              const next = line[i + 1]?.start ?? lines[lines.indexOf(line) + 1]?.[0].start ?? w.end + 0.4;
              const startF = (w.start - HIGHLIGHT.from) * fps;
              const endF = (Math.max(next, w.end) - HIGHLIGHT.from) * fps;
              // entra crescendo da esquerda; sai encolhendo para a direita
              // quando a próxima palavra começa: parece deslizar entre elas
              const grow = spring({ frame: frame - startF, fps, config: { damping: 200 }, durationInFrames: 6 });
              const shrink = interpolate(frame, [endF, endF + 5], [0, 1], { ...clamp, easing: Easing.in(Easing.quad) });
              const amount = Math.max(0, grow - shrink);
              const active = frame >= startF && frame < endF;
              const lineIn = spring({ frame: frame - (line[0].start - HIGHLIGHT.from) * fps - i * 2, fps, config: { damping: 14 } });
              const box: React.CSSProperties =
                variant === "underline"
                  ? { left: -4, right: -4, bottom: -10, height: 16, borderRadius: 8 }
                  : variant === "pill"
                    ? { inset: "-10px -20px", borderRadius: 999 }
                    : { inset: "-6px -14px", borderRadius: 6, transform: "rotate(-2deg)" };
              return (
                <span
                  key={`${w.start}-${i}`}
                  style={{
                    position: "relative",
                    display: "inline-block",
                    transform: `translateY(${(1 - lineIn) * 40}px) scale(${active && variant !== "underline" ? 1.06 : 1})`,
                    opacity: lineIn,
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      ...box,
                      background: color,
                      transform: `${box.transform ?? ""} scaleX(${amount})`,
                      transformOrigin: shrink > 0 ? "right" : "left",
                    }}
                  />
                  <span
                    style={{
                      ...heavyText,
                      position: "relative",
                      fontSize: 76,
                      color: active && variant !== "underline" ? "#0B0B0B" : "#FFFFFF",
                      WebkitTextStroke: active && variant !== "underline" ? "0px transparent" : "10px #000000",
                    }}
                  >
                    {w.text}
                  </span>
                </span>
              );
            })}
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};

// ─── 4. Explosão de emoji ────────────────────────────────────────────

const BURST = { from: 19.0, at: 1.62, emoji: "⏳", count: 16 };
const CONFETTI = ["#FFD400", "#7CFC9B", "#FF4D6D", "#4DA3FF", "#FFFFFF"];

const BurstDemo: React.FC<MotionLabProps> = ({ file, variant }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const local = frame - Math.round(BURST.at * fps);
  const pop = spring({ frame: local, fps, config: { damping: 8, stiffness: 220, mass: 0.7 } });
  const out = interpolate(local, [fps * 1.6, fps * 1.9], [0, 1], clamp);
  const wobble = Math.sin(local / 3) * 10 * Math.exp(-Math.max(local, 0) / 12);
  // centro da explosão (px no quadro 1080×1920)
  const cx = 760;
  const cy = 620;
  const particles = Array.from({ length: BURST.count }, (_, i) => {
    const angle = random(`a${i}`) * Math.PI * 2;
    const speed = 900 + random(`s${i}`) * 1100; // px/s
    const t = Math.max(local, 0) / fps;
    const gravity = variant === "confetti" ? 1400 : 2200;
    return {
      x: cx + Math.cos(angle) * speed * t * Math.exp(-t * 1.8),
      y: cy + Math.sin(angle) * speed * t * Math.exp(-t * 1.8) + 0.5 * gravity * t * t,
      rot: (random(`r${i}`) - 0.5) * 720 * t,
      size: 0.5 + random(`z${i}`) * 0.6,
      fade: interpolate(t, [0.5, 1.1], [1, 0], clamp),
      color: CONFETTI[i % CONFETTI.length],
    };
  });
  const ring = interpolate(local, [0, fps * 0.45], [0, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  return (
    <AbsoluteFill>
      <Clip file={file} from={BURST.from} />
      {local >= 0 && (
        <AbsoluteFill>
          {variant === "ring" && (
            <div
              style={{
                position: "absolute",
                left: cx,
                top: cy,
                width: 520,
                height: 520,
                marginLeft: -260,
                marginTop: -260,
                borderRadius: "50%",
                border: `${(1 - ring) * 40 + 2}px solid #FFD400`,
                transform: `scale(${ring})`,
                opacity: 1 - ring,
              }}
            />
          )}
          {local < fps * 1.2 &&
            particles.map((p, i) =>
              variant === "confetti" ? (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    left: p.x,
                    top: p.y,
                    width: 26 * p.size,
                    height: 44 * p.size,
                    background: p.color,
                    borderRadius: 4,
                    opacity: p.fade,
                    transform: `rotate(${p.rot}deg) rotateX(${p.rot * 1.5}deg)`,
                  }}
                />
              ) : variant === "ring" && i % 2 === 1 ? null : (
                <div
                  key={i}
                  style={{
                    position: "absolute",
                    left: p.x,
                    top: p.y,
                    fontSize: (variant === "ring" ? 46 : 74) * p.size,
                    opacity: p.fade,
                    transform: `translate(-50%, -50%) rotate(${p.rot}deg)`,
                  }}
                >
                  {variant === "ring" ? "✨" : BURST.emoji}
                </div>
              )
            )}
          <div
            style={{
              position: "absolute",
              left: cx,
              top: cy,
              fontSize: 220,
              lineHeight: 1,
              transform: `translate(-50%, -50%) scale(${pop * (1 - out)}) rotate(${wobble}deg)`,
              filter: "drop-shadow(0 12px 30px rgba(0,0,0,0.45))",
            }}
          >
            {BURST.emoji}
          </div>
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};

// ─── 5. Transição entre cortes ───────────────────────────────────────

const CUT_A = { from: 2.4, seconds: 2.4 };
const CUT_B = { from: 5.18, seconds: 2.4 };
const TRANSITION_FRAMES = 12;

type NoProps = Record<string, never>;

/** Chicote: os dois planos correm de lado com borrão no meio do movimento */
const WhipPan: React.FC<TransitionPresentationComponentProps<NoProps>> = ({
  children,
  presentationDirection,
  presentationProgress: p,
}) => {
  const eased = Easing.inOut(Easing.cubic)(p);
  const x = presentationDirection === "exiting" ? -eased * 100 : (1 - eased) * 100;
  const blur = Math.sin(p * Math.PI) * 28;
  return (
    <AbsoluteFill style={{ transform: `translateX(${x}%)`, filter: `blur(${blur}px)` }}>
      {children}
    </AbsoluteFill>
  );
};

/** Atravessa a câmera: o plano que sai cresce e some, o que entra assenta */
const ZoomThrough: React.FC<TransitionPresentationComponentProps<NoProps>> = ({
  children,
  presentationDirection,
  presentationProgress: p,
}) => {
  const eased = Easing.in(Easing.cubic)(p);
  const style: React.CSSProperties =
    presentationDirection === "exiting"
      ? { transform: `scale(${1 + eased * 2.2})`, opacity: 1 - eased, filter: `blur(${eased * 16}px)` }
      : {
          transform: `scale(${interpolate(p, [0, 1], [1.5, 1], { easing: Easing.out(Easing.cubic) })})`,
          opacity: interpolate(p, [0.3, 0.7], [0, 1], clamp),
          filter: `blur(${(1 - p) * 12}px)`,
        };
  return <AbsoluteFill style={style}>{children}</AbsoluteFill>;
};

/** Flash branco: troca no pico do clarão */
const Flash: React.FC<TransitionPresentationComponentProps<NoProps>> = ({
  children,
  presentationDirection,
  presentationProgress: p,
}) => {
  const visible = presentationDirection === "exiting" ? p < 0.5 : p >= 0.5;
  return (
    <AbsoluteFill style={{ opacity: visible ? 1 : 0 }}>
      {children}
      {presentationDirection === "entering" && (
        <AbsoluteFill style={{ background: "#FFFFFF", opacity: Math.pow(Math.sin(p * Math.PI), 1.5) }} />
      )}
    </AbsoluteFill>
  );
};

const PRESENTATIONS: Record<string, TransitionPresentation<NoProps>> = {
  whip: { component: WhipPan, props: {} },
  zoom: { component: ZoomThrough, props: {} },
  flash: { component: Flash, props: {} },
};

const TransitionDemo: React.FC<MotionLabProps> = ({ file, variant }) => {
  const a = Math.round(CUT_A.seconds * LAB_FPS);
  const b = Math.round(CUT_B.seconds * LAB_FPS);
  const presentation = PRESENTATIONS[variant];
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <TransitionSeries>
        <TransitionSeries.Sequence durationInFrames={a}>
          <Clip file={file} from={CUT_A.from} />
        </TransitionSeries.Sequence>
        {presentation && (
          <TransitionSeries.Transition
            presentation={presentation}
            timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
          />
        )}
        <TransitionSeries.Sequence durationInFrames={b}>
          <Clip file={file} from={CUT_B.from} />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};

// ─── Catálogo ────────────────────────────────────────────────────────

export type LabDemoId = "kinetic" | "zoom" | "highlight" | "burst" | "transition";

export interface LabDemo {
  id: LabDemoId;
  title: string;
  description: string;
  /** Fala do trecho, para o operador saber onde olhar */
  moment: string;
  variants: { id: string; label: string }[];
  durationInFrames: (variant: string) => number;
  component: React.FC<MotionLabProps>;
}

const seconds = (s: number) => () => Math.round(s * LAB_FPS);

export const LAB_DEMOS: LabDemo[] = [
  {
    id: "kinetic",
    title: "Tipografia cinética",
    description: "Palavra-chave que entra com movimento próprio em vez de só aparecer.",
    moment: "“…perdeu um ENTE QUERIDO…”",
    variants: [
      { id: "stagger", label: "Letra a letra" },
      { id: "mask", label: "Máscara + faixa" },
      { id: "blur", label: "Desfoque" },
    ],
    durationInFrames: seconds(4),
    component: KineticDemo,
  },
  {
    id: "zoom",
    title: "Zoom com motion blur",
    description: "Punch-in na palavra de ênfase. Compare sem e com borrão de movimento.",
    moment: "“…procure um ADVOGADO.”",
    variants: [
      { id: "none", label: "Sem blur" },
      { id: "speed", label: "Blur de velocidade" },
      { id: "shake", label: "Blur + tremida" },
      { id: "real", label: "Motion blur real (só render)" },
    ],
    durationInFrames: seconds(3.6),
    component: ZoomDemo,
  },
  {
    id: "highlight",
    title: "Destaque atrás da palavra",
    description: "Legenda em que a cor passa de palavra em palavra junto com a fala.",
    moment: "“O advogado vai dar entrada… dentro do prazo de dois meses”",
    variants: [
      { id: "marker", label: "Marca-texto" },
      { id: "pill", label: "Pílula" },
      { id: "underline", label: "Sublinhado" },
    ],
    durationInFrames: seconds(HIGHLIGHT.until - HIGHLIGHT.from),
    component: HighlightDemo,
  },
  {
    id: "burst",
    title: "Explosão de emoji",
    description: "Emoji que estoura com partículas no instante da palavra.",
    moment: "“…dentro do prazo de dois MESES”",
    variants: [
      { id: "emoji", label: "Emojis" },
      { id: "confetti", label: "Confete" },
      { id: "ring", label: "Anel + brilho" },
    ],
    durationInFrames: seconds(3.6),
    component: BurstDemo,
  },
  {
    id: "transition",
    title: "Transição entre cortes",
    description: "O que acontece na emenda entre dois trechos da fala.",
    moment: "“…sou advogado.” → “Vou falar um pouquinho sobre inventário”",
    variants: [
      { id: "cut", label: "Corte seco" },
      { id: "whip", label: "Chicote" },
      { id: "zoom", label: "Zoom através" },
      { id: "flash", label: "Flash" },
    ],
    durationInFrames: (variant) =>
      Math.round((CUT_A.seconds + CUT_B.seconds) * LAB_FPS) - (variant === "cut" ? 0 : TRANSITION_FRAMES),
    component: TransitionDemo,
  },
];

/** Composição única: escolhe o protótipo pela prop `demo` */
export const MotionLabComposition: React.FC<MotionLabProps> = (props) => {
  useGoogleFont(FONT, 900);
  const demo = LAB_DEMOS.find((d) => d.id === props.demo);
  if (!demo) return null;
  const C = demo.component;
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <C {...props} />
    </AbsoluteFill>
  );
};
