import fs from "node:fs";
import path from "node:path";
import { outputDuration, transcriptWords, type CutPace, type Recipe } from "@vision/recipe";
import { repoRoot } from "../paths";
import { suggestSmartCuts } from "../pipeline/smartCuts";
import { transcribeProject } from "../pipeline/transcribe";
import { planCreative, type CreativeReport } from "./planner";

/**
 * Fast Path "Analisar e aplicar": transcrição (só se ainda não houver) →
 * cortes determinísticos (pausas, vícios, repetições; sem a chamada extra de
 * retomadas) → Creative Planner (1 chamada). Tudo entra como sugestão
 * pendente; nada é aplicado sem o editor aceitar. Meta: ≤ 180 s até a
 * timeline com sugestões, sem contar o render do MP4.
 */
export const FAST_PATH_TARGET_MS = 180_000;

export interface FastPathReport {
  stages: { transcribeMs: number; transcribeSkipped: boolean; cutsMs: number; plannerMs: number };
  totalMs: number;
  withinTarget: boolean;
  videoSeconds: number;
  creative: CreativeReport;
}

export async function analyzeAndApply(
  input: Recipe,
  opts: {
    pace?: CutPace;
    instructions?: string;
    /** Inclui a chamada de IA das retomadas (análise automática, sem pressa) */
    aiCuts?: boolean;
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
  opts.onStage?.("Analisando cortes");
  recipe = await suggestSmartCuts(recipe, { ai: opts.aiCuts ?? false, pace: opts.pace ?? "normal" });
  const t2 = Date.now();

  // 3. a única chamada criativa
  opts.onStage?.("Planejando motions");
  const planned = await planCreative(recipe, { instructions: opts.instructions });
  const t3 = Date.now();

  const report: FastPathReport = {
    stages: { transcribeMs: t1 - t0, transcribeSkipped, cutsMs: t2 - t1, plannerMs: t3 - t2 },
    totalMs: t3 - t0,
    withinTarget: t3 - t0 <= FAST_PATH_TARGET_MS,
    videoSeconds: Math.round(outputDuration(recipe.timeline.segments) * 10) / 10,
    creative: planned.report,
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
  return { recipe: planned.recipe, report };
}
