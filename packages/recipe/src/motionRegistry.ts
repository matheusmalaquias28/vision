import { MOTION_KINDS, type MotionKind, type MotionOf } from "./schema";
import { TRANSITION_PRESETS, TRANSITION_STYLES } from "./transitions";

/**
 * Motion Registry: um manifesto por tipo da biblioteca fechada. É a mesma
 * fonte para a IA (catálogo compacto), o editor (galeria, rótulos, padrões)
 * e o validador de composição (camada, durações). O componente que desenha
 * cada tipo fica em packages/video/src/Motions.tsx.
 *
 * O identificador gravado nas receitas continua sendo `kind` (sem migração).
 * `version` sobe quando o contrato de params ou o visual padrão de um tipo
 * muda; `MOTION_REGISTRY_VERSION` entra na chave de cache do planner.
 */
export const MOTION_REGISTRY_VERSION = 2;

export type MotionCategory = "typography" | "data" | "overlay" | "camera" | "element";

/**
 * Camada de composição, usada nas regras de conflito: dois motions da mesma
 * camada não ficam na tela ao mesmo tempo (exceto peças do mesmo combo).
 */
export type MotionLayer = "camera" | "text" | "element" | "fullscreen";

export type CreativeStyle = "balanced" | "dynamic" | "premium" | "minimal" | "educational";
export const CREATIVE_STYLES: CreativeStyle[] = ["balanced", "dynamic", "premium", "minimal", "educational"];

/**
 * Campos que a IA pode preencher, sempre como texto curto. Cada manifesto
 * converte os que usa em params (`fromSlots`) e o MotionSchema valida.
 * Lista fechada: entra no schema de saída estruturada do planner.
 */
export const SLOT_KEYS = [
  "text",
  "title",
  "subtitle",
  "eyebrow",
  "emphasis",
  "items",
  "number",
  "prefix",
  "suffix",
  "label",
  "variant",
  "style",
  "scale",
  "position",
  "intensity",
  "direction",
  "side",
  "sender",
  "emoji",
] as const;
export type SlotKey = (typeof SLOT_KEYS)[number];
export type Slots = Partial<Record<SlotKey, string>>;

export interface MotionVariant {
  value: string;
  label: string;
  /** Quando escolher esta variante (para a IA e para o editor) */
  use: string;
}

export interface MotionManifest<K extends MotionKind = MotionKind> {
  kind: K;
  version: number;
  label: string;
  category: MotionCategory;
  layer: MotionLayer;
  /** O que o motion comunica */
  purpose: string;
  useWhen: string[];
  avoidWhen: string[];
  /** 1 = discreto · 3 = chamativo */
  intensity: 1 | 2 | 3;
  /** Duração no vídeo final */
  seconds: { min: number; default: number; max: number };
  variants: MotionVariant[];
  /** Campos que a IA preenche → instrução curta */
  aiParams: Partial<Record<SlotKey, string>>;
  /** Estilos em que o tipo combina (os demais não o descartam, só pontuam menos) */
  styles: CreativeStyle[];
  /** Texto/número precisa estar na fala ou no briefing (o compilador confere) */
  grounding: "number" | "words" | "loose" | "none";
  /** Usa a cor de destaque (o editor mostra o controle de cor) */
  usesAccent: boolean;
  /** high = gasta crédito de API externa (ilustração gerada) */
  costHint: "low" | "medium" | "high";
  /** Params para inserção manual no editor */
  defaults: () => MotionOf<K>["params"];
  /** Slots da IA → params crus (o MotionSchema valida depois) */
  fromSlots: (s: Slots) => Record<string, unknown>;
}

// ─── conversões de slots ─────────────────────────────────────────────

const str = (v: string | undefined) => (v ?? "").trim();

/** "1.500", "2,5", "70%" → número (pt-BR e en) */
export function parseSlotNumber(v: string | undefined): number | null {
  const s = str(v).replace(/[^\d.,-]/g, "");
  if (!s) return null;
  // "1.500" (milhar pt-BR) vs "2.5" (decimal): ponto seguido de exatamente 3 dígitos = milhar
  const normalized = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)
    ? s.replace(/\./g, "").replace(",", ".")
    : s.replace(",", ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** "R$" → "R$ " e "meses" → " meses": unidade não gruda no número ("%" continua junto) */
const spacedPrefix = (v: string) => (/[\p{L}$]$/u.test(v) ? `${v} ` : v);
const spacedSuffix = (v: string) => (/^\p{L}/u.test(v) ? ` ${v}` : v);

const decimalsOf = (n: number) => {
  const frac = String(n).split(".")[1];
  return frac ? Math.min(frac.length, 2) : 0;
};

const pick = (v: string | undefined, allowed: readonly string[], fallback?: string) => {
  const s = str(v).toLowerCase();
  const hit = allowed.find((a) => a.toLowerCase() === s);
  return hit ?? fallback;
};

/** Remove chaves undefined para o default do schema valer */
const clean = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== ""));

// ─── manifestos ──────────────────────────────────────────────────────

const zoom: MotionManifest<"zoom"> = {
  kind: "zoom",
  usesAccent: false,
  version: 2,
  label: "Zoom de câmera",
  category: "camera",
  layer: "camera",
  purpose: "Movimento de câmera no vídeo: punch é um impulso curto de ênfase; smooth aproxima devagar.",
  useWhen: ["frase de impacto (punch)", "explicação ou momento emocional (smooth)", "reforço de um combo"],
  avoidWhen: ["zooms seguidos", "trecho já cheio de texto animado", "falante muito perto da câmera"],
  intensity: 2,
  seconds: { min: 0.6, default: 1.2, max: 5 },
  variants: [
    { value: "punch", label: "Punch", use: "ênfase seca de 1–1,5 s" },
    { value: "smooth", label: "Suave", use: "aproximação lenta de 3–5 s, cinematográfica" },
  ],
  aiParams: { style: "punch|smooth", scale: "1.05–1.25 (punch até 1.25, smooth até 1.12)" },
  styles: ["balanced", "dynamic", "premium", "minimal", "educational"],
  grounding: "none",
  costHint: "low",
  defaults: () => ({ scale: 1.15, style: "punch", focusX: 50, focusY: 40 }),
  fromSlots: (s) => {
    const style = pick(s.style ?? s.variant, ["punch", "smooth"], "punch");
    const raw = parseSlotNumber(s.scale);
    const cap = style === "smooth" ? 1.12 : 1.25;
    const scale = raw === null ? (style === "smooth" ? 1.08 : 1.15) : Math.min(Math.max(raw, 1.03), cap);
    return { style, scale };
  },
};

const keyword: MotionManifest<"keyword"> = {
  kind: "keyword",
  usesAccent: true,
  version: 2,
  label: "Palavra-chave",
  category: "typography",
  layer: "text",
  purpose: "Destaca 1 a 3 palavras centrais no momento em que são ditas.",
  useWhen: ["benefício", "dor", "alerta", "oferta", "palavra que resume a frase"],
  avoidWhen: ["conectivo ou palavra genérica", "outro texto animado na tela", "trecho sem importância"],
  intensity: 2,
  seconds: { min: 0.8, default: 1.6, max: 2.5 },
  variants: [
    { value: "pop", label: "Selo", use: "energético, inclinado (dinâmico)" },
    { value: "slide", label: "Deslizar", use: "entrada lateral limpa (equilibrado)" },
    { value: "underline", label: "Sublinhado", use: "elegante, sem caixa (premium)" },
    { value: "marker", label: "Marca-texto", use: "didático, faixa pintada atrás (educativo)" },
  ],
  aiParams: {
    text: "1–3 palavras ditas naquele momento",
    variant: "pop|slide|underline|marker",
    position: "top|center",
  },
  styles: ["balanced", "dynamic", "educational", "premium"],
  grounding: "words",
  costHint: "low",
  defaults: () => ({ text: "TEXTO", position: "top", variant: "pop", intensity: "normal" }),
  fromSlots: (s) =>
    clean({
      text: str(s.text).slice(0, 40),
      variant: pick(s.variant, ["pop", "slide", "underline", "marker"]),
      position: pick(s.position, ["top", "center"]),
      intensity: pick(s.intensity, ["subtle", "normal", "strong"]),
    }),
};

const emoji: MotionManifest<"emoji"> = {
  kind: "emoji",
  usesAccent: false,
  version: 1,
  label: "Emoji",
  category: "element",
  layer: "element",
  purpose: "Emoji animado para emoção ou objeto concreto citado.",
  useWhen: ["emoção clara", "objeto concreto (💰 dinheiro, ⏰ prazo)"],
  avoidWhen: ["briefing pede sem emoji", "tom premium, sério ou institucional", "uso frequente"],
  intensity: 2,
  seconds: { min: 0.8, default: 1.4, max: 2.5 },
  variants: [],
  aiParams: { emoji: "1 emoji", position: "side|top|center" },
  styles: ["dynamic", "balanced"],
  grounding: "none",
  costHint: "low",
  defaults: () => ({ emoji: "🔥", position: "side" }),
  fromSlots: (s) => clean({ emoji: str(s.emoji).slice(0, 16), position: pick(s.position, ["side", "top", "center"]) }),
};

const lowerThird: MotionManifest<"lowerThird"> = {
  kind: "lowerThird",
  usesAccent: true,
  version: 2,
  label: "Nome/cargo",
  category: "overlay",
  layer: "text",
  purpose: "Identifica quem fala: nome e profissão exatamente como ditos.",
  useWhen: ["falante se apresenta (nome e/ou profissão)"],
  avoidWhen: ["nome não foi dito", "mais de uma vez no vídeo"],
  intensity: 1,
  seconds: { min: 2, default: 3.5, max: 5 },
  variants: [
    { value: "bar", label: "Barra", use: "cartão escuro com barra de cor (padrão)" },
    { value: "minimal", label: "Minimalista", use: "texto com fio fino, sem caixa (premium)" },
  ],
  aiParams: { title: "nome como dito", subtitle: "profissão como dita", variant: "bar|minimal" },
  styles: ["balanced", "dynamic", "premium", "minimal", "educational"],
  grounding: "words",
  costHint: "low",
  defaults: () => ({ title: "Nome", subtitle: "Cargo", variant: "bar" }),
  fromSlots: (s) =>
    clean({
      title: str(s.title ?? s.text).slice(0, 40),
      subtitle: str(s.subtitle).slice(0, 60),
      variant: pick(s.variant, ["bar", "minimal"]),
    }),
};

const counter: MotionManifest<"counter"> = {
  kind: "counter",
  usesAccent: true,
  version: 2,
  label: "Número",
  category: "data",
  layer: "text",
  purpose: "Número, valor, prazo ou porcentagem DITO na fala, contando até o valor.",
  useWhen: ["número concreto dito (%, R$, prazo, quantidade)"],
  avoidWhen: ["número não aparece na fala nem no briefing", "estimativa vaga"],
  intensity: 2,
  seconds: { min: 1.4, default: 2.2, max: 3.5 },
  variants: [
    { value: "bold", label: "Destaque", use: "número grande com contorno (dinâmico)" },
    { value: "card", label: "Cartão", use: "cartão com barra de progresso (premium/educativo)" },
  ],
  aiParams: {
    number: "só o número dito (ex.: 70)",
    prefix: "unidade antes do número, ex.: R$",
    suffix: "unidade logo depois do número: %, mil, dias, meses",
    label: "o que o número mede, até 4 palavras (ex.: de prazo)",
    variant: "bold|card",
  },
  styles: ["balanced", "dynamic", "premium", "educational"],
  grounding: "number",
  costHint: "low",
  defaults: () => ({ from: 0, to: 100, decimals: 0, prefix: "", suffix: "", label: "", variant: "bold" }),
  fromSlots: (s) => {
    const to = parseSlotNumber(s.number);
    return clean({
      from: 0,
      to: to ?? undefined,
      decimals: to === null ? undefined : decimalsOf(to),
      prefix: spacedPrefix(str(s.prefix)).slice(0, 8),
      suffix: spacedSuffix(str(s.suffix)).slice(0, 12),
      label: str(s.label).slice(0, 40),
      variant: pick(s.variant, ["bold", "card"]),
    });
  },
};

const flash: MotionManifest<"flash"> = {
  kind: "flash",
  usesAccent: false,
  version: 2,
  label: "Flash",
  category: "element",
  layer: "fullscreen",
  purpose: "Clarão curto de virada de assunto ou punchline. Raro.",
  useWhen: ["virada forte de assunto", "punchline"],
  avoidWhen: ["briefing pede sem flash", "tom premium ou minimalista", "mais de 1 a cada 15 s", "junto de outro efeito forte"],
  intensity: 3,
  seconds: { min: 0.15, default: 0.3, max: 0.5 },
  variants: [
    { value: "subtle", label: "Sutil", use: "pico de 45%" },
    { value: "normal", label: "Normal", use: "pico de 85%" },
  ],
  aiParams: { intensity: "subtle|normal" },
  styles: ["dynamic"],
  grounding: "none",
  costHint: "low",
  defaults: () => ({ color: "#FFFFFF", intensity: "normal" }),
  fromSlots: (s) => clean({ intensity: pick(s.intensity ?? s.variant, ["subtle", "normal"], "subtle") }),
};

const kinetic: MotionManifest<"kinetic"> = {
  kind: "kinetic",
  usesAccent: true,
  version: 1,
  label: "Frase cinética",
  category: "typography",
  layer: "text",
  purpose: "Frase curta de impacto entrando palavra a palavra (hook, promessa, tese).",
  useWhen: ["gancho nos primeiros segundos", "promessa ou tese central", "frase de efeito curta"],
  avoidWhen: ["frase longa (> 6 palavras)", "explicação técnica", "outro texto animado na tela"],
  intensity: 2,
  seconds: { min: 1.2, default: 2.2, max: 3.5 },
  variants: [
    { value: "rise", label: "Cascata", use: "palavras sobem em sequência (dinâmico)" },
    { value: "blur", label: "Foco", use: "entra desfocada e assenta (cinematográfico)" },
    { value: "mask", label: "Máscara", use: "revelação por máscara com faixa (premium)" },
  ],
  aiParams: {
    text: "2–6 palavras da fala",
    variant: "rise|blur|mask",
    emphasis: "1 palavra da frase para destacar (opcional)",
    position: "top|center",
  },
  styles: ["dynamic", "premium", "balanced"],
  grounding: "words",
  costHint: "low",
  defaults: () => ({ text: "FRASE DE IMPACTO", variant: "rise", position: "center", emphasis: "" }),
  fromSlots: (s) =>
    clean({
      text: str(s.text).slice(0, 60),
      variant: pick(s.variant, ["rise", "blur", "mask"]),
      position: pick(s.position, ["top", "center"]),
      emphasis: str(s.emphasis).slice(0, 30),
    }),
};

const statement: MotionManifest<"statement"> = {
  kind: "statement",
  usesAccent: true,
  version: 1,
  label: "Chamada premium",
  category: "typography",
  layer: "text",
  purpose: "Chamada sóbria com hierarquia: tese, promessa ou CTA final.",
  useWhen: ["CTA no final (variant cta)", "promessa central em tom premium", "conclusão"],
  avoidWhen: ["frase longa", "promessa que não foi dita", "tom muito descontraído"],
  intensity: 1,
  seconds: { min: 1.6, default: 2.6, max: 4.5 },
  variants: [
    { value: "center", label: "Centralizada", use: "tese/promessa no centro" },
    { value: "left", label: "À esquerda", use: "editorial, com fio de destaque" },
    { value: "cta", label: "CTA", use: "chamada para ação com botão (final do vídeo)" },
  ],
  aiParams: {
    text: "até 8 palavras (CTA: o que fazer)",
    eyebrow: "até 3 palavras acima (opcional)",
    variant: "center|left|cta",
  },
  styles: ["premium", "balanced", "minimal", "educational"],
  grounding: "loose",
  costHint: "low",
  defaults: () => ({ text: "Sua chamada aqui", eyebrow: "", variant: "center", shine: false }),
  fromSlots: (s) =>
    clean({
      text: str(s.text).slice(0, 70),
      eyebrow: str(s.eyebrow).slice(0, 30),
      variant: pick(s.variant, ["center", "left", "cta"]),
    }),
};

const list: MotionManifest<"list"> = {
  kind: "list",
  usesAccent: true,
  version: 1,
  label: "Lista de benefícios",
  category: "data",
  layer: "text",
  purpose: "2 a 5 benefícios, passos ou itens DITOS, entrando um a um.",
  useWhen: ["enumeração de benefícios", "passo a passo", "o que está incluso"],
  avoidWhen: ["itens que não foram ditos", "menos de 2 itens", "itens longos"],
  intensity: 2,
  seconds: { min: 2.5, default: 4, max: 6 },
  variants: [
    { value: "check", label: "Checks", use: "benefícios/inclusos" },
    { value: "number", label: "Numerada", use: "passos em ordem" },
  ],
  aiParams: {
    items: "2–5 itens separados por | (até 4 palavras cada)",
    title: "título curto (opcional)",
    variant: "check|number",
  },
  styles: ["educational", "balanced", "premium", "dynamic"],
  grounding: "words",
  costHint: "low",
  defaults: () => ({ title: "", items: ["Primeiro benefício", "Segundo benefício", "Terceiro benefício"], variant: "check", position: "center" }),
  fromSlots: (s) =>
    clean({
      items: str(s.items)
        .split("|")
        .map((i) => i.trim().slice(0, 40))
        .filter(Boolean)
        .slice(0, 5),
      title: str(s.title).slice(0, 40),
      variant: pick(s.variant, ["check", "number"]),
      position: pick(s.position, ["top", "center"]),
    }),
};

const bubble: MotionManifest<"bubble"> = {
  kind: "bubble",
  usesAccent: true,
  version: 1,
  label: "Mensagem",
  category: "overlay",
  layer: "text",
  purpose: "Balão de mensagem para uma pergunta, objeção ou depoimento CITADO na fala.",
  useWhen: ["falante cita uma pergunta de cliente", "objeção comum", "depoimento dito"],
  avoidWhen: ["mensagem inventada", "texto que não foi dito", "simular app real"],
  intensity: 1,
  seconds: { min: 1.8, default: 3, max: 5 },
  variants: [
    { value: "left", label: "Recebida", use: "pergunta/objeção de outra pessoa" },
    { value: "right", label: "Enviada", use: "resposta do falante" },
  ],
  aiParams: { text: "a mensagem citada (até 15 palavras)", sender: "quem disse (opcional)", side: "left|right" },
  styles: ["balanced", "dynamic", "educational"],
  grounding: "words",
  costHint: "low",
  defaults: () => ({ text: "Quanto custa?", sender: "", side: "left" }),
  fromSlots: (s) =>
    clean({
      text: str(s.text).slice(0, 120),
      sender: str(s.sender).slice(0, 30),
      side: pick(s.side ?? s.variant, ["left", "right"]),
    }),
};

const arrow: MotionManifest<"arrow"> = {
  kind: "arrow",
  usesAccent: true,
  version: 1,
  label: "Seta",
  category: "element",
  layer: "element",
  purpose: "Seta desenhada apontando para algo: link na bio, botão, produto, abaixo.",
  useWhen: ["“clica no link”, “aqui embaixo”", "apontar produto na tela", "reforço do CTA"],
  avoidWhen: ["nada para apontar", "uso repetido"],
  intensity: 1,
  seconds: { min: 1, default: 2, max: 3.5 },
  variants: [
    { value: "curve", label: "Curva", use: "traço orgânico" },
    { value: "straight", label: "Reta", use: "seta seca e direta" },
  ],
  aiParams: { direction: "down|up|left|right", label: "até 3 palavras (opcional)", variant: "curve|straight" },
  styles: ["balanced", "dynamic", "educational", "minimal"],
  grounding: "loose",
  costHint: "low",
  defaults: () => ({ direction: "down", label: "", variant: "curve" }),
  fromSlots: (s) =>
    clean({
      direction: pick(s.direction, ["down", "up", "left", "right"]),
      label: str(s.label ?? s.text).slice(0, 30),
      variant: pick(s.variant, ["curve", "straight"]),
    }),
};

// ── Adaptados do Remotion Elements (remotion.dev/elements), no esquema do Vision ──

/** "Antes: 30|Depois: 70" → itens do gráfico */
/** "Antes: 30|Depois: 70" → itens do gráfico (ignora partes sem número) */
export function parseChartItems(v: string | undefined): { label: string; value: number }[] {
  return str(v)
    .split("|")
    .map((part) => {
      const i = part.lastIndexOf(":");
      if (i <= 0) return null;
      const value = parseSlotNumber(part.slice(i + 1));
      const label = part.slice(0, i).trim().slice(0, 24);
      return value === null || !label ? null : { label, value };
    })
    .filter((x): x is { label: string; value: number } => x !== null)
    .slice(0, 7);
}

const annotation: MotionManifest<"annotation"> = {
  kind: "annotation",
  usesAccent: true,
  version: 1,
  label: "Marcação desenhada",
  category: "typography",
  layer: "text",
  purpose: "Frase da fala com uma marcação desenhada à mão em uma palavra (Remotion Elements: Text Marker, Circle Marker, Strike Through, Crossed Off).",
  useWhen: [
    "destacar a palavra que importa numa frase (marker)",
    "circular o termo-chave (circle)",
    "riscar o jeito antigo, o mito ou o erro (strike)",
    "negar algo com ênfase: “isso não funciona” (crossed)",
  ],
  avoidWhen: ["frase longa (> 8 palavras)", "outro texto animado na tela", "tom sóbrio demais para traço à mão"],
  intensity: 2,
  seconds: { min: 1.6, default: 2.6, max: 4 },
  variants: [
    { value: "marker", label: "Marca-texto", use: "destaque positivo de uma palavra" },
    { value: "circle", label: "Círculo", use: "aponta o termo central" },
    { value: "strike", label: "Risco", use: "o que está errado ou ficou para trás" },
    { value: "crossed", label: "Rabisco", use: "negação forte, “esqueça isso”" },
  ],
  aiParams: {
    text: "frase da fala, 2–8 palavras",
    emphasis: "palavra(s) DA FRASE que recebem a marcação",
    variant: "marker|circle|strike|crossed",
    position: "top|center",
  },
  styles: ["balanced", "dynamic", "educational"],
  grounding: "words",
  costHint: "low",
  defaults: () => ({ text: "Isso muda tudo", target: "tudo", variant: "marker", position: "center" }),
  fromSlots: (s) =>
    clean({
      text: str(s.text).slice(0, 70),
      target: str(s.emphasis).slice(0, 40),
      variant: pick(s.variant, ["marker", "circle", "strike", "crossed"]),
      position: pick(s.position, ["top", "center"]),
    }),
};

const chart: MotionManifest<"chart"> = {
  kind: "chart",
  usesAccent: true,
  version: 1,
  label: "Gráfico",
  category: "data",
  layer: "text",
  purpose: "Gráfico animado com números DITOS: comparação, parte do todo ou evolução (Remotion Elements: Pie, Bar, Column e Line Chart).",
  useWhen: [
    "comparar 2–5 números ditos (bars/columns)",
    "porcentagem ou parte do todo (pie)",
    "evolução no tempo: antes → depois, meses, anos (line)",
  ],
  avoidWhen: ["algum número não foi dito", "um número só sem comparação (use counter)", "explicação sem dados"],
  intensity: 2,
  seconds: { min: 2.8, default: 4, max: 6 },
  variants: [
    { value: "bars", label: "Barras", use: "comparação entre itens" },
    { value: "columns", label: "Colunas", use: "comparação lado a lado, poucos itens" },
    { value: "pie", label: "Pizza", use: "porcentagem / parte do todo" },
    { value: "line", label: "Linha", use: "evolução ao longo do tempo" },
  ],
  aiParams: {
    variant: "bars|columns|pie|line",
    items: "2–6 itens “rótulo: número” separados por | (números DITOS)",
    title: "o que o gráfico mostra, até 5 palavras",
    suffix: "unidade: %, mil, dias…",
  },
  styles: ["educational", "balanced", "premium", "dynamic"],
  grounding: "number",
  costHint: "low",
  defaults: () => ({
    variant: "bars",
    title: "Resultado",
    items: [
      { label: "Antes", value: 30 },
      { label: "Depois", value: 70 },
    ],
    prefix: "",
    suffix: "%",
    position: "top",
  }),
  fromSlots: (s) =>
    clean({
      variant: pick(s.variant ?? s.style, ["bars", "columns", "pie", "line"]),
      items: parseChartItems(s.items),
      title: str(s.title ?? s.label).slice(0, 40),
      prefix: str(s.prefix).slice(0, 6),
      suffix: str(s.suffix).slice(0, 8),
      position: pick(s.position, ["top", "center"]),
    }),
};

const callout: MotionManifest<"callout"> = {
  kind: "callout",
  usesAccent: true,
  version: 1,
  label: "Selo chamativo",
  category: "element",
  layer: "text",
  purpose: "Balão com bico que balança para chamar o olho: oferta, desconto, novidade (Remotion Elements: Wiggling Callout).",
  useWhen: ["oferta ou desconto dito (“-20%”, “grátis”)", "novidade ou destaque curtíssimo", "apontar para o produto"],
  avoidWhen: ["texto longo (> 2 palavras)", "oferta que não foi dita", "tom premium"],
  intensity: 3,
  seconds: { min: 1.2, default: 2, max: 3.5 },
  variants: [
    { value: "down", label: "Bico ↓", use: "aponta para baixo (produto, legenda, link)" },
    { value: "up", label: "Bico ↑", use: "aponta para cima" },
    { value: "left", label: "Bico ←", use: "aponta para a esquerda" },
    { value: "right", label: "Bico →", use: "aponta para a direita" },
  ],
  aiParams: { text: "1–2 palavras ou o desconto dito (ex.: -20%)", direction: "down|up|left|right", position: "top|center" },
  styles: ["dynamic", "balanced"],
  grounding: "loose",
  costHint: "low",
  defaults: () => ({ text: "-20%", pointer: "down", position: "center" }),
  fromSlots: (s) =>
    clean({
      text: str(s.text).slice(0, 14),
      pointer: pick(s.direction ?? s.variant, ["down", "up", "left", "right"]),
      position: pick(s.position, ["top", "center"]),
    }),
};

const screen: MotionManifest<"screen"> = {
  kind: "screen",
  usesAccent: true,
  version: 1,
  label: "Tela cheia",
  category: "typography",
  layer: "fullscreen",
  purpose: "Quebra o quadro do vídeo: tela cheia com fundo animado (papel, grid, pontos ou gradiente) e uma frase grande entrando palavra a palavra.",
  useWhen: [
    "tese, virada ou pergunta que merece parar o vídeo",
    "abrir uma parte: “passo 1”, “o problema”, “a solução” (eyebrow)",
    "promessa ou conclusão curta que precisa de destaque total",
  ],
  avoidWhen: [
    "mais de uma a cada 15 s",
    "nos primeiros 1,5 s quando o rosto é o gancho",
    "frase longa (> 12 palavras)",
    "enquanto a pessoa mostra algo na câmera",
  ],
  intensity: 3,
  seconds: { min: 1.5, default: 2.6, max: 5 },
  variants: [
    { value: "paper", label: "Papel", use: "textura de papel animada: caderno, educativo, próximo" },
    { value: "grid", label: "Grid", use: "grid sutil em movimento: tecnologia, dados, método" },
    { value: "dots", label: "Pontos", use: "malha de pontos: leve, moderno" },
    { value: "gradient", label: "Gradiente", use: "gradiente em movimento: premium, emocional" },
  ],
  aiParams: {
    text: "frase da fala, 2–10 palavras",
    emphasis: "palavra(s) DA FRASE em destaque",
    eyebrow: "rótulo curto opcional (PASSO 1, O PROBLEMA)",
    variant: "paper|grid|dots|gradient",
  },
  styles: ["balanced", "dynamic", "educational", "premium"],
  grounding: "words",
  costHint: "low",
  defaults: () => ({
    text: "O segredo é a constância",
    eyebrow: "",
    emphasis: "constância",
    variant: "paper",
    tone: "light",
    transition: "slide",
    align: "center",
    hideCaptions: true,
  }),
  fromSlots: (s) =>
    clean({
      text: str(s.text).slice(0, 90),
      emphasis: str(s.emphasis).slice(0, 40),
      eyebrow: str(s.eyebrow).slice(0, 30),
      variant: pick(s.variant ?? s.style, ["paper", "grid", "dots", "gradient"]),
    }),
};

const transition: MotionManifest<"transition"> = {
  kind: "transition",
  usesAccent: false,
  version: 1,
  label: "Transição",
  category: "element",
  layer: "fullscreen",
  purpose: "Transição rápida (até 1,3 s) com vídeo da biblioteca e som, num corte: luz, queima de filme, glitch, varrida de luz ou papel.",
  useWhen: [
    "virada de assunto ou começo de outra parte do roteiro (cai no corte mais perto)",
    "antes do CTA ou de uma revelação",
    "entre clipes diferentes",
  ],
  avoidWhen: [
    "mais de 3 no vídeo ou menos de 10 s de outra transição",
    "nos primeiros ou últimos 1,5 s",
    "no meio de uma frase sem corte por perto",
    "vídeo calmo ou minimalista",
  ],
  intensity: 2,
  seconds: { min: 0.5, default: 1, max: 1.3 },
  variants: TRANSITION_STYLES.map((s) => ({ value: s, label: TRANSITION_PRESETS[s].label, use: TRANSITION_PRESETS[s].use })),
  aiParams: { variant: TRANSITION_STYLES.join("|") },
  styles: ["dynamic", "balanced", "educational", "premium"],
  grounding: "none",
  costHint: "low",
  defaults: () => ({ style: "flare" }),
  fromSlots: (s) => clean({ style: pick(s.variant ?? s.style, [...TRANSITION_STYLES]) }),
};

const illustration: MotionManifest<"illustration"> = {
  kind: "illustration",
  usesAccent: true,
  version: 1,
  label: "Ilustração",
  category: "element",
  layer: "text",
  purpose: "Imagem gerada por IA no estilo colagem de papel (halftone, papel rasgado, marca-texto) que ilustra um ponto-chave da fala, num cartão que entra, se move de leve e sai.",
  useWhen: [
    "ponto-chave concreto que vira imagem: “ameaça por mensagem” → celular com mensagem",
    "conceito abstrato com símbolo claro: justiça → martelo e balança",
    "explicar um processo ou documento: contrato, carimbo, mapa",
  ],
  avoidWhen: [
    "mais de 3 no vídeo ou menos de 8 s de outra",
    "nos primeiros 1,5 s quando o rosto é o gancho",
    "assunto que exige pessoa real, marca ou texto legível",
    "tema sensível de forma explícita (violência): use um símbolo",
  ],
  intensity: 2,
  seconds: { min: 2, default: 3, max: 4.5 },
  variants: [],
  aiParams: {
    text: "o que desenhar: objeto ou cena simbólica do ponto-chave, 3–12 palavras, sem pessoas reconhecíveis e sem texto",
    label: "legenda opcional, até 4 palavras DA FALA",
    position: "top|center",
  },
  styles: ["balanced", "educational", "premium", "dynamic"],
  grounding: "none",
  costHint: "high",
  defaults: () => ({ subject: "balança da justiça e um contrato", label: "", image: null, position: "top" }),
  fromSlots: (s) =>
    clean({
      subject: str(s.text).slice(0, 300),
      label: str(s.label).slice(0, 40),
      position: pick(s.position, ["top", "center"]),
    }),
};

const speedLines: MotionManifest<"speedLines"> = {
  kind: "speedLines",
  usesAccent: false,
  version: 1,
  label: "Linhas de velocidade",
  category: "element",
  layer: "fullscreen",
  purpose: "Linhas radiais de energia por um instante: impacto, surpresa, virada (Remotion Elements: Speed Lines).",
  useWhen: ["revelação ou surpresa (“de repente”, “e aí…”)", "punchline com energia", "junto de um punch de câmera"],
  avoidWhen: ["tom premium, minimalista ou educativo", "mais de 1 a cada 12 s", "cobrir um texto importante"],
  intensity: 3,
  seconds: { min: 0.4, default: 0.8, max: 1.5 },
  variants: [
    { value: "subtle", label: "Sutil", use: "linhas mais transparentes" },
    { value: "normal", label: "Normal", use: "impacto pleno" },
  ],
  aiParams: { intensity: "subtle|normal" },
  styles: ["dynamic"],
  grounding: "none",
  costHint: "low",
  defaults: () => ({ intensity: "normal", tone: "light" }),
  fromSlots: (s) => clean({ intensity: pick(s.intensity ?? s.variant, ["subtle", "normal"], "subtle") }),
};

export const MOTION_REGISTRY: { [K in MotionKind]: MotionManifest<K> } = {
  zoom,
  keyword,
  emoji,
  lowerThird,
  counter,
  flash,
  kinetic,
  statement,
  list,
  bubble,
  arrow,
  annotation,
  chart,
  callout,
  speedLines,
  screen,
  transition,
  illustration,
};

export function motionManifest<K extends MotionKind>(kind: K): MotionManifest<K> {
  return MOTION_REGISTRY[kind];
}

export const MOTION_CATEGORY_LABEL: Record<MotionCategory, string> = {
  typography: "Tipografia",
  data: "Dados",
  overlay: "Sobreposições",
  camera: "Câmera",
  element: "Elementos",
};

/** Tipos em ordem de galeria (categoria, depois o mais usado) */
export const MOTION_GALLERY_ORDER: MotionKind[] = [
  "keyword",
  "kinetic",
  "annotation",
  "statement",
  "screen",
  "illustration",
  "counter",
  "chart",
  "list",
  "lowerThird",
  "bubble",
  "callout",
  "zoom",
  "arrow",
  "emoji",
  "speedLines",
  "transition",
  "flash",
];

// garante em tempo de carga que todo kind tem manifesto
for (const k of MOTION_KINDS) {
  if (!MOTION_REGISTRY[k]) throw new Error(`motion "${k}" sem manifesto no registry`);
}
