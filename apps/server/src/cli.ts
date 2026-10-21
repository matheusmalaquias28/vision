import "./env";
import path from "node:path";
import { Command } from "commander";
import {
  ASSET_TYPE_LABEL,
  CUT_REASON_LABEL,
  MOTION_LABEL,
  motionSummary,
  outputDuration,
  placeMotions,
  reviewMotions,
  type AssetType,
  type SuggestedCut,
} from "@vision/recipe";
import { acceptCuts, pendingCutIds, rejectCuts } from "./cuts";
import { loadCatalog } from "./library/catalog";
import { importPack } from "./library/importPack";
import { tagAssets } from "./library/tagAssets";
import {
  defaultSilenceOptions,
  suggestCuts,
} from "./pipeline/silence";
import { suggestMotions } from "./pipeline/motions";
import { suggestSmartCuts } from "./pipeline/smartCuts";
import { transcribeProject } from "./pipeline/transcribe";
import { createProject, loadRecipe, saveRecipe } from "./project";
import { renderRecipe } from "./render/renderJob";

const program = new Command();
program.name("vision").description("VISION — editor de vídeo com IA (CLI)");

function fmt(s: number): string {
  return `${s.toFixed(2)}s`;
}

function fmtCut(c: SuggestedCut): string {
  const note = c.note ? `  ${c.note}` : "";
  return `  ${c.id}  ${CUT_REASON_LABEL[c.reason].padEnd(9)} ${fmt(c.sourceStart)} → ${fmt(c.sourceEnd)}  (confiança ${c.confidence})${note}`;
}

program
  .command("ingest")
  .description("Cria um projeto a partir de um ou mais vídeos brutos")
  .argument("<videos...>", "caminhos dos vídeos")
  .option("--id <id>", "id do projeto (default: nome do primeiro arquivo)")
  .action(async (videos: string[], opts: { id?: string }) => {
    const recipe = await createProject(
      videos.map((v) => path.resolve(v)),
      opts.id
    );
    console.log(`Projeto criado: ${recipe.projectId}`);
    for (const s of recipe.sources) {
      console.log(
        `  ${s.id}: ${s.width}x${s.height} @ ${s.fps.toFixed(2)}fps, ${fmt(s.durationInSeconds)}`
      );
    }
    console.log(`  Receita: media/projects/${recipe.projectId}/recipe.json`);
  });

program
  .command("transcribe")
  .description("Transcreve a fala com timestamp por palavra (Whisper)")
  .argument("<projectId>")
  .action(async (projectId: string) => {
    const recipe = loadRecipe(projectId);
    const updated = await transcribeProject(recipe);
    saveRecipe(updated);
    const words = updated.captions.blocks.reduce(
      (acc, b) => acc + b.words.length,
      0
    );
    console.log(
      `Transcrição concluída: ${words} palavras em ${updated.captions.blocks.length} blocos de legenda`
    );
  });

program
  .command("silence")
  .description("Detecta silêncios e gera sugestões de corte")
  .argument("<projectId>")
  .option("--noise <db>", "limiar de silêncio em dB", String(defaultSilenceOptions.noiseDb))
  .option("--min <s>", "duração mínima de silêncio", String(defaultSilenceOptions.minSilenceSeconds))
  .action(async (projectId: string, opts: { noise: string; min: string }) => {
    const recipe = loadRecipe(projectId);
    const updated = await suggestCuts(recipe, {
      ...defaultSilenceOptions,
      noiseDb: Number(opts.noise),
      minSilenceSeconds: Number(opts.min),
    });
    saveRecipe(updated);
    const cuts = updated.timeline.suggestedCuts;
    if (cuts.length === 0) {
      console.log("Nenhum silêncio relevante encontrado.");
      return;
    }
    console.log(`${cuts.length} sugestão(ões) de corte:`);
    for (const c of cuts) {
      console.log(
        `  ${c.id}  ${fmt(c.sourceStart)} → ${fmt(c.sourceEnd)}  (${fmt(c.sourceEnd - c.sourceStart)}, confiança ${c.confidence})`
      );
    }
    console.log(`Revise com: npm run cli -- cuts ${projectId} --list`);
  });

program
  .command("smart-cuts")
  .description("Sugere cortes pela transcrição: pausas, vícios, repetições e retomadas (IA)")
  .argument("<projectId>")
  .option("--no-ai", "só os detectores determinísticos (sem chamada ao LLM)")
  .action(async (projectId: string, opts: { ai: boolean }) => {
    const updated = await suggestSmartCuts(loadRecipe(projectId), { ai: opts.ai });
    saveRecipe(updated);
    const pending = updated.timeline.suggestedCuts.filter((c) => c.status === "pending");
    console.log(`${pending.length} sugestão(ões) pendente(s):`);
    for (const c of pending) console.log(fmtCut(c));
    console.log(`Revise com: npm run cli -- cuts ${projectId} --accept <ids...>`);
  });

program
  .command("motions")
  .description("IA sugere motions da biblioteca ancorados na fala (entram como pendentes)")
  .argument("<projectId>")
  .option("--instructions <texto>", "pedido extra para a IA (ex.: 'mais zooms, sem emoji')", "")
  .option("--accept-all", "aceita todas as sugestões pendentes")
  .action(async (projectId: string, opts: { instructions: string; acceptAll?: boolean }) => {
    let recipe = loadRecipe(projectId);
    if (opts.acceptAll) {
      const ids = recipe.motions.filter((m) => m.status === "pending").map((m) => m.id);
      recipe = reviewMotions(recipe, ids, true);
      saveRecipe(recipe);
      console.log(`Aceito(s): ${ids.join(", ") || "(nenhum pendente)"}`);
      return;
    }
    recipe = await suggestMotions(recipe, opts.instructions);
    saveRecipe(recipe);
    const placed = placeMotions(recipe, true).filter((p) => p.motion.status === "pending");
    console.log(`${placed.length} motion(s) sugerido(s):`);
    for (const { motion: m, outputStart } of placed) {
      console.log(
        `  ${m.id}  ${fmt(outputStart).padStart(7)}  ${MOTION_LABEL[m.kind].padEnd(13)} ${motionSummary(m)}  — ${m.note}`
      );
    }
  });

const library = program.command("library").description("Biblioteca de assets (packs)");

library
  .command("import")
  .description("Importa um pack (pasta com subpastas por categoria) para media/library")
  .argument("<pasta>")
  .option("--only <tipos>", "só estes tipos, separados por vírgula (ex.: sfx,transition)")
  .option("-j, --jobs <n>", "conversões em paralelo", "4")
  .action(async (dir: string, opts: { only?: string; jobs: string }) => {
    const started = Date.now();
    let lastPct = -1;
    const report = await importPack(dir, {
      only: opts.only ? (opts.only.split(",").map((s) => s.trim()) as AssetType[]) : undefined,
      concurrency: Number(opts.jobs),
      onProgress: (done, total, label) => {
        const pct = Math.floor((done / total) * 100);
        if (pct !== lastPct) {
          lastPct = pct;
          console.log(`  ${pct}% (${done}/${total}) ${label}`);
        }
      },
    });
    const secs = Math.round((Date.now() - started) / 1000);
    console.log(
      `Pack "${report.packId}": ${report.imported} importado(s), ${report.reused} reaproveitado(s), ${report.failed.length} falha(s) em ${secs}s`
    );
    for (const f of report.failed) console.log(`  FALHOU ${f.file}: ${f.error}`);
  });

library
  .command("tag")
  .description("Descreve assets visuais com IA de visão (para busca e para a IA de edição)")
  .option("--only <tipos>", "só estes tipos (ex.: icon,character)")
  .option("--force", "refaz também os que já têm descrição")
  .option("--limit <n>", "no máximo n itens (teste)")
  .action(async (opts: { only?: string; force?: boolean; limit?: string }) => {
    const r = await tagAssets({
      force: opts.force,
      limit: opts.limit ? Number(opts.limit) : undefined,
      only: opts.only ? (opts.only.split(",").map((s) => s.trim()) as AssetType[]) : undefined,
      onProgress: (done, total) => console.log(`  ${done}/${total}`),
    });
    console.log(`${r.tagged} descrito(s), ${r.failed} sem resposta`);
  });

library
  .command("stats")
  .description("Resumo do catálogo por tipo")
  .action(() => {
    const catalog = loadCatalog();
    const byType = new Map<string, number>();
    for (const a of catalog.assets) byType.set(a.type, (byType.get(a.type) ?? 0) + 1);
    console.log(`${catalog.assets.length} assets em ${catalog.packs.length} pack(s)`);
    for (const [t, n] of [...byType].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${ASSET_TYPE_LABEL[t as AssetType].padEnd(16)} ${n}`);
    }
  });

program
  .command("cuts")
  .description("Lista, aceita ou rejeita sugestões de corte")
  .argument("<projectId>")
  .option("--list", "lista as sugestões")
  .option("--accept <ids...>", "aceita sugestões (aplica o corte)")
  .option("--accept-all", "aceita todas as sugestões pendentes")
  .option("--reject <ids...>", "rejeita sugestões")
  .action(
    async (
      projectId: string,
      opts: {
        list?: boolean;
        accept?: string[];
        acceptAll?: boolean;
        reject?: string[];
      }
    ) => {
      let recipe = loadRecipe(projectId);
      if (opts.accept || opts.acceptAll) {
        const ids = opts.acceptAll ? pendingCutIds(recipe) : opts.accept!;
        recipe = acceptCuts(recipe, ids);
        saveRecipe(recipe);
        console.log(`Aceito(s): ${ids.join(", ") || "(nenhum pendente)"}`);
      }
      if (opts.reject) {
        recipe = rejectCuts(recipe, opts.reject);
        saveRecipe(recipe);
        console.log(`Rejeitado(s): ${opts.reject.join(", ")}`);
      }
      console.log(
        `Timeline: ${recipe.timeline.segments.length} segmento(s), duração final ${fmt(outputDuration(recipe.timeline.segments))}`
      );
      for (const s of recipe.timeline.segments) {
        console.log(`  ${s.id}  ${fmt(s.sourceStart)} → ${fmt(s.sourceEnd)}`);
      }
      const pending = recipe.timeline.suggestedCuts.filter(
        (c) => c.status === "pending"
      );
      if (pending.length > 0) {
        console.log(`Sugestões pendentes:`);
        for (const c of pending) console.log(fmtCut(c));
      }
    }
  );

program
  .command("render")
  .description("Renderiza o vídeo final via Remotion")
  .argument("<projectId>")
  .action(async (projectId: string) => {
    const recipe = loadRecipe(projectId);
    console.log(
      `Renderizando ${projectId} (${fmt(outputDuration(recipe.timeline.segments))} @ ${recipe.render.fps}fps)...`
    );
    let lastShown = -1;
    const { outputPath } = await renderRecipe(recipe, (fraction) => {
      const pct = Math.floor(fraction * 10) * 10;
      if (pct > lastShown) {
        lastShown = pct;
        process.stdout.write(`  ${pct}%\n`);
      }
    });
    console.log(`Render concluído: ${outputPath}`);
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(`Erro: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
