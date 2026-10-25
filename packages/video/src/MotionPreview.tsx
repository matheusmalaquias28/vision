import React from "react";
import { AbsoluteFill, Freeze, OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { CaptionStyleSchema, zoomAt, type CaptionStyle, type Motion, type PlacedMotion } from "@vision/recipe";
import { mediaSrc } from "./media";
import { Motions } from "./Motions";

/**
 * Prévia de UM motion, com o mesmo componente do render. Usada pela galeria
 * do editor (um único Player, montado só para o item escolhido) e pela folha
 * de contato de validação visual (MotionSheet).
 */

/** Fundo neutro que lembra um vídeo vertical de pessoa falando */
const FakeShot: React.FC = () => (
  <AbsoluteFill style={{ background: "linear-gradient(180deg, #2b3242 0%, #1a1f2b 55%, #10131a 100%)" }}>
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "18%",
        width: 340,
        height: 420,
        marginLeft: -170,
        borderRadius: "50% 50% 46% 46%",
        background: "linear-gradient(180deg, #4a5468, #343c4d)",
      }}
    />
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: "40%",
        width: 760,
        height: 900,
        marginLeft: -380,
        borderRadius: "48% 48% 0 0",
        background: "linear-gradient(180deg, #3d4659, #262c39)",
      }}
    />
  </AbsoluteFill>
);

const Background: React.FC<{ file?: string | null; scale: number; focusX: number; focusY: number }> = ({
  file,
  scale,
  focusX,
  focusY,
}) => (
  <AbsoluteFill style={{ transform: `scale(${scale})`, transformOrigin: `${focusX}% ${focusY}%` }}>
    {file ? (
      <OffthreadVideo src={mediaSrc(file)} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    ) : (
      <FakeShot />
    )}
  </AbsoluteFill>
);

/** Peça de uma prévia: um motion começando `at` segundos depois do início */
export type PreviewPiece = { motion: Motion; at: number };

/**
 * Cena de prévia: as peças com o mesmo compositor de câmera e o mesmo
 * componente <Motions> do render (um combo aparece como vai ficar).
 */
const PreviewScene: React.FC<{
  pieces: PreviewPiece[];
  style: CaptionStyle;
  file?: string | null;
  accent?: string | null;
}> = ({ pieces, style, file, accent = null }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const placed: PlacedMotion[] = pieces.map((p) => ({
    motion: p.motion,
    outputStart: p.at,
    outputEnd: p.at + p.motion.durationSeconds,
  }));
  const cam = zoomAt(placed, frame / fps);
  return (
    <AbsoluteFill style={{ backgroundColor: "black", overflow: "hidden" }}>
      <Background file={file} scale={cam.scale} focusX={cam.focusX} focusY={cam.focusY} />
      <Motions placed={placed} style={style} defaultAccent={accent} />
    </AbsoluteFill>
  );
};

const OneMotion: React.FC<{ motion: Motion; style: CaptionStyle; file?: string | null }> = ({ motion, style, file }) => (
  <PreviewScene pieces={[{ motion, at: 0 }]} style={style} file={file} />
);

export type MotionPreviewProps = {
  pieces: PreviewPiece[];
  style?: Partial<CaptionStyle>;
  /** Vídeo de fundo ("media/..."); sem ele, um quadro neutro */
  file?: string | null;
  /** Cor padrão dos motions do vídeo */
  accent?: string | null;
};

/** Composição do Player da galeria (um motion ou as peças de uma receita) */
export const MotionPreviewComposition: React.FC<MotionPreviewProps> = ({ pieces, style, file, accent }) => (
  <PreviewScene pieces={pieces} style={CaptionStyleSchema.parse(style ?? {})} file={file} accent={accent} />
);

export type MotionSheetProps = {
  cells: { motion: Motion; frame: number; caption?: string }[];
  file?: string | null;
  style?: Partial<CaptionStyle>;
  columns?: number;
};

const CELL_W = 1080;
const CELL_H = 1920;
export const SHEET_SCALE = 0.25;

/**
 * Folha de contato (só para validação visual): cada célula é um quadro
 * 1080x1920 reduzido, com o motion congelado no frame pedido.
 */
export const MotionSheetComposition: React.FC<MotionSheetProps> = ({ cells, file, style, columns = 4 }) => {
  const s = CaptionStyleSchema.parse(style ?? {});
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ background: "#0b0d12", display: "flex", flexWrap: "wrap", alignContent: "flex-start" }}>
      {cells.map((c, i) => {
        const d = Math.max(1, Math.round(c.motion.durationSeconds * fps));
        return (
          <div key={i} style={{ width: CELL_W * SHEET_SCALE, height: CELL_H * SHEET_SCALE + 34, position: "relative" }}>
            <div
              style={{
                position: "absolute",
                width: CELL_W,
                height: CELL_H,
                transform: `scale(${SHEET_SCALE})`,
                transformOrigin: "top left",
                overflow: "hidden",
              }}
            >
              <Sequence durationInFrames={d} layout="none">
                <Freeze frame={Math.min(c.frame, d - 1)}>
                  <AbsoluteFill>
                    <OneMotion motion={c.motion} style={s} file={file} />
                  </AbsoluteFill>
                </Freeze>
              </Sequence>
            </div>
            <div
              style={{
                position: "absolute",
                left: 6,
                bottom: 6,
                font: "600 15px system-ui, sans-serif",
                color: "#cfd6e4",
              }}
            >
              {c.caption ?? `${c.motion.kind} f${c.frame}`}
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

export function sheetSize(count: number, columns = 4) {
  return {
    width: Math.round(CELL_W * SHEET_SCALE * columns),
    height: Math.round((CELL_H * SHEET_SCALE + 34) * Math.ceil(count / columns)),
  };
}
