import fs from "node:fs";
import path from "node:path";
import express from "express";
import { projectDir } from "../paths";
import { slugify } from "../project";
import { createProjectFromUploads, upload } from "../uploads";
import { authUrl, disconnect, driveStatus, handleCallback, uploadToFolder } from "./drive";
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
    videos: mine,
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
    const demand = await changeStatus(String(req.params.id), status, req.body?.updatedBy);
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
    res.json({ ...(await changeStatus(demand.id, demand.status)), raw: undefined });
  })
);

// ─── Notas (conversa gestor ↔ editor, espelhada no War) ──────────────

demandsRouter.post(
  "/api/demands/:id/notes",
  wrap(async (req, res) => {
    res.json(
      await addNote(String(req.params.id), String(req.body?.texto ?? ""), String(req.body?.autor ?? ""))
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

/** Cria o projeto de edição do vídeo N da demanda com os brutos enviados */
demandsRouter.post(
  "/api/demands/:id/videos/:index/project",
  upload.array("videos", 20),
  wrap(async (req, res) => {
    const store = getStore();
    const files = (req.files as Express.Multer.File[]) ?? [];
    const demand = await store.getDemand(String(req.params.id));
    const index = Number(req.params.index);
    const video = (await store.listVideos(demand?.id)).find((v) => v.index === index);
    if (!demand || !video) {
      for (const f of files) fs.rmSync(f.path, { force: true });
      res.status(404).json({ error: "vídeo da demanda não encontrado" });
      return;
    }
    if (video.projectId && fs.existsSync(projectDir(video.projectId))) {
      for (const f of files) fs.rmSync(f.path, { force: true });
      res.status(409).json({ error: "esse vídeo já tem um projeto", projectId: video.projectId });
      return;
    }
    const base = slugify(demand.title || demand.clientName).slice(0, 36);
    const recipe = await createProjectFromUploads(
      files,
      `${base}-${pad2(index)}`,
      demand.briefing || demand.briefingText || ""
    );
    await store.upsertVideo({ ...video, projectId: recipe.projectId, updatedAt: new Date().toISOString() });
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
    res.json({
      video: updated,
      delivered: videos.filter((v) => v.deliveredAt).length,
      total: videos.length,
    });
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
