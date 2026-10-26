import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import {
  compilePlan,
  ILLUSTRATION_GAP_SECONDS,
  interpretBriefing,
  MAX_ILLUSTRATIONS,
  mergeMotionSuggestions,
  MOTION_LABEL,
  MOTION_REGISTRY,
  outputDuration,
  sourceToOutput,
  spokenWords,
  validateComposition,
  withPendingCutsApplied,
  type CreativePlan,
  type Recipe,
  type Rejection,
} from "@vision/recipe";
import { requireOpenAI } from "../pipeline/transcribe";
import { generateIllustration } from "./illustrate";
import { formatTranscript, model } from "./planner";

/**
 * Imagens ilustrativas: a análise (Analisar e aplicar / automática) gera 2 uma
 * vez por projeto; o botão "Sugerir imagens" gera mais. Fora do plano de
 * motions porque cada imagem gasta crédito na Magnific. Uma chamada de IA
 * escolhe os pontos-chave da fala e descreve o que desenhar; o código ancora,
 * valida (máx. 3, ≥ 8 s, camadas livres) e gera as imagens em paralelo. Tudo
 * entra como sugestão pendente, já com a imagem, para o operador ver no
 * preview antes de aceitar.
 */

const OPTIONS = 5;
const TIMEOUT_MS = 45_000;

const OutputSchema = z.object({
  items: z.array(
    z.object({
      word: z.number().int(),
      subject: z.string(),
      label: z.string(),
      position: z.enum(["top", "center"]),
    })
  ),
});
export type IllustrationPick = z.infer<typeof OutputSchema>["items"][number];

export interface IllustrationReport {
  proposed: number;
  added: number;
  images: number;
  errors: string[];
  rejected: Rejection[];
  seconds: number;
}

function buildPrompt(recipe: Recipe, instructions: string): { system: string; user: string } {
  const segments = recipe.timeline.segments;
  const words = spokenWords(recipe);
  // o que já está na tela (texto/elementos): a imagem não deve brigar com eles
  const busy = recipe.motions
    .filter((m) => m.status !== "rejected" && MOTION_REGISTRY[m.kind].layer !== "camera" && m.kind !== "transition")
    .map((m) => ({ m, start: sourceToOutput(segments, m.sourceId, m.sourceTime) }))
    .filter((x): x is { m: (typeof x)["m"]; start: number } => x.start !== null)
    .sort((a, b) => a.start - b.start)
    .map(({ m, start }) => `${start.toFixed(1)}–${(start + m.durationSeconds).toFixed(1)}s ${MOTION_LABEL[m.kind]}`);
  const system = `Você escolhe momentos para IMAGENS ILUSTRATIVAS em anúncios verticais curtos em pt-BR. As imagens são geradas por IA num estilo fixo de colagem de papel (foto halftone recortada, papel rasgado, marca-texto amarelo) e aparecem num cartão por ~3 s. Você só devolve dados.
Regras:
- Escolha os pontos-chave mais CONCRETOS e visuais da fala: um objeto, cena ou símbolo claro. Ex.: "ameaça por mensagem" → "celular com mensagem de ameaça na tela, mão segurando"; "justiça" → "martelo de juiz sobre um contrato".
- "word" = índice da palavra onde a imagem entra (a palavra que a motivou).
- "subject" = o que desenhar, 4 a 14 palavras em português. Sem pessoas reconhecíveis, marcas, logos ou texto legível. Tema sensível vira símbolo (nada explícito).
- "label" = legenda opcional de até 4 palavras tiradas DA FALA, ou "" (vazio).
- "position" = "top" (padrão) ou "center".
- Pelo menos ${ILLUSTRATION_GAP_SECONDS} s entre as imagens. Evite os primeiros 1,5 s (o rosto é o gancho) e os momentos já ocupados.
- Devolva até ${OPTIONS} opções, da MELHOR para a pior; o sistema usa no máximo ${MAX_ILLUSTRATIONS}.`;
  const user = `VÍDEO FINAL: ${outputDuration(segments).toFixed(1)}s.
${recipe.briefing ? `BRIEFING DO GESTOR (War): ${recipe.briefing}` : "BRIEFING: (vazio)"}
${instructions ? `PEDIDO DO EDITOR: ${instructions}` : ""}
${busy.length ? `JÁ OCUPADO NA TELA:\n${busy.join("\n")}` : "JÁ OCUPADO NA TELA: nada"}

TRANSCRIÇÃO (tempo no vídeo final; índice da palavra entre colchetes):
${formatTranscript(words)}`;
  return { system, user };
}

/** Escolhas da IA → sugestões pendentes de ilustração (sem imagem ainda) */
export function placeIllustrations(
  recipe: Recipe,
  picks: IllustrationPick[],
  max: number = MAX_ILLUSTRATIONS
): { recipe: Recipe; added: string[]; rejected: Rejection[] } {
  const style = interpretBriefing(recipe.briefing).style ?? "balanced";
  const plan: CreativePlan = {
    style,
    events: picks.slice(0, OPTIONS).map((p) => ({
      type: "motion",
      id: "illustration",
      word: p.word,
      seconds: null,
      params: [
        { k: "text", v: p.subject },
        { k: "label", v: p.label },
        { k: "position", v: p.position },
      ],
    })),
  };
  const compiled = compilePlan(recipe, plan, { kinds: ["illustration"], combos: [] }, style);
  const composed = validateComposition(recipe, compiled.candidates, style, { onlyKinds: ["illustration"] });
  const before = new Set(recipe.motions.map((m) => m.id));
  const next = mergeMotionSuggestions(
    recipe,
    composed.accepted.slice(0, max).map(({ priority: _p, ...c }) => c),
    { onlyKinds: ["illustration"] }
  );
  const added = next.motions.filter((m) => m.kind === "illustration" && !before.has(m.id)).map((m) => m.id);
  return { recipe: next, added, rejected: [...compiled.rejected, ...composed.rejected] };
}

export async function suggestIllustrations(
  input: Recipe,
  opts: {
    instructions?: string;
    /** Quantas imagens no máximo (a análise automática pede 2) */
    max?: number;
    pick?: (system: string, user: string) => Promise<IllustrationPick[]>;
  } = {}
): Promise<{ recipe: Recipe; report: IllustrationReport }> {
  const t0 = Date.now();
  // como o planner: escolhe no vídeo já sem os cortes pendentes
  const planning = withPendingCutsApplied(input);
  if (spokenWords(planning).length === 0) throw new Error("Transcreva o vídeo antes de sugerir imagens");
  const { system, user } = buildPrompt(planning, (opts.instructions ?? "").trim());
  const picks = await (opts.pick ?? askModel)(system, user);
  const placedOnPlan = placeIllustrations(planning, picks, opts.max);
  // a timeline volta a ser a do operador (os cortes seguem pendentes)
  const placed = { ...placedOnPlan, recipe: { ...placedOnPlan.recipe, timeline: input.timeline } };

  // gera as imagens das sugestões novas em paralelo; falha numa não derruba as outras
  const errors: string[] = [];
  const images = new Map<string, string>();
  await Promise.all(
    placed.added.map(async (id) => {
      const m = placed.recipe.motions.find((x) => x.id === id);
      if (!m || m.kind !== "illustration") return;
      try {
        images.set(id, (await generateIllustration(input.projectId, m.params.subject)).file);
      } catch (err) {
        errors.push(`${m.params.label || m.params.subject}: ${err instanceof Error ? err.message : String(err)}`);
      }
    })
  );
  const recipe: Recipe = {
    ...placed.recipe,
    motions: placed.recipe.motions.map((m) =>
      m.kind === "illustration" && images.has(m.id) ? { ...m, params: { ...m.params, image: images.get(m.id)! } } : m
    ),
  };
  return {
    recipe,
    report: {
      proposed: picks.length,
      added: placed.added.length,
      images: images.size,
      errors,
      rejected: placed.rejected,
      seconds: Math.round((Date.now() - t0) / 100) / 10,
    },
  };
}

async function askModel(system: string, user: string): Promise<IllustrationPick[]> {
  const completion = await requireOpenAI().beta.chat.completions.parse(
    {
      model: model(),
      temperature: 0.4,
      max_tokens: 700,
      response_format: zodResponseFormat(OutputSchema, "illustration_picks"),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    },
    { timeout: TIMEOUT_MS, maxRetries: 1 }
  );
  const msg = completion.choices[0]?.message;
  if (msg?.refusal) throw new Error(`o modelo recusou: ${msg.refusal}`);
  if (!msg?.parsed) throw new Error("a IA não devolveu sugestões de imagem");
  return msg.parsed.items;
}
