import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ffmpegPath, runOrThrow } from "../src/pipeline/ffbin";
import { normalizeReason, normalizeVideo, originalsOf, probeFormat, type VideoFormat } from "../src/pipeline/normalize";

const phone: VideoFormat = { codec: "h264", pixFmt: "yuv420p", range: "tv", matrix: "bt709", transfer: "bt709", width: 1080, height: 1920, audioCodec: "aac" };

describe("formato de trabalho", () => {
  it("vídeo de celular comum passa direto; câmera, 4K, faixa completa e PCM convertem", () => {
    expect(normalizeReason(phone)).toBeNull();
    // câmera do projeto real: H.264 4:2:2 10 bits, faixa 0–255, sem marcação, PCM
    expect(normalizeReason({ ...phone, pixFmt: "yuv422p10le", range: "pc", matrix: "unknown", transfer: "unknown", width: 3840, height: 2160, audioCodec: "pcm_s16be" })).toMatch(/yuv422p10le/);
    expect(normalizeReason({ ...phone, pixFmt: "yuvj420p" })).toMatch(/yuvj420p/);
    expect(normalizeReason({ ...phone, range: "pc" })).toMatch(/faixa/);
    expect(normalizeReason({ ...phone, width: 2160, height: 3840 })).toMatch(/2160/);
    expect(normalizeReason({ ...phone, codec: "hevc" })).toMatch(/hevc/);
    expect(normalizeReason({ ...phone, audioCodec: "pcm_s16le" })).toMatch(/áudio/);
    // HDR até 1080p não mexe; acima de 1080p vira SDR 1080p
    expect(normalizeReason({ ...phone, codec: "hevc", pixFmt: "yuv420p10le", transfer: "arib-std-b67" })).toBeNull();
    expect(normalizeReason({ ...phone, codec: "hevc", pixFmt: "yuv420p10le", transfer: "arib-std-b67", width: 2160, height: 3840 })).toMatch(/HDR/);
  });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vision-normalize-"));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("converte um arquivo de câmera sintético mantendo duração e guardando o original", async () => {
    const src = path.join(dir, "source-src_01.mov");
    await runOrThrow(ffmpegPath, [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=24:duration=2",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      "-pix_fmt", "yuv422p10le", "-color_range", "pc", "-c:v", "libx264", "-c:a", "pcm_s16le",
      src,
    ]);
    const r = await normalizeVideo(src);
    expect(r.converted).toBe(true);
    expect(path.basename(r.abs)).toBe("source-src_01.mp4");
    const f = await probeFormat(r.abs);
    expect(f).toMatchObject({ codec: "h264", pixFmt: "yuv420p", range: "tv", matrix: "bt709", audioCodec: "aac", width: 1280, height: 720 });
    expect(normalizeReason(f)).toBeNull();
    expect(originalsOf(r.abs).map((p) => path.basename(p))).toEqual(["original-source-src_01.mov"]);
    // de novo não converte
    expect((await normalizeVideo(r.abs)).converted).toBe(false);
  }, 60_000);

  it("HDR 4K (HLG) vira SDR BT.709 em 1080p com a mesma duração", async () => {
    const src = path.join(dir, "source-src_hdr.mov");
    await runOrThrow(ffmpegPath, [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "testsrc2=size=2160x3840:rate=30:duration=1",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
      "-pix_fmt", "yuv420p10le", "-c:v", "libx265", "-x265-params", "log-level=error:colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc",
      "-color_primaries", "bt2020", "-color_trc", "arib-std-b67", "-colorspace", "bt2020nc",
      "-c:a", "aac",
      src,
    ]);
    expect((await probeFormat(src)).transfer).toBe("arib-std-b67");
    const r = await normalizeVideo(src);
    expect(r.converted).toBe(true);
    const f = await probeFormat(r.abs);
    expect(f).toMatchObject({ codec: "h264", pixFmt: "yuv420p", range: "tv", matrix: "bt709", transfer: "bt709", width: 1080, height: 1920 });
    expect(normalizeReason(f)).toBeNull();
  }, 120_000);
});
