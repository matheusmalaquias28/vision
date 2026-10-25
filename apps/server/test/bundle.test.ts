import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { mediaDir, repoRoot } from "../src/paths";
import { cleanupStaleRemotionTemp, freeTempBytes, syncBundleMedia } from "../src/render/bundle";

const tmp = os.tmpdir();
const made: string[] = [];
function fake(name: string, owner?: number, ageHours = 0): string {
  const dir = path.join(tmp, name);
  fs.mkdirSync(path.join(dir, "public"), { recursive: true });
  fs.writeFileSync(path.join(dir, "public", "video.mp4"), Buffer.alloc(1024));
  if (owner !== undefined) fs.writeFileSync(path.join(dir, ".vision-owner"), String(owner));
  if (ageHours > 0) {
    const t = new Date(Date.now() - ageHours * 3600_000);
    fs.utimesSync(dir, t, t);
  }
  made.push(dir);
  return dir;
}
afterAll(() => {
  for (const d of made) fs.rmSync(d, { recursive: true, force: true });
});

describe("limpeza dos temporários do Remotion", () => {
  it("apaga bundle de processo morto na hora; não mexe no de processo vivo nem no recém-criado sem dono", () => {
    const dead = fake(`remotion-webpack-bundle-vtest-dead-${process.pid}`, 2_147_000_000);
    const alive = fake(`remotion-webpack-bundle-vtest-alive-${process.pid}`, process.ppid);
    const fresh = fake(`remotion-webpack-bundle-vtest-fresh-${process.pid}`);
    const oldAssets = fake(`remotion-v4.0.519-assetsvtest${process.pid}`, undefined, 3);

    // simulação: conta, mas não apaga
    const dry = cleanupStaleRemotionTemp({ dryRun: true });
    expect(dry.removed).toBeGreaterThanOrEqual(2);
    expect(dry.bytes).toBeGreaterThanOrEqual(2048);
    expect(fs.existsSync(dead)).toBe(true);

    cleanupStaleRemotionTemp();
    expect(fs.existsSync(dead)).toBe(false);
    expect(fs.existsSync(oldAssets)).toBe(false);
    expect(fs.existsSync(alive)).toBe(true);
    expect(fs.existsSync(fresh)).toBe(true);
  });

  it("mede o espaço livre do disco temporário", () => {
    const free = freeTempBytes();
    expect(free === null || free > 0).toBe(true);
  });
});

describe("mídia nova no bundle (Windows copia media/ quando o bundle nasce)", () => {
  const proj = path.join(mediaDir, "projects", `__teste-sync-${Date.now().toString(36)}`);
  afterAll(() => fs.rmSync(proj, { recursive: true, force: true }));

  it("copia o que falta ou mudou; o que já está igual fica; link (Linux) não mexe", () => {
    const bundleDir = fake(`remotion-webpack-bundle-sync-${Date.now()}`);
    fs.mkdirSync(path.join(proj, "assets"), { recursive: true });
    const file = path.join(proj, "assets", "illus-x.png");
    fs.writeFileSync(file, Buffer.alloc(64));
    const rel = path.relative(repoRoot, file).split(path.sep).join("/");

    expect(syncBundleMedia(bundleDir, [rel, "media/nao-existe.png", "outro/arquivo.png"])).toBe(1);
    const copy = path.join(bundleDir, "public", ...rel.slice("media/".length).split("/"));
    expect(fs.statSync(copy).size).toBe(64);
    expect(syncBundleMedia(bundleDir, [rel])).toBe(0);
    fs.writeFileSync(file, Buffer.alloc(128));
    expect(syncBundleMedia(bundleDir, [rel])).toBe(1);
    expect(fs.statSync(copy).size).toBe(128);
  });
});
