import { describe, expect, it, vi } from "vitest";

// render de mentira: cada um termina quando o teste manda
const finishers: (() => void)[] = [];
vi.mock("../src/render/renderJob", () => ({
  renderRecipe: (recipe: { projectId: string }, onProgress?: (f: number) => void) =>
    new Promise<{ outputPath: string }>((resolve) => {
      onProgress?.(0.5);
      finishers.push(() => resolve({ outputPath: `/x/media/projects/${recipe.projectId}/renders/r.mp4` }));
    }),
}));
vi.mock("../src/project", () => ({ loadRecipe: (projectId: string) => ({ projectId }) }));
// o painel de desempenho não grava nada durante o teste
vi.mock("../src/demands/tracking", () => ({ recordWork: async () => {} }));

const { activeJobFor, enqueueRender, getJob, isRendering } = await import("../src/render/queue");
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("fila de render", () => {
  it("clicar de novo enquanto espera não enfileira outro render do mesmo vídeo", async () => {
    const a = enqueueRender("p1");
    await tick();
    expect(getJob(a.id)).toMatchObject({ status: "rendering", progress: 0.5 });

    // p2 espera atrás de p1; o 2º clique em p2 devolve o mesmo job
    const b1 = enqueueRender("p2");
    const b2 = enqueueRender("p2");
    expect(b2.id).toBe(b1.id);
    expect(b1).toMatchObject({ status: "queued", ahead: 1 });

    // p1 já renderizando: entra um novo (edições feitas depois), mas só um
    const a2 = enqueueRender("p1");
    const a3 = enqueueRender("p1");
    expect(a2.id).not.toBe(a.id);
    expect(a3.id).toBe(a2.id);
    expect(getJob(a2.id)!.ahead).toBe(2);

    // o editor reaberto acha o render mais recente ainda ativo
    expect(activeJobFor("p1")!.id).toBe(a2.id);
    expect(activeJobFor("p3")).toBeNull();

    finishers.shift()!();
    await tick();
    await tick();
    expect(getJob(a.id)).toMatchObject({ status: "done", progress: 1 });
    expect(getJob(b1.id)).toMatchObject({ status: "rendering" });
    expect(getJob(a2.id)!.ahead).toBe(1);

    finishers.shift()!();
    await tick();
    await tick();
    finishers.shift()!();
    await tick();
    await tick();
    expect(isRendering("p1")).toBe(false);
    expect(isRendering("p2")).toBe(false);
    expect(getJob("job_que_nao_existe")).toBeUndefined();
  });
});
