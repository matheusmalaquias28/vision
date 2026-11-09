import { describe, expect, it } from "vitest";
import { buildPerformanceReport, localSlot, weekStart, weekdayOf, type PerformanceInput } from "../src/demands/performance";
import { clampBeat } from "../src/demands/tracking";
import type { Demand, DemandVideo, EditActivity, WorkEvent } from "../src/demands/types";

const STATUSES = ["Aguardando Definição de Data", "Em Fila", "Aprovação do Gestor", "Concluído"];
const TZ = "America/Sao_Paulo";
// sexta 06/11/2026 às 18h em São Paulo
const NOW = new Date("2026-11-06T21:00:00Z");

const demand = (id: string, extra: Partial<Demand> = {}): Demand => ({
  id,
  clientId: "c1",
  clientName: "Cliente",
  title: `Demanda ${id}`,
  priority: null,
  videoCount: 1,
  driveEditados: null,
  driveMateriais: null,
  briefing: "",
  briefingText: null,
  instagram: null,
  gestor: null,
  solicitante: null,
  editor: null,
  squad: null,
  categoria: null,
  status: "Em Fila",
  dueDate: null,
  notas: [],
  statusPermitidos: [],
  callbackUrl: null,
  warCreatedAt: "2026-11-02T12:00:00Z",
  warUpdatedAt: null,
  statusChangedAt: null,
  syncState: "ok",
  syncError: null,
  raw: null,
  createdAt: "2026-11-02T12:00:00Z",
  updatedAt: "2026-11-02T12:00:00Z",
  ...extra,
});

const video = (demandId: string, extra: Partial<DemandVideo> = {}): DemandVideo => ({
  demandId,
  index: 1,
  projectId: null,
  driveFileId: null,
  driveFileUrl: null,
  deliveredAt: null,
  updatedAt: "2026-11-02T12:00:00Z",
  ...extra,
});

let nextId = 1;
const ev = (kind: WorkEvent["kind"], at: string, extra: Partial<WorkEvent> = {}): WorkEvent => ({
  id: nextId++,
  kind,
  userId: "ana",
  userName: "Ana",
  projectId: null,
  demandId: null,
  ok: true,
  seconds: null,
  detail: null,
  createdAt: at,
  ...extra,
});

const act = (userId: string, projectId: string, hour: string, seconds: number): EditActivity => ({
  userId,
  projectId,
  hour,
  seconds,
});

const base = (extra: Partial<PerformanceInput> = {}): PerformanceInput => ({
  from: "2026-11-02",
  to: "2026-11-06",
  now: NOW,
  tz: TZ,
  userId: null,
  statuses: STATUSES,
  demands: [],
  videos: [],
  activity: [],
  work: [],
  users: [
    { id: "ana", name: "Ana" },
    { id: "bia", name: "Bia" },
  ],
  trackingReady: true,
  ...extra,
});

describe("calendário do painel", () => {
  it("semana começa na segunda", () => {
    expect(weekdayOf("2026-11-02")).toBe(0); // segunda
    expect(weekdayOf("2026-11-08")).toBe(6); // domingo
    expect(weekStart("2026-11-08")).toBe("2026-11-02");
  });

  it("hora UTC vira dia e hora de São Paulo", () => {
    // 01h UTC de terça = 22h de segunda em São Paulo
    expect(localSlot("2026-11-03T01:00:00Z", TZ)).toEqual({ day: "2026-11-02", weekday: 0, hour: 22 });
  });
});

describe("batimento do editor", () => {
  it("duas abas não contam o mesmo minuto duas vezes", () => {
    const beats = new Map<string, number>();
    const t0 = 1_000_000;
    expect(clampBeat("ana", 60, t0, beats)).toBe(60);
    // outra aba manda 60 s só 30 s depois: vale ~30
    expect(clampBeat("ana", 60, t0 + 30_000, beats)).toBe(32);
    // valor absurdo nunca passa do teto
    expect(clampBeat("ana", 5000, t0 + 3_600_000, beats)).toBe(90);
    expect(clampBeat("bia", -5, t0, beats)).toBe(0);
  });
});

describe("desempenho por período", () => {
  const activity = [
    // segunda: 2 h no p1 (ana)
    act("ana", "p1", "2026-11-02T13:00:00Z", 3600),
    act("ana", "p1", "2026-11-02T14:00:00Z", 3600),
    // terça: 30 min no p2 (ana) + 1 h no p3 (bia)
    act("ana", "p2", "2026-11-03T13:00:00Z", 1800),
    act("bia", "p3", "2026-11-03T15:00:00Z", 3600),
    // quinta: 3 h no p2 (ana)
    act("ana", "p2", "2026-11-05T12:00:00Z", 3600),
    act("ana", "p2", "2026-11-05T13:00:00Z", 3600),
    act("ana", "p2", "2026-11-05T14:00:00Z", 3600),
  ];
  const videos = [
    video("d1", { projectId: "p1", deliveredAt: "2026-11-03T18:00:00Z" }),
    video("d2", { projectId: "p2", deliveredAt: "2026-11-05T19:00:00Z" }),
    video("d3", { projectId: "p3" }),
  ];
  const demands = [
    demand("d1", { dueDate: "2026-11-04" }),
    // data definida 6 h depois do pedido; prazo vencido na entrega
    demand("d2", { dueDate: "2026-11-04" }),
    demand("d3", { status: "Aguardando Definição de Data", warCreatedAt: "2026-10-30T12:00:00Z" }),
    demand("d4", { status: "Concluído" }),
  ];
  const work = [
    ev("render", "2026-11-03T17:00:00Z", { projectId: "p1" }),
    ev("render", "2026-11-03T17:30:00Z", { projectId: "p1" }), // re-render
    ev("render", "2026-11-05T18:00:00Z", { projectId: "p2" }),
    ev("render", "2026-11-05T18:10:00Z", { projectId: "p2", ok: false }),
    // d1 chegou com data; d2 ganhou data 6 h depois do pedido
    ev("due-date", "2026-11-02T12:00:30Z", { demandId: "d1", userId: null }),
    ev("due-date", "2026-11-02T18:00:00Z", { demandId: "d2", userId: null }),
  ];
  const report = buildPerformanceReport(base({ activity, videos, demands, work }));

  it("soma o tempo real e conta vídeos editados, renderizados e entregues", () => {
    expect(report.totals).toMatchObject({
      editSeconds: 7200 + 1800 + 3600 + 10800,
      daysWorked: 3,
      videosEdited: 3,
      rendered: 2,
      renders: 3,
      delivered: 2,
      demandsDelivered: 2,
    });
    expect(report.trackingSince).toBe("2026-11-02");
  });

  it("série diária com os dias sem atividade em zero", () => {
    expect(report.daily.map((d) => d.editSeconds)).toEqual([7200, 5400, 0, 10800, 0]);
    expect(report.daily[1]).toMatchObject({ videosEdited: 2, rendered: 1, delivered: 1 });
  });

  it("dias mais e menos produtivos (menos: só dias úteis já terminados)", () => {
    expect(report.best.map((d) => d.day)).toEqual(["2026-11-05", "2026-11-02", "2026-11-03"]);
    // quarta parada; sexta (hoje) ainda não acabou
    expect(report.worst.map((d) => d.day)).toEqual(["2026-11-04"]);
  });

  it("mapa de calor em hora local", () => {
    // 13h UTC = 10h em São Paulo, na segunda
    expect(report.heatmap[0][10]).toBe(3600);
    expect(report.heatmap[3][9]).toBe(3600);
  });

  it("filtro por pessoa: tempo pelo autor, entregas pelo dono do projeto", () => {
    const bia = buildPerformanceReport(base({ activity, videos, demands, work, userId: "bia" }));
    expect(bia.totals).toMatchObject({ editSeconds: 3600, videosEdited: 1, delivered: 0, renders: 0 });
    const ana = buildPerformanceReport(base({ activity, videos, demands, work, userId: "ana" }));
    expect(ana.totals.delivered).toBe(2);
    expect(ana.byEditor.map((e) => e.name)).toEqual(["Ana", "Bia"]);
  });

  it("tempo de cada demanda: pedido → data definida → entrega", () => {
    const [d2, d1] = report.demands.rows;
    expect(d2).toMatchObject({ demandId: "d2", dateSetHours: 6, cameWithDate: false, onTime: false, lateDays: 1 });
    expect(d2.editSeconds).toBe(1800 + 10800);
    expect(d1).toMatchObject({ demandId: "d1", cameWithDate: true, dateSetHours: null, onTime: true });
    // só d2 entra na média de "definir data" (d1 chegou com data)
    expect(report.demands).toMatchObject({ avgDateSetHours: 6, dateSetSample: 1, onTimeRate: 0.5, waitingDate: 1 });
    expect(report.demands.oldestWaitingDays).toBe(7);
  });

  it("tempo médio por vídeo entregue usa todo o tempo do projeto", () => {
    expect(report.perVideo).toEqual({ avgEditSeconds: Math.round((7200 + 12600) / 2), sample: 2 });
  });

  it("antes da medição os dias não entram nas médias", () => {
    const later = buildPerformanceReport(
      base({ activity: activity.filter((a) => a.hour >= "2026-11-05"), videos, demands, work })
    );
    expect(later.trackingSince).toBe("2026-11-05");
    expect(later.daily.filter((d) => d.tracked).map((d) => d.day)).toEqual(["2026-11-05", "2026-11-06"]);
    expect(later.worst).toEqual([]);
  });

  it("compara com o período anterior do mesmo tamanho", () => {
    expect(report.previous).toMatchObject({ from: "2026-10-28", to: "2026-11-01", editSeconds: 0 });
  });
});
