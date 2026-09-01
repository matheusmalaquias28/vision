import "./env";
import path from "node:path";
import { Command } from "commander";
import { outputDuration } from "@vision/recipe";
import { acceptCuts, pendingCutIds, rejectCuts } from "./cuts";
import {
  defaultSilenceOptions,
  suggestCuts,
} from "./pipeline/silence";
import { transcribeProject } from "./pipeline/transcribe";
import { createProject, loadRecipe, saveRecipe } from "./project";
import { renderRecipe } from "./render/renderJob";

const program = new Command();
program.name("vision").description("VISION — editor de vídeo com IA (CLI)");

function fmt(s: number): string {
  return `${s.toFixed(2)}s`;
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
        for (const c of pending) {
          console.log(
            `  ${c.id}  ${fmt(c.sourceStart)} → ${fmt(c.sourceEnd)}  (confiança ${c.confidence})`
          );
        }
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
