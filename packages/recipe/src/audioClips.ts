import type { AudioClip, Recipe } from "./schema";
import { outputDuration, segmentDuration } from "./time";

/** Pedaços menores que isso não são criados ao dividir um clipe */
export const MIN_AUDIO_CLIP_SECONDS = 0.1;

export function audioClipEnd(c: AudioClip): number {
  return c.start + c.duration;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/**
 * Posição no arquivo depois de tocar `elapsed` segundos do clipe. Com loop, o
 * Remotion repete o trecho [offset, fim do arquivo], então a posição dá a volta.
 */
function fileOffsetAfter(c: AudioClip, elapsed: number): number {
  if (c.loop && c.mediaDurationSeconds !== null) {
    const loopLen = c.mediaDurationSeconds - c.offset;
    if (loopLen > 0) return c.offset + (elapsed % loopLen);
  }
  return c.offset + elapsed;
}

/**
 * Divide o clipe no instante `at` (tempo do vídeo final). O segundo pedaço
 * continua o áudio de onde o primeiro parou; o corte não ganha fade.
 * null se `at` cai fora do clipe ou perto demais de uma borda.
 */
export function splitAudioClip(
  clip: AudioClip,
  at: number,
  newId: string
): [AudioClip, AudioClip] | null {
  const first = at - clip.start;
  const second = audioClipEnd(clip) - at;
  if (first < MIN_AUDIO_CLIP_SECONDS || second < MIN_AUDIO_CLIP_SECONDS) return null;
  return [
    { ...clip, duration: round3(first), fadeOutSeconds: 0 },
    {
      ...clip,
      id: newId,
      start: round3(at),
      duration: round3(second),
      offset: round3(fileOffsetAfter(clip, first)),
      fadeInSeconds: 0,
    },
  ];
}

/** Cópia colada logo depois do original */
export function duplicateAudioClip(clip: AudioClip, newId: string): AudioClip {
  return { ...clip, id: newId, start: round3(audioClipEnd(clip)) };
}

/**
 * Clipe novo solto na timeline em `start` (tempo do vídeo final).
 * Música vai até o fim do vídeo (ou do arquivo, se for mais curto); sem a
 * duração do arquivo, repete em loop como uma trilha de fundo.
 */
export function createAudioClip(opts: {
  id: string;
  kind: AudioClip["kind"];
  file: string;
  start: number;
  videoDuration: number;
  mediaDurationSeconds?: number | null;
  assetId?: string | null;
}): AudioClip {
  const media = opts.mediaDurationSeconds ?? null;
  const start = round3(
    Math.min(Math.max(opts.start, 0), Math.max(opts.videoDuration - MIN_AUDIO_CLIP_SECONDS, 0))
  );
  const remaining = Math.max(opts.videoDuration - start, MIN_AUDIO_CLIP_SECONDS);
  const isMusic = opts.kind === "music";
  const duration = round3(
    isMusic ? (media !== null ? Math.min(media, remaining) : remaining) : Math.min(media ?? 2, remaining)
  );
  return {
    id: opts.id,
    kind: opts.kind,
    file: opts.file,
    start,
    duration,
    offset: 0,
    volume: isMusic ? 0.12 : 0.8,
    fadeInSeconds: isMusic ? round3(Math.min(1, duration / 4)) : 0,
    fadeOutSeconds: isMusic ? round3(Math.min(2, duration / 4)) : 0,
    fadeInCurve: "linear",
    fadeOutCurve: "linear",
    loop: isMusic && media === null,
    mediaDurationSeconds: media,
    assetId: opts.assetId ?? null,
    motionId: null,
    status: "accepted",
    origin: "manual",
    note: "",
  };
}

/** O que teve o som extraído: um trecho da sequência ou um overlay de vídeo */
export type AudioSourceItem = { kind: "segment"; id: string } | { kind: "overlay"; id: string };

/**
 * Som extraído de um vídeo (arquivo já gerado no servidor) vira um clipe na
 * trilha de Efeitos, alinhado com a imagem: trecho → mesmo instante e mesmo
 * ponto do bruto, e o trecho fica mudo (senão tocaria dobrado); overlay →
 * início dele (overlay de vídeo já sai sem som). null se o item não existe.
 */
export function withExtractedAudio(
  recipe: Recipe,
  item: AudioSourceItem,
  extracted: { file: string; durationSeconds: number },
  newId: string
): Recipe | null {
  const total = outputDuration(recipe.timeline.segments);
  const base = { id: newId, kind: "sfx" as const, file: extracted.file, mediaDurationSeconds: extracted.durationSeconds };
  const clipOf = (start: number, duration: number, offset: number, volume: number): AudioClip => ({
    ...createAudioClip({ ...base, start, videoDuration: total }),
    duration: round3(Math.max(MIN_AUDIO_CLIP_SECONDS, Math.min(duration, extracted.durationSeconds - offset))),
    offset: round3(offset),
    volume: Math.min(1, volume),
  });
  if (item.kind === "segment") {
    const segs = recipe.timeline.segments;
    const i = segs.findIndex((s) => s.id === item.id);
    if (i < 0) return null;
    const seg = segs[i];
    const start = segs.slice(0, i).reduce((acc, s) => acc + segmentDuration(s), 0);
    const clip = clipOf(start, segmentDuration(seg), seg.sourceStart, recipe.audio.originalVolume * (seg.volume ?? 1));
    return {
      ...recipe,
      timeline: { ...recipe.timeline, segments: segs.map((s) => (s.id === seg.id ? { ...s, muted: true } : s)) },
      audioClips: [...recipe.audioClips, clip],
    };
  }
  const o = recipe.overlays.find((x) => x.id === item.id && x.kind === "video");
  if (!o) return null;
  const clip = clipOf(o.start, (o.end ?? total) - o.start, 0, 1);
  return { ...recipe, audioClips: [...recipe.audioClips, clip] };
}

/** Piso da linha de volume: abaixo disso a linha encosta embaixo (mudo) */
const VOLUME_FLOOR_DB = -40;

/**
 * Linha de volume da timeline: volume 0–1 → altura 0–1 (0 = embaixo/mudo,
 * 1 = em cima/100%). Em dB, como o ouvido percebe: a música a 12% fica no
 * meio da altura, não colada no chão.
 */
export function volumeToLine(volume: number): number {
  if (volume <= 0.01) return 0;
  const db = 20 * Math.log10(Math.min(volume, 1));
  return Math.min(1, Math.max(0, (db - VOLUME_FLOOR_DB) / -VOLUME_FLOOR_DB));
}

/** Inverso de volumeToLine, arredondado a 1%; perto do chão vira mudo */
export function lineToVolume(line: number): number {
  const p = Math.min(1, Math.max(0, line));
  if (p < 0.02) return 0;
  const v = Math.pow(10, (VOLUME_FLOOR_DB * (1 - p)) / 20);
  return Math.max(0.01, Math.round(v * 100) / 100);
}
