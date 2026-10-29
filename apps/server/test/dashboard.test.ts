import { describe, expect, it } from "vitest";
import { buildDayReport, dayOf, isDoneStatus, shiftDay } from "../src/demands/dashboard";
import type { Demand, DemandEvent, DemandVideo } from "../src/demands/types";

const STATUSES = ["Aguardando Definição de Data", "Em Fila", "Aprovação do Gestor", "Concluído"];
const TZ = "America/Sao_Paulo";
// 29/10 às 18h em São Paulo (21h UTC)
const NOW = new Date("2026-10-29T21:00:00Z");

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
  warCreatedAt: "2026-10-20T13:00:00Z",
  warUpdatedAt: null,
  statusChangedAt: "2026-10-29T13:00:00Z",
  syncState: "ok",
  syncError: null,
  raw: null,
  createdAt: "2026-10-20T13:00:00Z",
  updatedAt: "2026-10-20T13:00:00Z",
  ...extra,
});

const video = (demandId: string, extra: Partial<DemandVideo> = {}): DemandVideo => ({
  demandId,
  index: 1,
  projectId: null,
  driveFileId: null,
  driveFileUrl: null,
  deliveredAt: null,
  updatedAt: "2026-10-20T13:00:00Z",
  ...extra,
});

const statusEvent = (id: number, demandId: string, status: string, at: string, by = "Ana"): DemandEvent => ({
  id,
  demandId,
  direction: "out",
  kind: "status",
  status,
  previousStatus: null,
  by,
  payload: null,
  ok: true,
  error: null,
  attempts: 1,
  createdAt: at,
});

describe("dias no fuso do painel", () => {
  it("23h de São Paulo ainda é o mesmo dia (já é o seguinte em UTC)", () => {
    expect(dayOf("2026-10-30T02:00:00Z", TZ)).toBe("2026-10-29");
    expect(shiftDay("2026-11-01", -1)).toBe("2026-10-31");
  });
  it("status final pelo último da lista ou pelo nome", () => {
    expect(isDoneStatus("Concluído", STATUSES)).toBe(true);
    expect(isDoneStatus("Em Fila", STATUSES)).toBe(false);
  });
});

describe("buildDayReport", () => {
  const demands = [
    // entregue hoje: criada 20/10, entregue 29/10 com prazo 30/10 → no prazo, 9 dias
    demand("d1", { status: "Aprovação do Gestor", dueDate: "2026-10-30" }),
    // atrasada e parada
    demand("d2", { dueDate: "2026-10-27", statusChangedAt: "2026-10-22T13:00:00Z" }),
    // vence amanhã e não começou
    demand("d3", { dueDate: "2026-10-30" }),
    // sem data há dias, comentário do War sem resposta
    demand("d4", {
      status: "Aguardando Definição de Data",
      notas: [{ texto: "e aí?", autor: "Gestor", criadoEm: "2026-10-29T10:00:00Z", origem: "war" }],
    }),
    // concluída hoje, nova hoje
    demand("d5", { status: "Concluído", warCreatedAt: "2026-10-29T12:00:00Z" }),
  ];
  const videos = [
    video("d1", { projectId: "p1", deliveredAt: "2026-10-29T20:00:00Z" }),
    video("d2", { projectId: "p2" }),
    video("d3"),
    video("d4"),
    video("d5"),
  ];
  const projects = [
    { id: "p1", createdAt: "2026-10-29T15:00:00Z", analysisError: null },
    { id: "p2", createdAt: "2026-10-25T15:00:00Z", analysisError: "falhou" },
    { id: "avulso", createdAt: "2026-10-29T16:00:00Z", analysisError: null },
  ];
  const events = [
    statusEvent(1, "d5", "Concluído", "2026-10-29T14:00:00Z"),
    statusEvent(2, "d1", "Aprovação do Gestor", "2026-10-29T20:00:00Z"),
    statusEvent(3, "d2", "Em Fila", "2026-10-22T13:00:00Z"),
  ];
  const report = buildDayReport({ day: "2026-10-29", now: NOW, statuses: STATUSES, demands, videos, events, projects, tz: TZ });

  it("números do dia", () => {
    expect(report.isToday).toBe(true);
    expect(report.kpis).toMatchObject({
      openDemands: 4,
      newDemands: 1,
      editsStarted: 2,
      editsStartedLoose: 1,
      videosDelivered: 1,
      demandsDelivered: 1,
      demandsCompleted: 1,
      overdue: 1,
      onTimeRate: 1,
      averageSample: 1,
    });
    // 20/10 13h → 29/10 20h = 9,3 dias; edição de 15h a 20h = 5 h
    expect(report.kpis.avgLeadDays).toBe(9.3);
    expect(report.kpis.avgEditHours).toBe(5);
  });

  it("pontos de atenção, os graves primeiro", () => {
    const kinds = report.attention.map((a) => `${a.demandId}:${a.kind}`);
    expect(kinds).toEqual(
      expect.arrayContaining([
        "d2:overdue",
        "d2:stale",
        "d2:analysis-error",
        "d3:due-soon-not-started",
        "d4:no-date",
        "d4:unanswered",
      ])
    );
    expect(kinds).not.toContain("d1:overdue");
    const firstMid = report.attention.findIndex((a) => a.severity === "mid");
    expect(report.attention.slice(firstMid).every((a) => a.severity === "mid")).toBe(true);
  });

  it("status de agora e entradas do dia; quem mexeu", () => {
    expect(report.statusBoard.find((s) => s.status === "Concluído")).toMatchObject({ open: 1, enteredToday: 1 });
    expect(report.statusBoard.find((s) => s.status === "Em Fila")).toMatchObject({ open: 2, enteredToday: 0 });
    expect(report.activity).toEqual([{ name: "Ana", statusMoves: 2, comments: 0 }]);
    expect(report.started.map((s) => s.clientName)).toEqual(["Cliente", "Projeto avulso"]);
  });

  it("dia passado: só o que aconteceu nele", () => {
    const past = buildDayReport({ day: "2026-10-22", now: NOW, statuses: STATUSES, demands, videos, events, projects, tz: TZ });
    expect(past.isToday).toBe(false);
    expect(past.kpis.videosDelivered).toBe(0);
    expect(past.statusBoard.find((s) => s.status === "Em Fila")?.enteredToday).toBe(1);
  });
});
