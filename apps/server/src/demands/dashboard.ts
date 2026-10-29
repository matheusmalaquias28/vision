import type { Demand, DemandEvent, DemandVideo } from "./types";

/**
 * Resumo do dia para o superadmin (tela Painel): andamento das demandas,
 * edições começadas e entregues, prazos e pontos de atenção. Tudo é
 * calculado aqui a partir do banco e dos projetos, sem tabela nova.
 *
 * "Entregue" = vídeo enviado ao Drive (o último leva a demanda para a
 * revisão do gestor). "Concluída" = demanda que chegou ao status final do War.
 */

/** Fuso do "dia" (VPS roda em UTC) */
export const DASHBOARD_TZ = process.env.VISION_TZ ?? "America/Sao_Paulo";

/** Janela das médias de prazo e tempo de edição */
export const AVERAGE_WINDOW_DAYS = 30;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Dia (YYYY-MM-DD) de um instante no fuso do painel */
export function dayOf(iso: string | Date, tz = DASHBOARD_TZ): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(iso)
  );
}

/** Diferença em dias de calendário entre dois YYYY-MM-DD (b − a) */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY_MS);
}

/** Dia anterior/seguinte de um YYYY-MM-DD */
export function shiftDay(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + delta * DAY_MS).toISOString().slice(0, 10);
}

const plain = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Status final (concluída): o último da lista do War ou "Concluído" pelo nome */
export function isDoneStatus(status: string, statuses: string[]): boolean {
  return status === statuses.at(-1) || /conclu|finaliz/.test(plain(status));
}

const isWaitingDate = (status: string) => /aguardando|definicao de data/.test(plain(status));

export interface ProjectInfo {
  id: string;
  createdAt: string;
  /** Análise automática com erro (null = sem análise ou ok) */
  analysisError: string | null;
}

export interface DashboardInput {
  day: string;
  now: Date;
  statuses: string[];
  demands: Demand[];
  videos: DemandVideo[];
  /** Eventos desde (pelo menos) o início da janela das médias */
  events: DemandEvent[];
  projects: ProjectInfo[];
  tz?: string;
}

export type AttentionKind =
  | "overdue"
  | "due-today"
  | "due-soon-not-started"
  | "no-date"
  | "stale"
  | "sync-error"
  | "analysis-error"
  | "unanswered";

export interface AttentionItem {
  kind: AttentionKind;
  severity: "high" | "mid";
  demandId: string;
  title: string;
  clientName: string;
  detail: string;
}

export interface DayItem {
  demandId: string | null;
  title: string;
  clientName: string;
  /** vídeo NN da demanda (null = projeto avulso) */
  index: number | null;
  at: string;
}

export interface DayReport {
  day: string;
  isToday: boolean;
  generatedAt: string;
  kpis: {
    openDemands: number;
    newDemands: number;
    editsStarted: number;
    /** das iniciadas, quantas são projetos avulsos (fora do War) */
    editsStartedLoose: number;
    videosDelivered: number;
    demandsDelivered: number;
    demandsCompleted: number;
    overdue: number;
    /** criação da demanda → último vídeo entregue (dias), janela de 30 dias */
    avgLeadDays: number | null;
    /** início da edição → entrega do vídeo (horas), janela de 30 dias */
    avgEditHours: number | null;
    /** demandas entregues até o prazo / com prazo (0–1), janela de 30 dias */
    onTimeRate: number | null;
    /** quantas entregas entraram nas médias */
    averageSample: number;
  };
  /** Por status: quantas estão nele agora e quantas entraram no dia */
  statusBoard: { status: string; open: number; enteredToday: number }[];
  attention: AttentionItem[];
  started: DayItem[];
  delivered: DayItem[];
  /** Quem mexeu no dia: mudanças de status e comentários feitos pelo Vision */
  activity: { name: string; statusMoves: number; comments: number }[];
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

export function buildDayReport(input: DashboardInput): DayReport {
  const { day, now, statuses, demands, videos, events, projects } = input;
  const tz = input.tz ?? DASHBOARD_TZ;
  const today = dayOf(now, tz);
  const on = (iso: string | null | undefined, d = day) => !!iso && dayOf(iso, tz) === d;
  const byId = new Map(demands.map((d) => [d.id, d]));
  const projectById = new Map(projects.map((p) => [p.id, p]));
  const videosOf = (id: string) => videos.filter((v) => v.demandId === id);
  const created = (d: Demand) => d.warCreatedAt ?? d.createdAt;
  const done = (d: Demand) => isDoneStatus(d.status, statuses);
  /** todos os vídeos entregues: instante do último; senão null */
  const deliveredAt = (d: Demand): string | null => {
    const vs = videosOf(d.id);
    if (vs.length === 0 || vs.some((v) => !v.deliveredAt)) return null;
    return vs.map((v) => v.deliveredAt!).sort().at(-1)!;
  };
  // o banco guarda só o estado atual: abertas e pontos de atenção são sempre "agora";
  // o dia escolhido vale para o que aconteceu nele (novas, começos, entregas, status)
  const reference = today;

  const open = demands.filter((d) => !done(d));

  // ─── entregas e começos do dia ──────────────────────────────────────
  const demandVideoByProject = new Map(videos.filter((v) => v.projectId).map((v) => [v.projectId!, v]));
  const started: DayItem[] = projects
    .filter((p) => on(p.createdAt))
    .map((p) => {
      const v = demandVideoByProject.get(p.id);
      const d = v ? byId.get(v.demandId) : undefined;
      return {
        demandId: d?.id ?? null,
        title: d ? d.title || "Sem título" : p.id,
        clientName: d?.clientName ?? "Projeto avulso",
        index: v?.index ?? null,
        at: p.createdAt,
      };
    })
    .sort((a, b) => a.at.localeCompare(b.at));

  const delivered: DayItem[] = videos
    .filter((v) => on(v.deliveredAt))
    .map((v) => {
      const d = byId.get(v.demandId);
      return {
        demandId: v.demandId,
        title: d ? d.title || "Sem título" : v.demandId,
        clientName: d?.clientName ?? "",
        index: v.index,
        at: v.deliveredAt!,
      };
    })
    .sort((a, b) => a.at.localeCompare(b.at));

  const dayEvents = events.filter((e) => on(e.createdAt));
  const statusEvents = dayEvents.filter((e) => e.kind === "status" && e.ok && e.status);
  const completedToday = new Set(
    statusEvents.filter((e) => isDoneStatus(e.status!, statuses)).map((e) => e.demandId)
  );
  const demandsDelivered = demands.filter((d) => on(deliveredAt(d))).length;

  // ─── médias (30 dias até o dia escolhido) ───────────────────────────
  const windowStart = shiftDay(day, -AVERAGE_WINDOW_DAYS + 1);
  const inWindow = (iso: string) => {
    const d = dayOf(iso, tz);
    return d >= windowStart && d <= day;
  };
  const deliveredDemands = demands
    .map((d) => ({ d, at: deliveredAt(d) }))
    .filter((x): x is { d: Demand; at: string } => x.at !== null && inWindow(x.at));
  const leadDays = deliveredDemands.map((x) => (Date.parse(x.at) - Date.parse(created(x.d))) / DAY_MS);
  const withDue = deliveredDemands.filter((x) => x.d.dueDate);
  const onTime = withDue.filter((x) => dayOf(x.at, tz) <= x.d.dueDate!.slice(0, 10)).length;
  const editHours = videos
    .filter((v) => v.deliveredAt && v.projectId && inWindow(v.deliveredAt) && projectById.has(v.projectId))
    .map((v) => (Date.parse(v.deliveredAt!) - Date.parse(projectById.get(v.projectId!)!.createdAt)) / HOUR_MS)
    .filter((h) => h >= 0);

  // ─── pontos de atenção ──────────────────────────────────────────────
  const attention: AttentionItem[] = [];
  const add = (d: Demand, kind: AttentionKind, severity: "high" | "mid", detail: string) =>
    attention.push({ kind, severity, demandId: d.id, title: d.title || "Sem título", clientName: d.clientName, detail });

  for (const d of open) {
    const due = d.dueDate?.slice(0, 10) ?? null;
    const waiting = deliveredAt(d) === null;
    const vs = videosOf(d.id);
    const startedCount = vs.filter((v) => v.projectId).length;
    if (due && waiting) {
      const left = daysBetween(reference, due);
      if (left < 0) add(d, "overdue", "high", `prazo era ${due.split("-").reverse().join("/")} (${-left} dia${left === -1 ? "" : "s"} de atraso)`);
      else if (left === 0) add(d, "due-today", startedCount === 0 ? "high" : "mid", startedCount === 0 ? "entrega hoje e a edição nem começou" : `entrega hoje · ${vs.filter((v) => v.deliveredAt).length}/${vs.length} vídeos entregues`);
      else if (left <= 2 && startedCount === 0) add(d, "due-soon-not-started", "high", `entrega em ${left} dia${left === 1 ? "" : "s"} e a edição não começou`);
    }
    if (!due && isWaitingDate(d.status)) {
      const age = daysBetween(dayOf(created(d), tz), reference);
      if (age >= 2) add(d, "no-date", "mid", `sem data de entrega há ${age} dias`);
    }
    // parada no mesmo status (fora "aguardando data", que já tem item próprio)
    const since = d.statusChangedAt ?? created(d);
    const still = daysBetween(dayOf(since, tz), reference);
    if (!isWaitingDate(d.status) && still >= 3) add(d, "stale", "mid", `parada em "${d.status}" há ${still} dias`);
    if (d.syncState === "error") add(d, "sync-error", "high", `status não chegou ao War: ${d.syncError ?? "erro"}`);
    for (const v of vs) {
      const err = v.projectId ? projectById.get(v.projectId)?.analysisError : null;
      if (err) add(d, "analysis-error", "mid", `vídeo ${String(v.index).padStart(2, "0")}: análise da IA falhou`);
    }
    // último comentário é do War e ninguém respondeu pelo Vision há 4 h
    const notes = d.notas.filter((n) => !n.apagadoEm).sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
    const last = notes.at(-1);
    if (last && last.origem !== "vision" && now.getTime() - Date.parse(last.criadoEm) > 4 * HOUR_MS) {
      const h = Math.round((now.getTime() - Date.parse(last.criadoEm)) / HOUR_MS);
      add(d, "unanswered", "mid", `${last.autor} comentou há ${h >= 48 ? `${Math.round(h / 24)} dias` : `${h} h`} sem resposta`);
    }
  }
  const order: AttentionKind[] = [
    "overdue",
    "due-today",
    "due-soon-not-started",
    "sync-error",
    "unanswered",
    "analysis-error",
    "no-date",
    "stale",
  ];
  attention.sort(
    (a, b) =>
      (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1) || order.indexOf(a.kind) - order.indexOf(b.kind)
  );

  // ─── status ─────────────────────────────────────────────────────────
  const columns = [...statuses, ...new Set(demands.map((d) => d.status).filter((s) => !statuses.includes(s)))];
  const statusBoard = columns.map((status) => ({
    status,
    open: demands.filter((d) => d.status === status).length,
    enteredToday: new Set(statusEvents.filter((e) => e.status === status).map((e) => e.demandId)).size,
  }));

  // ─── quem fez o quê (ações feitas pelo Vision) ──────────────────────
  const people = new Map<string, { statusMoves: number; comments: number }>();
  const bump = (name: string | null | undefined, key: "statusMoves" | "comments") => {
    if (!name) return;
    const p = people.get(name) ?? { statusMoves: 0, comments: 0 };
    p[key]++;
    people.set(name, p);
  };
  for (const e of statusEvents) if (e.direction === "out") bump(e.by, "statusMoves");
  for (const d of demands) {
    for (const n of d.notas) if (n.origem === "vision" && !n.apagadoEm && on(n.criadoEm)) bump(n.autor, "comments");
  }
  const activity = [...people.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.statusMoves + b.comments - (a.statusMoves + a.comments));

  return {
    day,
    isToday: day === today,
    generatedAt: now.toISOString(),
    kpis: {
      openDemands: open.length,
      newDemands: demands.filter((d) => on(created(d))).length,
      editsStarted: started.length,
      editsStartedLoose: started.filter((s) => s.demandId === null).length,
      videosDelivered: delivered.length,
      demandsDelivered,
      demandsCompleted: completedToday.size,
      overdue: attention.filter((a) => a.kind === "overdue").length,
      avgLeadDays: round1(avg(leadDays)),
      avgEditHours: round1(avg(editHours)),
      onTimeRate: withDue.length ? Math.round((onTime / withDue.length) * 100) / 100 : null,
      averageSample: deliveredDemands.length,
    },
    statusBoard,
    attention,
    started,
    delivered,
    activity,
  };
}
