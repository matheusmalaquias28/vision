import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  NARRATION_MAX_CHARS,
  NARRATION_SPEED_MAX,
  NARRATION_SPEED_MIN,
  NARRATION_VOICES,
  type NarrationRequest,
  type NarrationTake,
} from "@vision/recipe";
import { projectDir, toRecipePath } from "../paths";
import { ffmpegPath, runOrThrow } from "./ffbin";
import { probeDuration } from "./probe";
import { requireOpenAI } from "./transcribe";

export class NarrationError extends Error {
  status = 400;
}

const NARRATION_MODEL = process.env.NARRATION_MODEL || "gpt-4o-mini-tts";

/** Confere e normaliza o pedido vindo do editor */
export function parseNarrationRequest(body: unknown): NarrationRequest {
  const b = (body ?? {}) as Record<string, unknown>;
  const script = String(b.script ?? "").trim();
  if (!script) throw new NarrationError("escreva o roteiro da narração");
  if (script.length > NARRATION_MAX_CHARS) {
    throw new NarrationError(`roteiro longo demais (máx. ${NARRATION_MAX_CHARS} caracteres)`);
  }
  const voice = String(b.voice ?? "");
  if (!NARRATION_VOICES.some((v) => v.id === voice)) throw new NarrationError("voz desconhecida");
  const speedRaw = Number(b.speed ?? 1);
  const speed = Number.isFinite(speedRaw)
    ? Math.min(NARRATION_SPEED_MAX, Math.max(NARRATION_SPEED_MIN, Math.round(speedRaw * 100) / 100))
    : 1;
  const instructions = String(b.instructions ?? "").trim().slice(0, 1000);
  return { script, voice, instructions, speed };
}

/**
 * Gera a narração para OUVIR antes (não mexe na receita): o editor decide se
 * põe na timeline. Arquivo em `assets/narr-<hash>.mp3` do projeto; o mesmo
 * pedido (texto, voz, tom, velocidade, modelo) reaproveita o arquivo e não
 * paga de novo.
 */
export async function generateNarrationTake(projectId: string, req: NarrationRequest): Promise<NarrationTake> {
  const hash = crypto
    .createHash("sha1")
    .update(JSON.stringify([NARRATION_MODEL, req.voice, req.instructions, req.speed, req.script]))
    .digest("hex")
    .slice(0, 12);
  const out = path.join(projectDir(projectId), "assets", `narr-${hash}.mp3`);

  if (!fs.existsSync(out)) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const client = requireOpenAI();
    const speech = await client.audio.speech.create({
      model: NARRATION_MODEL,
      voice: req.voice,
      input: req.script,
      ...(req.instructions ? { instructions: req.instructions } : {}),
      response_format: "mp3",
    });
    const raw = `${out}.raw.mp3`;
    fs.writeFileSync(raw, Buffer.from(await speech.arrayBuffer()));
    try {
      if (req.speed === 1) {
        fs.renameSync(raw, out);
      } else {
        // velocidade no ffmpeg (atempo mantém o tom da voz): vale para qualquer modelo
        const tmp = `${out}.part.mp3`;
        await runOrThrow(ffmpegPath, ["-y", "-i", raw, "-filter:a", `atempo=${req.speed}`, "-c:a", "libmp3lame", "-b:a", "192k", tmp]);
        fs.renameSync(tmp, out);
      }
    } finally {
      fs.rmSync(raw, { force: true });
    }
  }

  const durationSeconds = await probeDuration(out);
  if (!durationSeconds) throw new NarrationError("não deu para ler a duração da narração gerada");
  return { file: toRecipePath(out), durationSeconds: Math.round(durationSeconds * 1000) / 1000 };
}
