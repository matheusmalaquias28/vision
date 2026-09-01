import { spawn } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

export const ffmpegPath = ffmpegStatic as string;
export const ffprobePath = ffprobeStatic.path;

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function run(bin: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

/** Executa e retorna o stdout binário (para extrair PCM cru do ffmpeg) */
export function runBinaryOut(bin: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true });
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => chunks.push(d));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${bin} saiu com código ${code}:\n${stderr.slice(-2000)}`));
      } else {
        resolve(Buffer.concat(chunks));
      }
    });
  });
}

export async function runOrThrow(bin: string, args: string[]): Promise<RunResult> {
  const result = await run(bin, args);
  if (result.code !== 0) {
    throw new Error(
      `${bin} saiu com código ${result.code}:\n${result.stderr.slice(-2000)}`
    );
  }
  return result;
}
