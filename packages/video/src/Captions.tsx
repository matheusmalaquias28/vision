import { fitText } from "@remotion/layout-utils";
import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  isSourceTimeKept,
  outputToSource,
  sourceToOutput,
  type Recipe,
  type Word,
} from "@vision/recipe";
import { useGoogleFont } from "./fonts";

/** Tempo que o bloco continua visível depois da última palavra (s) */
const BLOCK_HOLD_SECONDS = 0.3;

function chunkWords(words: Word[], perLine: number): Word[][] {
  if (perLine <= 0) return [words];
  const lines: Word[][] = [];
  for (let i = 0; i < words.length; i += perLine) {
    lines.push(words.slice(i, i + perLine));
  }
  return lines;
}

export const Captions: React.FC<{ recipe: Recipe }> = ({ recipe }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const { style, blocks } = recipe.captions;
  useGoogleFont(style.fontFamily);

  const outputTime = frame / fps;
  const st = outputToSource(recipe.timeline.segments, outputTime);

  // blocos com sourceId usam o tempo do clipe bruto correspondente;
  // blocos com sourceId null (narração) usam o tempo do vídeo final
  const refTimeFor = (b: (typeof blocks)[number]): number | null => {
    if (b.sourceId === null) return outputTime;
    if (st === null || st.sourceId !== b.sourceId) return null;
    return st.seconds;
  };

  const block = blocks.find((b) => {
    const t = refTimeFor(b);
    if (t === null) return false;
    const start = b.words[0].start;
    const end = b.words[b.words.length - 1].end + BLOCK_HOLD_SECONDS;
    return t >= start && t <= end;
  });
  if (!block) return null;
  const sourceTime = refTimeFor(block)!;

  // animação de entrada: frames desde que o bloco apareceu no vídeo final
  const blockStartOutput =
    block.sourceId === null
      ? block.words[0].start
      : sourceToOutput(
          recipe.timeline.segments,
          block.sourceId,
          block.words[0].start
        );
  const enter =
    style.animation === "pop" && blockStartOutput !== null
      ? spring({
          frame: frame - Math.round(blockStartOutput * fps),
          fps,
          config: { damping: 200 },
          durationInFrames: 5,
        })
      : 1;

  // palavras removidas no editor de texto somem da legenda (o bloco fica)
  const visibleWords =
    block.sourceId === null
      ? block.words
      : block.words.filter((w) =>
          isSourceTimeKept(recipe.timeline.segments, block.sourceId!, (w.start + w.end) / 2)
        );
  if (visibleWords.length === 0) return null;

  const lines = chunkWords(visibleWords, style.wordsPerLine);
  const maxWidthPx = (width * style.maxWidthPct) / 100;

  // auto-ajuste: mede cada linha e reduz a fonte até a maior caber
  let fontSize = style.fontSizePx;
  if (style.autoFit) {
    for (const line of lines) {
      const text = line.map((w) => w.text).join(" ");
      const fitted = fitText({
        fontFamily: `'${style.fontFamily}', 'Arial Black', sans-serif`,
        fontWeight: "900",
        text: style.uppercase ? text.toUpperCase() : text,
        withinWidth: maxWidthPx,
      });
      fontSize = Math.min(fontSize, fitted.fontSize);
    }
  }

  const renderWord = (word: Word, key: number) => {
    const active = sourceTime >= word.start && sourceTime < word.end;
    return (
      <span
        key={key}
        style={{
          color: active ? style.highlightColor : style.textColor,
          transform: active ? "scale(1.08)" : "scale(1)",
          display: "inline-block",
          // o contorno cresce strokeWidth/2 para cada lado e come o espaço
          // entre palavras ("CÉSARMAGALHÃES"); compensa na margem
          margin: `0 calc(0.14em + ${style.strokeWidthPx / 2}px)`,
        }}
      >
        {word.text}
      </span>
    );
  };

  return (
    <AbsoluteFill
      style={{
        justifyContent: style.position === "center" ? "center" : "flex-end",
        alignItems: "center",
        paddingBottom: style.position === "bottom-third" ? "18%" : 0,
      }}
    >
      <div
        style={{
          maxWidth: `${style.maxWidthPct}%`,
          textAlign: "center",
          fontFamily: `'${style.fontFamily}', 'Arial Black', sans-serif`,
          fontWeight: 900,
          fontSize,
          lineHeight: 1.25,
          textTransform: style.uppercase ? "uppercase" : "none",
          // contorno estilo TikTok: o stroke é pintado ATRÁS do preenchimento
          WebkitTextStroke:
            style.strokeWidthPx > 0
              ? `${style.strokeWidthPx}px ${style.strokeColor}`
              : undefined,
          paintOrder: "stroke",
          textShadow: "0 4px 16px rgba(0,0,0,0.5)",
          transform: `scale(${interpolate(enter, [0, 1], [0.85, 1])}) translateY(${interpolate(enter, [0, 1], [40, 0])}px)`,
        }}
      >
        {lines.map((line, li) => (
          <div key={li}>{line.map((w, wi) => renderWord(w, wi))}</div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
