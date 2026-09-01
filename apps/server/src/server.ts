import "./env";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import multer from "multer";
import { parseRecipe } from "@vision/recipe";
import { directProject } from "./director";
import { mediaDir, musicDir, projectDir, projectsDir, recipePath, toRecipePath } from "./paths";
import { createProject, loadRecipe, saveRecipe, slugify } from "./project";
import { enhanceAudio } from "./pipeline/enhance";
import { generateNarration } from "./pipeline/narration";
import { defaultSilenceOptions, suggestCuts } from "./pipeline/silence";
import { transcribeProject } from "./pipeline/transcribe";
import { getWaveforms } from "./pipeline/waveform";
import { enqueueRender, getJob } from "./render/queue";
import { applyTemplate, TEMPLATES } from "./templates";

const PORT = Number(process.env.PORT ?? 4000);

const app = express();
app.use(express.json({ limit: "20mb" }));
// Serve media/ na raiz (mesma convenção do staticFile() do Remotion)
app.use(express.static(mediaDir));

const upload = multer({
  dest: path.join(os.tmpdir(), "vision-uploads"),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
});

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
        clipCount: r.sources.length,
        durationInSeconds: r.sources.reduce((a, s) => a + s.durationInSeconds, 0),
      };
    })
  );
});

app.post("/api/projects", upload.array("videos", 20), async (req, res, next) => {
  const files = (req.files as Express.Multer.File[]) ?? [];
  const renamed: string[] = [];
  try {
    if (files.length === 0) {
      res.status(400).json({ error: "envie ao menos um arquivo no campo 'videos'" });
      return;
    }
    for (const f of files) {
      const ext = path.extname(f.originalname).toLowerCase() || ".mp4";
      const withExt = `${f.path}${ext}`;
      fs.renameSync(f.path, withExt);
      renamed.push(withExt);
    }
    const requestedId =
      (req.body.id as string | undefined) ||
      slugify(path.basename(files[0].originalname, path.extname(files[0].originalname)));
    const recipe = await createProject(
      renamed,
      requestedId,
      (req.body.briefing as string | undefined) ?? ""
    );
    res.json(recipe);
  } catch (err) {
    next(err);
  } finally {
    for (const p of renamed) fs.rmSync(p, { force: true });
  }
});

app.get("/api/projects/:id/recipe", (req, res) => {
  res.json(loadRecipe(req.params.id));
});

app.put("/api/projects/:id/recipe", (req, res) => {
  const recipe = parseRecipe(req.body);
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

// ─── Diretor IA (fila simples, igual ao render) ──────────────────────
interface DirectorJob {
  id: string;
  projectId: string;
  status: "running" | "done" | "error";
  stage: string;
  error?: string;
}
const directorJobs = new Map<string, DirectorJob>();
let directorCounter = 0;

app.post("/api/projects/:id/direct", (req, res) => {
  const briefing = String(req.body?.briefing ?? "").trim();
  if (!briefing) {
    res.status(400).json({ error: "campo 'briefing' é obrigatório" });
    return;
  }
  const recipe = loadRecipe(req.params.id);
  const job: DirectorJob = {
    id: `dir_${++directorCounter}`,
    projectId: req.params.id,
    status: "running",
    stage: "Iniciando",
  };
  directorJobs.set(job.id, job);
  directProject(recipe, briefing, (stage) => {
    job.stage = stage;
  })
    .then(() => {
      job.status = "done";
    })
    .catch((err) => {
      job.status = "error";
      job.error = err instanceof Error ? err.message : String(err);
    });
  res.json(job);
});

app.get("/api/director-jobs/:jobId", (req, res) => {
  const job = directorJobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "job não encontrado" });
    return;
  }
  res.json(job);
});

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
  upload.single("asset"),
  (req, res, next) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "campo 'asset' é obrigatório" });
        return;
      }
      const id = String(req.params.id);
      loadRecipe(id);
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
    console.error(err);
    res.status(400).json({ error: err.message });
  }
);

app.listen(PORT, () => {
  console.log(`VISION server em http://localhost:${PORT}`);
});
