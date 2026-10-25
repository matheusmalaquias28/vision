import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MUSIC_MOODS,
  MUSIC_USES,
  MUSIC_VOCALS,
  MusicProfileSchema,
  tempoFromBpm,
  type Asset,
  type MusicProfile,
} from "@vision/recipe";
import { repoRoot } from "../paths";
import { ffmpegPath, runOrThrow } from "../pipeline/ffbin";
import { requireOpenAI } from "../pipeline/transcribe";
import { loadCatalog, saveCatalog } from "./catalog";
import { featureHints, measureMusic, type MusicFeatures } from "./musicFeatures";

/**
 * Estilo das músicas da biblioteca (`asset.music`), uma vez por faixa (o
 * catálogo vai junto com a biblioteca para a VPS). Híbrido:
 * 1. medição do sinal no código (BPM, batida, volume, graves, brilho): o
 *    andamento sai daqui e o resto vira pista para a IA — estável e de graça;
 * 2. IA de áudio ouve dois trechos COM as pistas e diz energia, humor, gênero,
 *    voz e uso. Sem as pistas ela errava (hip hop pesado = "jazz calmo"; o
 *    modelo mini chamava tudo de "motivacional/corporativa"); só com fórmula
 *    de sinal, cada métrica errava um gênero (lofi alto, hip hop baixo).
 * Uso: npm run cli -- library music [--force] [--limit n] [--only ids]
 */

const MODEL = () => process.env.MUSIC_MODEL ?? "gpt-audio";
const PART_SECONDS = 15;
const CONCURRENCY = 3;

/** Dois trechos de 15 s (25% e 60% da faixa) colados: a IA ouve mais de uma parte */
async function excerpt(asset: Asset, dir: string): Promise<string> {
  const dur = asset.durationSeconds ?? 60;
  const at = (f: number) => Math.max(0, Math.min(dur * f, dur - PART_SECONDS - 1)).toFixed(2);
  const src = path.join(repoRoot, ...asset.file.split("/"));
  const out = path.join(dir, `${asset.id}.mp3`);
  await runOrThrow(ffmpegPath, [
    "-y", "-hide_banner", "-loglevel", "error",
    "-ss", at(0.25), "-t", String(PART_SECONDS), "-i", src,
    "-ss", at(0.6), "-t", String(PART_SECONDS), "-i", src,
    "-filter_complex", "[0:a][1:a]concat=n=2:v=0:a=1[a]", "-map", "[a]",
    "-ac", "1", "-ar", "24000", "-b:a", "96k",
    out,
  ]);
  return out;
}

const SYSTEM = `Você ajuda um editor de vídeo a catalogar trilhas de fundo da biblioteca dele. Você NÃO identifica músicas, artistas nem letras: só descreve características sonoras do trecho (clima, gênero, instrumentação, se há voz cantada).`;

const prompt = (hints: string) => `Ouça os dois trechos (colados) e descreva a faixa como trilha de fundo para anúncios curtos em pt-BR, com uma pessoa FALANDO por cima. Não diga o nome da música nem do artista.
Medições automáticas do sinal (relativas a uma biblioteca de ~160 faixas; podem errar, confie no que você OUVE, principalmente no gênero e na instrumentação): ${hints}.
Responda APENAS com JSON, sem texto fora dele:
{"moods": [1 a 3 de ${JSON.stringify(MUSIC_MOODS)}, o mais característico primeiro; "sofisticada", "urbana" e "motivacional" só quando forem de fato o traço principal, não como coringa],
 "energy": 1 a 5 como trilha (1 bem calma … 5 muita energia). Referência: lofi e trilhas de fundo suaves 1–2 mesmo com batida; corporativa/acústica 2–3; hip hop/trap instrumental 3–4; eletrônica/EDM/rock/funk 4–5; orquestral épica 3–5 conforme a intensidade,
 "genre": gênero curto em pt-BR (ex.: lofi, trap, hip hop, eletrônica, pop, rock, orquestral, corporativa, acústica, jazz, cinematográfica, funk, sertaneja),
 "vocals": "none" (instrumental), "some" (vocalizes/trechos curtos de voz) ou "lead" (voz cantada principal),
 "useFor": [1 a 4 de ${JSON.stringify(MUSIC_USES)}],
 "description": uma frase curta em pt-BR com o clima e o tipo de vídeo que combina}`;

const plain = (x: unknown) => String(x).toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();

/** Parte da IA (humor, gênero, voz, uso). Energia/andamento vêm da medição. */
export async function describeMusic(
  file: string,
  hints: string
): Promise<Pick<MusicProfile, "moods" | "energy" | "genre" | "vocals" | "useFor" | "description">> {
  const audio = fs.readFileSync(file).toString("base64");
  const ask = async (audioFirst: boolean) => {
    const parts = [
      { type: "text" as const, text: prompt(hints) },
      { type: "input_audio" as const, input_audio: { data: audio, format: "mp3" as const } },
    ];
    const completion = await requireOpenAI().chat.completions.create(
      {
        model: MODEL(),
        modalities: ["text"],
        // mesma faixa, mesma resposta; na 2ª tentativa um pouco de variação
        temperature: audioFirst ? 0.4 : 0,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: audioFirst ? [parts[1], parts[0]] : parts },
        ],
      },
      { timeout: 90_000, maxRetries: 2 }
    );
    const text = completion.choices[0]?.message?.content ?? "";
    return { text, json: text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1) };
  };
  // às vezes o modelo responde conversando ("forneça o áudio") em vez do JSON
  let { text, json } = await ask(false);
  if (!json) ({ text, json } = await ask(true));
  if (!json) throw new Error(`resposta sem JSON: ${text.slice(0, 120)}`);
  const raw = JSON.parse(json) as Record<string, unknown>;
  // só o vocabulário fechado entra (o modelo às vezes inventa ou acentua)
  const pick = <T extends string>(v: unknown, allowed: readonly T[]): T[] =>
    [...new Set((Array.isArray(v) ? v : []).map(plain))].filter((x): x is T => (allowed as readonly string[]).includes(x));
  return {
    moods: pick(raw.moods, MUSIC_MOODS).slice(0, 3),
    energy: Math.min(5, Math.max(1, Math.round(Number(raw.energy) || 3))),
    genre: String(raw.genre ?? "").toLowerCase().slice(0, 40),
    vocals: (MUSIC_VOCALS as readonly string[]).includes(String(raw.vocals)) ? (raw.vocals as MusicProfile["vocals"]) : "none",
    useFor: pick(raw.useFor, MUSIC_USES).slice(0, 4),
    description: String(raw.description ?? "").slice(0, 200),
  };
}

export interface AnalyzeReport {
  measured: number;
  analyzed: number;
  skipped: number;
  failed: { id: string; error: string }[];
}

export async function analyzeMusicLibrary(
  opts: { force?: boolean; limit?: number; only?: string[]; onProgress?: (msg: string) => void } = {}
): Promise<AnalyzeReport> {
  const say = opts.onProgress ?? (() => undefined);
  const catalog = loadCatalog();
  const music = catalog.assets.filter((a) => a.type === "music");
  const todo = music
    .filter((a) => (opts.only?.length ? opts.only.includes(a.id) : opts.force || !a.music?.description))
    .slice(0, opts.limit ?? Infinity);
  const report: AnalyzeReport = { measured: 0, analyzed: 0, skipped: music.length - todo.length, failed: [] };

  // 1. medição de TODAS (as que faltam): a energia é relativa à biblioteca inteira
  const features = new Map<string, MusicFeatures>();
  for (const a of music) if (a.music?.features && !opts.force) features.set(a.id, a.music.features);
  const toMeasure = music.filter((a) => !features.has(a.id));
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < toMeasure.length) {
        const a = toMeasure[next++];
        try {
          features.set(a.id, await measureMusic(a.file, a.durationSeconds));
          report.measured++;
        } catch (err) {
          report.failed.push({ id: a.id, error: `medição: ${err instanceof Error ? err.message.split("\n")[0] : err}` });
        }
      }
    })
  );
  say(`medidas: ${features.size}/${music.length} faixas`);
  const measuredIds = [...features.keys()];
  const all = measuredIds.map((id) => features.get(id)!);

  // 2. IA de áudio só nas que faltam descrição
  const described = new Map<string, Awaited<ReturnType<typeof describeMusic>>>();
  const flush = () => {
    // relê o catálogo: outra operação pode ter gravado no meio
    const fresh = loadCatalog();
    for (const a of fresh.assets) {
      if (a.type !== "music" || !features.has(a.id)) continue;
      const f = features.get(a.id)!;
      const ai = described.get(a.id);
      const base = a.music;
      if (!ai && !base) continue;
      a.music = MusicProfileSchema.parse({
        ...(base ?? {}),
        ...(ai ?? {}),
        energy: ai?.energy ?? base?.energy ?? 3,
        tempo: tempoFromBpm(f.bpm),
        bpm: f.bpm,
        features: f,
        model: ai ? MODEL() : (base?.model ?? ""),
        analyzedAt: ai ? new Date().toISOString() : (base?.analyzedAt ?? ""),
      });
      if (ai) {
        a.tags = [...new Set([...a.tags, ...ai.moods, ...(ai.genre ? [ai.genre] : [])])].slice(0, 20);
        if (!a.description) a.description = ai.description;
      }
    }
    saveCatalog(fresh);
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vision-music-"));
  try {
    next = 0;
    const queue = todo.filter((a) => features.has(a.id));
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (next < queue.length) {
          const a = queue[next++];
          try {
            const file = await excerpt(a, dir);
            const ai = await describeMusic(file, featureHints(features.get(a.id)!, all));
            fs.rmSync(file, { force: true });
            described.set(a.id, ai);
            report.analyzed++;
            const f = features.get(a.id)!;
            say(
              `${report.analyzed + report.failed.length}/${queue.length} ${a.name} → energia ${ai.energy}, ${f.bpm ?? "?"} BPM, ${ai.moods.join("/")}, ${ai.genre}, voz ${ai.vocals}`
            );
            if (report.analyzed % 10 === 0) flush();
          } catch (err) {
            report.failed.push({ id: a.id, error: err instanceof Error ? err.message.split("\n")[0] : String(err) });
            say(`falhou ${a.name}: ${report.failed[report.failed.length - 1].error}`);
          }
        }
      })
    );
    flush();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return report;
}
