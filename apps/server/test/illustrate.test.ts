import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  deleteIllustration,
  generateIllustration,
  listIllustrations,
  MAX_GENERATIONS_PER_PROJECT,
} from "../src/creative/illustrate";
import { fromRecipePath, projectDir } from "../src/paths";

/** Magnific simulada: cria a tarefa, responde IN_PROGRESS uma vez e depois entrega a imagem */
function fakeMagnific() {
  const calls: { url: string; method: string; body?: any; key?: string }[] = [];
  let polls = 0;
  const impl = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined, key: headers["x-magnific-api-key"] });
    if (url.startsWith("https://cdn.test/")) {
      return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { headers: { "content-type": "image/jpeg" } });
    }
    if (method === "POST") return Response.json({ data: { task_id: `t${calls.length}`, status: "CREATED", generated: [] } });
    polls++;
    return Response.json(
      polls % 2 === 1
        ? { data: { task_id: "t", status: "IN_PROGRESS", generated: [] } }
        : { data: { task_id: "t", status: "COMPLETED", generated: [`https://cdn.test/img-${polls}.jpg`] } }
    );
  }) as typeof fetch;
  return { impl, calls };
}

describe("ilustração na Magnific", () => {
  const id = `__test-illus-${Date.now().toString(36)}`;
  const prevKey = process.env.MAGNIFIC_API_KEY;
  beforeAll(() => {
    process.env.MAGNIFIC_API_KEY = "chave-de-teste";
    fs.mkdirSync(projectDir(id), { recursive: true });
  });
  afterAll(() => {
    fs.rmSync(projectDir(id), { recursive: true, force: true });
    if (prevKey === undefined) delete process.env.MAGNIFIC_API_KEY;
    else process.env.MAGNIFIC_API_KEY = prevKey;
  });

  it("pede 1:1 em 1K, espera a tarefa e baixa a imagem para os assets do projeto", async () => {
    const api = fakeMagnific();
    const r = await generateIllustration(id, "celular com mensagem de ameaça", { fetchImpl: api.impl, pollMs: 1 });
    expect(r.cached).toBe(false);
    expect(r.file).toMatch(new RegExp(`^media/projects/${id}/assets/illus-[0-9a-f]{12}\\.jpg$`));
    expect(fs.existsSync(fromRecipePath(r.file))).toBe(true);
    const post = api.calls.find((c) => c.method === "POST")!;
    expect(post.url).toBe("https://api.magnific.com/v1/ai/text-to-image/nano-banana-pro-flash");
    expect(post.body).toMatchObject({ aspect_ratio: "1:1", resolution: "1K" });
    expect(post.body.prompt).toMatch(/celular com mensagem de ameaça/);
    expect(post.key).toBe("chave-de-teste");
    expect(api.calls.filter((c) => c.method === "GET" && c.url.includes("/nano-banana-pro-flash/")).length).toBe(2);
  });

  it("mesma descrição reaproveita sem gastar crédito; 'outra' gera de novo", async () => {
    const api = fakeMagnific();
    const again = await generateIllustration(id, "celular com mensagem de ameaça", { fetchImpl: api.impl, pollMs: 1 });
    expect(again.cached).toBe(true);
    expect(api.calls).toHaveLength(0);
    const fresh = await generateIllustration(id, "celular com mensagem de ameaça", { fresh: true, fetchImpl: api.impl, pollMs: 1 });
    expect(fresh.cached).toBe(false);
    expect(fresh.file).not.toBe(again.file);
  });

  it("falha da tarefa vira erro legível; teto de gerações por projeto", async () => {
    const failing = (async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? Response.json({ data: { task_id: "x", status: "CREATED", generated: [] } })
        : Response.json({ data: { task_id: "x", status: "FAILED", generated: [] } })) as typeof fetch;
    await expect(generateIllustration(id, "martelo de juiz", { fetchImpl: failing, pollMs: 1 })).rejects.toThrow(/não conseguiu gerar/);

    const index = JSON.parse(fs.readFileSync(`${projectDir(id)}/illustrations.json`, "utf8"));
    const full = Array.from({ length: MAX_GENERATIONS_PER_PROJECT }, (_, i) => ({ ...index[0], hash: `h${i}` }));
    fs.writeFileSync(`${projectDir(id)}/illustrations.json`, JSON.stringify(full));
    await expect(generateIllustration(id, "outra coisa", { fetchImpl: fakeMagnific().impl, pollMs: 1 })).rejects.toThrow(/limite/);
  });
});

describe("controle das imagens geradas", () => {
  const id = `__test-illus-ctl-${Date.now().toString(36)}`;
  const prevKey = process.env.MAGNIFIC_API_KEY;
  beforeAll(() => {
    process.env.MAGNIFIC_API_KEY = "chave-de-teste";
    fs.mkdirSync(projectDir(id), { recursive: true });
  });
  afterAll(() => {
    fs.rmSync(projectDir(id), { recursive: true, force: true });
    if (prevKey === undefined) delete process.env.MAGNIFIC_API_KEY;
    else process.env.MAGNIFIC_API_KEY = prevKey;
  });

  it("lista as geradas (mais nova primeiro); apagar só as fora de uso; apagada continua contando no teto", async () => {
    const a = await generateIllustration(id, "martelo de juiz", { fetchImpl: fakeMagnific().impl, pollMs: 1 });
    const b = await generateIllustration(id, "contrato assinado", { fetchImpl: fakeMagnific().impl, pollMs: 1 });
    let list = listIllustrations(id);
    expect(list.items.map((i) => i.subject)).toEqual(["contrato assinado", "martelo de juiz"]);
    expect(list).toMatchObject({ generated: 2, limit: MAX_GENERATIONS_PER_PROJECT });
    expect(() => deleteIllustration(id, a.file, new Set([a.file]))).toThrow(/em uso/);
    deleteIllustration(id, a.file, new Set([b.file]));
    expect(fs.existsSync(fromRecipePath(a.file))).toBe(false);
    list = listIllustrations(id);
    expect(list.items.map((i) => i.file)).toEqual([b.file]);
    expect(list.generated).toBe(2);
    // a mesma descrição de uma apagada gera de novo (não reaproveita arquivo que sumiu)
    const again = await generateIllustration(id, "martelo de juiz", { fetchImpl: fakeMagnific().impl, pollMs: 1 });
    expect(again.cached).toBe(false);
  });
});
