import { z } from "zod";

/**
 * Perfil de estilo das músicas da biblioteca (a maioria não diz nada pelo
 * nome: "1212", "Caleb Allerdo"). Gerado UMA vez por faixa, ouvindo um trecho
 * com um modelo de áudio (`library/analyzeMusic.ts`), e guardado no catálogo.
 * A escolha da trilha é determinística: a IA do planner só descreve a música
 * que o vídeo pede (`MusicWant`) e `rankMusic` acha as faixas que combinam.
 */

export const MUSIC_MOODS = [
  "animada",
  "motivacional",
  "epica",
  "tensa",
  "misteriosa",
  "calma",
  "relaxante",
  "alegre",
  "emocional",
  "sombria",
  "romantica",
  "divertida",
  "sofisticada",
  "urbana",
] as const;
export type MusicMood = (typeof MUSIC_MOODS)[number];

export const MUSIC_USES = [
  "institucional",
  "vendas",
  "depoimento",
  "educativo",
  "bastidores",
  "humor",
  "luxo",
  "esporte",
  "saude",
  "tecnologia",
  "comida",
  "noticia",
  "motivacional",
  "juridico",
] as const;
export type MusicUse = (typeof MUSIC_USES)[number];

export const MUSIC_TEMPOS = ["lento", "medio", "rapido"] as const;
export type MusicTempo = (typeof MUSIC_TEMPOS)[number];

/** Voz cantada compete com a fala do vídeo */
export const MUSIC_VOCALS = ["none", "some", "lead"] as const;

export const MusicProfileSchema = z.object({
  moods: z.array(z.enum(MUSIC_MOODS)).default([]),
  /** 1 (bem calma) … 5 (muita energia) */
  energy: z.number().int().min(1).max(5),
  tempo: z.enum(MUSIC_TEMPOS),
  bpm: z.number().positive().nullable().default(null),
  /** Gênero curto em pt-BR (lofi, trap, eletrônica, orquestral, corporativa…) */
  genre: z.string().default(""),
  vocals: z.enum(MUSIC_VOCALS).default("none"),
  useFor: z.array(z.enum(MUSIC_USES)).default([]),
  description: z.string().default(""),
  /** Medições do sinal (sem IA); energia e andamento saem daqui, comparando com a biblioteca */
  features: z
    .object({
      bpm: z.number().positive().nullable(),
      onset: z.number(),
      rmsDb: z.number(),
      centroidHz: z.number(),
      bass: z.number(),
    })
    .nullable()
    .default(null),
  model: z.string().default(""),
  analyzedAt: z.string().default(""),
});

/** Andamento pela medição: hip hop a ~90 conta como médio */
export function tempoFromBpm(bpm: number | null): MusicTempo {
  if (bpm === null) return "medio";
  return bpm < 85 ? "lento" : bpm <= 118 ? "medio" : "rapido";
}
export type MusicProfile = z.infer<typeof MusicProfileSchema>;

/** O que o vídeo pede (sai do planner; sem IA, `defaultMusicWant`) */
export const MusicWantSchema = z.object({
  moods: z.array(z.enum(MUSIC_MOODS)).default([]),
  energy: z.number().int().min(1).max(5).default(3),
  tempo: z.enum(MUSIC_TEMPOS).default("medio"),
  genre: z.string().default(""),
  useFor: z.array(z.enum(MUSIC_USES)).default([]),
  /** Fala o tempo todo: evitar voz cantada */
  avoidVocals: z.boolean().default(true),
});
export type MusicWant = z.infer<typeof MusicWantSchema>;

/** Sem pista nenhuma: anúncio falado pede trilha leve, positiva e sem voz */
export function defaultMusicWant(): MusicWant {
  return { moods: ["animada", "motivacional"], energy: 3, tempo: "medio", genre: "", useFor: ["vendas"], avoidVocals: true };
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();

interface Rankable {
  id: string;
  name: string;
  file: string;
  durationSeconds: number | null;
  music: MusicProfile | null;
}

export interface RankedMusic<A extends Rankable = Rankable> {
  asset: A;
  score: number;
  /** Motivo curto para o operador ("energia 4/5 · animada · sem voz") */
  why: string;
}

/** Faixas analisadas, da que mais combina para a que menos combina */
export function rankMusic<A extends Rankable>(
  assets: A[],
  want: MusicWant,
  opts: { exclude?: string[] } = {}
): RankedMusic<A>[] {
  const exclude = new Set(opts.exclude ?? []);
  const wantGenre = norm(want.genre);
  const out: RankedMusic<A>[] = [];
  for (const a of assets) {
    const p = a.music;
    if (!p || exclude.has(a.id)) continue;
    let score = 3 - Math.abs(p.energy - want.energy) * 1.2;
    const ti = MUSIC_TEMPOS.indexOf(p.tempo) - MUSIC_TEMPOS.indexOf(want.tempo);
    score += ti === 0 ? 1.5 : Math.abs(ti) === 1 ? 0.4 : -0.6;
    const moods = p.moods.filter((m) => want.moods.includes(m));
    score += Math.min(moods.length, 2) * 2;
    score += Math.min(p.useFor.filter((u) => want.useFor.includes(u)).length, 2);
    const genre = norm(p.genre);
    if (wantGenre && genre && (genre.includes(wantGenre) || wantGenre.includes(genre))) score += 1.5;
    if (want.avoidVocals) score -= p.vocals === "lead" ? 4 : p.vocals === "some" ? 1.5 : 0;
    const why = [
      `energia ${p.energy}/5`,
      ...(moods.length ? moods : p.moods.slice(0, 1)).slice(0, 2),
      p.genre || null,
      p.vocals === "none" ? "sem voz" : p.vocals === "some" ? "pouca voz" : "com voz",
    ]
      .filter(Boolean)
      .join(" · ");
    out.push({ asset: a, score: Math.round(score * 100) / 100, why });
  }
  // empate: nome, para ser estável entre chamadas
  return out.sort((x, y) => y.score - x.score || x.asset.name.localeCompare(y.asset.name));
}

/** Volume padrão da trilha sugerida (fundo sob a fala) */
export const SUGGESTED_MUSIC_VOLUME = 0.12;

/**
 * Coloca a faixa escolhida como trilha de fundo SUGERIDA (status "pending",
 * origem IA) do começo ao fim do vídeo, em loop se for mais curta. Troca a
 * sugestão anterior; não mexe se o operador já tem trilha própria (aceita).
 */
export function suggestMusicClip<R extends {
  audioClips: import("./schema").AudioClip[];
  musicWant: MusicWant | null;
}>(
  recipe: R,
  pick: RankedMusic | null,
  want: MusicWant,
  videoSeconds: number,
  id = "aud_music_ai"
): R {
  const others = recipe.audioClips.filter((c) => !(c.kind === "music" && c.status === "pending" && c.origin === "ai"));
  if (others.some((c) => c.kind === "music")) return { ...recipe, audioClips: others, musicWant: want };
  if (!pick || videoSeconds <= 0) return { ...recipe, audioClips: others, musicWant: want };
  const media = pick.asset.durationSeconds;
  const duration = Math.round(videoSeconds * 1000) / 1000;
  const clip: import("./schema").AudioClip = {
    id,
    kind: "music",
    file: pick.asset.file,
    start: 0,
    duration,
    offset: 0,
    volume: SUGGESTED_MUSIC_VOLUME,
    fadeInSeconds: Math.min(1, duration / 4),
    fadeOutSeconds: Math.min(2, duration / 4),
    fadeInCurve: "linear",
    fadeOutCurve: "linear",
    loop: media !== null && media < duration,
    mediaDurationSeconds: media,
    assetId: pick.asset.id,
    motionId: null,
    status: "pending",
    origin: "ai",
    note: pick.why,
  };
  return { ...recipe, audioClips: [...others, clip], musicWant: want };
}

/** Troca a faixa de um clipe de música mantendo tempo, volume e fades */
export function swapMusicClip<R extends { audioClips: import("./schema").AudioClip[] }>(
  recipe: R,
  clipId: string,
  pick: RankedMusic
): R {
  return {
    ...recipe,
    audioClips: recipe.audioClips.map((c) =>
      c.id === clipId
        ? {
            ...c,
            file: pick.asset.file,
            assetId: pick.asset.id,
            mediaDurationSeconds: pick.asset.durationSeconds,
            offset: 0,
            loop: pick.asset.durationSeconds !== null && pick.asset.durationSeconds < c.duration,
            note: pick.why,
          }
        : c
    ),
  };
}

/** Aceita a trilha sugerida: passa a valer no MP4 */
export function acceptAudioClip<R extends { audioClips: import("./schema").AudioClip[] }>(recipe: R, clipId: string): R {
  return {
    ...recipe,
    audioClips: recipe.audioClips.map((c) => (c.id === clipId ? { ...c, status: "accepted" as const } : c)),
  };
}
