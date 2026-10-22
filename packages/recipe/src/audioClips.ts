import type { AudioClip } from "./schema";

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
    loop: isMusic && media === null,
    mediaDurationSeconds: media,
    assetId: opts.assetId ?? null,
  };
}
