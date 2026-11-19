import { describe, expect, it } from "vitest";
import { authorResolver } from "../src/demands/dashboard";
import type { DemandVideo, EditActivity, WorkEvent } from "../src/demands/types";
import { buildPresence, leavePresence, notePresence, PRESENCE_TTL_MS, type PresenceBeat } from "../src/presence";

const start = (projectId: string, userName: string, userId: string | null, at = "2026-11-01T12:00:00Z"): WorkEvent => ({
  id: 1,
  kind: "start",
  userId,
  userName,
  projectId,
  demandId: null,
  ok: true,
  seconds: null,
  detail: null,
  createdAt: at,
});
const act = (userId: string, projectId: string, seconds: number): EditActivity =>
  ({ userId, projectId, hour: "2026-11-01T12:00:00Z", seconds }) as EditActivity;
const vid = (extra: Partial<DemandVideo> = {}): DemandVideo => ({
  demandId: "d1",
  index: 1,
  projectId: "p1",
  driveFileId: null,
  driveFileUrl: null,
  deliveredAt: null,
  updatedAt: "2026-11-01T12:00:00Z",
  ...extra,
});
const users = [
  { id: "u1", name: "Ana" },
  { id: "u2", name: "Bruno" },
];

describe("autoria das edições no painel", () => {
  it("edição automática é do Vision; quem ajustou depois aparece junto", () => {
    const authorOf = authorResolver({
      starts: [start("p1", "Vision", null)],
      activity: [act("u2", "p1", 600), act("u1", "p1", 30)],
      users,
    });
    // Ana só abriu (30 s): não conta; Bruno editou 10 min
    expect(authorOf("p1", vid({ auto: { status: "done" } as DemandVideo["auto"] }))).toEqual({
      startedBy: { kind: "vision" },
      editors: ["Bruno"],
    });
    // sem o registro de start, o `auto` do vídeo basta; alteração manual entra sem repetir
    const noStart = authorResolver({ starts: [], activity: [act("u2", "p1", 600)], users });
    expect(
      noStart("p1", vid({ auto: { status: "done" } as DemandVideo["auto"], manualEdit: { firstAt: "", lastAt: "", by: ["Bruno", "Carla"] } }))
    ).toEqual({ startedBy: { kind: "vision" }, editors: ["Bruno", "Carla"] });
  });

  it("projeto subido por alguém: a pessoa começou; outras que editaram vêm por tempo, sem repetir quem começou", () => {
    const authorOf = authorResolver({
      starts: [start("p1", "Ana", "u1")],
      activity: [act("u1", "p1", 3000), act("u2", "p1", 120)],
      users,
    });
    expect(authorOf("p1", vid())).toEqual({ startedBy: { kind: "user", name: "Ana" }, editors: ["Bruno"] });
  });

  it("sem registro de começo: só quem editou; sem nada, null", () => {
    const authorOf = authorResolver({ starts: [], activity: [act("u2", "p9", 900)], users });
    expect(authorOf("p9")).toEqual({ startedBy: null, editors: ["Bruno"] });
    expect(authorOf("p0")).toEqual({ startedBy: null, editors: [] });
    expect(authorOf(null)).toEqual({ startedBy: null, editors: [] });
  });
});

describe("presença", () => {
  const lookup = {
    demands: [{ id: "d1", title: "Reels de novembro", clientName: "Clínica Sol" }],
    videos: [{ demandId: "d1", index: 2, projectId: "reels-02" }],
  };
  const ana = { id: "u1", name: "Ana" };
  const bruno = { id: "u2", name: "Bruno" };

  it("diz onde cada um está, com o título da demanda e o vídeo", () => {
    const tabs = new Map<string, PresenceBeat>();
    notePresence(ana, { tabId: "a", view: "editor", projectId: "reels-02", active: true }, 1_000, tabs);
    notePresence(bruno, { tabId: "b", view: "painel", active: false }, 1_000, tabs);
    const list = buildPresence([...tabs.values()], 2_000, lookup);
    expect(list.map((u) => u.name)).toEqual(["Ana", "Bruno"]);
    expect(list[0]).toMatchObject({
      active: true,
      places: [{ label: "Editando", detail: "Reels de novembro · vídeo 02 — Clínica Sol", demandId: "d1", projectId: "reels-02" }],
    });
    expect(list[1]).toMatchObject({ active: false, lastActiveAt: null, places: [{ label: "No painel", detail: null }] });
  });

  it("projeto avulso, demanda aberta e várias abas da mesma pessoa (a em uso primeiro)", () => {
    const tabs = new Map<string, PresenceBeat>();
    notePresence(ana, { tabId: "a", view: "demanda", demandId: "d1", active: false }, 1_000, tabs);
    notePresence(ana, { tabId: "b", view: "editor", projectId: "teste", active: true }, 1_500, tabs);
    notePresence(ana, { tabId: "c", view: "editor", projectId: "teste", active: false }, 1_500, tabs);
    const [u] = buildPresence([...tabs.values()], 2_000, lookup);
    expect(u.places.map((p) => [p.label, p.detail])).toEqual([
      ["Editando", "teste (avulso)"],
      ["Vendo a demanda", "Reels de novembro — Clínica Sol"],
    ]);
  });

  it("aba sem batimento sai depois do prazo; fechar a aba sai na hora; tela nova zera o 'desde'", () => {
    const tabs = new Map<string, PresenceBeat>();
    notePresence(ana, { tabId: "a", view: "painel", active: true }, 0, tabs);
    expect(notePresence(ana, { tabId: "a", view: "painel", active: false }, 10_000, tabs)).toMatchObject({ since: 0, activeAt: 0 });
    expect(notePresence(ana, { tabId: "a", view: "demandas", active: false }, 20_000, tabs)?.since).toBe(20_000);
    expect(buildPresence([...tabs.values()], 20_000 + PRESENCE_TTL_MS + 1, lookup)).toEqual([]);
    notePresence(bruno, { tabId: "b", view: "painel", active: true }, 30_000, tabs);
    leavePresence("u2", "b", tabs);
    expect(buildPresence([...tabs.values()], 30_001, lookup).map((u) => u.name)).toEqual(["Ana"]);
  });

  it("batimento sem aba ou com tela desconhecida é ignorado", () => {
    const tabs = new Map<string, PresenceBeat>();
    expect(notePresence(ana, { view: "painel" }, 0, tabs)).toBeNull();
    expect(notePresence(ana, { tabId: "a", view: "admin" }, 0, tabs)).toBeNull();
    expect(tabs.size).toBe(0);
  });
});
