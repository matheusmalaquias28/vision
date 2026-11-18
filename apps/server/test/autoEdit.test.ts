import { describe, expect, it } from "vitest";
import {
  armAutoEdit,
  AUTO_EDIT_DELAY_MS,
  planClips,
  SETTLE_MS,
  videoItemsFrom,
  videoLinksFrom,
} from "../src/demands/autoEditRules";
import type { DriveFile } from "../src/demands/drive";
import type { AutoEdit } from "../src/demands/types";

const NOW = new Date("2026-11-18T15:00:00Z");
const LINK = "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp";
const MB = 1024 * 1024;

const file = (path: string, over: Partial<DriveFile> = {}): DriveFile => ({
  id: path,
  name: path.split("/").at(-1)!,
  path,
  mimeType: "video/mp4",
  size: 50 * MB,
  durationSeconds: 20,
  modifiedTime: "2026-11-18T14:00:00Z",
  ...over,
});

describe("videoItemsFrom (payload do War)", () => {
  it("lê videos[] com numero, titulo e driveClipes", () => {
    const body = {
      quantidadeVideos: 2,
      videos: [
        { numero: 2, titulo: "Vídeo 2", driveClipes: `${LINK}2` },
        { numero: 1, titulo: "Vídeo 1", driveClipes: `${LINK}1` },
      ],
    };
    expect(videoItemsFrom(body, 2)).toEqual([
      { link: `${LINK}1`, title: "Vídeo 1" },
      { link: `${LINK}2`, title: "Vídeo 2" },
    ]);
  });

  it("lista vazia = demanda antiga: sem link por vídeo (driveMateriais não entra)", () => {
    const body = { quantidadeVideos: 2, videos: [], driveMateriais: LINK };
    expect(videoLinksFrom(body, 2)).toEqual([null, null]);
  });

  it("sem numero usa a posição; item a mais que a quantidade fica de fora", () => {
    expect(videoLinksFrom({ videos: [{ driveClipes: "a1234567890" }, { driveClipes: "b1234567890" }] }, 1)).toEqual([
      "a1234567890",
    ]);
  });

  it("aceita lista de links", () => {
    expect(videoLinksFrom({ linksVideos: [LINK, ""] }, 2)).toEqual([LINK, null]);
  });
});

describe("armAutoEdit", () => {
  const empty = { projectId: null, deliveredAt: null, auto: null };

  it("arma 10 min depois do pedido", () => {
    const a = armAutoEdit(empty, LINK, NOW.toISOString(), NOW)!;
    expect(a.status).toBe("waiting");
    expect(Date.parse(a.notBefore) - NOW.getTime()).toBe(AUTO_EDIT_DELAY_MS);
  });

  it("não mexe em vídeo com projeto, entregue ou sem link", () => {
    expect(armAutoEdit({ ...empty, projectId: "p" }, LINK, null, NOW)).toBeNull();
    expect(armAutoEdit({ ...empty, deliveredAt: NOW.toISOString() }, LINK, null, NOW)).toBeNull();
    expect(armAutoEdit(empty, null, null, NOW)).toBeNull();
  });

  it("atualização do War com o mesmo link não rearma; link novo rearma o erro", () => {
    const done = { ...armAutoEdit(empty, LINK, null, NOW)!, status: "done" } as AutoEdit;
    expect(armAutoEdit({ ...empty, auto: done }, LINK, null, NOW)).toBeNull();
    const failed = { ...done, status: "error" } as AutoEdit;
    expect(armAutoEdit({ ...empty, auto: failed }, LINK, null, NOW)).toBeNull();
    expect(armAutoEdit({ ...empty, auto: failed }, `${LINK}x`, null, NOW)?.status).toBe("waiting");
  });

  it("na fila com link trocado: troca o link e mantém o horário", () => {
    const waiting = armAutoEdit(empty, LINK, null, NOW)!;
    const later = new Date(NOW.getTime() + 60_000);
    const next = armAutoEdit({ ...empty, auto: waiting }, `${LINK}x`, null, later)!;
    expect(next.link).toBe(`${LINK}x`);
    expect(next.notBefore).toBe(waiting.notBefore);
  });
});

describe("planClips (organizar os brutos)", () => {
  it("ordem natural pelo caminho, só vídeo", () => {
    const plan = planClips(
      [file("C0010.MP4"), file("C0002.MP4"), file("capa.png", { mimeType: "image/png" }), file("Dia 2/A.mp4"), file("Dia 10/A.mp4")],
      NOW
    );
    expect(plan.take.map((f) => f.path)).toEqual(["C0002.MP4", "C0010.MP4", "Dia 2/A.mp4", "Dia 10/A.mp4"]);
    expect(plan.skipped).toEqual([{ name: "capa.png", reason: "não é vídeo" }]);
    expect(plan.settling).toBe(false);
  });

  it("mesmos limites do envio manual (1 GB, 3 min)", () => {
    const plan = planClips([file("a.mp4", { size: 2048 * MB }), file("b.mp4", { durationSeconds: 400 }), file("c.mp4")], NOW);
    expect(plan.take.map((f) => f.name)).toEqual(["c.mp4"]);
    expect(plan.skipped.map((s) => s.name)).toEqual(["a.mp4", "b.mp4"]);
  });

  it("arquivo mexido há pouco = ainda subindo", () => {
    const recent = new Date(NOW.getTime() - SETTLE_MS / 2).toISOString();
    expect(planClips([file("a.mp4", { modifiedTime: recent })], NOW).settling).toBe(true);
  });
});
