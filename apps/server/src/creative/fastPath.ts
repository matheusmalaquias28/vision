import fs from "node:fs";
import path from "node:path";
import { outputDuration, transcriptWords, type CutPace, type Recipe } from "@vision/recipe";
import { repoRoot } from "../paths";
import { suggestSmartCuts } from "../pipeline/smartCuts";
import { transcribeProject } from "../pipeline/transcribe";
import { illustrationsEnabled } from "./illustrate";
import { suggestIllustrations } from "./illustrationPlanner";
import { planCreative, type CreativeReport } from "./planner";

/**
 * Fast Path "Analisar e aplicar": transcrição (só se ainda não houver) →
 * cortes (pausas, vícios, repetições; retomadas com aiCuts) JÁ APLICADOS e
 * legenda reagrupada → Creative Planner (1 chamada) → 2 imagens geradas da
 * fala. Motions, transições e imagens são planejados sobre o vídeo cortado e
 * entram como sugestão pendente. Meta: ≤ 180 s, sem contar o render do MP4.
 */
export const FAST_PATH_TARGET_MS = 180_000;

/** Imagens geradas junto com a análise (máx. 2; o botão "Sugerir imagens" segue para mais) */
export const AUTO_IMAGES = 2;

export interface FastPathReport {
  stages: { transcribeMs: number; transcribeSkipped: boolean; cutsMs: number; plannerMs: number; imagesMs: number };
  totalMs: number;
  withinTarget: boolean;
  videoSeconds: number;
  creative: CreativeReport;
  /** null = não rodou (já tinha imagem, sem MAGNIFIC_API_KEY ou desligado) */
  images: { added: number; generated: number; errors: string[] } | null;
}

export async function analyzeAndApply(
  input: Recipe,
  opts: {
    pace?: CutPace;
    instructions?: string;
    /** Inclui a chamada de IA das retomadas (análise automática, sem pressa) */
    aiCuts?: boolean;
    /** Quantas imagens gerar (padrão AUTO_IMAGES; 0 desliga) */
    images?: number;
    onStage?: (stage: string) => void;
  } = {}
): Promise<{ recipe: Recipe; report: FastPathReport }> {
  const t0 = Date.now();
  let recipe = input;

  // 1. transcrição: reaproveita a existente (não retranscreve sem mudança de áudio)
  const transcribeSkipped = transcriptWords(recipe).length > 0;
  if (!transcribeSkipped) {
    opts.onStage?.("Transcrevendo");
    recipe = await transcribeProject(recipe);
  }
  const t1 = Date.now();
  if (transcriptWords(recipe).length === 0) throw new Error("Nenhuma fala encontrada no vídeo");

  // 2. cortes determinísticos (a chamada de IA de retomadas fica opcional, no botão Sugerir cortes)
  opts.onStage?.("Cortando");
  recipe = await suggestSmartCuts(recipe, { ai: opts.aiCuts ?? false, pace: opts.pace ?? "normal" });
  const t2 = Date.now();

  // 3. a única chamada criativa
  opts.onStage?.("Planejando motions");
  const planned = await planCreative(recipe, { instructions: opts.instructions });
  recipe = planned.recipe;
  const t3 = Date.now();

  // 4. imagens geradas a partir da fala, pendentes já com a imagem. Só uma vez
  // por projeto (rodar de novo não gasta crédito) e só com a Magnific configurada
  let images: FastPathReport["images"] = null;
  const wantImages = opts.images ?? AUTO_IMAGES;
  if (wantImages > 0 && illustrationsEnabled() && !recipe.motions.some((m) => m.kind === "illustration")) {
    opts.onStage?.("Gerando imagens");
    try {
      const ill = await suggestIllustrations(recipe, { instructions: opts.instructions, max: wantImages });
      recipe = ill.recipe;
      images = { added: ill.report.added, generated: ill.report.images, errors: ill.report.errors };
    } catch (err) {
      // imagem nunca derruba a análise: o operador ainda tem o botão "Sugerir imagens"
      const error = err instanceof Error ? err.message : String(err);
      console.warn(`Imagens automáticas de ${recipe.projectId} falharam:`, error);
      images = { added: 0, generated: 0, errors: [error] };
    }
  }
  const t4 = Date.now();

  const report: FastPathReport = {
    stages: { transcribeMs: t1 - t0, transcribeSkipped, cutsMs: t2 - t1, plannerMs: t3 - t2, imagesMs: t4 - t3 },
    totalMs: t4 - t0,
    withinTarget: t4 - t0 <= FAST_PATH_TARGET_MS,
    videoSeconds: Math.round(outputDuration(recipe.timeline.segments) * 10) / 10,
    creative: planned.report,
    images,
  };
  try {
    const file = path.join(repoRoot, "data", "creative-metrics.jsonl");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(
      file,
      JSON.stringify({
        at: new Date().toISOString(),
        kind: "fast-path",
        projectId: recipe.projectId,
        jobId: planned.report.jobId,
        videoSeconds: report.videoSeconds,
        stages: report.stages,
        totalMs: report.totalMs,
        withinTarget: report.withinTarget,
      }) + "\n",
      "utf8"
    );
  } catch {
    // métrica nunca derruba a edição
  }
  return { recipe, report };
}
