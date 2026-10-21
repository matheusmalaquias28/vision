import type { CutReason, Recipe, Segment, Word } from "./schema";
import { isSourceTimeKept } from "./time";

/**
 * Folga mantida antes/depois das palavras vizinhas ao cortar por texto.
 * Os timestamps do Whisper erram por alguns centésimos; sem essa folga o
 * corte come o ataque da sílaba seguinte.
 */
export const WORD_EDGE_SECONDS = 0.05;

/** Menor trecho que um corte por texto remove (> MIN_SEGMENT_SECONDS de time.ts) */
const MIN_CUT_SECONDS = 0.08;

/** Palavra falada (de um clipe bruto), achatada a partir dos blocos de legenda */
export interface TranscriptWord extends Word {
  /** Chave estável: `${blockId}:${wordIndex}` */
  key: string;
  sourceId: string;
  blockId: string;
  wordIndex: number;
}

/** Candidato a corte produzido por um detector (vira SuggestedCut no merge) */
export interface CutCandidate {
  sourceId: string;
  sourceStart: number;
  sourceEnd: number;
  reason: CutReason;
  confidence: number;
  note: string;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/**
 * Todas as palavras faladas (blocos de narração ficam de fora), agrupadas por
 * clipe na ordem em que cada clipe aparece na timeline e, dentro do clipe,
 * na ordem do bruto. Palavras cortadas continuam na lista — é assim que o
 * editor de texto mostra o que pode ser restaurado.
 */
export function transcriptWords(recipe: Recipe): TranscriptWord[] {
  const sourceOrder: string[] = [];
  for (const s of [...recipe.timeline.segments, ...recipe.sources]) {
    const id = "sourceId" in s ? s.sourceId : s.id;
    if (!sourceOrder.includes(id)) sourceOrder.push(id);
  }
  const words: TranscriptWord[] = [];
  for (const block of recipe.captions.blocks) {
    if (block.sourceId === null) continue;
    block.words.forEach((w, wordIndex) =>
      words.push({
        ...w,
        key: `${block.id}:${wordIndex}`,
        sourceId: block.sourceId!,
        blockId: block.id,
        wordIndex,
      })
    );
  }
  return words.sort(
    (a, b) =>
      sourceOrder.indexOf(a.sourceId) - sourceOrder.indexOf(b.sourceId) ||
      a.start - b.start
  );
}

export function wordMid(w: Word): number {
  return (w.start + w.end) / 2;
}

export function isWordKept(segments: Segment[], w: TranscriptWord): boolean {
  return isSourceTimeKept(segments, w.sourceId, wordMid(w));
}

/**
 * Intervalo do bruto a cortar para remover as palavras words[from..to]
 * (mesma fonte, ordenadas). Vai do fim da palavra anterior até logo antes da
 * próxima — remove também a pausa que segue o trecho, para a fala emendar.
 */
export function wordsCutRange(
  words: Word[],
  from: number,
  to: number
): { start: number; end: number } {
  const first = words[from];
  const last = words[to];
  const prev = from > 0 ? words[from - 1] : undefined;
  const next = to < words.length - 1 ? words[to + 1] : undefined;
  const start = Math.min(
    first.start,
    Math.max(prev ? prev.end : 0, first.start - WORD_EDGE_SECONDS)
  );
  const end = next
    ? Math.min(next.start, Math.max(last.end, next.start - WORD_EDGE_SECONDS))
    : last.end + WORD_EDGE_SECONDS;
  return withMinWindow(start, end, first, last);
}

/**
 * Intervalo a devolver ao restaurar words[from..to]: só o áudio das palavras
 * (com folga), sem a pausa seguinte — senão restaurar uma palavra traria de
 * volta silêncios que já tinham sido cortados por outro motivo.
 */
export function wordsRestoreRange(
  words: Word[],
  from: number,
  to: number
): { start: number; end: number } {
  const first = words[from];
  const last = words[to];
  const prev = from > 0 ? words[from - 1] : undefined;
  const next = to < words.length - 1 ? words[to + 1] : undefined;
  const start = Math.min(
    first.start,
    Math.max(prev ? prev.end : 0, first.start - WORD_EDGE_SECONDS)
  );
  const end = Math.max(
    last.end,
    Math.min(next ? next.start : Infinity, last.end + WORD_EDGE_SECONDS)
  );
  return withMinWindow(start, end, first, last);
}

/**
 * Palavras sem duração (timestamps colapsados do Whisper): garante uma janela
 * mínima em volta delas, senão o corte/restauração não muda nada.
 */
function withMinWindow(
  start: number,
  end: number,
  first: Word,
  last: Word
): { start: number; end: number } {
  if (end - start < MIN_CUT_SECONDS) {
    const center = (first.start + last.end) / 2;
    start = Math.max(0, Math.min(start, center - MIN_CUT_SECONDS / 2));
    end = Math.max(end, center + MIN_CUT_SECONDS / 2);
  }
  return { start: round3(start), end: round3(Math.max(end, start)) };
}

/**
 * Ajusta o fim de uma retomada sugerida pelo LLM, que costuma errar o índice
 * por uma ou duas palavras. Numa retomada o falante recomeça com as mesmas
 * palavras do trecho descartado: se as 2 primeiras palavras do corte
 * reaparecem DENTRO dele, o corte termina logo antes desse recomeço; se
 * reaparecem logo depois (até 2 palavras após o fim), o corte estica até lá.
 */
export function snapRetakeToRestart(words: Word[], from: number, to: number): number {
  const norm = (i: number) => (i < words.length ? normalizeWord(words[i].text) : "");
  const isRestart = (p: number) => norm(p) === norm(from) && norm(p + 1) === norm(from + 1);
  if (norm(from) === "" || from + 1 >= words.length) return to;
  for (let p = from + 2; p <= Math.min(to + 2, words.length - 2); p++) {
    if (isRestart(p)) return p - 1;
  }
  return to;
}

/** Normaliza para comparação: minúsculas, sem pontuação nas bordas */
export function normalizeWord(text: string): string {
  return text
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

// ─── Detectores determinísticos ──────────────────────────────────────

/**
 * Vícios inequívocos (sons de hesitação). "é" sozinho e "um" ficam de fora:
 * são verbo e artigo em pt-BR.
 */
const STRONG_FILLER = /^(é{2,}|e{2,}h*|eh+|ah+n*|ãh*|ã{2,}|hã+|hum+|hm+|uh+m*|uhum)$/u;

/** Vícios que às vezes são legítimos — confiança baixa, operador decide */
const WEAK_FILLERS: Record<string, number> = { "né": 0.5, tipo: 0.35 };

/** Palavras após as quais "tipo" é substantivo ("tipo de", "tipo do") */
const TIPO_AS_NOUN = new Set(["de", "do", "da", "dos", "das", "assim"]);

/** words: palavras de UMA fonte, ordenadas */
export function detectFillers(words: TranscriptWord[]): CutCandidate[] {
  const out: CutCandidate[] = [];
  words.forEach((w, i) => {
    const norm = normalizeWord(w.text);
    let confidence = 0;
    if (STRONG_FILLER.test(norm)) confidence = 0.85;
    else if (norm in WEAK_FILLERS) {
      const next = words[i + 1] ? normalizeWord(words[i + 1].text) : "";
      if (norm === "tipo" && TIPO_AS_NOUN.has(next)) return;
      confidence = WEAK_FILLERS[norm];
    }
    if (confidence === 0) return;
    const { start, end } = wordsCutRange(words, i, i);
    out.push({
      sourceId: w.sourceId,
      sourceStart: start,
      sourceEnd: end,
      reason: "filler",
      confidence,
      note: `"${w.text}"`,
    });
  });
  return out;
}

/**
 * Gaguejos: mesma palavra (ou par de palavras) dita duas vezes seguidas.
 * Corta a PRIMEIRA ocorrência — a segunda é a que emenda na frase.
 */
export function detectRepeats(words: TranscriptWord[]): CutCandidate[] {
  const out: CutCandidate[] = [];
  const norm = words.map((w) => normalizeWord(w.text));
  let i = 0;
  while (i < words.length) {
    const pair =
      i + 3 < words.length &&
      norm[i] !== "" &&
      norm[i] === norm[i + 2] &&
      norm[i + 1] === norm[i + 3];
    const single = i + 1 < words.length && norm[i] !== "" && norm[i] === norm[i + 1];
    const n = pair ? 2 : single ? 1 : 0;
    if (n === 0) {
      i++;
      continue;
    }
    const { start, end } = wordsCutRange(words, i, i + n - 1);
    const text = words.slice(i, i + n).map((w) => w.text).join(" ");
    out.push({
      sourceId: words[i].sourceId,
      sourceStart: start,
      sourceEnd: end,
      reason: "repeat",
      // palavras curtas repetidas ("é é", "a a") são quase sempre gaguejo;
      // repetição longa pode ser ênfase ("multa, multa do ITCMD")
      confidence: pair || norm[i].length <= 3 ? 0.8 : 0.6,
      note: `"${text} ${text}"`,
    });
    i += n * 2;
  }
  return out;
}

export interface PauseOptions {
  /** Buraco mínimo entre palavras para virar sugestão (s) */
  minGapSeconds: number;
  /** Respiro mantido de cada lado (s) */
  keepSeconds: number;
}

export const defaultPauseOptions: PauseOptions = {
  minGapSeconds: 0.45,
  keepSeconds: 0.15,
};

/**
 * Pausas entre palavras. Pega o que o silencedetect perde: respiração,
 * ruído de fundo e hesitações que o Whisper omite da transcrição.
 */
export function detectPauses(
  words: TranscriptWord[],
  opts: PauseOptions = defaultPauseOptions
): CutCandidate[] {
  const out: CutCandidate[] = [];
  for (let i = 1; i < words.length; i++) {
    const gap = words[i].start - words[i - 1].end;
    if (gap < opts.minGapSeconds) continue;
    const start = words[i - 1].end + opts.keepSeconds;
    const end = words[i].start - opts.keepSeconds;
    if (end - start < 0.15) continue;
    out.push({
      sourceId: words[i].sourceId,
      sourceStart: round3(start),
      sourceEnd: round3(end),
      reason: "pause",
      confidence:
        Math.round(Math.min(0.9, 0.5 + (gap - opts.minGapSeconds) * 0.4) * 100) / 100,
      note: `${gap.toFixed(1)}s entre "${words[i - 1].text}" e "${words[i].text}"`,
    });
  }
  return out;
}

/** Agrupa as palavras por fonte, preservando a ordem */
export function wordsBySource(words: TranscriptWord[]): Map<string, TranscriptWord[]> {
  const map = new Map<string, TranscriptWord[]>();
  for (const w of words) {
    const list = map.get(w.sourceId) ?? [];
    list.push(w);
    map.set(w.sourceId, list);
  }
  return map;
}

/** Roda os detectores determinísticos em todas as fontes */
export function detectTranscriptCuts(
  recipe: Recipe,
  pauseOpts: PauseOptions = defaultPauseOptions
): CutCandidate[] {
  const out: CutCandidate[] = [];
  for (const words of wordsBySource(transcriptWords(recipe)).values()) {
    out.push(...detectRepeats(words), ...detectFillers(words), ...detectPauses(words, pauseOpts));
  }
  return out;
}
