import { z } from "zod";
import {
  isWordKept,
  mergeMotionSuggestions,
  MOTION_KINDS,
  MotionSchema,
  outputDuration,
  sourceToOutput,
  transcriptWords,
  type MotionCandidate,
  type MotionKind,
  type Recipe,
  type TranscriptWord,
} from "@vision/recipe";
import { requireOpenAI } from "./transcribe";

/** Duração padrão por tipo quando o LLM não informa (s, tempo final) */
const DEFAULT_DURATION: Record<MotionKind, number> = {
  zoom: 1.2,
  keyword: 1.6,
  emoji: 1.4,
  lowerThird: 3.5,
  counter: 2.2,
  flash: 0.3,
};

/** Teto por tipo: o LLM às vezes exagera (flash de 1s, zoom punch de 3s) */
const MAX_DURATION: Record<MotionKind, number> = {
  zoom: 5,
  keyword: 2.5,
  emoji: 2.5,
  lowerThird: 5,
  counter: 3,
  flash: 0.5,
};

/** No máximo 1 motion a cada N segundos de vídeo final */
const SECONDS_PER_MOTION = 4;

const PlanSchema = z.object({
  motions: z
    .array(
      z.object({
        kind: z.enum(MOTION_KINDS),
        word: z.number().int().min(0),
        durationSeconds: z.number().positive().optional(),
        importance: z.number().min(1).max(3).default(2),
        params: z.record(z.unknown()).default({}),
        why: z.string().default(""),
      })
    )
    .default([]),
});

interface SpokenWord {
  word: TranscriptWord;
  outputTime: number;
}

/** Palavras que estão no corte, na ordem do vídeo final */
function spokenWords(recipe: Recipe): SpokenWord[] {
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

/** Linhas "(12.3s) [40]palavra [41]outra ..." — quebra em pausas ou a cada 10 palavras */
function formatTranscript(words: SpokenWord[]): string {
  const lines: string[] = [];
  let line: string[] = [];
  let lineStart = 0;
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (line.length >= 10 || (prev && w.outputTime - prev.outputTime > 0.9)) {
      lines.push(`(${lineStart.toFixed(1)}s) ${line.join(" ")}`);
      line = [];
    }
    if (line.length === 0) lineStart = w.outputTime;
    line.push(`[${i}]${w.word.text}`);
  });
  if (line.length > 0) lines.push(`(${lineStart.toFixed(1)}s) ${line.join(" ")}`);
  return lines.join("\n");
}

function buildPrompt(recipe: Recipe, words: SpokenWord[], maxMotions: number, instructions: string): string {
  const duration = outputDuration(recipe.timeline.segments);
  return `Você é o motion designer de vídeos verticais curtos (Reels/TikTok) em pt-BR.
Escolha onde aplicar motions de uma BIBLIOTECA FECHADA para deixar o vídeo mais dinâmico e claro, sem poluir.

VÍDEO FINAL: ${duration.toFixed(1)}s. Máximo de ${maxMotions} motions.
${recipe.briefing ? `BRIEFING DO GESTOR: ${recipe.briefing}\n` : ""}${instructions ? `PEDIDO DO EDITOR: ${instructions}\n` : ""}
TRANSCRIÇÃO (tempo no vídeo final entre parênteses; índice de cada palavra entre colchetes):
${formatTranscript(words)}

BIBLIOTECA (kind → quando usar → params):
- "zoom" → ênfase numa frase de impacto (style "punch", 1.0–1.5s) ou explicação longa (style "smooth", 3–5s). params: {"scale": 1.08–1.3, "style": "punch"|"smooth"}
- "keyword" → conceito-chave dito naquele momento, 1 a 3 palavras. params: {"text": "PRAZO", "position": "top"|"center"}
- "emoji" → emoção ou objeto concreto citado (💰 dinheiro, ⚠️ alerta, ⏰ prazo). Use pouco. params: {"emoji": "⚠️", "position": "side"|"top"|"center"}
- "lowerThird" → SÓ quando o falante se apresenta: nome e profissão exatamente como ditos. params: {"title": "Nome", "subtitle": "Profissão"}
- "counter" → número, valor, prazo ou porcentagem falado. params: {"from": 0, "to": 2, "decimals": 0, "prefix": "R$ ", "suffix": " meses", "label": "texto curto opcional"}
- "flash" → virada de assunto ou punchline. Raro. params: {}

REGRAS:
- "word" é o índice da palavra onde o motion COMEÇA (a palavra que o motivou).
- Nada nos primeiros 0.5s. Distribua pelo vídeo; não concentre tudo no início.
- Não repita o mesmo kind em sequência curta; varie.
- keyword/counter/lowerThird nunca se sobrepõem no tempo.
- Na dúvida, menos é mais. "importance": 3 = essencial, 1 = opcional.

Responda APENAS com JSON:
{"motions": [{"kind": "...", "word": 12, "durationSeconds": 1.5, "importance": 1-3, "params": {...}, "why": "motivo curto em pt-BR"}]}`;
}

export async function suggestMotions(recipe: Recipe, instructions = ""): Promise<Recipe> {
  const words = spokenWords(recipe);
  if (words.length === 0) {
    throw new Error("Projeto sem transcrição no corte — rode Transcrever antes");
  }
  const total = outputDuration(recipe.timeline.segments);
  const maxMotions = Math.max(3, Math.round(total / SECONDS_PER_MOTION));

  const client = requireOpenAI();
  const completion = await client.chat.completions.create({
    model: process.env.MOTIONS_MODEL ?? process.env.DIRECTOR_MODEL ?? "gpt-4o",
    response_format: { type: "json_object" },
    temperature: 0.3,
    messages: [{ role: "user", content: buildPrompt(recipe, words, maxMotions, instructions) }],
  });
  const plan = PlanSchema.parse(JSON.parse(completion.choices[0]?.message?.content ?? "{}"));

  const candidates: MotionCandidate[] = [];
  const ranked = [...plan.motions].sort((a, b) => b.importance - a.importance).slice(0, maxMotions);
  for (const item of ranked) {
    const spoken = words[item.word];
    if (!spoken || spoken.outputTime < 0.5) continue;
    const durationSeconds = Math.min(
      item.durationSeconds ?? DEFAULT_DURATION[item.kind],
      MAX_DURATION[item.kind],
      Math.max(0.1, total - spoken.outputTime)
    );
    // valida params com o MESMO schema da receita: parâmetro inválido = descarta
    const parsed = MotionSchema.safeParse({
      id: "tmp",
      kind: item.kind,
      sourceId: spoken.word.sourceId,
      sourceTime: spoken.word.start,
      durationSeconds,
      params: item.params,
      note: item.why,
    });
    if (!parsed.success) continue;
    const { id: _id, status: _status, origin: _origin, ...candidate } = parsed.data;
    candidates.push(candidate);
  }
  return mergeMotionSuggestions(recipe, candidates);
}
