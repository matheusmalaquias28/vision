import { DASHBOARD_TZ, dayOf, daysBetween, isDoneStatus, shiftDay } from "./dashboard";
import type { Demand, DemandVideo, EditActivity, WorkEvent } from "./types";

/**
 * Desempenho por período (tela Painel → Desempenho, só superadmin). Função
 * pura: recebe o que o banco tem e devolve séries prontas para os gráficos.
 *
 * - Tempo real de edição = segundos em que o editor esteve aberto, visível e
 *   em uso (batimentos do editor, `edit_activity`). Só existe a partir do dia
 *   em que a medição começou (`trackingSince`); antes, os dias aparecem como
 *   "sem medição" e ficam fora das médias.
 * - Vídeos editados = projetos com tempo de edição no dia; renderizados =
 *   projetos com render ok no dia; entregues = vídeos enviados ao Drive.
 * - Filtro por pessoa: tempo e renders pelo autor; entregas e demandas pelo
 *   "dono" do projeto (quem mais editou; sem medição, quem começou/entregou).
 * - Tempo para definir a data = pedido no War → primeira data de entrega
 *   (`work_events` due-date). Demanda que já chegou com data fica de fora.
 */

export const MAX_PERIOD_DAYS = 120;
/** Semanas no gráfico de média semanal */
export const WEEKS_SHOWN = 8;
/** Dia conta como trabalhado com pelo menos 1 min de edição */
const WORKED_DAY_SECONDS = 60;
/** Data definida até 2 min depois de a demanda chegar = chegou com data */
const CAME_WITH_DATE_MS = 120_000;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Desde quando o servidor precisa ler atividade e eventos para este período */
export function performanceDataSince(from: string, to: string): string {
  const days = daysBetween(from, to) + 1;
  const prevFrom = shiftDay(from, -days);
  const weeksFrom = shiftDay(weekStart(to), -(WEEKS_SHOWN - 1) * 7);
  // +60 dias: tempo total de vídeos entregues no período que começaram antes dele
  return shiftDay(prevFrom < weeksFrom ? prevFrom : weeksFrom, -60);
}

/** 0 = segunda … 6 = domingo */
export function weekdayOf(day: string): number {
  return (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
}

/** Segunda-feira da semana do dia */
export function weekStart(day: string): string {
  return shiftDay(day, -weekdayOf(day));
}

const partsCache = new Map<string, Intl.DateTimeFormat>();
/** Dia, dia da semana e hora local (no fuso do painel) de um instante */
export function localSlot(iso: string, tz = DASHBOARD_TZ): { day: string; weekday: number; hour: number } {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    });
    partsCache.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  const day = `${p.year}-${p.month}-${p.day}`;
  return { day, weekday: weekdayOf(day), hour: Number(p.hour) % 24 };
}

export interface PerformanceInput {
  /** YYYY-MM-DD, inclusive */
  from: string;
  to: string;
  now: Date;
  tz?: string;
  /** null = todas as pessoas */
  userId: string | null;
  statuses: string[];
  demands: Demand[];
  videos: DemandVideo[];
  activity: EditActivity[];
  /** start/render/deliver do período (+ folga) e TODOS os due-date */
  work: WorkEvent[];
  users: { id: string; name: string }[];
  trackingReady: boolean;
}

export interface PeriodTotals {
  editSeconds: number;
  daysWorked: number;
  videosEdited: number;
  /** projetos com render ok */
  rendered: number;
  /** renders ok (re-render conta de novo) */
  renders: number;
  delivered: number;
  demandsDelivered: number;
}

export interface DailyPoint {
  day: string;
  weekday: number;
  editSeconds: number;
  videosEdited: number;
  rendered: number;
  delivered: number;
  /** false = antes da medição de tempo começar */
  tracked: boolean;
}

export interface DemandRow {
  demandId: string;
  title: string;
  clientName: string;
  videoCount: number;
  requestedAt: string;
  dateSetAt: string | null;
  cameWithDate: boolean;
  dueDate: string | null;
  deliveredAt: string;
  /** pedido → último vídeo entregue */
  leadDays: number;
  /** pedido → data definida (null = chegou com data ou sem registro) */
  dateSetHours: number | null;
  /** tempo real de edição somado dos vídeos da demanda */
  editSeconds: number;
  onTime: boolean | null;
  /** dias de calendário depois do prazo (0 = no prazo) */
  lateDays: number;
}

export interface PerformanceReport {
  from: string;
  to: string;
  days: number;
  generatedAt: string;
  userId: string | null;
  trackingReady: boolean;
  /** primeiro dia com tempo de edição medido (null = nunca) */
  trackingSince: string | null;
  editors: { id: string; name: string }[];
  totals: PeriodTotals;
  previous: PeriodTotals & { from: string; to: string };
  /** tempo real médio por vídeo entregue no período (todo o tempo do projeto) */
  perVideo: { avgEditSeconds: number | null; sample: number };
  weeklyAvg: { editSeconds: number | null; delivered: number | null; weeks: number };
  daily: DailyPoint[];
  weekdays: { weekday: number; avgEditSeconds: number | null; avgDelivered: number | null; samples: number }[];
  best: DailyPoint[];
  worst: DailyPoint[];
  /** [dia da semana 0=seg][hora 0–23] = segundos de edição no período */
  heatmap: number[][];
  weekly: { weekStart: string; editSeconds: number; delivered: number; rendered: number; daysWorked: number; tracked: boolean; complete: boolean }[];
  demands: {
    avgLeadDays: number | null;
    avgDateSetHours: number | null;
    dateSetSample: number;
    onTimeRate: number | null;
    sample: number;
    waitingDate: number;
    oldestWaitingDays: number | null;
    rows: DemandRow[];
  };
  byEditor: {
    id: string;
    name: string;
    editSeconds: number;
    daysWorked: number;
    videosEdited: number;
    rendered: number;
    delivered: number;
    avgPerVideoSeconds: number | null;
  }[];
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const round1 = (v: number | null) => (v === null ? null : Math.round(v * 10) / 10);

function daysOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = shiftDay(d, 1)) out.push(d);
  return out;
}

export function buildPerformanceReport(input: PerformanceInput): PerformanceReport {
  const { from, to, now, userId, statuses, demands, videos, activity, work, users } = input;
  const tz = input.tz ?? DASHBOARD_TZ;
  const today = dayOf(now, tz);
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  for (const w of work) if (w.userId && w.userName && !nameOf.has(w.userId)) nameOf.set(w.userId, w.userName);

  // ─── atividade em horário local ─────────────────────────────────────
  const slots = activity.map((a) => ({ ...a, ...localSlot(a.hour, tz) }));
  const trackingSince = slots.length ? slots.map((s) => s.day).sort()[0] : null;
  const tracked = (day: string) => trackingSince !== null && day >= trackingSince;
  const mine = <T extends { userId: string | null }>(xs: T[]) => (userId ? xs.filter((x) => x.userId === userId) : xs);
  const mySlots = mine(slots);

  // ─── dono de cada projeto (filtro por pessoa em entregas e demandas) ─
  const secondsBy = new Map<string, Map<string, number>>();
  for (const a of activity) {
    const m = secondsBy.get(a.projectId) ?? new Map<string, number>();
    m.set(a.userId, (m.get(a.userId) ?? 0) + a.seconds);
    secondsBy.set(a.projectId, m);
  }
  const ownerOf = (projectId: string | null): string | null => {
    if (!projectId) return null;
    const m = secondsBy.get(projectId);
    if (m && m.size) return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const ev = work.find((w) => w.projectId === projectId && w.userId && (w.kind === "start" || w.kind === "deliver"));
    return ev?.userId ?? null;
  };
  const projectSeconds = (projectId: string | null) => {
    const m = projectId ? secondsBy.get(projectId) : undefined;
    if (!m) return 0;
    return userId ? (m.get(userId) ?? 0) : sum([...m.values()]);
  };
  const isMine = (projectId: string | null) => !userId || ownerOf(projectId) === userId;

  const renders = mine(work.filter((w) => w.kind === "render" && w.ok && w.projectId)).map((w) => ({
    ...w,
    day: dayOf(w.createdAt, tz),
  }));
  const deliveries = videos
    .filter((v) => v.deliveredAt && isMine(v.projectId))
    .map((v) => ({ ...v, day: dayOf(v.deliveredAt!, tz) }));

  // ─── demandas entregues (último vídeo) ──────────────────────────────
  const videosOf = new Map<string, DemandVideo[]>();
  for (const v of videos) videosOf.set(v.demandId, [...(videosOf.get(v.demandId) ?? []), v]);
  const demandDeliveredAt = (d: Demand): string | null => {
    const vs = videosOf.get(d.id) ?? [];
    if (vs.length === 0 || vs.some((v) => !v.deliveredAt)) return null;
    return vs.map((v) => v.deliveredAt!).sort().at(-1)!;
  };
  const demandIsMine = (d: Demand) => !userId || (videosOf.get(d.id) ?? []).some((v) => ownerOf(v.projectId) === userId);
  const deliveredDemands = demands
    .map((d) => ({ d, at: demandDeliveredAt(d) }))
    .filter((x): x is { d: Demand; at: string } => x.at !== null && demandIsMine(x.d))
    .map((x) => ({ ...x, day: dayOf(x.at, tz) }));

  // ─── totais de um intervalo ─────────────────────────────────────────
  const totalsFor = (a: string, b: string): PeriodTotals => {
    const inRange = (day: string) => day >= a && day <= b;
    const s = mySlots.filter((x) => inRange(x.day));
    const perDay = new Map<string, number>();
    for (const x of s) perDay.set(x.day, (perDay.get(x.day) ?? 0) + x.seconds);
    const r = renders.filter((x) => inRange(x.day));
    return {
      editSeconds: sum(s.map((x) => x.seconds)),
      daysWorked: [...perDay.values()].filter((v) => v >= WORKED_DAY_SECONDS).length,
      videosEdited: new Set(s.map((x) => x.projectId)).size,
      rendered: new Set(r.map((x) => x.projectId)).size,
      renders: r.length,
      delivered: deliveries.filter((x) => inRange(x.day)).length,
      demandsDelivered: deliveredDemands.filter((x) => inRange(x.day)).length,
    };
  };
  const periodDays = daysBetween(from, to) + 1;
  const prevTo = shiftDay(from, -1);
  const prevFrom = shiftDay(from, -periodDays);

  // ─── série diária ───────────────────────────────────────────────────
  const pointFor = (day: string): DailyPoint => {
    const s = mySlots.filter((x) => x.day === day);
    return {
      day,
      weekday: weekdayOf(day),
      editSeconds: sum(s.map((x) => x.seconds)),
      videosEdited: new Set(s.map((x) => x.projectId)).size,
      rendered: new Set(renders.filter((x) => x.day === day).map((x) => x.projectId)).size,
      delivered: deliveries.filter((x) => x.day === day).length,
      tracked: tracked(day),
    };
  };
  const daily = daysOf(from, to).map(pointFor);

  // dias completos e medidos (hoje ainda não terminou)
  const measured = daily.filter((p) => p.tracked && p.day < today);
  const weekdays = Array.from({ length: 7 }, (_, weekday) => {
    const ps = measured.filter((p) => p.weekday === weekday);
    return {
      weekday,
      avgEditSeconds: round1(avg(ps.map((p) => p.editSeconds))),
      avgDelivered: round1(avg(ps.map((p) => p.delivered))),
      samples: ps.length,
    };
  });
  const rank = (a: DailyPoint, b: DailyPoint) => a.editSeconds - b.editSeconds || a.delivered - b.delivered;
  const best = daily
    .filter((p) => p.tracked && p.editSeconds > 0)
    .sort((a, b) => rank(b, a))
    .slice(0, 3);
  const bestDays = new Set(best.map((p) => p.day));
  // menos produtivos: só dias úteis já terminados (fim de semana parado é normal)
  const worst = measured
    .filter((p) => p.weekday < 5 && !bestDays.has(p.day))
    .sort(rank)
    .slice(0, 3);

  // ─── mapa de calor: dia da semana × hora ────────────────────────────
  const heatmap = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  for (const x of mySlots) if (x.day >= from && x.day <= to) heatmap[x.weekday][x.hour] += x.seconds;

  // ─── semanas ────────────────────────────────────────────────────────
  const lastWeek = weekStart(to);
  const weekly = Array.from({ length: WEEKS_SHOWN }, (_, i) => {
    const ws = shiftDay(lastWeek, -(WEEKS_SHOWN - 1 - i) * 7);
    const we = shiftDay(ws, 6);
    const t = totalsFor(ws, we);
    return {
      weekStart: ws,
      editSeconds: t.editSeconds,
      delivered: t.delivered,
      rendered: t.rendered,
      daysWorked: t.daysWorked,
      tracked: trackingSince !== null && we >= trackingSince,
      complete: we < today,
    };
  });
  const doneWeeks = weekly.filter((w) => w.complete);
  const avgWeeks = doneWeeks.length ? doneWeeks : weekly.slice(-1);
  const firstDelivery = deliveries.map((x) => x.day).sort()[0];
  const deliveryWeeks = avgWeeks.filter((w) => firstDelivery && shiftDay(w.weekStart, 6) >= firstDelivery);
  const trackedWeeks = avgWeeks.filter((w) => w.tracked);
  const weeklyAvg = {
    editSeconds: round1(avg(trackedWeeks.map((w) => w.editSeconds))),
    delivered: round1(avg(deliveryWeeks.map((w) => w.delivered))),
    weeks: avgWeeks.length,
  };

  // ─── tempo por vídeo entregue ───────────────────────────────────────
  const perVideoSecs = deliveries
    .filter((x) => x.day >= from && x.day <= to)
    .map((x) => projectSeconds(x.projectId))
    .filter((s) => s > 0);

  // ─── demandas: pedido → data definida → entrega ─────────────────────
  const dateSet = new Map<string, string>();
  for (const w of work) {
    if (w.kind !== "due-date" || !w.demandId) continue;
    const cur = dateSet.get(w.demandId);
    if (!cur || w.createdAt < cur) dateSet.set(w.demandId, w.createdAt);
  }
  const requestedAt = (d: Demand) => d.warCreatedAt ?? d.createdAt;
  const dateInfo = (d: Demand) => {
    const at = dateSet.get(d.id) ?? null;
    const cameWithDate = at !== null && Date.parse(at) - Date.parse(d.createdAt) < CAME_WITH_DATE_MS;
    const hours = at && !cameWithDate ? Math.max(0, (Date.parse(at) - Date.parse(requestedAt(d))) / HOUR_MS) : null;
    return { at, cameWithDate, hours };
  };
  const rows: DemandRow[] = deliveredDemands
    .filter((x) => x.day >= from && x.day <= to)
    .map(({ d, at }) => {
      const info = dateInfo(d);
      const due = d.dueDate?.slice(0, 10) ?? null;
      const late = due ? Math.max(0, daysBetween(due, dayOf(at, tz))) : 0;
      return {
        demandId: d.id,
        title: d.title || "Sem título",
        clientName: d.clientName,
        videoCount: d.videoCount,
        requestedAt: requestedAt(d),
        dateSetAt: info.at,
        cameWithDate: info.cameWithDate,
        dueDate: due,
        deliveredAt: at,
        leadDays: round1((Date.parse(at) - Date.parse(requestedAt(d))) / DAY_MS)!,
        dateSetHours: round1(info.hours),
        editSeconds: sum((videosOf.get(d.id) ?? []).map((v) => projectSeconds(v.projectId))),
        onTime: due ? late === 0 : null,
        lateDays: late,
      };
    })
    .sort((a, b) => b.deliveredAt.localeCompare(a.deliveredAt));
  // tempo para definir a data: datas definidas no período (todas as demandas)
  const dateSetInPeriod = demands
    .map(dateInfo)
    .filter((i) => i.hours !== null && i.at && dayOf(i.at, tz) >= from && dayOf(i.at, tz) <= to)
    .map((i) => i.hours!);
  const waiting = demands.filter((d) => !d.dueDate && !isDoneStatus(d.status, statuses));
  const withDue = rows.filter((r) => r.onTime !== null);

  // ─── por pessoa ─────────────────────────────────────────────────────
  const inPeriod = (day: string) => day >= from && day <= to;
  const people = new Set<string>();
  for (const s of slots) if (inPeriod(s.day)) people.add(s.userId);
  for (const w of work) if (w.userId && w.kind !== "due-date" && inPeriod(dayOf(w.createdAt, tz))) people.add(w.userId);
  const byEditor = [...people].map((id) => {
    const s = slots.filter((x) => x.userId === id && inPeriod(x.day));
    const perDay = new Map<string, number>();
    for (const x of s) perDay.set(x.day, (perDay.get(x.day) ?? 0) + x.seconds);
    const edited = new Set(s.map((x) => x.projectId)).size;
    const editSeconds = sum(s.map((x) => x.seconds));
    return {
      id,
      name: nameOf.get(id) ?? "Sem nome",
      editSeconds,
      daysWorked: [...perDay.values()].filter((v) => v >= WORKED_DAY_SECONDS).length,
      videosEdited: edited,
      rendered: new Set(
        work
          .filter((w) => w.kind === "render" && w.ok && w.userId === id && inPeriod(dayOf(w.createdAt, tz)))
          .map((w) => w.projectId)
      ).size,
      delivered: videos.filter((v) => v.deliveredAt && inPeriod(dayOf(v.deliveredAt, tz)) && ownerOf(v.projectId) === id)
        .length,
      avgPerVideoSeconds: edited ? Math.round(editSeconds / edited) : null,
    };
  });
  byEditor.sort((a, b) => b.editSeconds - a.editSeconds);

  const editorIds = new Set([...slots.map((s) => s.userId), ...work.map((w) => w.userId).filter((x): x is string => !!x)]);
  const editors = [...editorIds]
    .map((id) => ({ id, name: nameOf.get(id) ?? "Sem nome" }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return {
    from,
    to,
    days: periodDays,
    generatedAt: now.toISOString(),
    userId,
    trackingReady: input.trackingReady,
    trackingSince,
    editors,
    totals: totalsFor(from, to),
    previous: { ...totalsFor(prevFrom, prevTo), from: prevFrom, to: prevTo },
    perVideo: { avgEditSeconds: perVideoSecs.length ? Math.round(avg(perVideoSecs)!) : null, sample: perVideoSecs.length },
    weeklyAvg,
    daily,
    weekdays,
    best,
    worst,
    heatmap,
    weekly,
    demands: {
      avgLeadDays: round1(avg(rows.map((r) => r.leadDays))),
      avgDateSetHours: round1(avg(dateSetInPeriod)),
      dateSetSample: dateSetInPeriod.length,
      onTimeRate: withDue.length ? Math.round((withDue.filter((r) => r.onTime).length / withDue.length) * 100) / 100 : null,
      sample: rows.length,
      waitingDate: waiting.length,
      oldestWaitingDays: waiting.length
        ? Math.max(...waiting.map((d) => daysBetween(dayOf(requestedAt(d), tz), today)))
        : null,
      rows,
    },
    byEditor,
  };
}
