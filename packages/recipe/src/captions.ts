import type { CaptionBlock, Word } from "./schema";

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
