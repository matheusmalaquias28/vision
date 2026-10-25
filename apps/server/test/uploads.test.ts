import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ffmpegPath, runOrThrow } from "../src/pipeline/ffbin";
import { checkClipUpload } from "../src/uploads";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vision-upload-check-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Arquivo como o multer entrega (caminho temporário + nome original) */
const multerFile = (p: string, originalname: string, mimetype: string, size = fs.statSync(p).size) =>
  ({ path: p, originalname, mimetype, size }) as Express.Multer.File;

async function make(name: string, args: string[]): Promise<string> {
  const p = path.join(dir, name);
  await runOrThrow(ffmpegPath, ["-y", "-hide_banner", "-loglevel", "error", ...args, p]);
  return p;
}

describe("limites de arquivo no servidor", () => {
  it("vídeo curto passa; o temporário fica para a rota usar", async () => {
    const p = await make("ok.mp4", ["-f", "lavfi", "-i", "testsrc2=size=320x240:rate=24:duration=2", "-pix_fmt", "yuv420p", "-c:v", "libx264"]);
    const r = await checkClipUpload(multerFile(p, "Clipe.mp4", "video/mp4"), ["video"]);
    expect(r).toMatchObject({ kind: "video" });
    expect(fs.existsSync(p)).toBe(true);
  }, 30_000);

  it("áudio longo demais é recusado pelo motivo e o temporário some", async () => {
    const p = await make("longo.mp3", ["-f", "lavfi", "-i", "sine=frequency=220:duration=320", "-b:a", "32k"]);
    const r = await checkClipUpload(multerFile(p, "musica.mp3", "audio/mpeg"), ["audio", "video", "image"]);
    expect("error" in r && r.error).toMatch(/longo/);
    expect(fs.existsSync(p)).toBe(false);
  }, 30_000);

  it("pesado demais ou tipo errado para a rota também são recusados", async () => {
    const big = await make("pesado.mp4", ["-f", "lavfi", "-i", "testsrc2=size=160x120:rate=24:duration=1", "-pix_fmt", "yuv420p", "-c:v", "libx264"]);
    const r1 = await checkClipUpload(multerFile(big, "pesado.mp4", "video/mp4", 500 * 1024 * 1024), ["video"]);
    expect("error" in r1 && r1.error).toMatch(/pesado/);
    const audio = await make("efeito.mp3", ["-f", "lavfi", "-i", "sine=duration=1"]);
    // clipe da sequência só aceita vídeo: áudio vai para a trilha de áudio
    const r2 = await checkClipUpload(multerFile(audio, "efeito.mp3", "audio/mpeg"), ["video"]);
    expect("error" in r2 && r2.error).toMatch(/tipo/);
    const txt = path.join(dir, "nota.txt");
    fs.writeFileSync(txt, "oi");
    const r3 = await checkClipUpload(multerFile(txt, "nota.txt", "text/plain"), ["image", "video", "audio"]);
    expect("error" in r3).toBe(true);
  }, 30_000);
});
