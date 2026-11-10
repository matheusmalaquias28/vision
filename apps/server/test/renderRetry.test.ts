import { afterEach, describe, expect, it } from "vitest";
import {
  BROWSER_SETUP_MESSAGE,
  isBrowserSetupError,
  renderTimeoutMs,
  withBrowserRetry,
} from "../src/render/renderJob";

const setupError = () =>
  new Error(
    "Timed out after 30000ms while setting up the headless browser.\nThis could be because the you specified takes a long time to load"
  );

describe("render: Chrome que não abre a tempo", () => {
  afterEach(() => {
    delete process.env.RENDER_TIMEOUT_MS;
  });

  it("limite padrão de 90 s; RENDER_TIMEOUT_MS troca (abaixo de 10 s é ignorado)", () => {
    expect(renderTimeoutMs()).toBe(90_000);
    process.env.RENDER_TIMEOUT_MS = "120000";
    expect(renderTimeoutMs()).toBe(120_000);
    process.env.RENDER_TIMEOUT_MS = "500";
    expect(renderTimeoutMs()).toBe(90_000);
  });

  it("reconhece só a falha de abrir o navegador", () => {
    expect(isBrowserSetupError(setupError())).toBe(true);
    expect(isBrowserSetupError(new Error("ENOENT: source-x.mp4"))).toBe(false);
  });

  it("tenta de novo uma vez e segue se a 2ª abrir", async () => {
    let calls = 0;
    const retries: number[] = [];
    const out = await withBrowserRetry(
      async () => {
        calls++;
        if (calls === 1) throw setupError();
        return "ok";
      },
      { waitMs: 0, onRetry: (a) => retries.push(a) }
    );
    expect(out).toBe("ok");
    expect(calls).toBe(2);
    expect(retries).toEqual([1]);
  });

  it("esgotadas as tentativas, a mensagem sai em português (original em cause)", async () => {
    let calls = 0;
    const err = await withBrowserRetry(
      async () => {
        calls++;
        throw setupError();
      },
      { waitMs: 0 }
    ).catch((e: Error) => e);
    expect(calls).toBe(2);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe(BROWSER_SETUP_MESSAGE);
    expect(((err as Error).cause as Error).message).toMatch(/headless browser/);
  });

  it("erro do projeto não repete", async () => {
    let calls = 0;
    await expect(
      withBrowserRetry(
        async () => {
          calls++;
          throw new Error("mídia faltando");
        },
        { waitMs: 0 }
      )
    ).rejects.toThrow("mídia faltando");
    expect(calls).toBe(1);
  });
});
