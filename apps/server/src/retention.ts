import fs from "node:fs";
import path from "node:path";
import { getStore } from "./demands/store";
import { fromRecipePath, projectDir, projectsDir, recipePath } from "./paths";
import { originalsOf } from "./pipeline/normalize";
import { previewProxyDir } from "./pipeline/previewProxy";
import { cleanupStaleRemotionTemp } from "./render/bundle";
import { loadRecipe } from "./project";

/**
 * Libera disco apagando o que não precisa ficar para sempre:
 * - o vídeo BRUTO, N dias depois da entrega no Drive (VISION_RAW_RETENTION_DAYS,
 *   padrão 10) ou, em projeto sem entrega, M dias sem edição
 *   (VISION_IDLE_RETENTION_DAYS, padrão 30);
 * - renders antigos (fica só o mais recente).
 * Receita, transcrição, áudio extraído, miniaturas e o último render ficam.
 * Sem o bruto o projeto abre para consulta, mas não renderiza de novo.
 * 0 desliga a regra correspondente.
 */

const MARKER = ".raw-purged.json";
const DAY = 86_400_000;

export interface PurgeInfo {
  purgedAt: string;
  reason: string;
  files: string[];
  bytes: number;
}

export function purgeInfo(projectId: string): PurgeInfo | null {
  const f = path.join(projectDir(projectId), MARKER);
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, "utf8")) as PurgeInfo) : null;
}

/** true se algum vídeo bruto do projeto não está mais no disco */
export function rawMissing(projectId: string): boolean {
  return loadRecipe(projectId).sources.some((s) => !fs.existsSync(fromRecipePath(s.file)));
}

const days = (env: string | undefined, fallback: number) => {
  const n = Number(env);
  return Number.isFinite(n) && env !== undefined && env !== "" ? n : fallback;
};

const size = (f: string) => (fs.existsSync(f) ? fs.statSync(f).size : 0);

interface RetentionResult {
  projectId: string;
  action: string;
  bytes: number;
}

export async function runRetention({ dryRun = false, only }: { dryRun?: boolean; only?: string } = {}): Promise<RetentionResult[]> {
  const rawDays = days(process.env.VISION_RAW_RETENTION_DAYS, 10);
  const idleDays = days(process.env.VISION_IDLE_RETENTION_DAYS, 30);
  const store = getStore();
  const results: RetentionResult[] = [];

  // temporários do Remotion largados por processos antigos (cada bundle leva media/ inteira no Windows)
  if (!only) {
    const tmp = cleanupStaleRemotionTemp({ dryRun });
    if (tmp.removed > 0) results.push({ projectId: "(temporários)", action: `${tmp.removed} pasta(s) do Remotion`, bytes: tmp.bytes });
  }
  if (!fs.existsSync(projectsDir)) return results;

  for (const id of fs.readdirSync(projectsDir)) {
    if (!fs.existsSync(recipePath(id)) || (only && id !== only)) continue;
    const dir = projectDir(id);

    // renders antigos: só o mais recente fica
    const rendersDir = path.join(dir, "renders");
    if (fs.existsSync(rendersDir)) {
      const renders = fs
        .readdirSync(rendersDir)
        .filter((f) => f.endsWith(".mp4"))
        .map((f) => path.join(rendersDir, f))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
      const old = renders.slice(1);
      if (old.length > 0) {
        const bytes = old.reduce((a, f) => a + size(f), 0);
        if (!dryRun) for (const f of old) fs.rmSync(f, { force: true });
        results.push({ projectId: id, action: `${old.length} render(s) antigo(s)`, bytes });
      }
    }

    // bruto
    if (purgeInfo(id)) continue;
    const recipe = loadRecipe(id);
    const raws = recipe.sources
      .map((s) => fromRecipePath(s.file))
      .filter((f) => fs.existsSync(f))
      // original de câmera guardado ao lado do formato de trabalho
      .flatMap((f) => [f, ...originalsOf(f)]);
    // cópias leves do preview: sem o bruto não servem para nada
    const proxyDir = previewProxyDir(id);
    if (fs.existsSync(proxyDir)) raws.push(...fs.readdirSync(proxyDir).map((n) => path.join(proxyDir, n)));
    if (raws.length === 0) continue;

    const video = await store.findVideoByProject(id);
    const lastEdit = fs.statSync(recipePath(id)).mtimeMs;
    let reason: string | null = null;
    if (video?.deliveredAt && rawDays > 0 && Date.now() - Date.parse(video.deliveredAt) > rawDays * DAY) {
      reason = `entregue no Drive há mais de ${rawDays} dias`;
    } else if (!video?.deliveredAt && idleDays > 0 && Date.now() - lastEdit > idleDays * DAY) {
      reason = `sem edição há mais de ${idleDays} dias`;
    }
    if (!reason) continue;

    const bytes = raws.reduce((a, f) => a + size(f), 0);
    if (!dryRun) {
      for (const f of raws) fs.rmSync(f, { force: true });
      const info: PurgeInfo = {
        purgedAt: new Date().toISOString(),
        reason,
        files: raws.map((f) => path.basename(f)),
        bytes,
      };
      fs.writeFileSync(path.join(dir, MARKER), JSON.stringify(info, null, 2), "utf8");
    }
    results.push({ projectId: id, action: `bruto apagado (${reason})`, bytes });
  }
  return results;
}

/** Com VISION_RETENTION=on: roda 1 min depois de subir e a cada 6 h (desligado em dev) */
export function scheduleRetention() {
  if (process.env.VISION_RETENTION !== "on") return;
  const run = () =>
    runRetention()
      .then((r) => {
        if (r.length === 0) return;
        const mb = Math.round(r.reduce((a, x) => a + x.bytes, 0) / 1e6);
        console.log(`Limpeza: ${r.length} item(ns), ${mb} MB liberados`);
        for (const x of r) console.log(`  ${x.projectId}: ${x.action}`);
      })
      .catch((e) => console.error("Limpeza falhou:", e));
  setTimeout(run, 60_000);
  setInterval(run, 6 * 3_600_000);
}
