import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { outputDuration, reviewSuggestions, type Recipe } from "@vision/recipe";
import { musicDir } from "./paths";
import { enhanceAudio } from "./pipeline/enhance";
import { generateNarration } from "./pipeline/narration";
import { defaultSilenceOptions, suggestCuts } from "./pipeline/silence";
import { requireOpenAI, transcribeProject } from "./pipeline/transcribe";
import { saveRecipe } from "./project";
import { applyTemplate, TEMPLATES } from "./templates";

/**
 * O LLM NÃO escreve a receita: ele devolve um plano pequeno e validado,
 * e o servidor aplica cada decisão com o pipeline determinístico.
 */
const PlanSchema = z.object({
  clipOrder: z.array(z.string()).default([]),
  removeSilences: z.boolean().default(false),
  captions: z.boolean().default(false),
  enhanceAudio: z.boolean().default(false),
  music: z
    .object({ file: z.string(), volume: z.number().min(0).max(1).default(0.12) })
    .nullable()
    .default(null),
  title: z.string().nullable().default(null),
  narrationScript: z.string().nullable().default(null),
  template: z.string().nullable().default(null),
  notes: z.string().default(""),
});

export type DirectorPlan = z.infer<typeof PlanSchema>;

function listMusicFiles(): string[] {
  if (!fs.existsSync(musicDir)) return [];
  return fs
    .readdirSync(musicDir)
    .filter((f) => [".mp3", ".wav", ".m4a", ".aac", ".ogg"].includes(path.extname(f).toLowerCase()))
    .map((f) => `media/music/${f}`);
}

function buildPrompt(recipe: Recipe, briefing: string): string {
  const clips = recipe.sources
    .map(
      (s) =>
        `- ${s.id}: ${s.durationInSeconds.toFixed(1)}s, ${s.width}x${s.height}`
    )
    .join("\n");
  const music = listMusicFiles();
  const templates = TEMPLATES.map((t) => `- "${t.id}": ${t.description}`).join("\n");
  return `Você é o diretor de edição da plataforma VISION. Vídeos verticais curtos (máx 1:30).
Receba o briefing do gestor e os clipes disponíveis e devolva APENAS um JSON com o plano de edição.

BRIEFING DO GESTOR:
${briefing}

CLIPES ENVIADOS (na ordem de upload):
${clips}

MÚSICAS DISPONÍVEIS:
${music.length > 0 ? music.map((m) => `- "${m}"`).join("\n") : "(nenhuma)"}

TEMPLATES DISPONÍVEIS:
${templates}

Responda com JSON neste formato exato:
{
  "clipOrder": ["src_01", ...],        // ordem dos clipes no vídeo final; [] mantém a ordem de upload
  "removeSilences": true|false,        // cortar pausas/silêncios automaticamente
  "captions": true|false,              // legendar a fala
  "enhanceAudio": true|false,          // tratar o áudio (ruído + volume)
  "music": {"file": "<uma das músicas acima>", "volume": 0.12} | null,
  "title": "texto do título fixo" | null,
  "narrationScript": "roteiro da narração em pt-BR" | null,  // só se o briefing pedir narração
  "template": "clean"|"dinamico"|"podcast" | null,
  "notes": "resumo em 1-2 frases do que você decidiu e por quê"
}

Regras:
- Siga o briefing à risca; não invente etapas que não foram pedidas.
- Só escolha música da lista. Se pedirem música e a lista estiver vazia, deixe null e explique em notes.
- narrationScript: escreva um roteiro curto e natural compatível com a duração total dos clipes.
- Se o briefing não indicar estilo, escolha o template que melhor combinar com o conteúdo.`;
}

export interface DirectorProgress {
  stage: string;
}

/** Pede o plano ao LLM e aplica cada decisão via pipeline */
export async function directProject(
  recipe: Recipe,
  briefing: string,
  onProgress: (stage: string) => void
): Promise<Recipe> {
  onProgress("Interpretando o briefing");
  const client = requireOpenAI();
  const completion = await client.chat.completions.create({
    model: process.env.DIRECTOR_MODEL ?? "gpt-4o",
    response_format: { type: "json_object" },
    messages: [{ role: "user", content: buildPrompt(recipe, briefing) }],
  });
  const rawPlan = JSON.parse(completion.choices[0]?.message?.content ?? "{}");
  const plan = PlanSchema.parse(rawPlan);

  let r: Recipe = { ...recipe, briefing };

  // 1. Ordem dos clipes
  if (plan.clipOrder.length > 0) {
    const valid = plan.clipOrder.filter((id) =>
      r.sources.some((s) => s.id === id)
    );
    if (valid.length > 0) {
      const ordered = [
        ...valid,
        ...r.sources.map((s) => s.id).filter((id) => !valid.includes(id)),
      ];
      r = {
        ...r,
        timeline: {
          ...r.timeline,
          segments: [...r.timeline.segments].sort(
            (a, b) => ordered.indexOf(a.sourceId) - ordered.indexOf(b.sourceId)
          ),
        },
      };
    }
  }

  // 2. Áudio tratado
  if (plan.enhanceAudio) {
    onProgress("Tratando o áudio");
    r = await enhanceAudio(r);
  }

  // 3. Legendas
  if (plan.captions) {
    onProgress("Transcrevendo a fala");
    try {
      r = await transcribeProject(r);
    } catch {
      // clipes sem fala não devem derrubar a demanda inteira
    }
  }

  // 4. Cortes de silêncio (sugere E aplica — decisão do diretor, reversível
  //    na timeline porque as sugestões ficam registradas como aceitas).
  //    Só silêncios: retomadas/vícios continuam pendentes para o operador.
  if (plan.removeSilences) {
    onProgress("Cortando silêncios");
    r = await suggestCuts(r, defaultSilenceOptions);
    const silenceIds = r.timeline.suggestedCuts
      .filter((c) => c.reason === "silence" && c.status === "pending")
      .map((c) => c.id);
    r = reviewSuggestions(r, silenceIds, true);
  }

  // 5. Música
  if (plan.music && listMusicFiles().includes(plan.music.file)) {
    // trilha de fundo do vídeo inteiro, em loop (substitui músicas anteriores)
    r = {
      ...r,
      audioClips: [
        ...r.audioClips.filter((c) => c.kind !== "music"),
        {
          id: "aud_music",
          kind: "music",
          file: plan.music.file,
          start: 0,
          duration: Math.max(outputDuration(r.timeline.segments), 0.1),
          offset: 0,
          volume: plan.music.volume,
          fadeInSeconds: 1,
          fadeOutSeconds: 2,
          loop: true,
          mediaDurationSeconds: null,
          assetId: null,
        },
      ],
    };
  }

  // 6. Narração
  if (plan.narrationScript) {
    onProgress("Gerando narração");
    r = await generateNarration(r, plan.narrationScript);
  }

  // 7. Título fixo
  if (plan.title) {
    r = {
      ...r,
      overlays: [
        ...r.overlays,
        {
          id: `ov_${String(r.overlays.length + 1).padStart(2, "0")}`,
          kind: "title" as const,
          text: plan.title,
          file: null,
          start: 0,
          end: Math.min(5, outputDuration(r.timeline.segments)),
          position: "top" as const,
          layout: "overlay" as const,
          blend: "normal" as const,
          opacity: 1,
          scale: 0.4,
          assetId: null,
          mediaDurationSeconds: null,
          placement: null,
        },
      ],
    };
  }

  // 8. Template (por último: estiliza o resultado, inclusive SFX nos cortes)
  if (plan.template && TEMPLATES.some((t) => t.id === plan.template)) {
    onProgress("Aplicando template");
    r = applyTemplate(r, plan.template);
  }

  onProgress(plan.notes || "Finalizando");
  saveRecipe(r);
  return r;
}
