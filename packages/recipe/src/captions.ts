import type { CaptionBlock, Segment, Word } from "./schema";
import { isSourceTimeKept, segmentDuration } from "./time";

/** Pausa entre palavras que força um novo bloco de legenda (s) */
export const DEFAULT_BLOCK_GAP_SECONDS = 0.8;

/**
 * Agrupa palavras (ordenadas por start) em blocos de legenda.
 * Quebra quando o bloco enche ou quando há uma pausa longa na fala.
 */
export function groupWordsIntoBlocks(
  words: Word[],
  maxWordsPerBlock: number,
  gapSeconds: number = DEFAULT_BLOCK_GAP_SECONDS,
  sourceId: string | null = null
): CaptionBlock[] {
  const blocks: CaptionBlock[] = [];
  let current: Word[] = [];
  const flush = () => {
    if (current.length === 0) return;
    blocks.push({
      id: `cap_${String(blocks.length + 1).padStart(2, "0")}`,
      sourceId,
      words: current,
    });
    current = [];
  };
  for (const word of words) {
    const prev = current[current.length - 1];
    if (
      current.length >= maxWordsPerBlock ||
      (prev && word.start - prev.end > gapSeconds)
    ) {
      flush();
    }
    current.push(word);
  }
  flush();
  return blocks;
}

/** Duração mínima para considerar que a palavra tem timing próprio (s) */
const MIN_WORD_SECONDS = 0.04;
/** Quanto tempo uma palavra sem timing pode "pegar" da pausa anterior (s) */
const BORROW_PER_WORD_SECONDS = 0.15;

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/**
 * O Whisper às vezes devolve palavras com duração zero empilhadas no fim da
 * anterior ("um" 5.42–5.82, "pouquinho" 5.82–5.82). Sem duração a palavra não
 * acende na legenda nem pode ser cortada sozinha. Redistribui o trecho do
 * grupo colado entre as palavras, proporcional ao tamanho de cada uma; se o
 * grupo inteiro não tem duração, avança sobre a pausa anterior.
 */
export function spreadCollapsedWords(words: Word[]): Word[] {
  const out = words.map((w) => ({ ...w }));
  let i = 0;
  while (i < out.length) {
    let j = i;
    while (
      j + 1 < out.length &&
      out[j + 1].end - out[j + 1].start < MIN_WORD_SECONDS &&
      Math.abs(out[j + 1].start - out[j].end) < 0.01
    ) {
      j++;
    }
    const collapsedAlone = j === i && out[i].end - out[i].start < MIN_WORD_SECONDS;
    if (j > i || collapsedAlone) {
      const group = out.slice(i, j + 1);
      const end = group[group.length - 1].end;
      let start = group[0].start;
      const needed = group.length * BORROW_PER_WORD_SECONDS;
      if (end - start < group.length * MIN_WORD_SECONDS) {
        const floor = i > 0 ? out[i - 1].end : 0;
        start = Math.max(floor, Math.min(start, end - needed));
      }
      const totalChars = group.reduce((a, w) => a + Math.max(w.text.length, 1), 0);
      let cursor = start;
      group.forEach((w, k) => {
        const slice = (Math.max(w.text.length, 1) / totalChars) * (end - start);
        out[i + k].start = round3(cursor);
        cursor += slice;
        out[i + k].end = k === group.length - 1 ? end : round3(cursor);
      });
    }
    i = j + 1;
  }
  return out;
}

/**
 * Reagrupa os blocos existentes (preserva texto e timing das palavras,
 * só muda a divisão em blocos). Usado quando o usuário muda
 * maxWordsPerBlock no estilo.
 */
export function regroupBlocks(
  blocks: CaptionBlock[],
  maxWordsPerBlock: number,
  gapSeconds: number = DEFAULT_BLOCK_GAP_SECONDS
): CaptionBlock[] {
  // reagrupa por fonte separadamente (timestamps de fontes diferentes
  // não são comparáveis) e re-numera os ids no final
  const bySource = new Map<string | null, CaptionBlock[]>();
  for (const b of blocks) {
    const list = bySource.get(b.sourceId) ?? [];
    list.push(b);
    bySource.set(b.sourceId, list);
  }
  const all: CaptionBlock[] = [];
  for (const [sourceId, group] of bySource) {
    const words = group
      .flatMap((b) => b.words)
      .slice()
      .sort((a, b) => a.start - b.start);
    all.push(...groupWordsIntoBlocks(words, maxWordsPerBlock, gapSeconds, sourceId));
  }
  return all.map((b, i) => ({
    ...b,
    id: `cap_${String(i + 1).padStart(2, "0")}`,
  }));
}

// ─── Tamanho fixo: frase longa vira partes que cabem ─────────────────

export interface PaginateOptions {
  /** Largura máxima de uma linha (px) */
  maxWidth: number;
  /** Linhas por parte */
  maxLines: number;
  /** Máximo de palavras por linha (0 = livre) */
  wordsPerLine: number;
  /** Largura da palavra sozinha (px), já em caixa alta se for o caso */
  measure: (text: string) => number;
  /** Espaço que cada palavra ocupa além da própria largura (margens, contorno) */
  perWord: number;
}

const ENDS_CLAUSE = /[.,!?;:…]$/;

/**
 * Divide as palavras de um bloco em partes (páginas) que cabem em
 * `maxLines` linhas de `maxWidth` no tamanho FIXO da fonte, e cada parte em
 * linhas equilibradas. Usa o menor número de partes possível e distribui as
 * palavras por igual entre elas, preferindo quebrar depois de vírgula/ponto
 * e evitando parte ou linha com uma palavra sozinha. Uma palavra mais larga
 * que a linha ocupa a linha sozinha (o render reduz só essa linha).
 * Retorna partes → linhas → palavras.
 */
export function paginateWords<W extends { text: string }>(words: W[], o: PaginateOptions): W[][][] {
  if (words.length === 0) return [];
  const w = words.map((x) => o.measure(x.text) + o.perWord);
  const maxLines = Math.max(1, o.maxLines);
  const perLine = o.wordsPerLine > 0 ? o.wordsPerLine : Infinity;
  const width = (a: number, b: number) => {
    let sum = 0;
    for (let i = a; i < b; i++) sum += w[i];
    return sum;
  };

  /** Linhas mínimas e equilibradas para words[a..b) (null se precisar de mais que maxLines) */
  const lineBreak = (a: number, b: number): number[] | null => {
    // menor número de linhas pelo guloso
    let lines = 0;
    let i = a;
    while (i < b) {
      let j = i + 1;
      while (j < b && j - i < perLine && width(i, j + 1) <= o.maxWidth) j++;
      lines++;
      i = j;
    }
    if (lines > maxLines) return null;
    if (lines === 1) return [b];
    // com o mesmo número de linhas, a divisão que minimiza a linha mais larga
    // linha com uma palavra só (numa parte de 3+ palavras) pesa como uma linha cheia a mais
    const orphan = (start: number, end: number) => (end - start === 1 && b - a > 2 ? o.maxWidth : 0);
    let best: { ends: number[]; cost: number } | null = null;
    const search = (start: number, left: number, ends: number[], worst: number, penalty: number) => {
      if (left === 1) {
        if (b - start > perLine) return;
        const lw = width(start, b);
        if (lw > o.maxWidth && b - start > 1) return;
        const cost = Math.max(worst, lw) + penalty + orphan(start, b);
        if (!best || cost < best.cost) best = { ends: [...ends, b], cost };
        return;
      }
      for (let end = start + 1; end <= b - (left - 1); end++) {
        if (end - start > perLine) break;
        const lw = width(start, end);
        if (lw > o.maxWidth && end - start > 1) break;
        search(end, left - 1, [...ends, end], Math.max(worst, lw), penalty + orphan(start, end));
      }
    };
    search(a, lines, [], 0, 0);
    return best ? (best as { ends: number[] }).ends : null;
  };

  // menor número de partes (guloso) …
  let pagesNeeded = 0;
  for (let i = 0; i < words.length; ) {
    let j = i + 1;
    while (j < words.length && lineBreak(i, j + 1)) j++;
    pagesNeeded++;
    i = j;
  }

  // … e a divisão mais equilibrada com esse número (DP pequena: blocos têm poucas palavras)
  const n = words.length;
  const total = width(0, n);
  const target = total / pagesNeeded;
  const INF = Number.POSITIVE_INFINITY;
  const cost: number[][] = Array.from({ length: pagesNeeded + 1 }, () => Array(n + 1).fill(INF));
  const from: number[][] = Array.from({ length: pagesNeeded + 1 }, () => Array(n + 1).fill(-1));
  cost[0][0] = 0;
  for (let k = 1; k <= pagesNeeded; k++) {
    for (let b = 1; b <= n; b++) {
      for (let a = k - 1; a < b; a++) {
        if (cost[k - 1][a] === INF || !lineBreak(a, b)) continue;
        const pw = width(a, b);
        let c = (pw - target) ** 2;
        if (pagesNeeded > 1 && b - a === 1) c += target ** 2; // parte com uma palavra só
        if (b < n && ENDS_CLAUSE.test(words[b - 1].text)) c -= (target * 0.35) ** 2; // quebra natural
        const v = cost[k - 1][a] + c;
        if (v < cost[k][b]) {
          cost[k][b] = v;
          from[k][b] = a;
        }
      }
    }
  }
  const bounds: number[] = [];
  if (cost[pagesNeeded][n] === INF) {
    // não deveria acontecer; volta para o guloso
    for (let i = 0; i < n; ) {
      let j = i + 1;
      while (j < n && lineBreak(i, j + 1)) j++;
      bounds.push(j);
      i = j;
    }
  } else {
    for (let k = pagesNeeded, b = n; k > 0; k--) {
      bounds.unshift(b);
      b = from[k][b];
    }
  }

  const pages: W[][][] = [];
  let start = 0;
  for (const end of bounds) {
    const ends = lineBreak(start, end) ?? [end];
    const lines: W[][] = [];
    let ls = start;
    for (const le of ends) {
      lines.push(words.slice(ls, le));
      ls = le;
    }
    pages.push(lines);
    start = end;
  }
  return pages;
}

/**
 * Palavras do bloco que estão no vídeo final (o meio da palavra foi mantido).
 * Mesma regra do render: palavra cortada some, o resto do bloco fica.
 */
export function keptCaptionWords(segments: Segment[], block: CaptionBlock): Word[] {
  if (block.sourceId === null) return block.words;
  const sourceId = block.sourceId;
  return block.words.filter((w) => isSourceTimeKept(segments, sourceId, (w.start + w.end) / 2));
}

/** Onde [from, to) de um clipe aparece primeiro no vídeo final */
function firstOutputSpan(segments: Segment[], sourceId: string, from: number, to: number): { start: number; end: number } | null {
  let acc = 0;
  for (const s of segments) {
    if (s.sourceId === sourceId) {
      const a = Math.max(from, s.sourceStart);
      const b = Math.min(to, s.sourceEnd);
      if (b > a) return { start: acc + a - s.sourceStart, end: acc + b - s.sourceStart };
    }
    acc += segmentDuration(s);
  }
  return null;
}

/**
 * Trecho do vídeo final ocupado pelo bloco: da primeira à última palavra
 * mantida. null = todas as palavras foram cortadas. Um corte na primeira
 * palavra (muleta "Então") não pode esconder o resto do bloco da timeline.
 */
export function captionBlockOutputRange(segments: Segment[], block: CaptionBlock): { start: number; end: number } | null {
  const words = keptCaptionWords(segments, block);
  if (words.length === 0) return null;
  const first = words[0];
  const last = words[words.length - 1];
  if (block.sourceId === null) return { start: first.start, end: last.end };
  const a = firstOutputSpan(segments, block.sourceId, first.start, first.end);
  const b = firstOutputSpan(segments, block.sourceId, last.start, last.end);
  if (!a) return null;
  return { start: a.start, end: Math.max(b?.end ?? a.end, a.end) };
}
