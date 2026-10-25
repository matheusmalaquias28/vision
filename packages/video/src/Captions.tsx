import { measureText } from "@remotion/layout-utils";
import React from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  interpolateColors,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  keptCaptionWords,
  outputToSource,
  paginateWords,
  sourceToOutput,
  type CaptionStyle,
  type Recipe,
  type Word,
} from "@vision/recipe";
import { useGoogleFont } from "./fonts";
import { AtPoint, dragProps } from "./Positioned";

/** Tempo que o bloco continua visível depois da última palavra (s) */
const BLOCK_HOLD_SECONDS = 0.3;

/**
 * Margem de cada lado da palavra (em). Folga para a palavra falada crescer 8%
 * sem encostar na vizinha.
 */
const WORD_GAP_EM = 0.17;

const fontStack = (style: CaptionStyle) => `'${style.fontFamily}', 'Arial Black', sans-serif`;

/** Folga lateral da pílula do modelo "box" (fica em todas as palavras: o layout não pula) */
const BOX_PAD_EM = 0.14;

/** Espaço de cada palavra além da própria largura: margem lateral + contorno (+ pílula) */
const perWordPx = (style: CaptionStyle) =>
  2 * WORD_GAP_EM * style.fontSizePx +
  style.strokeWidthPx +
  (style.animation === "box" ? 2 * BOX_PAD_EM * style.fontSizePx : 0);

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const EASE_OUT = Easing.bezier(0.16, 1, 0.3, 1);
const EASE_IN = Easing.bezier(0.5, 0, 0.75, 0);
/** Modelos suaves: entrada/saída com curva, destaque da palavra em transição */
const SOFT = new Set<CaptionStyle["animation"]>(["smooth", "reveal", "box", "blur"]);

/** Texto preto ou branco, o que contrastar mais com a cor (texto sobre a pílula) */
function contrastText(hex: string): string {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return "#000000";
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? "#111111" : "#FFFFFF";
}

function withAlpha(hex: string, alpha: number): string {
  const m = hex.replace("#", "").match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return `rgba(255,215,0,${alpha})`;
  const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16));
  return `rgba(${r},${g},${b},${alpha})`;
}

function wordWidth(style: CaptionStyle, text: string): number {
  return measureText({
    text,
    fontFamily: fontStack(style),
    fontSize: style.fontSizePx,
    fontWeight: String(style.fontWeight),
    textTransform: style.uppercase ? "uppercase" : "none",
  }).width;
}

/** Partes já calculadas (a mesma frase não é refeita a cada frame) */
const pageCache = new Map<string, Word[][][]>();

/**
 * Partes do bloco no tamanho FIXO da fonte: o que não cabe em `maxLines`
 * linhas vira a próxima parte, mostrada quando a fala chega nela.
 */
function pagesFor(words: Word[], style: CaptionStyle, maxWidthPx: number): Word[][][] {
  const key = [
    style.animation === "box" ? "box" : "",
    style.fontFamily,
    style.fontWeight,
    style.fontSizePx,
    style.strokeWidthPx,
    style.uppercase,
    style.maxLines,
    style.wordsPerLine,
    Math.round(maxWidthPx),
    words.map((w) => `${w.text}@${w.start}`).join(" "),
  ].join("|");
  const hit = pageCache.get(key);
  if (hit) return hit;
  const pages = paginateWords(words, {
    maxWidth: maxWidthPx,
    maxLines: style.maxLines,
    wordsPerLine: style.wordsPerLine,
    measure: (t) => wordWidth(style, t),
    perWord: perWordPx(style),
  });
  if (pageCache.size > 2000) pageCache.clear();
  pageCache.set(key, pages);
  return pages;
}

export const Captions: React.FC<{
  recipe: Recipe;
  /** Trechos (tempo final) sem legenda, ex.: tela cheia com texto */
  hiddenRanges?: [number, number][];
}> = ({ recipe, hiddenRanges = [] }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const { style, blocks } = recipe.captions;
  // medir antes da fonte carregar mediria a fonte errada (e o cache guardaria)
  const fontReady = useGoogleFont(style.fontFamily, style.fontWeight);

  const outputTime = frame / fps;
  const hidden = hiddenRanges.some(([a, b]) => outputTime >= a && outputTime < b);
  const st = outputToSource(recipe.timeline.segments, outputTime);

  // blocos com sourceId usam o tempo do clipe bruto correspondente;
  // blocos com sourceId null (narração) usam o tempo do vídeo final
  const refTimeFor = (b: (typeof blocks)[number]): number | null => {
    if (b.sourceId === null) return outputTime;
    if (st === null || st.sourceId !== b.sourceId) return null;
    return st.seconds;
  };

  // na folga depois da última palavra de um bloco, o próximo já pode ter
  // começado: vale o que começou por último (senão a frase nova ficava
  // escondida até a antiga sair, e chegava atrasada e sem animação de entrada)
  const startOut = (b: (typeof blocks)[number]) =>
    b.sourceId === null ? b.words[0].start : (sourceToOutput(recipe.timeline.segments, b.sourceId, b.words[0].start) ?? -Infinity);
  let block: (typeof blocks)[number] | undefined;
  for (const b of blocks) {
    const t = refTimeFor(b);
    if (t === null) continue;
    const start = b.words[0].start;
    const end = b.words[b.words.length - 1].end + BLOCK_HOLD_SECONDS;
    if (t >= start && t <= end && (!block || startOut(b) > startOut(block))) block = b;
  }
  if (!block || !fontReady || hidden) return null;
  const sourceTime = refTimeFor(block)!;

  // palavras removidas no editor de texto somem da legenda (o bloco fica)
  const visibleWords = keptCaptionWords(recipe.timeline.segments, block);
  if (visibleWords.length === 0) return null;

  // tamanho sempre o mesmo: a frase que não cabe é dividida em partes
  const maxWidthPx = (width * style.maxWidthPct) / 100;
  const pages = pagesFor(visibleWords, style, maxWidthPx);
  let pageIndex = 0;
  for (let i = 1; i < pages.length; i++) {
    if (sourceTime >= pages[i][0][0].start) pageIndex = i;
  }
  const lines = pages[pageIndex];
  const pageStart = lines[0][0].start;
  const fontSize = style.fontSizePx;

  // animação de entrada: frames desde que esta parte apareceu no vídeo final
  const pageStartOutput =
    block.sourceId === null ? pageStart : sourceToOutput(recipe.timeline.segments, block.sourceId, pageStart);
  const enter =
    style.animation === "pop" && pageStartOutput !== null
      ? spring({
          frame: frame - Math.round(pageStartOutput * fps),
          fps,
          config: { damping: 200 },
          durationInFrames: 5,
        })
      : 1;

  /** Só uma palavra mais larga que a linha é reduzida (o resto mantém o tamanho) */
  const lineScale = (line: Word[]) => {
    const lw = line.reduce((a, w) => a + wordWidth(style, w.text) + perWordPx(style), 0);
    return lw > maxWidthPx ? maxWidthPx / lw : 1;
  };

  // ── modelos suaves: tudo é curva no tempo (nada liga/desliga de um quadro para o outro)
  const anim = style.animation;
  const soft = SOFT.has(anim);
  const framesIn = pageStartOutput === null ? 999 : frame - Math.round(pageStartOutput * fps);
  const enterSoft = interpolate(framesIn, [0, anim === "blur" ? 13 : 9], [0, 1], { ...clamp, easing: EASE_OUT });
  // a parte some suave pouco antes da próxima entrar (ou do fim do bloco)
  const nextPage = pages[pageIndex + 1];
  // última parte: sai até o fim da folga ou até o próximo bloco começar
  const nextBlockStart = blocks
    .filter((b) => b.sourceId === block!.sourceId && b.words[0].start > block!.words[0].start)
    .reduce((min, b) => Math.min(min, b.words[0].start), Infinity);
  const pageEnd = nextPage
    ? nextPage[0][0].start
    : Math.min(visibleWords[visibleWords.length - 1].end + BLOCK_HOLD_SECONDS, nextBlockStart);
  const exitSoft = interpolate(sourceTime, [pageEnd - 0.14, pageEnd], [0, 1], { ...clamp, easing: EASE_IN });
  /** Peso do destaque da palavra: acende em ~0,12 s ao ser dita, apaga em ~0,2 s depois */
  const weight = (w: Word) =>
    interpolate(sourceTime, [w.start - 0.03, w.start + 0.12], [0, 1], { ...clamp, easing: EASE_OUT }) *
    (1 - interpolate(sourceTime, [w.end, w.end + 0.2], [0, 1], clamp));

  const renderWord = (word: Word, key: number) => {
    // o contorno cresce strokeWidth/2 para cada lado e come o espaço
    // entre palavras ("CÉSARMAGALHÃES"); compensa na margem
    const margin = `0 calc(${WORD_GAP_EM}em + ${style.strokeWidthPx / 2}px)`;
    if (!soft) {
      const active = sourceTime >= word.start && sourceTime < word.end;
      return (
        <span
          key={key}
          style={{
            color: active ? style.highlightColor : style.textColor,
            transform: active ? "scale(1.08)" : "scale(1)",
            display: "inline-block",
            margin,
          }}
        >
          {word.text}
        </span>
      );
    }
    const w = weight(word);
    if (anim === "box") {
      return (
        <span
          key={key}
          style={{
            display: "inline-block",
            margin,
            padding: `0 ${BOX_PAD_EM}em`,
            borderRadius: "0.2em",
            background: withAlpha(style.highlightColor, w),
            boxShadow: w > 0.01 ? `0 0.08em 0.3em rgba(0,0,0,${0.35 * w})` : undefined,
            color: interpolateColors(w, [0, 1], [style.textColor, contrastText(style.highlightColor)]),
            // sobre a pílula o contorno sai aos poucos
            WebkitTextStroke: style.strokeWidthPx > 0 ? `${style.strokeWidthPx * (1 - w)}px ${style.strokeColor}` : undefined,
            transform: `scale(${1 + 0.04 * w})`,
          }}
        >
          {word.text}
        </span>
      );
    }
    // reveal: a palavra só aparece quando é dita (sobe e sai do desfoque)
    const shown =
      anim === "reveal"
        ? interpolate(sourceTime, [word.start - 0.08, word.start + 0.1], [0, 1], { ...clamp, easing: EASE_OUT })
        : 1;
    return (
      <span
        key={key}
        style={{
          display: "inline-block",
          margin,
          color: interpolateColors(w, [0, 1], [style.textColor, style.highlightColor]),
          opacity: shown,
          filter: shown < 1 ? `blur(${(1 - shown) * 4}px)` : undefined,
          transform: `translateY(${(1 - shown) * 0.28 - 0.04 * w}em) scale(${1 + 0.06 * w})`,
        }}
      >
        {word.text}
      </span>
    );
  };

  /** Movimento do conjunto (a parte da legenda que está na tela) */
  const containerMotion = (): React.CSSProperties => {
    if (anim === "pop") {
      return { transform: `scale(${interpolate(enter, [0, 1], [0.85, 1])}) translateY(${interpolate(enter, [0, 1], [40, 0])}px)` };
    }
    if (anim === "none") return {};
    const vis = enterSoft * (1 - exitSoft);
    if (anim === "reveal") return { opacity: 1 - exitSoft, transform: `translateY(${-exitSoft * 10}px)` };
    if (anim === "blur") {
      return {
        opacity: vis,
        filter: `blur(${(1 - enterSoft) * 10 + exitSoft * 6}px)`,
        letterSpacing: `${(1 - enterSoft) * 0.08}em`,
        transform: `translateY(${(1 - enterSoft) * 10}px)`,
      };
    }
    // smooth / box: sobe e aparece com desaceleração; sai subindo de leve
    const rise = anim === "box" ? 16 : 24;
    return {
      opacity: vis,
      transform: `translateY(${(1 - enterSoft) * rise - exitSoft * 10}px) scale(${0.96 + 0.04 * enterSoft})`,
    };
  };

  const caption = (
    <div
      {...dragProps("caption")}
      style={{
        maxWidth: `${style.maxWidthPct}%`,
        textAlign: "center",
        fontFamily: `'${style.fontFamily}', 'Arial Black', sans-serif`,
        fontWeight: style.fontWeight,
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
        ...containerMotion(),
      }}
    >
      {lines.map((line, li) => {
        const scale = lineScale(line);
        return (
          <div key={li} style={{ whiteSpace: "nowrap", transform: scale < 1 ? `scale(${scale})` : undefined }}>
            {line.map((w, wi) => renderWord(w, wi))}
          </div>
        );
      })}
    </div>
  );

  if (style.placement) return <AtPoint at={style.placement}>{caption}</AtPoint>;
  return (
    <AbsoluteFill
      style={{
        justifyContent: style.position === "center" ? "center" : "flex-end",
        alignItems: "center",
        paddingBottom: style.position === "bottom-third" ? "18%" : 0,
      }}
    >
      {caption}
    </AbsoluteFill>
  );
};
