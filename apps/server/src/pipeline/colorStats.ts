import { autoGradeFromStats, type ColorGrade, type ColorStats, type Source } from "@vision/recipe";
import { fromRecipePath } from "../paths";
import { ffmpegPath, ffprobePath, run, runOrThrow } from "./ffbin";

/**
 * Mede a luma e a saturação de um vídeo bruto (ffmpeg signalstats em alguns
 * quadros espalhados) para o "Ajuste automático" de cor. Só lê o arquivo.
 */

const SAMPLES = 7;
const PARALLEL = 4;

/** Faixa de luma do arquivo: "pc" = 0–255 (câmeras em LOG), "tv" = 16–235 (celular, padrão) */
async function lumaRange(abs: string): Promise<"pc" | "tv"> {
  const { stdout } = await runOrThrow(ffprobePath, [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=color_range",
    "-of", "csv=p=0",
    abs,
  ]);
  return stdout.trim() === "pc" ? "pc" : "tv";
}

/** Percentis 10/90 da luma (0–255 do arquivo) e saturação média de um quadro */
async function frameStats(abs: string, at: number): Promise<{ yLow: number; yHigh: number; satAvg: number } | null> {
  // sem conversão de faixa: o valor cru é normalizado depois pela faixa do arquivo
  const { stdout, code } = await run(ffmpegPath, [
    "-hide_banner", "-loglevel", "error",
    "-ss", at.toFixed(2),
    "-i", abs,
    "-frames:v", "1",
    "-an",
    "-vf", "scale=w=320:h=-2,format=yuv444p,signalstats,metadata=print:file=-",
    "-f", "null", "-",
  ]);
  if (code !== 0) return null;
  const first = (key: string) => {
    const m = stdout.match(new RegExp(`signalstats\\.${key}=([\\d.]+)`));
    return m ? Number(m[1]) : null;
  };
  const yLow = first("YLOW");
  const yHigh = first("YHIGH");
  const satAvg = first("SATAVG");
  return yLow === null || yHigh === null || satAvg === null ? null : { yLow, yHigh, satAvg };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export async function measureSourceColor(source: Source): Promise<ColorStats> {
  const abs = fromRecipePath(source.file);
  const range = await lumaRange(abs);
  const times = Array.from({ length: SAMPLES }, (_, i) => source.durationInSeconds * (0.1 + (0.8 * i) / (SAMPLES - 1)));
  const frames: { yLow: number; yHigh: number; satAvg: number }[] = [];
  for (let i = 0; i < times.length; i += PARALLEL) {
    const batch = await Promise.all(times.slice(i, i + PARALLEL).map((t) => frameStats(abs, t)));
    for (const f of batch) if (f) frames.push(f);
  }
  if (frames.length === 0) throw new Error(`Não consegui medir a cor de ${source.file}`);
  // luma na escala da tela (o navegador expande 16–235 para 0–255)
  const toScreen = (y: number) => (range === "pc" ? y / 255 : (y - 16) / 219);
  return {
    yLow: Math.max(0, toScreen(median(frames.map((f) => f.yLow)))),
    yHigh: Math.min(1, toScreen(median(frames.map((f) => f.yHigh)))),
    satAvg: median(frames.map((f) => f.satAvg)),
  };
}

/** Ajuste automático por vídeo (não grava: o editor aplica e o operador revisa) */
export async function autoColorGrades(sources: Source[]): Promise<Record<string, { grade: ColorGrade; stats: ColorStats }>> {
  const out: Record<string, { grade: ColorGrade; stats: ColorStats }> = {};
  for (const s of sources) {
    const stats = await measureSourceColor(s);
    out[s.id] = { grade: autoGradeFromStats(stats), stats };
  }
  return out;
}
