import { motionManifest, type CreativeStyle, type SlotKey, type Slots } from "./motionRegistry";
import type { MotionKind } from "./schema";

/**
 * Receitas de motion ("combos"; no código não se chamam recipe para não
 * confundir com a receita de edição). Cada combo é expandido AQUI, em
 * motions comuns com offsets fixos e um `group` compartilhado — a IA só
 * escolhe o combo e preenche os slots. Cada peça segue editável sozinha.
 */
export const COMBO_IDS = ["impact-hook", "statistic-reveal", "benefit-stack", "cta-focus"] as const;
export type ComboId = (typeof COMBO_IDS)[number];

export interface ComboPiece {
  kind: MotionKind;
  /** Segundos depois da âncora (tempo final) */
  offset: number;
  duration: number;
  params: Record<string, unknown>;
}

export interface ComboManifest {
  id: ComboId;
  version: number;
  label: string;
  purpose: string;
  useWhen: string[];
  avoidWhen: string[];
  seconds: { min: number; default: number; max: number };
  aiParams: Partial<Record<SlotKey, string>>;
  styles: CreativeStyle[];
  /** Tipos usados: se o briefing proíbe algum, o combo sai do catálogo */
  uses: MotionKind[];
  /** Textos de exemplo: prévia da galeria e inserção manual (o editor troca depois) */
  demoSlots: Slots;
  build: (slots: Slots, duration: number, style?: CreativeStyle) => ComboPiece[];
}

const str = (v: string | undefined) => (v ?? "").trim();

/** Variante da frase cinética que combina com cada estilo */
const KINETIC_BY_STYLE: Record<CreativeStyle, "rise" | "blur" | "mask"> = {
  dynamic: "rise",
  balanced: "blur",
  premium: "mask",
  minimal: "mask",
  educational: "blur",
};

const impactHook: ComboManifest = {
  id: "impact-hook",
  version: 1,
  label: "Gancho de impacto",
  purpose: "Abertura forte: punch de câmera + frase cinética. Sem flash.",
  useWhen: ["primeira frase/gancho do vídeo", "promessa central forte"],
  avoidWhen: ["mais de uma vez por vídeo", "tom sóbrio demais"],
  seconds: { min: 1.6, default: 2.4, max: 3.5 },
  aiParams: { text: "2–6 palavras do gancho (frase, não palavra solta)", emphasis: "1 palavra DA FRASE para destacar (opcional)" },
  styles: ["dynamic", "balanced", "premium"],
  uses: ["zoom", "kinetic"],
  demoSlots: { text: "Frase de impacto aqui", emphasis: "impacto" },
  build: (s, d, style = "dynamic") => [
    // premium/minimal: aproximação suave em vez de punch
    style === "premium" || style === "minimal"
      ? { kind: "zoom", offset: 0, duration: d, params: { style: "smooth", scale: 1.06 } }
      : { kind: "zoom", offset: 0, duration: Math.min(1.3, d), params: { style: "punch", scale: 1.12 } },
    {
      kind: "kinetic",
      offset: 0.08,
      duration: d - 0.08,
      params: { text: str(s.text), emphasis: str(s.emphasis), variant: KINETIC_BY_STYLE[style], position: "center" },
    },
  ],
};

const statisticReveal: ComboManifest = {
  id: "statistic-reveal",
  version: 1,
  label: "Revelação de número",
  purpose: "Número dito ganha cartão com contagem + aproximação lenta da câmera.",
  useWhen: ["estatística, porcentagem ou valor DITO na fala"],
  avoidWhen: ["número não foi dito", "número sem contexto"],
  seconds: { min: 2.2, default: 3, max: 4 },
  aiParams: {
    number: "só o número dito",
    prefix: "unidade antes, ex.: R$",
    suffix: "unidade depois: %, mil, dias, meses",
    label: "o que o número mede (até 4 palavras)",
  },
  styles: ["premium", "educational", "balanced", "dynamic"],
  uses: ["counter", "zoom"],
  demoSlots: { number: "70", suffix: "%", label: "dos clientes voltam" },
  build: (s, d) => {
    const counter = motionManifest("counter").fromSlots({ ...s, variant: "card" });
    return [
      { kind: "zoom", offset: 0, duration: d, params: { style: "smooth", scale: 1.06 } },
      { kind: "counter", offset: 0, duration: d, params: counter },
    ];
  },
};

const benefitStack: ComboManifest = {
  id: "benefit-stack",
  version: 1,
  label: "Pilha de benefícios",
  purpose: "Benefícios ditos entram um a um, com aproximação discreta.",
  useWhen: ["falante enumera 2–5 benefícios ou passos"],
  avoidWhen: ["itens não ditos", "itens longos"],
  seconds: { min: 3, default: 4.5, max: 6 },
  aiParams: { items: "2–5 itens separados por | (até 4 palavras cada)", title: "título curto (opcional)" },
  styles: ["educational", "balanced", "premium", "dynamic"],
  uses: ["list", "zoom"],
  demoSlots: { items: "Primeiro benefício|Segundo benefício|Terceiro benefício", title: "O que você ganha" },
  build: (s, d) => [
    { kind: "zoom", offset: 0, duration: d, params: { style: "smooth", scale: 1.05 } },
    { kind: "list", offset: 0, duration: d, params: motionManifest("list").fromSlots(s) },
  ],
};

const ctaFocus: ComboManifest = {
  id: "cta-focus",
  version: 1,
  label: "Foco no CTA",
  purpose: "Chamada para ação elegante no fim: chamada com botão + seta para baixo.",
  useWhen: ["CTA final (“clica no link”, “chama no direct”, “agende”)"],
  avoidWhen: ["não há CTA na fala nem no briefing", "meio do vídeo"],
  seconds: { min: 2.2, default: 3.2, max: 4.5 },
  aiParams: { text: "a ação (até 6 palavras)", eyebrow: "até 3 palavras (opcional)" },
  styles: ["balanced", "dynamic", "premium", "minimal", "educational"],
  uses: ["statement", "arrow"],
  demoSlots: { text: "Clica no link da bio", eyebrow: "Vagas limitadas" },
  build: (s, d) => [
    { kind: "statement", offset: 0, duration: d, params: { text: str(s.text), eyebrow: str(s.eyebrow), variant: "cta", shine: true } },
    { kind: "arrow", offset: Math.min(0.5, d / 4), duration: d - Math.min(0.5, d / 4), params: { direction: "down", label: "", variant: "curve" } },
  ],
};

export const MOTION_COMBOS: Record<ComboId, ComboManifest> = {
  "impact-hook": impactHook,
  "statistic-reveal": statisticReveal,
  "benefit-stack": benefitStack,
  "cta-focus": ctaFocus,
};

/** Rótulo do combo a partir do `group` gravado no motion ("cta-focus:2") */
/** Nome do grupo de um motion no painel: a receita ou o zoom nos cortes */
export function motionGroupLabel(group: string): string {
  if (group === "punch-in") return "Zoom nos cortes";
  return comboOfGroup(group)?.label ?? "receita";
}

export function comboOfGroup(group: string | null): ComboManifest | null {
  if (!group) return null;
  const id = group.split(":")[0] as ComboId;
  return MOTION_COMBOS[id] ?? null;
}

/** Número de grupo livre para um combo na receita */
export function nextGroupId(existing: (string | null)[], combo: ComboId): string {
  let n = 1;
  const taken = new Set(existing);
  while (taken.has(`${combo}:${n}`)) n++;
  return `${combo}:${n}`;
}

