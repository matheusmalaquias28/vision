/**
 * Creative Engine — parte determinística (sem IA). O planner do servidor faz
 * UMA chamada ao modelo; tudo antes (briefing, candidatos, catálogo) e depois
 * (compilação, checagem de fatos, composição) acontece aqui, no código.
 */
import { COMBO_IDS, MOTION_COMBOS, nextGroupId, type ComboId } from "./motionCombos";
import { PUNCH_IN_GROUP, type MotionCandidate } from "./motions";
import type { MusicWant } from "./music";
import {
  MOTION_REGISTRY,
  parseSlotNumber,
  SLOT_KEYS,
  type CreativeStyle,
  type MotionLayer,
  type SlotKey,
  type Slots,
} from "./motionRegistry";
import { MOTION_KINDS, MotionSchema, type Motion, type MotionKind, type Recipe } from "./schema";
import { ILLUSTRATION_GAP_SECONDS, MAX_ILLUSTRATIONS } from "./illustration";
import {
  MAX_TRANSITIONS,
  snapToCut,
  TRANSITION_EDGE_SECONDS,
  TRANSITION_GAP_SECONDS,
  TRANSITION_PRESETS,
  type TransitionStyle,
} from "./transitions";
import { applyCutToSegments, outputDuration, outputToSource, segmentDuration, sourceToOutput } from "./time";
import { isWordKept, transcriptWords, type TranscriptWord } from "./transcript";

// ─── Presets globais (iguais para todas as demandas; nada por cliente) ───

export interface CreativePreset {
  label: string;
  description: string;
  /** Um motion (ou combo) a cada N segundos, no máximo */
  secondsPerMotion: number;
  /** Máximo de motions começando numa janela de 10 s */
  maxPer10s: number;
  /** Mesmo tipo de novo só depois de N segundos */
  repeatGapSeconds: number;
  /** Intervalo mínimo entre flashes (Infinity = estilo sem flash) */
  flashGapSeconds: number;
}

export const CREATIVE_PRESETS: Record<CreativeStyle, CreativePreset> = {
  balanced: {
    label: "Equilibrado",
    description: "ritmo de anúncio: algo a cada poucos segundos, variedade, sem exagero",
    secondsPerMotion: 4,
    maxPer10s: 2,
    repeatGapSeconds: 6,
    flashGapSeconds: 20,
  },
  dynamic: {
    label: "Dinâmico",
    description: "ritmo alto: punches, frases cinéticas, transições, mais motions",
    secondsPerMotion: 3,
    maxPer10s: 3,
    repeatGapSeconds: 4,
    flashGapSeconds: 12,
  },
  premium: {
    label: "Premium",
    description: "sóbrio: tipografia elegante, câmera suave, sem flash",
    secondsPerMotion: 5.5,
    maxPer10s: 2,
    repeatGapSeconds: 8,
    flashGapSeconds: Infinity,
  },
  minimal: {
    label: "Minimalista",
    description: "o mínimo: só o essencial, sem flash nem emoji",
    secondsPerMotion: 10,
    maxPer10s: 1,
    repeatGapSeconds: 12,
    flashGapSeconds: Infinity,
  },
  educational: {
    label: "Educativo",
    description: "clareza: listas, números e setas; sem flash",
    secondsPerMotion: 4.5,
    maxPer10s: 2,
    repeatGapSeconds: 6,
    flashGapSeconds: Infinity,
  },
};

// ─── Briefing Interpreter (texto livre do War, determinístico) ───────

export interface BriefDirectives {
  /** Estilo pedido explicitamente (null = não disse) */
  style: CreativeStyle | null;
  /** Tipos proibidos pelo briefing */
  avoid: MotionKind[];
  /** Elementos pedidos: viram preferência no catálogo, não obrigação */
  wants: ("counter" | "list" | "cta" | "emphasis" | "emoji" | "flash" | "chart" | "screen" | "transition" | "illustration")[];
  /** Trechos do briefing que justificam cada decisão */
  evidence: string[];
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

const NEG = String.raw`(?:sem|nao\s+(?:usar|use|coloque|colocar|quero|precisa(?:\s+de)?|ter)|evit(?:e|ar)|nada\s+de|zero|proibido|dispensa(?:r)?)`;
/** Proibição: "sem emoji", "não usar flash", "evitar zoom" (até 3 palavras no meio) */
const forbids = (text: string, target: string) =>
  new RegExp(String.raw`${NEG}\s+(?:\S+\s+){0,3}?${target}`).exec(text);

const STYLE_HINTS: [CreativeStyle, RegExp][] = [
  ["dynamic", /\b(dinamic\w*|agil|rapid\w*|energ\w*|frenetic\w*|acelerad\w*|cortes rapidos)/],
  ["premium", /\b(premium|sofisticad\w*|elegan\w*|luxo\w*|sobri\w*|sobrio|institucional|corporativ\w*|refinad\w*)/],
  ["minimal", /\b(minimal\w*|limp[oa]|clean|discret\w*|sem efeitos|poucos efeitos)/],
  ["educational", /\b(educativ\w*|didatic\w*|explicativ\w*|tutorial|passo a passo|ensinar)/],
];

export function interpretBriefing(briefing: string): BriefDirectives {
  const text = norm(briefing ?? "");
  const out: BriefDirectives = { style: null, avoid: [], wants: [], evidence: [] };
  if (!text.trim()) return out;

  const avoidRules: [MotionKind[], string][] = [
    [["emoji"], String.raw`emoj\w*`],
    [["flash"], String.raw`(?:flash\w*|clar(?:a|o)o\w*|piscad\w*)`],
    [["zoom"], String.raw`zoom\w*`],
    [["arrow"], String.raw`seta\w*`],
    [["counter"], String.raw`(?:contador\w*|numeros? animad\w*)`],
    [["chart"], String.raw`grafic\w*`],
    [["screen"], String.raw`(?:telas? cheias?|cartela\w*)`],
    [["transition"], String.raw`transic\w*`],
    [["illustration"], String.raw`(?:ilustr\w*|imagens? (?:gerad\w*|de ia|com ia))`],
    [["kinetic", "keyword", "statement", "list", "bubble", "counter"], String.raw`(?:textos?|letterings?)(?:\s+na\s+tela|\s+animad\w*)?`],
  ];
  for (const [kinds, target] of avoidRules) {
    const m = forbids(text, target);
    if (m) {
      for (const k of kinds) if (!out.avoid.includes(k)) out.avoid.push(k);
      out.evidence.push(m[0]);
    }
  }
  if (/\bsem (efeitos|motions?|animac\w*)\b/.test(text)) {
    for (const k of ["flash", "emoji"] as MotionKind[]) if (!out.avoid.includes(k)) out.avoid.push(k);
  }

  let first = Infinity;
  for (const [style, re] of STYLE_HINTS) {
    const m = re.exec(text);
    if (m && m.index < first) {
      first = m.index;
      out.style = style;
    }
  }
  if (out.style) out.evidence.push(STYLE_HINTS.find(([s]) => s === out.style)![1].exec(text)![0]);

  const wantRules: [BriefDirectives["wants"][number], RegExp][] = [
    ["counter", /\b(contador|porcentage\w*|estatistic\w*|numero\w*|dados?)\b/],
    ["list", /\b(beneficios?|vantage\w*|topicos|passos|itens)\b/],
    ["cta", /\b(cta|chamada para acao|call to action|link|direct|whats\w*|agend\w*|compr\w*|inscrev\w*)\b/],
    ["emphasis", /\b(destac\w*|enfatiz\w*|ressalt\w*|palavras?[- ]chave)\b/],
    ["emoji", /\bemojis?\b/],
    ["flash", /\bflash\w*\b/],
    ["chart", /\b(grafic\w*|comparativ\w*|comparac\w*)\b/],
    ["screen", /\b(telas? cheias?|cartela\w*)\b/],
    ["transition", /\btransic\w*\b/],
    ["illustration", /\b(ilustr\w*|imagens? (gerad\w*|de ia|com ia))\b/],
  ];
  for (const [want, re] of wantRules) {
    if (re.test(text) && !out.avoid.includes(want as MotionKind)) out.wants.push(want);
  }
  return out;
}

// ─── Fala no corte ───────────────────────────────────────────────────

export interface SpokenWord {
  word: TranscriptWord;
  /** Início no vídeo final */
  outputTime: number;
}

/**
 * A receita como fica quando o operador aceitar os cortes pendentes. O
 * planner trabalha nela: no bruto, as trocas de clipe ficam longe das
 * palavras (o ar de cada ponta) e a transição não acha corte; e o que fosse
 * ancorado numa pausa a ser cortada sumiria depois. Âncoras são no tempo do
 * bruto, então servem nos dois.
 */
export function withPendingCutsApplied(recipe: Recipe): Recipe {
  let segments = recipe.timeline.segments;
  for (const c of recipe.timeline.suggestedCuts) {
    if (c.status === "pending") segments = applyCutToSegments(segments, c.sourceId, c.sourceStart, c.sourceEnd);
  }
  if (segments === recipe.timeline.segments || segments.length === 0) return recipe;
  return { ...recipe, timeline: { ...recipe.timeline, segments } };
}

/** Palavras que estão no corte, na ordem do vídeo final */
export function spokenWords(recipe: Recipe): SpokenWord[] {
  const segments = recipe.timeline.segments;
  return transcriptWords(recipe)
    .filter((w) => isWordKept(segments, w))
    .map((word) => ({
      word,
      outputTime:
        sourceToOutput(segments, word.sourceId, word.start) ??
        sourceToOutput(segments, word.sourceId, (word.start + word.end) / 2)!,
    }))
    .sort((a, b) => a.outputTime - b.outputTime);
}

/** Instantes de corte no vídeo final (fronteiras entre trechos) e se trocam de clipe */
function cutPoints(recipe: Recipe): { at: number; clipChange: boolean }[] {
  const segments = recipe.timeline.segments;
  const out: { at: number; clipChange: boolean }[] = [];
  let acc = 0;
  segments.forEach((s, i) => {
    if (i > 0) out.push({ at: acc, clipChange: s.sourceId !== segments[i - 1].sourceId });
    acc += segmentDuration(s);
  });
  return out;
}

// ─── Momentos de lista na fala (tela cheia em modelo lista tem prioridade) ───

/** Frases que anunciam uma enumeração ("em casos de", "esses são os pontos"...) */
const ENUM_PHRASES = [
  "em casos de",
  "nos casos de",
  "em caso de",
  "em situacoes de",
  "nas situacoes de",
  "em situacoes como",
  "esses sao os",
  "estes sao os",
  "essas sao as",
  "estas sao as",
  "sao eles",
  "sao elas",
  "sao os seguintes",
  "sao as seguintes",
  "os seguintes",
  "as seguintes",
  "esses topicos",
  "estes topicos",
  "esses pontos",
  "estes pontos",
  "os pontos",
  "os topicos",
  "entre eles",
  "entre elas",
  "por exemplo",
  "passo a passo",
  "primeiro passo",
  "em primeiro lugar",
].map((p) => p.split(" "));

/** Contáveis: "3 erros", "três dicas", "os documentos" */
const ENUM_NOUNS =
  /^(passos|etapas|pontos|topicos|itens|dicas|erros|motivos|razoes|formas|maneiras|tipos|sinais|documentos|requisitos|direitos|beneficios|vantagens|regras|cuidados|perguntas|criterios|fatores|situacoes|casos|hipoteses)$/;
const COUNT_WORDS = /^(\d+|dois|duas|tres|quatro|cinco|seis|sete)$/;

const normWord = (t: string) => norm(t).replace(/[^a-z0-9]/g, "");

export interface EnumerationCue {
  /** Índice (em spokenWords) da palavra onde a enumeração é anunciada */
  word: number;
  /** Trecho que disparou ("em casos de", "3 erros", "primeiro … segundo") */
  cue: string;
}

/**
 * Onde a fala vira lista: frase de abertura ("em casos de", "esses são os
 * pontos", "analisar esses tópicos"), número + contável ("3 erros", "dois
 * documentos") ou "primeiro … segundo" perto um do outro. Uma pista a cada
 * 8 s no máximo (a tela cheia também só vale 1 a cada 15 s).
 */
export function detectEnumerations(words: SpokenWord[]): EnumerationCue[] {
  const toks = words.map((w) => normWord(w.word.text));
  const raw: EnumerationCue[] = [];
  for (let i = 0; i < toks.length; i++) {
    const phrase = ENUM_PHRASES.find((p) => p.every((t, k) => toks[i + k] === t));
    if (phrase) {
      raw.push({ word: i, cue: words.slice(i, i + phrase.length).map((w) => w.word.text).join(" ") });
      continue;
    }
    // "3 erros", "esses tópicos", "os documentos são"
    if ((COUNT_WORDS.test(toks[i]) || /^(esses|estes|essas|estas)$/.test(toks[i])) && ENUM_NOUNS.test(toks[i + 1] ?? "")) {
      raw.push({ word: i, cue: `${words[i].word.text} ${words[i + 1].word.text}` });
      continue;
    }
    // "primeiro … segundo" em até 25 palavras
    if (/^(primeiro|primeira)$/.test(toks[i]) && toks.slice(i + 1, i + 26).some((t) => /^(segundo|segunda|depois)$/.test(t))) {
      raw.push({ word: i, cue: "primeiro … segundo" });
    }
  }
  const out: EnumerationCue[] = [];
  for (const c of raw) {
    const last = out[out.length - 1];
    if (!last || words[c.word].outputTime - words[last.word].outputTime >= 8) out.push(c);
  }
  return out;
}

/** Índices das palavras que vêm logo depois de um corte (marcados no prompt) */
export function wordsAfterCut(recipe: Recipe, words: SpokenWord[]): Set<number> {
  const cuts = cutPoints(recipe).map((c) => c.at);
  const out = new Set<number>();
  words.forEach((w, i) => {
    if (i === 0) return;
    const prev = words[i - 1].outputTime;
    if (cuts.some((c) => c > prev && c <= w.outputTime + 0.05)) out.add(i);
  });
  return out;
}

// ─── Motion Retrieval (filtro e pontuação locais, sem embeddings) ────

export interface RetrievalContext {
  style: CreativeStyle;
  directives: BriefDirectives;
  durationSeconds: number;
}

/** Tipos que a IA pode usar nesta demanda, do mais ao menos adequado */
export function getCandidateMotions(ctx: RetrievalContext): MotionKind[] {
  const { style, directives } = ctx;
  const wants = new Set(directives.wants);
  const scored = MOTION_KINDS.filter((k) => {
    if (directives.avoid.includes(k)) return false;
    if ((k === "flash" || k === "speedLines") && !wants.has("flash") && CREATIVE_PRESETS[style].flashGapSeconds === Infinity) return false;
    if (k === "emoji" && !wants.has("emoji") && (style === "premium" || style === "minimal")) return false;
    // tela cheia e transição quebram o vídeo: não combinam com minimalista (a não ser que o briefing peça)
    if (k === "screen" && !wants.has("screen") && style === "minimal") return false;
    if (k === "transition" && !wants.has("transition") && style === "minimal") return false;
    // ilustração gera imagem paga: só pelo botão "Sugerir imagens", nunca no plano automático
    if (k === "illustration") return false;
    return true;
  }).map((k) => {
    const m = MOTION_REGISTRY[k];
    let score = m.styles.includes(style) ? 2 : 0;
    if (wants.has("counter") && k === "counter") score += 3;
    if (wants.has("list") && k === "list") score += 3;
    if (wants.has("chart") && k === "chart") score += 3;
    if (wants.has("screen") && k === "screen") score += 3;
    if (wants.has("transition") && k === "transition") score += 3;
    if (wants.has("counter") && k === "chart") score += 1;
    if (wants.has("cta") && (k === "statement" || k === "arrow")) score += 2;
    if (wants.has("emphasis") && (k === "keyword" || k === "kinetic")) score += 2;
    if (k === "zoom") score += 1; // câmera combina com quase tudo
    return { k, score };
  });
  return scored.sort((a, b) => b.score - a.score).map((x) => x.k).slice(0, 16);
}

export function getCandidateCombos(ctx: RetrievalContext, kinds: MotionKind[]): ComboId[] {
  return COMBO_IDS.filter((id) => MOTION_COMBOS[id].uses.every((k) => kinds.includes(k))).sort(
    (a, b) => Number(MOTION_COMBOS[b].styles.includes(ctx.style)) - Number(MOTION_COMBOS[a].styles.includes(ctx.style))
  );
}

/** Catálogo compacto para o prompt: só finalidade, uso, durações e campos (sem código) */
export function formatCatalogForPrompt(kinds: MotionKind[], combos: ComboId[]): string {
  const fields = (p: Partial<Record<SlotKey, string>>) =>
    Object.entries(p)
      .map(([k, v]) => `${k}: ${v}`)
      .join("; ");
  const lines = kinds.map((k) => {
    const m = MOTION_REGISTRY[k];
    const variants = m.variants.length ? ` | variantes: ${m.variants.map((v) => `${v.value}=${v.use}`).join(", ")}` : "";
    return `- ${k}: ${m.purpose} | usar: ${m.useWhen.join("; ")} | evitar: ${m.avoidWhen.join("; ")} | ${m.seconds.min}–${m.seconds.max}s${variants} | params: ${fields(m.aiParams)}`;
  });
  const comboLines = combos.map((id) => {
    const c = MOTION_COMBOS[id];
    return `- ${id}: ${c.purpose} | usar: ${c.useWhen.join("; ")} | evitar: ${c.avoidWhen.join("; ")} | ${c.seconds.min}–${c.seconds.max}s | params: ${fields(c.aiParams)}`;
  });
  return `MOTIONS (type "motion"):\n${lines.join("\n")}${comboLines.length ? `\n\nRECEITAS (type "combo", várias peças sincronizadas):\n${comboLines.join("\n")}` : ""}`;
}

// ─── Plano da IA → candidatos validados ──────────────────────────────

export interface PlanEvent {
  type: "motion" | "combo";
  id: string;
  /** Índice da palavra (lista de spokenWords) onde começa */
  word: number;
  /** Duração pedida (null = padrão do tipo) */
  seconds: number | null;
  params: { k: SlotKey; v: string }[];
}

export interface CreativePlan {
  style: CreativeStyle;
  events: PlanEvent[];
  /** Trilha que o vídeo pede (undefined = plano sem essa parte: heurístico/cache antigo) */
  music?: Omit<MusicWant, "avoidVocals"> | null;
}

export interface Rejection {
  ref: string;
  reason: string;
}

/** Candidato com a ordem de importância que a IA deu (0 = mais importante) */
export type RankedCandidate = MotionCandidate & { priority: number };

const STOPWORDS = new Set(
  "a o as os de da do das dos e em no na nos nas um uma uns umas que pra para por com sem se seu sua seus suas voce voces eu ele ela isso esse essa este esta mais muito ja nao sim ao aos tem ter ser vai vou foi era sao como mas ou the and".split(
    " "
  )
);

function contentTokens(text: string): string[] {
  return norm(text)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

const NUMBER_WORDS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18,
  dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80,
  noventa: 90, cem: 100, cento: 100, duzentos: 200, trezentos: 300, quinhentos: 500, mil: 1000,
};

/** Fatos permitidos: palavras e números que aparecem na fala ou no briefing */
export interface Facts {
  tokens: Set<string>;
  numbers: number[];
}

export function buildFacts(recipe: Recipe, words: SpokenWord[]): Facts {
  const corpus = `${words.map((w) => w.word.text).join(" ")} ${recipe.briefing}`;
  const tokens = new Set(contentTokens(corpus));
  const numbers: number[] = [];
  const n = norm(corpus);
  for (const m of n.matchAll(/(\d+(?:[.,]\d+)*)\s*(mil|milhao|milhoes|bi|bilhao|bilhoes)?/g)) {
    const v = parseSlotNumber(m[1]);
    if (v === null) continue;
    numbers.push(v);
    if (m[2] === "mil") numbers.push(v * 1000);
    if (m[2]?.startsWith("milh")) numbers.push(v * 1e6);
    if (m[2]?.startsWith("bi")) numbers.push(v * 1e9);
  }
  for (const t of n.split(/[^a-z]+/)) if (t in NUMBER_WORDS) numbers.push(NUMBER_WORDS[t]);
  return { tokens, numbers };
}

const tokenKnown = (facts: Facts, t: string) =>
  facts.tokens.has(t) ||
  facts.tokens.has(t.replace(/s$/, "")) ||
  [...facts.tokens].some((f) => f.length >= 5 && t.length >= 5 && f.slice(0, 5) === t.slice(0, 5));

/** Fração das palavras de conteúdo que vieram da fala/briefing (1 se não houver) */
export function groundedRatio(facts: Facts, text: string): number {
  const toks = contentTokens(text);
  if (toks.length === 0) return 1;
  return toks.filter((t) => tokenKnown(facts, t)).length / toks.length;
}

export function numberGrounded(facts: Facts, value: number): boolean {
  return facts.numbers.some((n) => Math.abs(n - value) < 1e-9);
}

/** Texto visível de um motion (para checar se veio da fala) */
function visibleText(m: Pick<Motion, "kind" | "params">): string {
  const p = m.params as Record<string, unknown>;
  switch (m.kind) {
    case "list":
      return `${p.title ?? ""} ${(p.items as string[]).join(" ")}`;
    case "lowerThird":
      return `${p.title ?? ""} ${p.subtitle ?? ""}`;
    case "counter":
      return String(p.label ?? "");
    case "statement":
    case "screen":
      return `${p.eyebrow ?? ""} ${p.text ?? ""} ${((p.items as string[] | undefined) ?? []).join(" ")}`;
    case "arrow":
      return String(p.label ?? "");
    case "chart":
      return `${p.title ?? ""} ${(p.items as { label: string }[]).map((i) => i.label).join(" ")}`;
    default:
      return String(p.text ?? "");
  }
}

/** null = ok; senão, o motivo da recusa */
export function checkGrounding(m: Pick<Motion, "kind" | "params">, facts: Facts): string | null {
  const g = MOTION_REGISTRY[m.kind].grounding;
  if (m.kind === "counter") {
    const to = (m.params as { to: number }).to;
    if (!numberGrounded(facts, to)) return `número ${to} não aparece na fala nem no briefing`;
  }
  if (m.kind === "chart") {
    for (const item of (m.params as { items: { label: string; value: number }[] }).items) {
      if (!numberGrounded(facts, item.value)) return `número ${item.value} (${item.label}) não aparece na fala nem no briefing`;
    }
  }
  if (g === "none") return null;
  const text = visibleText(m);
  // qualquer número visível no texto (selo "-20%", chamada "500 clientes") também precisa ter sido dito
  for (const raw of text.match(/\d+(?:[.,]\d+)*/g) ?? []) {
    const v = parseSlotNumber(raw);
    if (v !== null && !numberGrounded(facts, v)) return `número ${raw} não aparece na fala nem no briefing`;
  }
  if (m.kind === "chart") return groundedRatio(facts, text) === 0 && contentTokens(text).length > 0 ? `rótulos "${text.trim()}" sem relação com a fala` : null;
  if (g === "words" && m.kind !== "lowerThird" && contentTokens(text).length === 0) {
    return `texto "${text.trim()}" é genérico demais`;
  }
  const ratio = groundedRatio(facts, text);
  if (g === "words" && ratio < 0.5) return `texto "${text.trim()}" não vem da fala`;
  if (g === "loose" && ratio === 0) return `texto "${text.trim()}" não tem relação com a fala`;
  return null;
}

function slotsOf(e: PlanEvent): Slots {
  const s: Slots = {};
  for (const { k, v } of e.params) if ((SLOT_KEYS as readonly string[]).includes(k)) s[k] = v;
  // destaque só vale se for uma palavra da própria frase
  if (s.emphasis !== undefined) {
    const words = norm(s.text ?? "").split(/[^a-z0-9]+/);
    const target = norm(s.emphasis).replace(/[^a-z0-9]/g, "");
    if (!target || !words.includes(target)) delete s.emphasis;
  }
  return s;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** Quanto um evento ancorado perto do fim pode recuar para caber (CTA na última frase) */
const MAX_BACKSHIFT_SECONDS = 2.5;

/**
 * Início e duração dentro do vídeo: se não cabe a duração mínima a partir da
 * âncora, recua até MAX_BACKSHIFT_SECONDS; além disso, recusa.
 */
function fitTiming(
  anchor: number,
  total: number,
  seconds: { min: number; default: number; max: number },
  asked: number | null
): { start: number; duration: number } | null {
  let start = anchor;
  if (total - start < seconds.min) {
    const shifted = Math.max(0, total - seconds.min);
    if (anchor - shifted > MAX_BACKSHIFT_SECONDS) return null;
    start = shifted;
  }
  const duration = Math.min(Math.max(asked ?? seconds.default, seconds.min), seconds.max, total - start);
  return duration >= seconds.min - 1e-9 ? { start, duration } : null;
}
const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Converte o plano da IA em candidatos: âncora pela palavra no corte,
 * slots → params pelo manifesto, MotionSchema, durações e checagem de fatos.
 * Nada que falhe entra; cada recusa vai para `rejected` com o motivo.
 */
export function compilePlan(
  recipe: Recipe,
  plan: CreativePlan,
  allowed: { kinds: MotionKind[]; combos: ComboId[] },
  /** Estilo final (o do briefing manda sobre o da IA) */
  style: CreativeStyle = plan.style
): { candidates: RankedCandidate[]; rejected: Rejection[] } {
  const words = spokenWords(recipe);
  const facts = buildFacts(recipe, words);
  const segments = recipe.timeline.segments;
  const total = outputDuration(segments);
  const candidates: RankedCandidate[] = [];
  const rejected: Rejection[] = [];
  // sugestões pendentes da IA serão substituídas: os grupos delas ficam livres
  const groups: (string | null)[] = recipe.motions
    .filter((m) => !(m.status === "pending" && m.origin === "ai"))
    .map((m) => m.group);

  const toCandidate = (
    kind: MotionKind,
    outStart: number,
    duration: number,
    params: Record<string, unknown>,
    priority: number,
    group: string | null,
    note: string
  ): { ok: RankedCandidate } | { error: string } => {
    const anchor = outputToSource(segments, Math.min(Math.max(outStart, 0), Math.max(total - 0.05, 0)));
    if (!anchor) return { error: "fora do vídeo" };
    const parsed = MotionSchema.safeParse({
      id: "tmp",
      kind,
      sourceId: anchor.sourceId,
      sourceTime: round3(anchor.seconds),
      durationSeconds: round2(duration),
      params,
      note,
      group,
      origin: "ai",
      status: "pending",
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return { error: `params inválidos (${issue.path.join(".")}: ${issue.message})` };
    }
    const grounding = checkGrounding(parsed.data, facts);
    if (grounding) return { error: grounding };
    const { id: _i, status: _s, origin: _o, placement: _p, ...cand } = parsed.data;
    return { ok: { ...cand, priority } };
  };

  plan.events.forEach((e, priority) => {
    const ref = `${e.type}:${e.id}@${e.word}`;
    const spoken = words[e.word];
    if (!spoken) return rejected.push({ ref, reason: "palavra inexistente" });
    const start = spoken.outputTime;
    const slots = slotsOf(e);

    if (e.type === "motion") {
      const kind = e.id as MotionKind;
      if (!allowed.kinds.includes(kind)) return rejected.push({ ref, reason: "tipo fora do catálogo desta demanda" });
      const man = MOTION_REGISTRY[kind];
      if (kind === "transition") {
        // transição só em corte: vai para o corte mais perto da palavra, centralizada nele
        const params = man.fromSlots(slots);
        const preset = TRANSITION_PRESETS[(params.style as TransitionStyle | undefined) ?? "flare"];
        const at = snapToCut(segments, start, preset.seconds);
        if (at === null) return rejected.push({ ref, reason: "transição só em corte (nenhum corte perto da palavra)" });
        const r = toCandidate(kind, at, preset.seconds, params, priority, null, "");
        if ("error" in r) rejected.push({ ref, reason: r.error });
        else candidates.push(r.ok);
        return;
      }
      const fit = fitTiming(start, total, man.seconds, e.seconds);
      if (!fit) return rejected.push({ ref, reason: "sem tempo até o fim do vídeo" });
      const params = man.fromSlots(slots);
      const r = toCandidate(kind, fit.start, fit.duration, params, priority, null, "");
      if ("error" in r) rejected.push({ ref, reason: r.error });
      else candidates.push(r.ok);
      return;
    }

    const comboId = e.id as ComboId;
    if (!allowed.combos.includes(comboId)) return rejected.push({ ref, reason: "receita fora do catálogo desta demanda" });
    const combo = MOTION_COMBOS[comboId];
    const fit = fitTiming(start, total, combo.seconds, e.seconds);
    if (!fit) return rejected.push({ ref, reason: "sem tempo até o fim do vídeo" });
    const group = nextGroupId(groups, comboId);
    const pieces: RankedCandidate[] = [];
    for (const piece of combo.build(slots, fit.duration, style)) {
      const r = toCandidate(piece.kind, fit.start + piece.offset, piece.duration, piece.params, priority, group, combo.label);
      if ("error" in r) return rejected.push({ ref, reason: `${piece.kind}: ${r.error}` });
      pieces.push(r.ok);
    }
    groups.push(group);
    candidates.push(...pieces);
  });
  return { candidates, rejected };
}

/** Modelos que o código usa quando completa as transições (combinam com quase tudo) */
const FILLER_TRANSITIONS: TransitionStyle[] = ["flare", "burn"];

/**
 * Transições que o código oferece nos cortes, para quando a IA põe poucas:
 * primeiro nas trocas de clipe, depois nos outros cortes. Entram depois de
 * tudo o que a IA pediu (`priority`) e passam por validateComposition, que
 * aplica as regras (máx. 3, 10 s entre elas, longe das pontas).
 */
export function transitionFillers(recipe: Recipe, priority: number): RankedCandidate[] {
  const segments = recipe.timeline.segments;
  const cuts = cutPoints(recipe).sort((a, b) => Number(b.clipChange) - Number(a.clipChange) || a.at - b.at);
  const out: RankedCandidate[] = [];
  cuts.forEach((cut, i) => {
    const style = FILLER_TRANSITIONS[i % FILLER_TRANSITIONS.length];
    const seconds = TRANSITION_PRESETS[style].seconds;
    const anchor = outputToSource(segments, Math.max(0, cut.at - seconds / 2));
    if (!anchor) return;
    const parsed = MotionSchema.safeParse({
      id: "tmp",
      kind: "transition",
      sourceId: anchor.sourceId,
      sourceTime: round3(anchor.seconds),
      durationSeconds: seconds,
      params: { style },
      origin: "ai",
      status: "pending",
    });
    if (!parsed.success) return;
    const { id: _i, status: _s, origin: _o, placement: _p, ...cand } = parsed.data;
    out.push({ ...cand, priority: priority + i });
  });
  return out;
}

// ─── Composition Validator ───────────────────────────────────────────

interface Unit {
  key: string;
  priority: number;
  start: number;
  pieces: { c: RankedCandidate; start: number; end: number; layer: MotionLayer }[];
}

/**
 * Regras de composição, determinísticas: densidade do estilo, uma peça por
 * camada de cada vez (texto, câmera, elemento, tela cheia), flash espaçado,
 * nada de repetir o mesmo tipo em sequência. Considera os motions que já
 * estão na timeline (manuais e revisados); um combo conta como um motion.
 */
/** Tipos com teto próprio (máx. 3 cada), fora da cota de motions do estilo */
const OWN_CAP_KINDS: MotionKind[] = ["transition", "illustration"];

/** Telas cheias quebram o vídeo: no máximo uma a cada 15 s */
const SCREEN_GAP_SECONDS = 15;

export function validateComposition(
  recipe: Recipe,
  candidates: RankedCandidate[],
  style: CreativeStyle,
  /** Só estes tipos de sugestão pendente da IA serão substituídos (padrão: todos) */
  opts: { onlyKinds?: MotionKind[] } = {}
): { accepted: RankedCandidate[]; rejected: Rejection[] } {
  const preset = CREATIVE_PRESETS[style];
  const segments = recipe.timeline.segments;
  const total = outputDuration(segments);
  const rejected: Rejection[] = [];

  // o que fica na timeline (sugestões pendentes da IA serão substituídas)
  const existing = recipe.motions
    .filter((m) => m.status !== "rejected" && !isReplacedSuggestion(m, opts.onlyKinds))
    .map((m) => ({ m, start: sourceToOutput(segments, m.sourceId, m.sourceTime) }))
    .filter((x): x is { m: Motion; start: number } => x.start !== null)
    .map(({ m, start }) => ({
      kind: m.kind,
      group: m.group,
      start,
      end: start + m.durationSeconds,
      layer: MOTION_REGISTRY[m.kind].layer,
    }));

  const units = new Map<string, Unit>();
  for (const c of candidates) {
    const start = sourceToOutput(segments, c.sourceId, c.sourceTime);
    if (start === null) {
      rejected.push({ ref: c.kind, reason: "âncora em trecho cortado" });
      continue;
    }
    const key = c.group ?? `single:${units.size}:${c.kind}`;
    const u = units.get(key) ?? { key, priority: c.priority, start, pieces: [] };
    u.start = Math.min(u.start, start);
    u.pieces.push({ c, start, end: Math.min(start + c.durationSeconds, total), layer: MOTION_REGISTRY[c.kind].layer });
    units.set(key, u);
  }

  // transições e ilustrações têm tetos próprios: não gastam a cota do estilo
  const cap = Math.max(2, Math.round(total / preset.secondsPerMotion));
  // variedade: o mesmo tipo solto no máximo ~1/3 da cota (5 palavras-chave num vídeo de 30 s cansa)
  const maxPerKind = Math.max(2, Math.ceil(cap * 0.35));
  const placed = [...existing];
  const unitStarts = existing.filter((e) => countsForDensity(e.kind, e.group)).map((e) => e.start);
  const accepted: RankedCandidate[] = [];
  let acceptedUnits = 0;

  for (const u of [...units.values()].sort((a, b) => a.priority - b.priority || a.start - b.start)) {
    const label = u.key.startsWith("single:") ? u.pieces[0].c.kind : u.key;
    const fail = (reason: string) => rejected.push({ ref: label, reason });
    const dense = u.pieces.some((p) => countsForDensity(p.c.kind, p.c.group));
    const capped = u.pieces.some((p) => !OWN_CAP_KINDS.includes(p.c.kind));
    if (capped && acceptedUnits >= cap) {
      fail(`limite do estilo ${preset.label} (${cap} motions)`);
      continue;
    }
    if (dense && unitStarts.filter((s) => Math.abs(s - u.start) < 5).length >= preset.maxPer10s) {
      fail("muitos motions na mesma janela de 10 s");
      continue;
    }
    let reason: string | null = null;
    for (const p of u.pieces) {
      const sameLayer = placed.filter((x) => x.layer === p.layer && x.start < p.end && p.start < x.end);
      if (sameLayer.length > 0) {
        reason = `camada ${p.layer} ocupada nesse momento`;
        break;
      }
      // flash e linhas de velocidade: efeitos fortes de tela cheia, raros e espaçados
      if (p.c.kind === "flash" || p.c.kind === "speedLines") {
        if (preset.flashGapSeconds === Infinity) {
          reason = `estilo ${preset.label} não usa ${p.c.kind === "flash" ? "flash" : "linhas de velocidade"}`;
          break;
        }
        if (placed.some((x) => (x.kind === "flash" || x.kind === "speedLines") && Math.abs(x.start - p.start) < preset.flashGapSeconds)) {
          reason = "efeito forte perto demais de outro";
          break;
        }
      }
      // ilustrações geradas: custam crédito e cobrem o meio da tela — no máximo 3, espaçadas
      if (p.c.kind === "illustration") {
        if (placed.filter((x) => x.kind === "illustration").length >= MAX_ILLUSTRATIONS) {
          reason = `máximo de ${MAX_ILLUSTRATIONS} ilustrações por vídeo`;
          break;
        }
        if (placed.some((x) => x.kind === "illustration" && Math.abs(x.start - p.start) < ILLUSTRATION_GAP_SECONDS)) {
          reason = "ilustração perto demais de outra";
          break;
        }
      }
      // transições: no máximo 3, bem espaçadas, longe do começo e do fim
      if (p.c.kind === "transition") {
        if (p.start < TRANSITION_EDGE_SECONDS || p.end > total - TRANSITION_EDGE_SECONDS) {
          reason = "transição perto demais do começo ou do fim";
          break;
        }
        if (placed.filter((x) => x.kind === "transition").length >= MAX_TRANSITIONS) {
          reason = `máximo de ${MAX_TRANSITIONS} transições por vídeo`;
          break;
        }
        if (placed.some((x) => x.kind === "transition" && Math.abs(x.start - p.start) < TRANSITION_GAP_SECONDS)) {
          reason = "transição perto demais de outra";
          break;
        }
      }
      // tela cheia cobre o vídeo e tudo o que estiver por cima: rara e sozinha
      if (p.c.kind === "screen") {
        if (placed.some((x) => x.kind === "screen" && Math.abs(x.start - p.start) < SCREEN_GAP_SECONDS)) {
          reason = "tela cheia perto demais de outra";
          break;
        }
        if (placed.some((x) => x.layer !== "camera" && x.start < p.end && p.start < x.end)) {
          reason = "tela cheia esconderia outro motion";
          break;
        }
      } else if (p.layer !== "camera" && placed.some((x) => x.kind === "screen" && x.start < p.end && p.start < x.end)) {
        reason = "coberto por uma tela cheia";
        break;
      }
      // repetição só conta fora do combo (zoom do combo não briga com o próprio combo)
      if (!u.key.startsWith("single:") ? false : placed.some((x) => x.kind === p.c.kind && Math.abs(x.start - p.start) < preset.repeatGapSeconds)) {
        reason = `${p.c.kind} repetido em sequência`;
        break;
      }
      if (
        u.key.startsWith("single:") &&
        countsForDensity(p.c.kind, p.c.group) &&
        placed.filter((x) => x.kind === p.c.kind).length >= maxPerKind
      ) {
        reason = `${p.c.kind} demais no vídeo (máx. ${maxPerKind}; varie o tipo)`;
        break;
      }
    }
    if (reason) {
      fail(reason);
      continue;
    }
    for (const p of u.pieces) {
      placed.push({ kind: p.c.kind, group: p.c.group, start: p.start, end: p.end, layer: p.layer });
      accepted.push(p.c);
    }
    if (dense) unitStarts.push(u.start);
    if (capped) acceptedUnits++;
  }
  return { accepted, rejected };
}

/** Sugestão pendente da IA que um novo plano substitui (onlyKinds limita a alguns tipos) */
export function isReplacedSuggestion(m: Motion, onlyKinds?: MotionKind[]): boolean {
  return m.status === "pending" && m.origin === "ai" && (!onlyKinds || onlyKinds.includes(m.kind));
}

/**
 * A cota de motions por janela de 10 s é contra poluição na tela: câmera
 * (zooms, inclusive os automáticos nos cortes) e transições não poluem e têm
 * regras próprias (camada, repetição, máx. 3 transições espaçadas).
 * Ilustrações também ficam fora: têm teto e espaçamento próprios (máx. 3,
 * ≥ 8 s entre elas).
 */
function countsForDensity(kind: MotionKind, group: string | null): boolean {
  return (
    group !== PUNCH_IN_GROUP &&
    kind !== "transition" &&
    kind !== "illustration" &&
    MOTION_REGISTRY[kind].layer !== "camera"
  );
}


// ─── Inserção manual de receitas (galeria do editor) ─────────────────

/**
 * Peças de uma receita com início relativo (segundos), já validadas — para a
 * prévia da galeria. Usa os textos de exemplo se `slots` não vier.
 */
export function comboPreviewPieces(comboId: ComboId, slots?: Slots): { motion: Motion; at: number }[] {
  const combo = MOTION_COMBOS[comboId];
  return combo.build(slots ?? combo.demoSlots, combo.seconds.default).map((p, i) => ({
    at: p.offset,
    motion: MotionSchema.parse({
      id: `preview-${comboId}-${i}`,
      kind: p.kind,
      sourceId: "preview",
      sourceTime: 0,
      durationSeconds: round2(p.duration),
      params: p.params,
      group: `${comboId}:preview`,
    }),
  }));
}

/**
 * Receita inserida à mão no instante `outputStart` do vídeo final: peças
 * aceitas, origem manual, mesmo grupo. null se não couber no vídeo.
 */
export function buildComboMotions(
  recipe: Recipe,
  comboId: ComboId,
  outputStart: number,
  idPrefix: string,
  slots?: Slots
): Motion[] | null {
  const segments = recipe.timeline.segments;
  const total = outputDuration(segments);
  const combo = MOTION_COMBOS[comboId];
  const fit = fitTiming(outputStart, total, combo.seconds, null);
  if (!fit) return null;
  const group = nextGroupId(recipe.motions.map((m) => m.group), comboId);
  const out: Motion[] = [];
  for (const [i, p] of combo.build(slots ?? combo.demoSlots, fit.duration).entries()) {
    const anchor = outputToSource(segments, Math.min(fit.start + p.offset, Math.max(total - 0.05, 0)));
    if (!anchor) return null;
    const parsed = MotionSchema.safeParse({
      id: `${idPrefix}_${i}`,
      kind: p.kind,
      sourceId: anchor.sourceId,
      sourceTime: round3(anchor.seconds),
      durationSeconds: round2(p.duration),
      params: p.params,
      group,
      origin: "manual",
      status: "accepted",
    });
    if (!parsed.success) return null;
    out.push(parsed.data);
  }
  return out;
}
