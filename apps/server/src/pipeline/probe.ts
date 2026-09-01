import { ffprobePath, runOrThrow } from "./ffbin";

export interface ProbeResult {
  durationInSeconds: number;
  width: number;
  height: number;
  fps: number;
}

function parseFrameRate(raw: string | undefined): number {
  if (!raw) return 30;
  const [num, den] = raw.split("/").map(Number);
  if (!num) return 30;
  if (!den) return num;
  return num / den;
}

export async function probeVideo(absPath: string): Promise<ProbeResult> {
  const { stdout } = await runOrThrow(ffprobePath, [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    absPath,
  ]);
  const data = JSON.parse(stdout);
  const video = (data.streams ?? []).find(
    (s: any) => s.codec_type === "video"
  );
  if (!video) {
    throw new Error(`Nenhuma trilha de vídeo encontrada em ${absPath}`);
  }
  const duration = Number(data.format?.duration ?? video.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error(`Não foi possível determinar a duração de ${absPath}`);
  }
  return {
    durationInSeconds: Math.round(duration * 1000) / 1000,
    width: Number(video.width),
    height: Number(video.height),
    fps: parseFrameRate(video.r_frame_rate),
  };
}
