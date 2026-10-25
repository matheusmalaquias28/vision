import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import {
  compilePlan,
  CREATIVE_PRESETS,
  CREATIVE_STYLES,
  formatCatalogForPrompt,
  getCandidateCombos,
  getCandidateMotions,
  interpretBriefing,
  mergeMotionSuggestions,
  MOTION_REGISTRY_VERSION,
  MUSIC_MOODS,
  MUSIC_TEMPOS,
  MUSIC_USES,
  MusicWantSchema,
  defaultMusicWant,
  outputDuration,
  rankMusic,
  suggestMusicClip,
  SLOT_KEYS,
  spokenWords,
  TRANSITION_PRESETS,
  TRANSITION_STYLES,
  validateComposition,
  type ComboId,
  type CreativePlan,
  type CreativeStyle,
  type MotionKind,
  type Recipe,
  type Rejection,
  type SpokenWord,
} from "@vision/recipe";
import { loadCatalog } from "../library/catalog";
import { projectDir, repoRoot } from "../paths";
import { requireOpenAI } from "../pipeline/transcribe";

/**
 * Creative Planner (Fast Path): o briefing do War é interpretado no código,
 * o catálogo é filtrado no código e a IA recebe UMA chamada com saída
 * estruturada — escolhe motions/receitas, âncoras e textos. Compilação,
 * checagem de fatos e composição voltam a ser código. Tudo entra como
 * sugestão pendente: o editor aceita, ajusta ou rejeita.
 */

export const PROMPT_VERSION = 4;
const DEFAULT_MODEL = "gpt-4o-mini";
const PLANNER_TIMEOUT_MS = 45_000;
const MAX_OUTPUT_TOKENS = 1200;

export const model = () => process.env.CREATIVE_MODEL ?? process.env.MOTIONS_MODEL ?? DEFAULT_MODEL;

export interface CreativeReport {
  jobId: string;
  model: string;
  style: CreativeStyle;
  styleSource: "briefing" | "ia" | "padrão";
  avoid: MotionKind[];
  catalog: { motions: MotionKind[]; combos: ComboId[] };
  proposed: number;
  applied: number;
  rejected: Rejection[];
  tokens: { input: number; output: number; cached: number } | null;
  timings: { prepareMs: number; plannerMs: number; compileMs: number; totalMs: number };
  cacheHit: boolean;
  fallback: string | null;
  promptChars: number;
  /** Trilha sugerida (pendente na trilha Música) */
  music: { name: string; why: string } | null;
}

// ─── Saída estruturada (schema estrito; props validadas depois no código) ──

function outputSchema(ids: string[]) {
  return z.object({
    style: z.enum(CREATIVE_STYLES as [CreativeStyle, ...CreativeStyle[]]),
    events: z.array(
      z.object({
        type: z.enum(["motion", "combo"]),
        id: z.enum(ids as [string, ...string[]]),
        word: z.number().int(),
        seconds: z.number().nullable(),
        params: z.array(z.object({ k: z.enum(SLOT_KEYS), v: z.string() })),
      })
    ),
    /** Trilha de fundo que o vídeo pede (o código escolhe a faixa); null = sem música */
    music: z
      .object({
        moods: z.array(z.enum(MUSIC_MOODS)),
        energy: z.number().int(),
        tempo: z.enum(MUSIC_TEMPOS),
        genre: z.string(),
        useFor: z.array(z.enum(MUSIC_USES)),
      })
      .nullable(),
  });
}

// ─── Prompt compacto ─────────────────────────────────────────────────

/** Linhas "(12.3s) [40]palavra [41]outra" — quebra em pausas ou a cada 12 palavras */
export function formatTranscript(words: SpokenWord[]): string {
  const lines: string[] = [];
  let line: string[] = [];
  let lineStart = 0;
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (line.length >= 12 || (prev && w.outputTime - prev.outputTime > 0.9)) {
      lines.push(`(${lineStart.toFixed(1)}s) ${line.join(" ")}`);
      line = [];
    }
    if (line.length === 0) lineStart = w.outputTime;
    line.push(`[${i}]${w.word.text}`);
  });
  if (line.length > 0) lines.push(`(${lineStart.toFixed(1)}s) ${line.join(" ")}`);
  return lines.join("\n");
}

function buildPrompt(args: {
  recipe: Recipe;
  words: SpokenWord[];
  style: CreativeStyle | null;
  avoid: MotionKind[];
  instructions: string;
  catalog: string;
  maxEvents: number;
}): { system: string; user: string } {
  const total = outputDuration(args.recipe.timeline.segments);
  const styleLine = args.style
    ? `ESTILO (do briefing, obrigatório): ${args.style} — ${CREATIVE_PRESETS[args.style].description}`
    : `ESTILO: escolha um entre ${CREATIVE_STYLES.map((s) => `${s} (${CREATIVE_PRESETS[s].description})`).join("; ")}. Sem pista no briefing: anúncio curto pede ritmo, prefira dynamic; balanced se a fala for séria/calma (jurídico, saúde, depoimento emocionado).`;
  const system = `Você é o diretor de motion de anúncios verticais curtos em pt-BR. Escolha motions de uma BIBLIOTECA FECHADA para reforçar a narrativa (gancho, dor, benefício, número, prova, CTA) com acabamento profissional. Você só devolve dados: nunca código.
Regras:
- "word" = índice da palavra onde o motion COMEÇA (a palavra que o motivou).
- O BRIEFING É O MÍNIMO, NÃO O LIMITE: briefing curto ou vago não é motivo para editar pouco. Cumpra o que ele pede e respeite o que ele proíbe; o resto você decide como um editor profissional de anúncios faria para o vídeo prender do começo ao fim.
- Edição completa: gancho forte nos primeiros 2 s; reforço visual em cada ideia-chave (palavra-chave, frase cinética, número, lista, marcação desenhada); câmera (zoom) nos picos de emoção; transição em mudança de assunto quando houver corte; CTA destacado no fim. Nunca deixe mais de ~5 s seguidos sem nada acontecendo na tela.
- Textos e números SÓ do que foi dito ou do briefing. Nunca invente estatística, promessa, nome ou depoimento.
- Varie: não repita o mesmo tipo em sequência; misture texto, câmera e elementos.
- Dois textos animados nunca ao mesmo tempo. Combo já inclui câmera: não coloque zoom junto.
- Ordene "events" do MAIS importante para o menos importante. No máximo ${args.maxEvents} eventos.
- "params" é uma lista {k, v} só com os campos que o tipo usa (v sempre texto).
- "music": descreva a trilha de fundo ideal para ESTE vídeo (fala por cima): 1–3 humores, energia 1–5, andamento, gênero curto e o tipo de vídeo. Tema sério (jurídico, saúde, luto) pede trilha discreta; venda e motivação pedem energia. null só se o briefing proibir música.`;
  const user = `VÍDEO FINAL: ${total.toFixed(1)}s.
${styleLine}
${args.recipe.briefing ? `BRIEFING DO GESTOR (War): ${args.recipe.briefing}` : "BRIEFING: (vazio)"}
${args.avoid.length ? `PROIBIDO PELO BRIEFING: ${args.avoid.join(", ")}` : ""}
${args.instructions ? `PEDIDO DO EDITOR: ${args.instructions}` : ""}

TRANSCRIÇÃO (tempo no vídeo final; índice da palavra entre colchetes):
${formatTranscript(args.words)}

${args.catalog}`;
  return { system, user };
}

// ─── Cache por hash das entradas relevantes ──────────────────────────

function cacheKey(recipe: Recipe, words: SpokenWord[], instructions: string, catalogIds: string[]): string {
  const payload = JSON.stringify({
    v: PROMPT_VERSION,
    registry: MOTION_REGISTRY_VERSION,
    model: model(),
    briefing: recipe.briefing,
    instructions,
    catalogIds,
    words: words.map((w) => [w.word.text, Math.round(w.outputTime * 10)]),
  });
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 24);
}

interface CacheEntry {
  key: string;
  plan: CreativePlan;
  tokens: CreativeReport["tokens"];
  at: string;
}

const cacheFile = (projectId: string) => path.join(projectDir(projectId), "creative-cache.json");

function readCache(projectId: string, key: string): CacheEntry | null {
  try {
    const entry = JSON.parse(fs.readFileSync(cacheFile(projectId), "utf8")) as CacheEntry;
    return entry.key === key ? entry : null;
  } catch {
    return null;
  }
}

/** Métricas por job (sem transcrição nem briefing: nada sensível) */
function logMetrics(report: CreativeReport, projectId: string, durationSeconds: number) {
  if (process.env.VITEST) return;
  const file = path.join(repoRoot, "data", "creative-metrics.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const { rejected, ...rest } = report;
  fs.appendFileSync(
    file,
    JSON.stringify({
      at: new Date().toISOString(),
      projectId,
      videoSeconds: Math.round(durationSeconds * 10) / 10,
      ...rest,
      rejected: rejected.map((r) => r.reason),
    }) + "\n",
    "utf8"
  );
}

// ─── Fallback sem IA ─────────────────────────────────────────────────

const CTA_WORDS = /^(link|bio|clica|clique|agende|agenda|chama|direct|whatsapp|compre|garanta|inscreva|acesse)$/i;

/**
 * Plano heurístico curto quando a IA falha: números ditos viram contador,
 * CTA no final vira cta-focus, e um punch no primeiro gancho. Passa pelo
 * mesmo compilador/validador.
 */
function heuristicPlan(words: SpokenWord[], kinds: MotionKind[], combos: ComboId[], total: number): CreativePlan {
  const events: CreativePlan["events"] = [];
  const firstIdx = words.findIndex((w) => w.outputTime >= 0.3);
  if (kinds.includes("zoom") && firstIdx >= 0) {
    events.push({ type: "motion", id: "zoom", word: firstIdx, seconds: 1.2, params: [{ k: "style", v: "punch" }] });
  }
  if (kinds.includes("counter")) {
    words.forEach((w, i) => {
      const digits = w.word.text.match(/\d+(?:[.,]\d+)*/);
      if (!digits || events.filter((e) => e.id === "counter").length >= 2) return;
      const next = words[i + 1]?.word.text ?? "";
      const suffix = /%|por\s?cento/i.test(w.word.text + next) ? "%" : "";
      events.push({ type: "motion", id: "counter", word: i, seconds: null, params: [{ k: "number", v: digits[0] }, { k: "suffix", v: suffix }] });
    });
  }
  if (combos.includes("cta-focus")) {
    const ctaIdx = words.findIndex((w, i) => w.outputTime > total * 0.6 && CTA_WORDS.test(w.word.text.replace(/[^\p{L}]/gu, "")) && i >= 0);
    if (ctaIdx >= 0) {
      const text = words
        .slice(ctaIdx, ctaIdx + 6)
        .map((w) => w.word.text)
        .join(" ")
        .replace(/[.,!?]+$/, "");
      events.push({ type: "combo", id: "cta-focus", word: ctaIdx, seconds: null, params: [{ k: "text", v: text }] });
    }
  }
  return { style: "balanced", events };
}

// ─── Planner ─────────────────────────────────────────────────────────

export async function planCreative(
  recipe: Recipe,
  opts: { instructions?: string; force?: boolean } = {}
): Promise<{ recipe: Recipe; report: CreativeReport }> {
  const t0 = Date.now();
  const instructions = (opts.instructions ?? "").trim();
  const words = spokenWords(recipe);
  if (words.length === 0) throw new Error("Projeto sem transcrição no corte — rode Transcrever antes");
  const total = outputDuration(recipe.timeline.segments);

  // briefing do War + pedido do editor, lidos no código (proibições valem sem depender da IA)
  const directives = interpretBriefing(`${recipe.briefing}\n${instructions}`);
  const presetStyle = directives.style ?? "balanced";
  // transição usa vídeos da biblioteca: sem eles na máquina (VPS sem a cópia), não oferece
  const libraryIds = new Set(loadCatalog().assets.map((a) => a.id));
  const hasTransitions = TRANSITION_STYLES.some((s) => libraryIds.has(TRANSITION_PRESETS[s].assetId));
  const kinds = getCandidateMotions({ style: presetStyle, directives, durationSeconds: total }).filter(
    (k) => k !== "transition" || hasTransitions
  );
  const combos = getCandidateCombos({ style: presetStyle, directives, durationSeconds: total }, kinds);
  // teto generoso: quem filtra densidade e colisões é validateComposition
  const maxEvents = Math.max(4, Math.min(20, Math.round(total / CREATIVE_PRESETS[presetStyle].secondsPerMotion) + 4));
  const catalog = formatCatalogForPrompt(kinds, combos);
  const { system, user } = buildPrompt({ recipe, words, style: directives.style, avoid: directives.avoid, instructions, catalog, maxEvents });
  const key = cacheKey(recipe, words, instructions, [...kinds, ...combos]);
  const t1 = Date.now();

  let plan: CreativePlan | null = null;
  let tokens: CreativeReport["tokens"] = null;
  let cacheHit = false;
  let fallback: string | null = null;

  const cached = opts.force ? null : readCache(recipe.projectId, key);
  if (cached) {
    plan = cached.plan;
    tokens = cached.tokens;
    cacheHit = true;
  } else {
    try {
      const client = requireOpenAI();
      const completion = await client.beta.chat.completions.parse(
        {
          model: model(),
          temperature: 0.3,
          max_tokens: MAX_OUTPUT_TOKENS,
          response_format: zodResponseFormat(outputSchema([...kinds, ...combos]), "creative_plan"),
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        },
        { timeout: PLANNER_TIMEOUT_MS, maxRetries: 1 }
      );
      const msg = completion.choices[0]?.message;
      if (msg?.refusal) throw new Error(`o modelo recusou: ${msg.refusal}`);
      if (!msg?.parsed) throw new Error("resposta sem plano (cortada ou vazia)");
      plan = msg.parsed as CreativePlan;
      const usage = completion.usage;
      tokens = usage
        ? {
            input: usage.prompt_tokens,
            output: usage.completion_tokens,
            cached: usage.prompt_tokens_details?.cached_tokens ?? 0,
          }
        : null;
      fs.writeFileSync(
        cacheFile(recipe.projectId),
        JSON.stringify({ key, plan, tokens, at: new Date().toISOString() } satisfies CacheEntry),
        "utf8"
      );
    } catch (err) {
      fallback = err instanceof Error ? err.message : String(err);
      plan = heuristicPlan(words, kinds, combos, total);
    }
  }
  const t2 = Date.now();

  // estilo do briefing manda; sem ele, vale a escolha da IA
  const style: CreativeStyle = directives.style ?? plan.style ?? "balanced";
  const compiled = compilePlan(recipe, plan, { kinds, combos }, style);
  const composed = validateComposition(recipe, compiled.candidates, style);
  let next = mergeMotionSuggestions(
    recipe,
    composed.accepted.map(({ priority: _p, ...c }) => c)
  );
  // trilha: a IA descreveu o que o vídeo pede; a faixa sai do catálogo analisado
  const noMusic = /\bsem (musica|trilha)\b/.test(
    `${recipe.briefing}\n${instructions}`.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "")
  );
  let musicPick: CreativeReport["music"] = null;
  // plano sem essa parte (heurístico ou cache antigo): trilha leve e positiva
  const musicDesc = plan.music === undefined ? defaultMusicWant() : plan.music;
  if (musicDesc && !noMusic) {
    const want = MusicWantSchema.parse({
      ...musicDesc,
      energy: Math.min(5, Math.max(1, Math.round(musicDesc.energy))),
      avoidVocals: true,
    });
    const ranked = rankMusic(loadCatalog().assets.filter((a) => a.type === "music"), want);
    next = suggestMusicClip(next, ranked[0] ?? null, want, outputDuration(next.timeline.segments));
    const clip = next.audioClips.find((c) => c.kind === "music" && c.status === "pending" && c.origin === "ai");
    if (clip && ranked[0]) musicPick = { name: ranked[0].asset.name, why: ranked[0].why };
  }
  // um combo conta como um evento aplicado
  const fresh = next.motions.filter((m) => m.status === "pending" && m.origin === "ai");
  const applied = new Set(fresh.map((m) => m.group ?? m.id)).size;
  const t3 = Date.now();

  const report: CreativeReport = {
    jobId: crypto.randomBytes(6).toString("hex"),
    model: model(),
    style,
    styleSource: directives.style ? "briefing" : fallback ? "padrão" : "ia",
    avoid: directives.avoid,
    catalog: { motions: kinds, combos },
    proposed: plan.events.length,
    applied,
    rejected: [...compiled.rejected, ...composed.rejected],
    tokens,
    timings: { prepareMs: t1 - t0, plannerMs: t2 - t1, compileMs: t3 - t2, totalMs: t3 - t0 },
    cacheHit,
    fallback,
    promptChars: system.length + user.length,
    music: musicPick,
  };
  try {
    logMetrics(report, recipe.projectId, total);
  } catch {
    // métrica nunca derruba a edição
  }
  console.log(
    `Creative ${report.jobId}: ${applied}/${report.proposed} aplicados, estilo ${style}, ${report.timings.totalMs} ms` +
      `${tokens ? `, tokens ${tokens.input}+${tokens.output}` : ""}${cacheHit ? " (cache)" : ""}${fallback ? ` · fallback: ${fallback}` : ""}`
  );
  return { recipe: next, report };
}

