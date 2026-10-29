import fs from "node:fs";
import path from "node:path";
import express from "express";
import { projectDir, projectsDir, recipePath } from "../paths";
import { slugify } from "../project";
import { checkClipUpload, clipUpload, createProjectFromUploads, uploadName } from "../uploads";
import { readAnalysis, startAutoAnalysis } from "../creative/autoAnalyze";
import { authUrl, disconnect, driveStatus, handleCallback, uploadToFolder } from "./drive";
import { AVERAGE_WINDOW_DAYS, buildDayReport, dayOf, shiftDay, type ProjectInfo } from "./dashboard";
import { getStore } from "./store";
import type { Demand, DemandVideo } from "./types";
import {
  addNote,
  changeStatus,
  checkSecret,
  handleWarWebhook,
  resendNote,
  warStatuses,
  webhookSecret,
} from "./war";

export const demandsRouter = express.Router();

type Handler = (req: express.Request, res: express.Response) => Promise<unknown>;
const wrap = (fn: Handler): express.RequestHandler => (req, res, next) => {
  fn(req, res).catch(next);
};

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Nome do arquivo entregue: "Título da demanda 01.mp4" */
function deliveryName(demand: Demand, index: number) {
  const title = (demand.title || demand.clientName).replace(/[\\/:*?"<>|]+/g, " ").trim();
  return `${title} ${pad2(index)}.mp4`;
}

function withProgress(d: Demand, videos: DemandVideo[]) {
  const mine = videos.filter((v) => v.demandId === d.id);
  return {
    ...d,
    raw: undefined,
    // andamento da análise automática de cada vídeo (lido do projeto)
    videos: mine.map((v) => ({ ...v, analysis: v.projectId ? readAnalysis(v.projectId) : null })),
    started: mine.filter((v) => v.projectId).length,
    delivered: mine.filter((v) => v.deliveredAt).length,
  };
}

/** Data de referência para "demandas do mês": criação no War */
const refDate = (d: Demand) => d.warCreatedAt ?? d.createdAt;

function clientStats(demands: Demand[], statuses: string[]) {
  const now = new Date();
  const thisMonth = demands.filter((d) => {
    const t = new Date(refDate(d));
    return t.getFullYear() === now.getFullYear() && t.getMonth() === now.getMonth();
  });
  const finalStatus = statuses.at(-1);
  return {
    total: demands.length,
    month: thisMonth.length,
    open: demands.filter((d) => d.status !== finalStatus).length,
    videos: demands.reduce((a, d) => a + d.videoCount, 0),
  };
}

// ─── Webhook do War ──────────────────────────────────────────────────

demandsRouter.post(
  "/api/webhooks/war",
  wrap(async (req, res) => {
    if (!webhookSecret()) {
      res.status(503).json({ error: "DEMANDAS_WEBHOOK_SECRET não configurado no Vision" });
      return;
    }
    if (!checkSecret(req.headers)) {
      res.status(401).json({ error: "Não autorizado" });
      return;
    }
    res.json({ ok: true, ...(await handleWarWebhook(req.body)) });
  })
);

// ─── Demandas ────────────────────────────────────────────────────────

demandsRouter.get(
  "/api/demands",
  wrap(async (_req, res) => {
    const store = getStore();
    const [demands, videos, statuses] = await Promise.all([
      store.listDemands(),
      store.listVideos(),
      warStatuses(),
    ]);
    // status que existem em demandas mas sumiram da lista do War continuam visíveis
    const columns = [...statuses];
    for (const d of demands) if (!columns.includes(d.status)) columns.push(d.status);
    res.json({ statuses: columns, demands: demands.map((d) => withProgress(d, videos)) });
  })
);

// ─── Painel do dia (só superadmin) ───────────────────────────────────

/** Projetos do disco: quando a edição começou e se a análise da IA falhou */
function projectInfos(): ProjectInfo[] {
  if (!fs.existsSync(projectsDir)) return [];
  const out: ProjectInfo[] = [];
  for (const id of fs.readdirSync(projectsDir)) {
    try {
      // só o createdAt: ler a receita inteira (zod + migração) de cada projeto é caro
      const { createdAt } = JSON.parse(fs.readFileSync(recipePath(id), "utf8")) as { createdAt?: string };
      if (!createdAt) continue;
      const a = readAnalysis(id);
      out.push({ id, createdAt, analysisError: a?.status === "error" ? (a.error ?? "erro") : null });
    } catch {
      // pasta sem receita (ou receita quebrada) não é projeto
    }
  }
  return out;
}

demandsRouter.get(
  "/api/dashboard/day",
  wrap(async (req, res) => {
    if (req.user?.role !== "superadmin") {
      res.status(403).json({ error: "só o superadmin vê o painel" });
      return;
    }
    const now = new Date();
    const asked = String(req.query.date ?? "");
    const day = /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : dayOf(now);
    const store = getStore();
    // eventos da janela das médias (+1 dia de folga para o fuso)
    const since = `${shiftDay(day, -AVERAGE_WINDOW_DAYS - 1)}T00:00:00Z`;
    const [demands, videos, events, statuses] = await Promise.all([
      store.listDemands(),
      store.listVideos(),
      store.listEventsSince(since),
      warStatuses(),
    ]);
    res.json(buildDayReport({ day, now, statuses, demands, videos, events, projects: projectInfos() }));
  })
);

demandsRouter.get(
  "/api/demands/:id",
  wrap(async (req, res) => {
    const store = getStore();
    const demand = await store.getDemand(String(req.params.id));
    if (!demand) {
      res.status(404).json({ error: "demanda não encontrada" });
      return;
    }
    const [client, videos, events] = await Promise.all([
      store.getClient(demand.clientId),
      store.listVideos(demand.id),
      store.listEvents(demand.id),
    ]);
    res.json({
      demand: withProgress(demand, videos),
      client: client && { ...client, raw: undefined },
      events: events.map((e) => ({ ...e, payload: undefined })).reverse(),
    });
  })
);

demandsRouter.post(
  "/api/demands/:id/status",
  wrap(async (req, res) => {
    const status = String(req.body?.status ?? "");
    if (!status) {
      res.status(400).json({ error: "status é obrigatório" });
      return;
    }
    const demand = await changeStatus(String(req.params.id), status, req.user?.name);
    res.json({ ...demand, raw: undefined });
  })
);

/** Reenvia ao War o status atual (depois de uma falha de sincronização) */
demandsRouter.post(
  "/api/demands/:id/resync",
  wrap(async (req, res) => {
    const demand = await getStore().getDemand(String(req.params.id));
    if (!demand) {
      res.status(404).json({ error: "demanda não encontrada" });
      return;
    }
    res.json({ ...(await changeStatus(demand.id, demand.status, req.user?.name)), raw: undefined });
  })
);

// ─── Notas (conversa gestor ↔ editor, espelhada no War) ──────────────

demandsRouter.post(
  "/api/demands/:id/notes",
  wrap(async (req, res) => {
    res.json(
      await addNote(String(req.params.id), String(req.body?.texto ?? ""), req.user?.name ?? "")
    );
  })
);

demandsRouter.post(
  "/api/demands/:id/notes/resend",
  wrap(async (req, res) => {
    res.json(await resendNote(String(req.params.id), String(req.body?.criadoEm ?? "")));
  })
);

// ─── Notificações ────────────────────────────────────────────────────

demandsRouter.get(
  "/api/notifications",
  wrap(async (_req, res) => {
    const items = await getStore().listNotifications(40);
    res.json({ unread: items.filter((n) => !n.readAt).length, items });
  })
);

demandsRouter.post(
  "/api/notifications/read",
  wrap(async (req, res) => {
    const demandId = req.body?.demandId ? String(req.body.demandId) : undefined;
    await getStore().markNotificationsRead(demandId);
    res.json({ ok: true });
  })
);

/**
 * Cria o projeto de edição do vídeo N da demanda com os brutos enviados, na
 * ordem do formulário. `briefing` = o do War editado no Vision: vale só para
 * este projeto (vai para recipe.briefing) e nunca volta ao War. Sem o campo,
 * usa o do War.
 */
demandsRouter.post(
  "/api/demands/:id/videos/:index/project",
  clipUpload.array("videos", 20),
  wrap(async (req, res) => {
    const store = getStore();
    const files = (req.files as Express.Multer.File[]) ?? [];
    const discard = () => {
      for (const f of files) fs.rmSync(f.path, { force: true });
    };
    const demand = await store.getDemand(String(req.params.id));
    const index = Number(req.params.index);
    const video = (await store.listVideos(demand?.id)).find((v) => v.index === index);
    if (!demand || !video) {
      discard();
      res.status(404).json({ error: "vídeo da demanda não encontrado" });
      return;
    }
    if (video.projectId && fs.existsSync(projectDir(video.projectId))) {
      discard();
      res.status(409).json({ error: "esse vídeo já tem um projeto", projectId: video.projectId });
      return;
    }
    // mesmos limites dos clipes inseridos no editor (UPLOAD_LIMITS)
    for (const f of files) {
      const checked = await checkClipUpload(f, ["video"]);
      if ("error" in checked) {
        discard();
        res.status(400).json({ error: `${uploadName(f.originalname)}: ${checked.error}` });
        return;
      }
    }
    const briefing =
      typeof req.body?.briefing === "string"
        ? req.body.briefing.trim()
        : demand.briefing || demand.briefingText || "";
    const base = slugify(demand.title || demand.clientName).slice(0, 36);
    const recipe = await createProjectFromUploads(files, `${base}-${pad2(index)}`, briefing);
    await store.upsertVideo({ ...video, projectId: recipe.projectId, updatedAt: new Date().toISOString() });
    // transcrição, cortes e motions com o briefing já começam no servidor (tudo entra como sugestão)
    startAutoAnalysis(recipe.projectId);
    res.json(recipe);
  })
);

// ─── Clientes ────────────────────────────────────────────────────────

demandsRouter.get(
  "/api/clients",
  wrap(async (_req, res) => {
    const store = getStore();
    const [clients, demands, statuses] = await Promise.all([
      store.listClients(),
      store.listDemands(),
      warStatuses(),
    ]);
    res.json(
      clients
        .map((c) => ({
          ...c,
          raw: undefined,
          stats: clientStats(
            demands.filter((d) => d.clientId === c.id),
            statuses
          ),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
    );
  })
);

demandsRouter.get(
  "/api/clients/:id",
  wrap(async (req, res) => {
    const store = getStore();
    const client = await store.getClient(String(req.params.id));
    if (!client) {
      res.status(404).json({ error: "cliente não encontrado" });
      return;
    }
    const [demands, videos, statuses] = await Promise.all([
      store.listDemands({ clientId: client.id }),
      store.listVideos(),
      warStatuses(),
    ]);
    res.json({
      client,
      stats: clientStats(demands, statuses),
      demands: demands
        .sort((a, b) => refDate(b).localeCompare(refDate(a)))
        .map((d) => withProgress(d, videos)),
    });
  })
);

// ─── Projeto ↔ demanda ───────────────────────────────────────────────

demandsRouter.get(
  "/api/projects/:id/demand",
  wrap(async (req, res) => {
    const store = getStore();
    const video = await store.findVideoByProject(String(req.params.id));
    const demand = video && (await store.getDemand(video.demandId));
    if (!video || !demand) {
      res.json(null);
      return;
    }
    const videos = await store.listVideos(demand.id);
    res.json({ demand: withProgress(demand, videos), video, deliveryName: deliveryName(demand, video.index) });
  })
);

/** Envia o render mais recente do projeto para o Drive de editados da demanda */
demandsRouter.post(
  "/api/projects/:id/deliver",
  wrap(async (req, res) => {
    const store = getStore();
    const projectId = String(req.params.id);
    const video = await store.findVideoByProject(projectId);
    const demand = video && (await store.getDemand(video.demandId));
    if (!video || !demand) {
      res.status(404).json({ error: "projeto não pertence a uma demanda" });
      return;
    }
    if (!demand.driveEditados) {
      res.status(400).json({ error: "a demanda não tem Drive para editados" });
      return;
    }
    const rendersDir = path.join(projectDir(projectId), "renders");
    const latest = fs.existsSync(rendersDir)
      ? fs
          .readdirSync(rendersDir)
          .filter((f) => f.endsWith(".mp4"))
          .map((f) => path.join(rendersDir, f))
          .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]
      : undefined;
    if (!latest) {
      res.status(400).json({ error: "renderize o vídeo antes de enviar" });
      return;
    }
    const file = await uploadToFolder(demand.driveEditados, deliveryName(demand, video.index), latest);
    const updated: DemandVideo = {
      ...video,
      driveFileId: file.id,
      driveFileUrl: file.url,
      deliveredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await store.upsertVideo(updated);
    const videos = await store.listVideos(demand.id);
    const delivered = videos.filter((v) => v.deliveredAt).length;

    // último vídeo entregue: a demanda segue sozinha para o status de revisão
    let autoStatus: { status: string; syncError: string | null } | null = null;
    const target = process.env.VISION_STATUS_ON_DELIVERY ?? "Aprovação do Gestor";
    if (target && delivered === videos.length && demand.status.toLowerCase() !== target.toLowerCase()) {
      try {
        const moved = await changeStatus(demand.id, target, req.user?.name);
        autoStatus = { status: moved.status, syncError: moved.syncError };
      } catch (e) {
        // status não permitido pelo War: a entrega vale, só não move a demanda
        autoStatus = { status: demand.status, syncError: e instanceof Error ? e.message : String(e) };
      }
    }
    res.json({ video: updated, delivered, total: videos.length, autoStatus });
  })
);

// ─── Integrações ─────────────────────────────────────────────────────

demandsRouter.get(
  "/api/integrations",
  wrap(async (_req, res) => {
    res.json({
      storage: getStore().kind,
      webhookConfigured: Boolean(webhookSecret()),
      drive: await driveStatus(),
    });
  })
);

demandsRouter.get("/api/google/connect", (_req, res, next) => {
  try {
    res.redirect(authUrl());
  } catch (err) {
    next(err);
  }
});

demandsRouter.get(
  "/api/google/callback",
  wrap(async (req, res) => {
    try {
      await handleCallback(String(req.query.code ?? ""), String(req.query.state ?? ""));
      res.redirect("/#/demandas?drive=ok");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.redirect(`/#/demandas?drive=erro&msg=${encodeURIComponent(msg)}`);
    }
  })
);

demandsRouter.post(
  "/api/google/disconnect",
  wrap(async (_req, res) => {
    await disconnect();
    res.json({ ok: true });
  })
);
