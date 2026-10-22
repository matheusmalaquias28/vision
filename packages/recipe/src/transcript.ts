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
 * Sons de hesitação inequívocos ("ééé", "eeeh", "aaah", "hmmm", "ããã"). "é",
 * "e", "a" e "um" sozinhos ficam de fora: são verbo, conjunção e artigo.
 */
const STRONG_FILLER =
  /^(é{2,}h*|e{2,}h*|eh+|a{2,}h*|ah+n*|ã{2,}h*|ãh+|hã+|o{2,}h*|u{2,}h*|uh+m*|hu+m+|hm+|m{2,}|ahn+|uhum)$/u;

/**
 * Vogal sozinha esticada além disso é hesitação ("éééé"), não verbo/conjunção.
 * "o"/"a" ficam de fora: são artigos, e o Whisper às vezes dá a eles o tempo
 * da palavra seguinte ("o[58.3-59.1] imóvel[59.1-59.1]") — cortar comeria a fala.
 */
const STRETCHED_VOWEL = new Set(["é", "e", "ah", "eh"]);
const STRETCHED_SECONDS = 0.4;
/** Vizinha com menos que isso foi "espremida" pelo Whisper: tempos não confiáveis */
const COLLAPSED_WORD_SECONDS = 0.04;

/**
 * Muletas e palavras de transição: às vezes têm função na frase, então a
 * confiança base é baixa e o contexto decide (ver detectFillers).
 */
const CRUTCHES: Record<string, number> = {
  "né": 0.55,
  tipo: 0.5,
  sabe: 0.45,
  entendeu: 0.45,
  "então": 0.35,
  assim: 0.3,
  "aí": 0.3,
  bom: 0.3,
  enfim: 0.4,
  olha: 0.35,
  "tá": 0.3,
  beleza: 0.3,
  basicamente: 0.35,
  digamos: 0.4,
};

/** Expressões de transição de duas palavras */
const CRUTCH_PHRASES: Record<string, number> = {
  "pois é": 0.45,
  "quer dizer": 0.45,
  "na verdade": 0.35,
  "tipo assim": 0.6,
  "então assim": 0.6,
  "e aí": 0.35,
  "sabe assim": 0.55,
};

/** Muletas que, abrindo a fala de um clipe, quase sempre sobram ("Então, hoje…") */
const OPENERS = new Set(["então", "bom", "olha", "enfim", "aí", "assim"]);

/** Palavras após as quais "tipo" é substantivo ("tipo de", "tipo do") */
const TIPO_AS_NOUN = new Set(["de", "do", "da", "dos", "das"]);
/** "assim que", "assim como", "então ele"… : conectivo de verdade */
const CONNECTIVE_AFTER: Record<string, Set<string>> = {
  assim: new Set(["que", "como", "mesmo"]),
};

/** Pausa em volta da muleta: é ela solta, entre respiros, que sobra na fala */
const CRUTCH_GAP_SECONDS = 0.18;
/** Muletas abaixo disso ficam de fora (mais ruído que ajuda) */
const MIN_CRUTCH_CONFIDENCE = 0.5;

/** words: palavras de UMA fonte, ordenadas */
export function detectFillers(words: TranscriptWord[]): CutCandidate[] {
  const out: CutCandidate[] = [];
  const norm = words.map((w) => normalizeWord(w.text));
  const gapBefore = (i: number) => (i === 0 ? Infinity : words[i].start - words[i - 1].end);
  const gapAfter = (i: number) =>
    i === words.length - 1 ? Infinity : words[i + 1].start - words[i].end;

  /** Contexto que indica muleta: isolada por pausas ou abrindo o clipe */
  const contextBoost = (from: number, to: number) => {
    const before = gapBefore(from) >= CRUTCH_GAP_SECONDS;
    const after = gapAfter(to) >= CRUTCH_GAP_SECONDS;
    let boost = before && after ? 0.3 : before || after ? 0.15 : 0;
    if (from === 0 && OPENERS.has(norm[from])) boost += 0.25;
    return boost;
  };

  const push = (from: number, to: number, confidence: number) => {
    const { start, end } = wordsCutRange(words, from, to);
    const text = words.slice(from, to + 1).map((w) => w.text).join(" ");
    out.push({
      sourceId: words[from].sourceId,
      sourceStart: start,
      sourceEnd: end,
      reason: "filler",
      confidence: Math.round(Math.min(confidence, 0.9) * 100) / 100,
      note: `"${text}"`,
    });
  };

  for (let i = 0; i < words.length; i++) {
    const n = norm[i];
    if (!n) continue;
    if (STRONG_FILLER.test(n)) {
      push(i, i, 0.85);
      continue;
    }
    if (STRETCHED_VOWEL.has(n) && words[i].end - words[i].start >= STRETCHED_SECONDS) {
      const collapsed = (k: number) =>
        k >= 0 && k < words.length && words[k].end - words[k].start < COLLAPSED_WORD_SECONDS;
      if (!collapsed(i - 1) && !collapsed(i + 1)) {
        push(i, i, 0.6);
        continue;
      }
    }
    const phrase = i + 1 < words.length ? `${n} ${norm[i + 1]}` : "";
    if (phrase in CRUTCH_PHRASES) {
      const confidence = CRUTCH_PHRASES[phrase] + contextBoost(i, i + 1);
      if (confidence >= MIN_CRUTCH_CONFIDENCE) {
        push(i, i + 1, confidence);
        i++;
        continue;
      }
    }
    if (n in CRUTCHES) {
      const next = norm[i + 1] ?? "";
      if (n === "tipo" && TIPO_AS_NOUN.has(next)) continue;
      if (CONNECTIVE_AFTER[n]?.has(next)) continue;
      const confidence = CRUTCHES[n] + contextBoost(i, i);
      if (confidence >= MIN_CRUTCH_CONFIDENCE) push(i, i, confidence);
    }
  }
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

/**
 * Ritmo dos cortes de pausa. O que sobra de silêncio num corte é
 * 2 × keepSeconds; pausas menores que minGapSeconds ficam.
 */
export const CUT_PACES = ["suave", "normal", "acelerado"] as const;
export type CutPace = (typeof CUT_PACES)[number];

export const PAUSE_PACES: Record<CutPace, PauseOptions> = {
  suave: { minGapSeconds: 0.6, keepSeconds: 0.15 },
  normal: { minGapSeconds: 0.35, keepSeconds: 0.1 },
  // fala colada, estilo reels: sobra ~0.12s entre frases
  acelerado: { minGapSeconds: 0.25, keepSeconds: 0.06 },
};

export const defaultPauseOptions: PauseOptions = PAUSE_PACES.normal;

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
    // corte de 0.1s ainda tira um "buraco" perceptível no ritmo acelerado
    if (end - start < 0.1) continue;
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

/** Silêncio medido no áudio (ffmpeg silencedetect), em segundos do bruto */
export interface SilenceRange {
  start: number;
  end: number;
}

/** Silêncio menor que isso dentro de uma palavra é pausa natural da fala */
const MIN_SILENCE_IN_WORD = 0.2;
/** Silêncio que começa até aqui é o "ar" antes da primeira fala */
const HEAD_SILENCE_EPS = 0.05;

/**
 * O Whisper estica palavras por cima das pausas ("na" de 1.5s a 3.5s quando a
 * fala só volta em 3.4s) e as lacunas entre palavras somem — sem lacuna,
 * detectPauses não acha a pausa e a legenda destaca a palavra no silêncio.
 * Apara de cada palavra o silêncio real do áudio: na borda, some; no meio,
 * fica o lado com mais fala. Palavra inteira dentro de um silêncio vai para a
 * borda onde a fala está (depois do silêncio inicial; senão a mais próxima).
 * Idempotente: palavras já aparadas não mudam.
 */
export function refineWordsWithSilences(words: Word[], silences: SilenceRange[]): Word[] {
  return words.map((w) => {
    let start = w.start;
    let end = w.end;
    for (const s of silences) {
      const a = Math.max(start, s.start);
      const b = Math.min(end, s.end);
      if (b - a < MIN_SILENCE_IN_WORD) continue;
      if (a <= start && b >= end) {
        // nenhuma fala sobra: a palavra foi posta no silêncio
        const mid = (start + end) / 2;
        const edge =
          s.start <= HEAD_SILENCE_EPS || s.end - mid <= mid - s.start ? s.end : s.start;
        start = edge;
        end = edge;
        break;
      }
      if (a - start <= end - b) start = b;
      else end = a;
    }
    if (start === w.start && end === w.end) return w;
    return { ...w, start: round3(start), end: round3(end) };
  });
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

/**
 * Ar antes da primeira palavra e depois da última de cada clipe (o começo de
 * gravação em que a pessoa ainda não falou, o fim em que ela já parou).
 */
export function detectEdgePauses(
  words: TranscriptWord[],
  sourceDuration: number,
  opts: PauseOptions = defaultPauseOptions
): CutCandidate[] {
  if (words.length === 0) return [];
  const out: CutCandidate[] = [];
  const first = words[0];
  const last = words[words.length - 1];
  const headEnd = first.start - opts.keepSeconds;
  if (first.start >= opts.minGapSeconds && headEnd >= 0.15) {
    out.push({
      sourceId: first.sourceId,
      sourceStart: 0,
      sourceEnd: round3(headEnd),
      reason: "pause",
      confidence: 0.85,
      note: `${first.start.toFixed(1)}s antes de "${first.text}"`,
    });
  }
  const tailStart = last.end + opts.keepSeconds;
  if (sourceDuration - last.end >= opts.minGapSeconds && sourceDuration - tailStart >= 0.15) {
    out.push({
      sourceId: last.sourceId,
      sourceStart: round3(tailStart),
      sourceEnd: round3(sourceDuration),
      reason: "pause",
      confidence: 0.85,
      note: `${(sourceDuration - last.end).toFixed(1)}s depois de "${last.text}"`,
    });
  }
  return out;
}

/** Roda os detectores determinísticos em todas as fontes */
export function detectTranscriptCuts(
  recipe: Recipe,
  pauseOpts: PauseOptions = defaultPauseOptions
): CutCandidate[] {
  const out: CutCandidate[] = [];
  const durations = new Map(recipe.sources.map((s) => [s.id, s.durationInSeconds]));
  for (const [sourceId, words] of wordsBySource(transcriptWords(recipe))) {
    out.push(
      ...detectRepeats(words),
      ...detectFillers(words),
      ...detectPauses(words, pauseOpts),
      ...detectEdgePauses(words, durations.get(sourceId) ?? words[words.length - 1].end, pauseOpts)
    );
  }
  return out;
}
