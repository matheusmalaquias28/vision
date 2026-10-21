import { z } from "zod";
import {
  snapRetakeToRestart,
  transcriptWords,
  wordsBySource,
  wordsCutRange,
  type CutCandidate,
  type Recipe,
  type TranscriptWord,
} from "@vision/recipe";
import { requireOpenAI } from "./transcribe";

/**
 * O LLM só aponta FAIXAS DE PALAVRAS (índices) — o servidor converte para
 * tempo com wordsCutRange e tudo entra como sugestão pendente. Nada é cortado
 * sem o operador aceitar.
 */
const RetakeResponseSchema = z.object({
  cuts: z
    .array(
      z.object({
        sourceId: z.string(),
        from: z.number().int().min(0),
        to: z.number().int().min(0),
        kind: z.enum(["retake", "false-start"]).default("retake"),
        confidence: z.number().min(0).max(1).default(0.6),
        why: z.string().default(""),
      })
    )
    .default([]),
});

/** Uma retomada nunca é maior que isso; acima disso o modelo provavelmente errou */
const MAX_CUT_WORDS = 60;

function buildPrompt(bySource: Map<string, TranscriptWord[]>): string {
  const sections = [...bySource.entries()]
    .map(
      ([sourceId, words]) =>
        `### ${sourceId}\n${words.map((w, i) => `[${i}]${w.text}`).join(" ")}`
    )
    .join("\n\n");
  return `Você revisa transcrições de vídeos curtos gravados em pt-BR (falante olhando para a câmera).
Cada palavra vem com o índice entre colchetes, por clipe.

Encontre APENAS erros de gravação para cortar:
- "retake": o falante diz uma frase (ou parte), para, e diz de novo — mantenha a ÚLTIMA versão completa e corte as anteriores. "to" é a última palavra ANTES do recomeço (a primeira palavra da versão mantida NÃO entra no corte).
- "false-start": frase começada e abandonada no meio, sem repetição.

NÃO sugira cortes de conteúdo, estilo, ênfase intencional, vícios de linguagem isolados ("é", "né", "tipo") nem pausas — outro sistema cuida disso.
Na dúvida, não sugira ou use confiança baixa (< 0.5).

TRANSCRIÇÃO:
${sections}

Responda APENAS com JSON:
{"cuts": [{"sourceId": "src_01", "from": <índice da primeira palavra a cortar>, "to": <índice da última, inclusive>, "kind": "retake"|"false-start", "confidence": 0.0-1.0, "why": "explicação curta em pt-BR"}]}
Se não houver nada, responda {"cuts": []}.`;
}

export async function detectRetakes(recipe: Recipe): Promise<CutCandidate[]> {
  const bySource = wordsBySource(transcriptWords(recipe));
  if (bySource.size === 0) return [];
  const client = requireOpenAI();
  const completion = await client.chat.completions.create({
    model: process.env.CUTS_MODEL ?? process.env.DIRECTOR_MODEL ?? "gpt-4o",
    response_format: { type: "json_object" },
    temperature: 0,
    messages: [{ role: "user", content: buildPrompt(bySource) }],
  });
  const raw = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
  const { cuts } = RetakeResponseSchema.parse(raw);

  const out: CutCandidate[] = [];
  for (const c of cuts) {
    const words = bySource.get(c.sourceId);
    // índices inválidos são descartados em silêncio: é sugestão, não ordem
    if (!words || c.from > c.to || c.to >= words.length) continue;
    if (c.to - c.from + 1 > MAX_CUT_WORDS) continue;
    const to = c.kind === "retake" ? snapRetakeToRestart(words, c.from, c.to) : c.to;
    const { start, end } = wordsCutRange(words, c.from, to);
    const text = words.slice(c.from, to + 1).map((w) => w.text).join(" ");
    const label = c.kind === "false-start" ? "Começo falso" : "Retomada";
    out.push({
      sourceId: c.sourceId,
      sourceStart: start,
      sourceEnd: end,
      reason: "retake",
      confidence: c.confidence,
      note: `${label}: "${text}"${c.why ? ` — ${c.why}` : ""}`,
    });
  }
  return out;
}
