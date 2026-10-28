import "./env";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { CUT_PACES, migrateRecipeData, parseRecipe } from "@vision/recipe";
import { mediaDir, musicDir, projectDir, projectsDir, recipePath, toRecipePath } from "./paths";
import { loadRecipe, saveRecipe, slugify } from "./project";
import { checkClipUpload, clipUpload, createProjectFromUploads, upload, uploadName } from "./uploads";
import { demandsRouter } from "./demands/routes";
import { authRouter, requireAuth } from "./auth";
import { usersRouter } from "./users";
import { purgeInfo, rawMissing, scheduleRetention } from "./retention";
import { autoColorGrades } from "./pipeline/colorStats";
import { normalizeVideo } from "./pipeline/normalize";
import { enhanceAudio } from "./pipeline/enhance";
import { generateNarration } from "./pipeline/narration";
import { probeVideo } from "./pipeline/probe";
import { defaultSilenceOptions, suggestCuts } from "./pipeline/silence";
import { planCreative } from "./creative/planner";
import { analyzeAndApply } from "./creative/fastPath";
import { readAnalysis, startAutoAnalysis } from "./creative/autoAnalyze";
import {
  deleteIllustration,
  generateIllustration,
  illustrationsEnabled,
  listIllustrations,
} from "./creative/illustrate";
import { suggestIllustrations } from "./creative/illustrationPlanner";
import { suggestSmartCuts } from "./pipeline/smartCuts";
import { transcribeProject } from "./pipeline/transcribe";
import { getFilmstrips } from "./pipeline/filmstrip";
import { getPreviewProxies, queuePreviewProxy } from "./pipeline/previewProxy";
import { getThumbnail } from "./pipeline/thumbnail";
import { getFileWaveform, getWaveforms } from "./pipeline/waveform";
import { enqueueRender, getJob } from "./render/queue";
import { cleanupStaleRemotionTemp, warmBundle } from "./render/bundle";
import { loadCatalog } from "./library/catalog";
import { applyTemplate, TEMPLATES } from "./templates";

const PORT = Number(process.env.PORT ?? 4000);

const app = express();
// atrás do Caddy (mesma máquina): IP real e HTTPS vêm dos cabeçalhos X-Forwarded-*
app.set("trust proxy", "loopback");
app.use(express.json({ limit: "20mb" }));
// tudo abaixo (API e arquivos de media/) exige login, menos o webhook do War
app.use(requireAuth);
app.use(authRouter);
app.use(usersRouter);
app.use(demandsRouter);
// Serve media/ na raiz (mesma convenção do staticFile() do Remotion). Cache:
// cópia leve do preview tem carimbo no nome (nunca muda) e a biblioteca é
// importada uma vez; o resto (brutos, áudio tratado) revalida a cada uso.
const MEDIA_CACHE: [RegExp, string][] = [
  [/^\/projects\/[^/]+\/proxy\//, "private, max-age=31536000, immutable"],
  [/^\/library\//, "private, max-age=86400"],
];
app.use(
  express.static(mediaDir, {
    setHeaders: (res, abs) => {
      const rel = "/" + path.relative(mediaDir, abs).split(path.sep).join("/");
      const rule = MEDIA_CACHE.find(([re]) => re.test(rel));
      if (rule) res.setHeader("Cache-Control", rule[1]);
    },
  })
);

function listAudioFiles(dir: string, prefix: string) {
  const exts = [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"];
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => exts.includes(path.extname(f).toLowerCase()))
    .sort()
    .map((f) => ({ name: f, file: `${prefix}/${f}` }));
}

app.get("/api/projects", (_req, res) => {
  const ids = fs.existsSync(projectsDir)
    ? fs
        .readdirSync(projectsDir)
        .filter((d) => fs.existsSync(recipePath(d)))
        .sort()
    : [];
  res.json(
    ids.map((id) => {
      const r = loadRecipe(id);
      return {
        id,
        createdAt: r.createdAt,
        // toda edição regrava o recipe.json
        updatedAt: fs.statSync(recipePath(id)).mtime.toISOString(),
        clipCount: r.sources.length,
        durationInSeconds: r.sources.reduce((a, s) => a + s.durationInSeconds, 0),
        // bruto apagado pela limpeza: abre para consulta, não renderiza
        rawPurgedAt: purgeInfo(id)?.purgedAt ?? null,
      };
    })
  );
});

app.post("/api/projects", upload.array("videos", 20), async (req, res, next) => {
  try {
    const recipe = await createProjectFromUploads(
      (req.files as Express.Multer.File[]) ?? [],
      req.body.id as string | undefined,
      (req.body.briefing as string | undefined) ?? ""
    );
    // transcrição, cortes e motions já começam no servidor (tudo entra como sugestão)
    startAutoAnalysis(recipe.projectId);
    res.json(recipe);
  } catch (err) {
    next(err);
  }
});

/** Andamento da análise automática (null = nunca rodou) */
app.get("/api/projects/:id/analysis", (req, res) => {
  res.json(readAnalysis(req.params.id));
});

app.get("/api/projects/:id/recipe", (req, res) => {
  res.json(loadRecipe(req.params.id));
});

app.put("/api/projects/:id/recipe", (req, res) => {
  // editor aberto antes de uma migração ainda manda o formato antigo
  const recipe = parseRecipe(migrateRecipeData(req.body));
  if (recipe.projectId !== req.params.id) {
    res.status(400).json({ error: "projectId da receita não bate com a URL" });
    return;
  }
  saveRecipe(recipe);
  res.json(recipe);
});

app.post("/api/projects/:id/transcribe", async (req, res, next) => {
  try {
    const updated = await transcribeProject(loadRecipe(req.params.id));
    saveRecipe(updated);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

app.post("/api/projects/:id/silence", async (req, res, next) => {
  try {
    const updated = await suggestCuts(loadRecipe(req.params.id), defaultSilenceOptions);
    saveRecipe(updated);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Pausas, vícios e repetições (determinístico) + retomadas (IA, opcional)
app.post("/api/projects/:id/smart-cuts", async (req, res, next) => {
  try {
    const pace = CUT_PACES.find((p) => p === req.body?.pace) ?? "normal";
    const updated = await suggestSmartCuts(loadRecipe(req.params.id), {
      ai: req.body?.ai !== false,
      pace,
    });
    saveRecipe(updated);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// Plano de motions da IA (entra como pendente; o operador aceita/rejeita)
/** Creative Planner: 1 chamada de IA → motions/receitas pendentes + relatório */
app.post("/api/projects/:id/creative/plan", async (req, res, next) => {
  try {
    const { recipe, report } = await planCreative(loadRecipe(req.params.id), {
      instructions: String(req.body?.instructions ?? ""),
      force: Boolean(req.body?.force),
    });
    saveRecipe(recipe);
    res.json({ recipe, report });
  } catch (err) {
    next(err);
  }
});

/** Fast Path: transcrição (se faltar) + cortes determinísticos + planner, com tempos por etapa */
app.post("/api/projects/:id/creative/analyze", async (req, res, next) => {
  try {
    const pace = CUT_PACES.includes(req.body?.pace) ? req.body.pace : "normal";
    const { recipe, report } = await analyzeAndApply(loadRecipe(req.params.id), {
      pace,
      instructions: String(req.body?.instructions ?? ""),
    });
    saveRecipe(recipe);
    res.json({ recipe, report });
  } catch (err) {
    next(err);
  }
});

// compatibilidade: mesma rotina, devolve só a receita
app.post("/api/projects/:id/motions/suggest", async (req, res, next) => {
  try {
    const { recipe } = await planCreative(loadRecipe(req.params.id), {
      instructions: String(req.body?.instructions ?? ""),
    });
    saveRecipe(recipe);
    res.json(recipe);
  } catch (err) {
    next(err);
  }
});

// Ajuste automático de cor (mede os vídeos com ffmpeg); não grava, o editor aplica
app.post("/api/projects/:id/color/auto", async (req, res, next) => {
  try {
    const recipe = loadRecipe(req.params.id);
    const ids: unknown = req.body?.sourceIds;
    const sources = Array.isArray(ids) ? recipe.sources.filter((s) => ids.includes(s.id)) : recipe.sources;
    res.json({ grades: await autoColorGrades(sources) });
  } catch (err) {
    next(err);
  }
});

// Imagens ilustrativas: a IA escolhe 2–3 pontos-chave e gera as imagens (só por botão)
app.post("/api/projects/:id/illustrations/suggest", async (req, res, next) => {
  try {
    if (!illustrationsEnabled()) {
      res.status(503).json({ error: "geração de imagens desligada: falta MAGNIFIC_API_KEY no .env" });
      return;
    }
    const { recipe, report } = await suggestIllustrations(loadRecipe(req.params.id), {
      instructions: String(req.body?.instructions ?? ""),
    });
    saveRecipe(recipe);
    res.json({ recipe, report });
  } catch (err) {
    next(err);
  }
});

// Controle das imagens geradas no projeto (galeria do painel)
app.get("/api/projects/:id/illustrations", (req, res, next) => {
  try {
    loadRecipe(req.params.id); // projeto existe
    res.json({ ...listIllustrations(req.params.id), enabled: illustrationsEnabled() });
  } catch (err) {
    next(err);
  }
});

app.delete("/api/projects/:id/illustrations", (req, res, next) => {
  try {
    const recipe = loadRecipe(req.params.id);
    const used = new Set(
      recipe.motions.flatMap((m) => (m.kind === "illustration" && m.params.image ? [m.params.image] : []))
    );
    deleteIllustration(req.params.id, String(req.query.file ?? ""), used);
    res.json(listIllustrations(req.params.id));
  } catch (err) {
    next(err);
  }
});

// Ilustração (Magnific): gera a imagem e devolve o caminho; o editor grava no motion
app.post("/api/projects/:id/illustrations", async (req, res, next) => {
  try {
    loadRecipe(req.params.id); // projeto existe
    const subject = String(req.body?.subject ?? "").trim();
    if (subject.length < 2 || subject.length > 300) {
      res.status(400).json({ error: "descreva a imagem (2 a 300 caracteres)" });
      return;
    }
    if (!illustrationsEnabled()) {
      res.status(503).json({ error: "geração de imagens desligada: falta MAGNIFIC_API_KEY no .env" });
      return;
    }
    res.json(await generateIllustration(req.params.id, subject, { fresh: req.body?.fresh === true }));
  } catch (err) {
    next(err);
  }
});

app.post("/api/projects/:id/enhance", async (req, res, next) => {
  try {
    const updated = await enhanceAudio(loadRecipe(req.params.id));
    saveRecipe(updated);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

app.post("/api/projects/:id/narration", async (req, res, next) => {
  try {
    const script = String(req.body?.script ?? "").trim();
    if (!script) {
      res.status(400).json({ error: "campo 'script' é obrigatório" });
      return;
    }
    const updated = await generateNarration(loadRecipe(req.params.id), script);
    saveRecipe(updated);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

app.get("/api/projects/:id/waveform", async (req, res, next) => {
  try {
    res.json(await getWaveforms(loadRecipe(req.params.id)));
  } catch (err) {
    next(err);
  }
});

app.get("/api/waveform", async (req, res, next) => {
  const file = String(req.query.file ?? "");
  if (!file) {
    res.status(400).json({ error: "parâmetro file é obrigatório" });
    return;
  }
  try {
    res.set("Cache-Control", "public, max-age=3600");
    res.json(await getFileWaveform(file));
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status) {
      res.status(status).json({ error: (err as Error).message });
      return;
    }
    next(err);
  }
});

app.get("/api/projects/:id/filmstrip", async (req, res, next) => {
  try {
    res.json(await getFilmstrips(loadRecipe(req.params.id)));
  } catch (err) {
    next(err);
  }
});

app.get("/api/projects/:id/preview-proxies", (req, res, next) => {
  try {
    res.json(getPreviewProxies(loadRecipe(req.params.id)));
  } catch (err) {
    next(err);
  }
});

app.get("/api/projects/:id/thumbnail", async (req, res, next) => {
  try {
    const file = await getThumbnail(loadRecipe(req.params.id));
    res.set("Cache-Control", "public, max-age=3600");
    res.sendFile(file);
  } catch (err) {
    next(err);
  }
});

// ─── Biblioteca de assets ───────────────────────────────────────────
app.get("/api/library", (_req, res) => res.json(loadCatalog()));

// ─── Templates ───────────────────────────────────────────────────────
app.get("/api/templates", (_req, res) => res.json(TEMPLATES));

app.post("/api/projects/:id/template", (req, res) => {
  const templateId = String(req.body?.template ?? "");
  const updated = applyTemplate(loadRecipe(req.params.id), templateId);
  saveRecipe(updated);
  res.json(updated);
});

// ─── Bibliotecas e assets ────────────────────────────────────────────
app.get("/api/music", (_req, res) => res.json(listAudioFiles(musicDir, "media/music")));

app.get("/api/sfx", (_req, res) =>
  res.json(listAudioFiles(path.join(mediaDir, "sfx"), "media/sfx"))
);

app.post(
  "/api/projects/:id/assets",
  clipUpload.single("asset"),
  async (req, res, next) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "campo 'asset' é obrigatório" });
        return;
      }
      const id = String(req.params.id);
      loadRecipe(id);
      const checked = await checkClipUpload(req.file, ["image", "video", "audio"]);
      if ("error" in checked) {
        res.status(400).json({ error: checked.error });
        return;
      }
      const safeName = `${Date.now().toString(36)}-${slugify(
        path.basename(req.file.originalname, path.extname(req.file.originalname))
      )}${path.extname(req.file.originalname).toLowerCase()}`;
      const destAbs = path.join(projectDir(id), "assets", safeName);
      fs.mkdirSync(path.dirname(destAbs), { recursive: true });
      fs.copyFileSync(req.file.path, destAbs);
      fs.rmSync(req.file.path, { force: true });
      res.json({ file: toRecipePath(destAbs), name: safeName });
    } catch (err) {
      next(err);
    }
  }
);

// Registra um vídeo como nova fonte (para inserir como clipe na sequência).
// Copia + faz probe; devolve o Source pronto. O cliente insere o segmento e
// salva a receita. probeVideo rejeita arquivos sem trilha de vídeo (imagens).
app.post(
  "/api/projects/:id/sources",
  clipUpload.single("asset"),
  async (req, res, next) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "campo 'asset' é obrigatório" });
        return;
      }
      const id = String(req.params.id);
      loadRecipe(id);
      const checked = await checkClipUpload(req.file, ["video"]);
      if ("error" in checked) {
        res.status(400).json({ error: checked.error });
        return;
      }
      const srcId = `src_${Date.now().toString(36)}`;
      const ext = path.extname(req.file.originalname).toLowerCase() || ".mp4";
      const copied = path.join(projectDir(id), `source-${srcId}${ext}`);
      fs.copyFileSync(req.file.path, copied);
      fs.rmSync(req.file.path, { force: true });
      const { abs: destAbs } = await normalizeVideo(copied);
      const probe = await probeVideo(destAbs);
      // cópia leve do preview já começa (o Player pega quando ficar pronta)
      queuePreviewProxy(id, destAbs);
      res.json({
        source: {
          id: srcId,
          file: toRecipePath(destAbs),
          // nome original: a timeline mostra no trecho (antes vinha sem e a timeline quebrava)
          name: uploadName(req.file.originalname),
          durationInSeconds: probe.durationInSeconds,
          width: probe.width,
          height: probe.height,
          fps: probe.fps,
          enhancedAudio: null,
          color: null,
          framing: null,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

app.get("/api/projects/:id/assets", (req, res) => {
  const id = String(req.params.id);
  const dir = path.join(projectDir(id), "assets");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
  res.json(
    files.map((f) => ({
      name: f,
      file: `media/projects/${id}/assets/${f}`,
    }))
  );
});

// ─── Render ──────────────────────────────────────────────────────────
app.post("/api/projects/:id/render", (req, res) => {
  loadRecipe(req.params.id);
  if (rawMissing(req.params.id)) {
    res.status(400).json({ error: "o vídeo bruto deste projeto já foi apagado pela limpeza; não dá para renderizar de novo" });
    return;
  }
  res.json(enqueueRender(req.params.id));
});

app.get("/api/render-jobs/:jobId", (req, res) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "job não encontrado" });
    return;
  }
  res.json(job);
});

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    // multer: arquivo acima do limite da rota (vem antes de qualquer checagem)
    if ((err as { code?: string }).code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "arquivo pesado demais para a timeline" });
      return;
    }
    console.error(err);
    res.status(400).json({ error: err.message });
  }
);

// Na Vercel a função importa o app; localmente (e num VPS) sobe a porta
if (!process.env.VERCEL) {
  const server = app.listen(PORT, () => {
    console.log(`VISION server em http://localhost:${PORT}`);
  });
  // o Node corta pedidos com mais de 5 min: upload de bruto grande (até 1 GB) leva mais que isso
  server.requestTimeout = 60 * 60 * 1000;
  scheduleRetention();
  // cópias do bundle do Remotion largadas por processos antigos (cada uma leva a pasta media/)
  const { removed, bytes } = cleanupStaleRemotionTemp();
  if (removed > 0) console.log(`Limpeza: ${removed} pasta(s) temporária(s) do Remotion apagada(s), ${Math.round(bytes / 1e6)} MB`);
  // bundle uma vez, reaproveitado por todos os renders do processo
  warmBundle();
  // biblioteca fica fora do git: sem ela não há ícones, SFX nem som dos motions
  try {
    const assets = loadCatalog().assets;
    const sfx = assets.filter((a) => a.type === "sfx").length;
    if (assets.length === 0) {
      console.warn("Biblioteca VAZIA (media/library): sem ícones, personagens, SFX nem som dos motions. Veja DEPLOY.md, passo 11.");
    } else {
      console.log(`Biblioteca: ${assets.length} itens (${sfx} SFX)`);
    }
  } catch (err) {
    console.warn("Biblioteca ilegível:", err instanceof Error ? err.message : err);
  }
}

export default app;
