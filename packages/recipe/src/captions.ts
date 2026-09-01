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
