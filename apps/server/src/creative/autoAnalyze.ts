import fs from "node:fs";
import path from "node:path";
import { projectDir } from "../paths";
import { loadRecipe, saveRecipe } from "../project";
import { analyzeAndApply } from "./fastPath";

/**
 * Análise automática ao subir os brutos (projeto de demanda ou avulso):
 * transcrição → cortes (inclusive a chamada de IA das retomadas, já que não
 * há pressa) → plano de motions com o briefing. Roda no servidor, então
 * continua se a aba fechar. Tudo entra como sugestão pendente. Ilustrações
 * ficam de fora (botão próprio). Um projeto por vez, em fila.
 *
 * O andamento fica em `analysis.json` do projeto (sobrevive a reinício; um
 * "running" antigo vira erro de interrompida).
 */

export interface AnalysisStatus {
  status: "queued" | "running" | "done" | "error";
  stage: string;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

/** Mais que isso "rodando" = o servidor caiu no meio */
const STALE_MS = 15 * 60_000;

const statusPath = (projectId: string) => path.join(projectDir(projectId), "analysis.json");

function write(projectId: string, s: AnalysisStatus): void {
  fs.writeFileSync(statusPath(projectId), JSON.stringify(s, null, 2));
}

export function readAnalysis(projectId: string): AnalysisStatus | null {
  let s: AnalysisStatus;
  try {
    s = JSON.parse(fs.readFileSync(statusPath(projectId), "utf8")) as AnalysisStatus;
  } catch {
    return null;
  }
  const busy = s.status === "running" || s.status === "queued";
  if (busy && !pending.has(projectId) && Date.now() - Date.parse(s.startedAt) > STALE_MS) {
    return { ...s, status: "error", error: "análise interrompida (o servidor reiniciou); rode Analisar e aplicar" };
  }
  return s;
}

const pending = new Set<string>();
let chain: Promise<void> = Promise.resolve();

export function startAutoAnalysis(projectId: string): void {
  if (pending.has(projectId)) return;
  pending.add(projectId);
  const startedAt = new Date().toISOString();
  write(projectId, { status: "queued", stage: "Na fila", startedAt, finishedAt: null, error: null });
  chain = chain.then(async () => {
    const stage = (s: string) => write(projectId, { status: "running", stage: s, startedAt, finishedAt: null, error: null });
    try {
      stage("Transcrevendo");
      const { recipe } = await analyzeAndApply(loadRecipe(projectId), { aiCuts: true, onStage: stage });
      saveRecipe(recipe);
      write(projectId, { status: "done", stage: "Pronto para revisar", startedAt, finishedAt: new Date().toISOString(), error: null });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.warn(`Análise automática de ${projectId} falhou:`, error);
      write(projectId, { status: "error", stage: "Falhou", startedAt, finishedAt: new Date().toISOString(), error });
    } finally {
      pending.delete(projectId);
    }
  });
}
