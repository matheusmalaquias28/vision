import "./env";
import fs from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  ASSET_TYPE_LABEL,
  CUT_PACES,
  CUT_REASON_LABEL,
  MOTION_LABEL,
  motionSummary,
  outputDuration,
  placeMotions,
  reviewMotions,
  type AssetType,
  type CutPace,
  type SuggestedCut,
} from "@vision/recipe";
import { acceptCuts, pendingCutIds, rejectCuts } from "./cuts";
import crypto from "node:crypto";
import { checkPasswordStrength, hashPassword } from "./auth";
import { checkDatabase } from "./demands/dbCheck";
import { runRetention } from "./retention";
import { renderMotionSheet } from "./render/motionSheet";
import { getStore } from "./demands/store";
import { loadCatalog } from "./library/catalog";
import { importPack } from "./library/importPack";
import { tagAssets } from "./library/tagAssets";
import { analyzeMusicLibrary } from "./library/analyzeMusic";
import {
  defaultSilenceOptions,
  suggestCuts,
} from "./pipeline/silence";
import { planCreative } from "./creative/planner";
import { analyzeAndApply } from "./creative/fastPath";
import { motionCatalogMarkdown } from "./creative/catalogDoc";
import { suggestSmartCuts } from "./pipeline/smartCuts";
import { transcribeProject } from "./pipeline/transcribe";
import { ensureWorkingSources } from "./pipeline/normalize";
import { generateIllustration } from "./creative/illustrate";
import { createProject, loadRecipe, saveRecipe } from "./project";
import { releaseBundle } from "./render/bundle";
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
  .option("--pace <ritmo>", `silêncio entre frases: ${CUT_PACES.join(" | ")}`, "normal")
  .action(async (projectId: string, opts: { ai: boolean; pace: string }) => {
    const pace = CUT_PACES.find((p) => p === opts.pace);
    if (!pace) throw new Error(`--pace deve ser ${CUT_PACES.join(", ")}`);
    const updated = await suggestSmartCuts(loadRecipe(projectId), { ai: opts.ai, pace: pace as CutPace });
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
    const result = await planCreative(recipe, { instructions: opts.instructions });
    recipe = result.recipe;
    saveRecipe(recipe);
    const r = result.report;
    console.log(
      `Estilo ${r.style} (${r.styleSource}) · ${r.applied}/${r.proposed} aplicados · ${r.timings.totalMs} ms` +
        (r.tokens ? ` · tokens ${r.tokens.input}+${r.tokens.output}` : "") +
        (r.cacheHit ? " · cache" : "") +
        (r.fallback ? ` · fallback: ${r.fallback}` : "")
    );
    for (const x of r.rejected) console.log(`  recusado ${x.ref}: ${x.reason}`);
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
  .command("music")
  .description("Ouve um trecho de cada música com IA de áudio e grava o estilo (humor, energia, andamento, gênero, voz)")
  .option("--force", "refaz também as que já foram analisadas")
  .option("--limit <n>", "no máximo n músicas (teste)")
  .option("--only <ids>", "só estes ids, separados por vírgula")
  .action(async (opts: { force?: boolean; limit?: string; only?: string }) => {
    const r = await analyzeMusicLibrary({
      force: opts.force,
      limit: opts.limit ? Number(opts.limit) : undefined,
      only: opts.only ? opts.only.split(",").map((s) => s.trim()) : undefined,
      onProgress: (msg) => console.log(`  ${msg}`),
    });
    console.log(`${r.analyzed} analisada(s), ${r.skipped} já tinham perfil, ${r.failed.length} falha(s)`);
    for (const f of r.failed) console.log(`  FALHOU ${f.id}: ${f.error}`);
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
  .command("normalize")
  .description("Converte vídeos de câmera (10 bits, faixa 0–255, 4K…) do projeto para o formato de trabalho")
  .argument("<projectId>")
  .action(async (projectId: string) => {
    const { recipe, changed } = await ensureWorkingSources(loadRecipe(projectId), (m) => console.log(`  ${m}`));
    if (changed) saveRecipe(recipe);
    console.log(changed ? "Fontes convertidas; o original ficou ao lado como original-*." : "Todas as fontes já estão no formato de trabalho.");
  });

program
  .command("illustrate")
  .description("Gera a imagem de uma ilustração (Magnific, 1:1 em 1K, colagem de papel) nos assets do projeto")
  .argument("<projectId>")
  .argument("<assunto...>", "o que desenhar")
  .option("--fresh", "gera outra mesmo se a descrição já tiver imagem")
  .action(async (projectId: string, subject: string[], opts: { fresh?: boolean }) => {
    loadRecipe(projectId);
    const r = await generateIllustration(projectId, subject.join(" "), { fresh: opts.fresh });
    console.log(r.cached ? `Já existia: ${r.file}` : `Gerada em ${r.seconds}s: ${r.file}`);
  });

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
    try {
      const { outputPath } = await renderRecipe(recipe, (fraction) => {
        const pct = Math.floor(fraction * 10) * 10;
        if (pct > lastShown) {
          lastShown = pct;
          process.stdout.write(`  ${pct}%\n`);
        }
      });
      console.log(`Render concluído: ${outputPath}`);
    } finally {
      // uso pontual: o bundle (cópia de media/ no Windows) não fica no temp
      await releaseBundle();
    }
  });

const users = program.command("user").description("Pessoas com acesso ao Vision");

/** Senha passada ou uma gerada (mostrada uma vez) */
function passwordOrGenerated(given?: string): { password: string; generated: boolean } {
  if (given) {
    const weak = checkPasswordStrength(given);
    if (weak) throw new Error(weak);
    return { password: given, generated: false };
  }
  return { password: crypto.randomBytes(12).toString("base64url"), generated: true };
}

users
  .command("add")
  .description("Cria um acesso")
  .requiredOption("--email <email>", "e-mail de login")
  .requiredOption("--name <nome>", "nome que aparece nas notas e no War")
  .option("--admin", "administrador (gerencia editores)")
  .option("--superadmin", "super administrador (gerencia todos os acessos)")
  .option("--password <senha>", "senha (sem ela, uma é gerada e mostrada uma vez)")
  .action(async (opts: { email: string; name: string; admin?: boolean; superadmin?: boolean; password?: string }) => {
    const store = getStore();
    const email = opts.email.trim().toLowerCase();
    if (await store.getUserByEmail(email)) throw new Error(`já existe um acesso com ${email}`);
    const { password, generated } = passwordOrGenerated(opts.password);
    const now = new Date().toISOString();
    await store.upsertUser({
      id: crypto.randomUUID(),
      name: opts.name.trim(),
      email,
      passwordHash: hashPassword(password),
      role: opts.superadmin ? "superadmin" : opts.admin ? "admin" : "editor",
      active: true,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    });
    console.log(`Acesso criado: ${opts.name} <${email}> (${opts.superadmin ? "superadmin" : opts.admin ? "admin" : "editor"})`);
    if (generated) console.log(`Senha gerada (anote agora, não aparece de novo): ${password}`);
    process.exit(0);
  });

users
  .command("list")
  .description("Lista os acessos")
  .action(async () => {
    for (const u of await getStore().listUsers()) {
      console.log(
        `${u.active ? "ativo   " : "inativo "} ${u.role.padEnd(10)} ${u.name} <${u.email}>  último login: ${u.lastLoginAt ?? "nunca"}`
      );
    }
    process.exit(0);
  });

users
  .command("passwd")
  .description("Define uma nova senha")
  .requiredOption("--email <email>", "e-mail de login")
  .option("--password <senha>", "nova senha (sem ela, uma é gerada)")
  .action(async (opts: { email: string; password?: string }) => {
    const store = getStore();
    const user = await store.getUserByEmail(opts.email);
    if (!user) throw new Error(`nenhum acesso com ${opts.email}`);
    const { password, generated } = passwordOrGenerated(opts.password);
    await store.upsertUser({ ...user, passwordHash: hashPassword(password), updatedAt: new Date().toISOString() });
    console.log(`Senha de ${user.email} trocada.${generated ? ` Nova senha: ${password}` : ""}`);
    process.exit(0);
  });

users
  .command("disable")
  .description("Bloqueia um acesso (o histórico de notas continua)")
  .requiredOption("--email <email>", "e-mail de login")
  .option("--enable", "reativa em vez de bloquear")
  .action(async (opts: { email: string; enable?: boolean }) => {
    const store = getStore();
    const user = await store.getUserByEmail(opts.email);
    if (!user) throw new Error(`nenhum acesso com ${opts.email}`);
    await store.upsertUser({ ...user, active: Boolean(opts.enable), updatedAt: new Date().toISOString() });
    console.log(`${user.email} ${opts.enable ? "reativado" : "bloqueado"}.`);
    process.exit(0);
  });

program
  .command("analyze")
  .description("Fast Path: transcrição (se faltar) + cortes determinísticos + 1 chamada criativa, com tempos")
  .argument("<projectId>")
  .action(async (projectId: string) => {
    const { recipe, report } = await analyzeAndApply(loadRecipe(projectId));
    saveRecipe(recipe);
    const s = report.stages;
    console.log(
      `Fast Path ${report.withinTarget ? "dentro" : "FORA"} da meta: ${(report.totalMs / 1000).toFixed(1)} s ` +
        `(transcrição ${s.transcribeSkipped ? "reaproveitada" : `${(s.transcribeMs / 1000).toFixed(1)} s`}, ` +
        `cortes ${(s.cutsMs / 1000).toFixed(1)} s, planner ${(s.plannerMs / 1000).toFixed(1)} s) · vídeo ${report.videoSeconds} s`
    );
    const c = report.creative;
    console.log(`Estilo ${c.style} (${c.styleSource}) · ${c.applied}/${c.proposed} aplicados${c.tokens ? ` · tokens ${c.tokens.input}+${c.tokens.output}` : ""}${c.cacheHit ? " · cache" : ""}`);
    process.exit(0);
  });

program
  .command("motion-catalog")
  .description("Gera docs/motion-catalog.md a partir do Motion Registry")
  .option("--out <arquivo>", "arquivo de saída", "docs/motion-catalog.md")
  .action((opts: { out: string }) => {
    fs.writeFileSync(path.resolve(opts.out), `${motionCatalogMarkdown()}\n`, "utf8");
    console.log(`Catálogo salvo em ${opts.out}`);
  });

program
  .command("motion-sheet")
  .description("Folha de contato dos motions (validação visual, mesmo render do MP4)")
  .requiredOption("--out <arquivo>", "PNG de saída")
  .option("--frame <n>", "frame congelado em cada célula (ou 'mid')", "mid")
  .option("--file <media>", "vídeo de fundo (media/...)")
  .option("--only <tipos>", "só estes tipos, separados por vírgula (ex.: chart,callout)")
  .option("--image <media>", "imagem já gerada para os exemplos de ilustração")
  .action(async (opts: { out: string; frame: string; file?: string; only?: string; image?: string }) => {
    try {
      const out = await renderMotionSheet({
        out: path.resolve(opts.out),
        frame: opts.frame === "mid" ? "mid" : Number(opts.frame),
        file: opts.file ?? null,
        only: opts.only,
        image: opts.image ?? null,
      });
      console.log(`Folha salva em ${out}`);
    } finally {
      await releaseBundle();
    }
    process.exit(0);
  });

program
  .command("retention")
  .description("Apaga brutos vencidos e renders antigos (VISION_RAW_RETENTION_DAYS / VISION_IDLE_RETENTION_DAYS)")
  .option("--dry-run", "só mostra o que seria apagado")
  .option("--project <id>", "só este projeto")
  .action(async (opts: { dryRun?: boolean; project?: string }) => {
    const r = await runRetention({ dryRun: opts.dryRun, only: opts.project });
    for (const x of r) console.log(`${x.projectId}: ${x.action} · ${(x.bytes / 1e6).toFixed(1)} MB`);
    const mb = (r.reduce((a, x) => a + x.bytes, 0) / 1e6).toFixed(1);
    console.log(r.length === 0 ? "Nada a apagar." : `${opts.dryRun ? "Liberaria" : "Liberado"}: ${mb} MB`);
    process.exit(0);
  });

program
  .command("db-check")
  .description("Confere a conexão com o banco (VISION_DATABASE_URL) sem gravar nada")
  .action(async () => {
    const url = process.env.VISION_DATABASE_URL;
    if (!url) throw new Error("VISION_DATABASE_URL não está no .env");
    const ok = await checkDatabase(url);
    console.log(ok ? "\nTudo certo." : "\nAlgo não bate: veja as linhas ERRO.");
    if (!ok) process.exitCode = 1;
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(`Erro: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
