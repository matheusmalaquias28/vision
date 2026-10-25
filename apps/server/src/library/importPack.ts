import fs from "node:fs";
import path from "node:path";
import type { Asset, AssetType, BlendMode, Catalog } from "@vision/recipe";
import { fromRecipePath, toRecipePath } from "../paths";
import { ffmpegPath, ffprobePath, run, runBinaryOut } from "../pipeline/ffbin";
import { slugify } from "../project";
import { libraryDir, loadCatalog, saveCatalog } from "./catalog";

/**
 * Importa um pack de assets (pasta com subpastas por categoria) para
 * media/library/<pack>/, convertendo tudo para formatos que o navegador e o
 * Remotion tocam, e registra cada item no catalog.json.
 *
 * Incremental: item cujo arquivo de origem não mudou (tamanho + mtime) e cuja
 * saída ainda existe é reaproveitado sem reprocessar.
 */

const AUDIO = [".wav", ".mp3", ".aac", ".m4a", ".ogg", ".flac"];
const IMAGE = [".png", ".jpg", ".jpeg", ".webp", ".gif"];
const VIDEO = [".mp4", ".mov", ".webm", ".m4v"];

/** Pastas/formatos que não dá para usar fora do Premiere/After Effects */
const SKIP_EXT = [".mogrt", ".aegraphic", ".prproj", ".pek", ".cfa", ".prfpset", ".prin", ".itx", ".ilut", ".look", ".lut", ".prv"];

/** Categoria do pack → tipo de asset. Pastas fora daqui caem na heurística. */
const FOLDER_RULES: { match: RegExp; type: AssetType | "skip" }[] = [
  { match: /^efeitos sonoros|^sfx|^sound/i, type: "sfx" },
  { match: /^musica|^música|^music/i, type: "music" },
  { match: /^icone|^ícone|^icon|^sticker/i, type: "icon" },
  { match: /^personage|^character/i, type: "character" },
  { match: /minimalista/i, type: "skip" },
  { match: /^planos de fundo|^background|^fundo/i, type: "background" },
  { match: /^transi/i, type: "transition" },
  { match: /^overlay|^linhas|^lines/i, type: "overlay" },
  { match: /^textura|^texture/i, type: "texture" },
  { match: /^fonte|^font/i, type: "font" },
  { match: /^lut/i, type: "lut" },
  { match: /^zona segura|^safe/i, type: "guide" },
  // templates do Premiere/AE e projetos: não portáveis
  { match: /^textos|^projeto|^presets|^letras/i, type: "skip" },
];

/** Palavras do nome que viram sinônimos úteis para busca e para a IA */
const SYNONYMS: Record<string, string[]> = {
  whoosh: ["transição", "movimento", "swoosh", "passagem"],
  woosh: ["whoosh", "transição", "movimento"],
  swoosh: ["whoosh", "transição", "movimento"],
  boom: ["impacto", "grave", "explosão", "ênfase"],
  hit: ["impacto", "batida", "ênfase"],
  impact: ["impacto", "batida", "ênfase"],
  impacto: ["impacto", "batida", "ênfase"],
  riser: ["subida", "tensão", "build-up", "expectativa"],
  buildup: ["subida", "tensão", "expectativa"],
  "tensão": ["suspense", "expectativa"],
  click: ["clique", "interface", "mouse"],
  clique: ["click", "interface"],
  glitch: ["digital", "falha", "tecnologia"],
  burn: ["film burn", "luz", "analógico", "queimado", "vintage"],
  film: ["filme", "analógico", "vintage", "película"],
  flare: ["luz", "brilho", "lens flare"],
  leak: ["luz", "light leak"],
  lut: ["luz", "light leak", "cor"],
  paper: ["papel", "rasgo"],
  glow: ["brilho", "neon"],
  grid: ["grade", "tecnologia"],
  angry: ["raiva", "bravo", "irritado", "conflito"],
  confused: ["confuso", "dúvida"],
  happy: ["feliz", "alegria"],
  sad: ["triste"],
  money: ["dinheiro", "finanças"],
  "$": ["dinheiro", "finanças"],
  audience: ["plateia", "público"],
  business: ["negócios", "empresário"],
  doctor: ["médico", "saúde"],
  deal: ["acordo", "negócio", "parceria"],
  thinking: ["pensando", "reflexão", "dúvida"],
  gym: ["academia", "força", "esforço"],
  correto: ["certo", "acerto", "sucesso"],
  camera: ["câmera", "foto"],
  shutter: ["câmera", "foto", "obturador"],
};

const NOISE = new Set(["copy", "png", "jpg", "mp4", "mov", "wav", "mp3", "the", "of", "and", "de", "do", "da", "e", "a", "o", "4k", "16mm", "720p", "1080p", "vertical", "ngtvst"]);

interface Probe {
  width: number | null;
  height: number | null;
  pixFmt: string;
  codec: string;
  duration: number | null;
  hasVideo: boolean;
  audioCodec: string | null;
}

async function probe(file: string): Promise<Probe> {
  const { stdout } = await run(ffprobePath, [
    "-v", "error",
    "-show_entries", "stream=codec_type,codec_name,width,height,pix_fmt:format=duration",
    "-of", "json",
    file,
  ]);
  const j = JSON.parse(stdout || "{}");
  const streams: any[] = j.streams ?? [];
  const v = streams.find((s) => s.codec_type === "video");
  const a = streams.find((s) => s.codec_type === "audio");
  const d = Number(j.format?.duration);
  return {
    width: v?.width ?? null,
    height: v?.height ?? null,
    pixFmt: v?.pix_fmt ?? "",
    codec: v?.codec_name ?? "",
    duration: Number.isFinite(d) && d > 0 ? Math.round(d * 1000) / 1000 : null,
    hasVideo: Boolean(v),
    audioCodec: a?.codec_name ?? null,
  };
}

function hasAlphaFmt(pixFmt: string): boolean {
  return /^(rgba|bgra|argb|abgr|ya|yuva|gbrap|pal8|rgba64|ya16)/.test(pixFmt);
}

/** Cor média de um canto do primeiro frame (detecta fundo chroma) */
async function cornerColor(file: string, at: number): Promise<[number, number, number] | null> {
  try {
    const buf = await runBinaryOut(ffmpegPath, [
      "-v", "error", "-ss", String(at), "-i", file, "-frames:v", "1",
      "-vf", "crop=iw/20:ih/20:iw/40:ih/40,scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
    ]);
    return buf.length >= 3 ? [buf[0], buf[1], buf[2]] : null;
  } catch {
    return null;
  }
}

function chromaOf(rgb: [number, number, number] | null): "green" | "red" | "blue" | null {
  if (!rgb) return null;
  const [r, g, b] = rgb;
  if (g > 150 && r < 110 && b < 110) return "green";
  if (r > 190 && g < 70 && b < 70) return "red";
  if (b > 170 && r < 70 && g < 110) return "blue";
  return null;
}

const KEY_HEX = { green: "0x00FF00", red: "0xFF0000", blue: "0x0000FF" } as const;

function cleanName(base: string): string {
  return base
    .replace(/\.[^.]+$/, "")
    .replace(/[_]+/g, " ")
    .replace(/\s*-\s*sound effect.*$/i, "")
    .replace(/\bcopy\b/gi, "")
    .replace(/\(\d+\)/g, (m) => m)
    .replace(/\s+/g, " ")
    .trim();
}

function tagsFor(name: string, collection: string, type: AssetType, extra: string[] = []): string[] {
  const words = `${name} ${collection}`
    .toLowerCase()
    .split(/[^\p{L}$]+/u)
    .filter((w) => w.length > 1 && !NOISE.has(w) && !/^\d+$/.test(w));
  const out = new Set<string>([...words, ...extra]);
  for (const w of words) for (const s of SYNONYMS[w] ?? []) out.add(s);
  if (type === "sfx") out.add("efeito sonoro");
  return [...out].slice(0, 16);
}

function ruleFor(topFolder: string): AssetType | "skip" | null {
  for (const r of FOLDER_RULES) if (r.match.test(topFolder)) return r.type;
  return null;
}

/** Tipo pela extensão quando a pasta não diz nada */
function guessType(ext: string, p: Probe): AssetType | null {
  if (AUDIO.includes(ext)) return p.duration !== null && p.duration > 25 ? "music" : "sfx";
  if (IMAGE.includes(ext)) return hasAlphaFmt(p.pixFmt) ? "icon" : "background";
  if (VIDEO.includes(ext)) return p.hasVideo ? (p.duration !== null && p.duration < 4 ? "transition" : "background") : "music";
  if (ext === ".ttf" || ext === ".otf") return "font";
  if (ext === ".cube") return "lut";
  return null;
}

interface Job {
  abs: string;
  rel: string;
  collection: string;
  type: AssetType;
  ext: string;
  stat: fs.Stats;
}

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      // pastas de cache/ autosave do Premiere/AE
      if (/^(adobe|salvamento automático|motion graphics template media|- ignorar)/i.test(e.name)) return [];
      return walk(p);
    }
    return [p];
  });
}

async function ff(args: string[]): Promise<void> {
  const { code, stderr } = await run(ffmpegPath, ["-v", "error", "-y", ...args]);
  if (code !== 0) throw new Error(stderr.slice(-800) || `ffmpeg saiu com ${code}`);
}

/** cobre 1080×1920 (corta o excesso no centro), como object-fit: cover */
const COVER_1080 = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1";

async function thumbFrom(input: string, out: string, at: number | null, alpha: boolean): Promise<void> {
  await ff([
    ...(alpha ? ["-c:v", "libvpx-vp9"] : []),
    "-i", input,
    ...(at !== null ? ["-ss", String(at)] : []),
    "-frames:v", "1",
    "-vf", "scale=240:240:force_original_aspect_ratio=decrease",
    out,
  ]);
}

interface Processed {
  file: string;
  thumb: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  hasAlpha: boolean;
  blend: BlendMode;
  license: "ok" | "verify";
  extraTags?: string[];
}

async function processJob(job: Job, id: string, outDir: string, thumbDir: string): Promise<Processed> {
  const p = await probe(job.abs);
  const typeDir = path.join(outDir, job.type);
  fs.mkdirSync(typeDir, { recursive: true });
  const thumbPng = path.join(thumbDir, `${id}.png`);
  const thumbJpg = path.join(thumbDir, `${id}.jpg`);
  const base = { width: p.width, height: p.height, durationSeconds: p.duration, hasAlpha: false, blend: "normal" as BlendMode, license: "ok" as const };

  switch (job.type) {
    case "sfx": {
      const out = path.join(typeDir, `${id}${job.ext}`);
      fs.copyFileSync(job.abs, out);
      return { ...base, file: out, thumb: null, width: null, height: null };
    }
    case "music": {
      if (AUDIO.includes(job.ext)) {
        const out = path.join(typeDir, `${id}${job.ext}`);
        fs.copyFileSync(job.abs, out);
        return { ...base, file: out, thumb: null, width: null, height: null, license: "verify" };
      }
      const out = path.join(typeDir, `${id}.m4a`);
      await ff(["-i", job.abs, "-vn", ...(p.audioCodec === "aac" ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "160k"]), out]);
      return { ...base, file: out, thumb: null, width: null, height: null, license: "verify" };
    }
    case "font":
    case "lut": {
      const out = path.join(typeDir, `${id}${job.ext}`);
      fs.copyFileSync(job.abs, out);
      return { ...base, file: out, thumb: null, width: null, height: null, durationSeconds: null };
    }
    case "icon":
    case "guide":
    case "overlay":
    case "texture":
    case "background":
    case "character": {
      if (IMAGE.includes(job.ext)) {
        const alpha = hasAlphaFmt(p.pixFmt);
        const max = job.type === "icon" ? 512 : 1920;
        const out = path.join(typeDir, `${id}${alpha ? ".png" : ".jpg"}`);
        await ff([
          "-i", job.abs, "-frames:v", "1",
          "-vf", `scale='min(${max},iw)':'min(${max},ih)':force_original_aspect_ratio=decrease`,
          ...(alpha ? [] : ["-q:v", "3"]),
          out,
        ]);
        const after = await probe(out);
        await thumbFrom(out, alpha ? thumbPng : thumbJpg, null, false);
        return {
          ...base,
          file: out,
          thumb: alpha ? thumbPng : thumbJpg,
          width: after.width,
          height: after.height,
          durationSeconds: null,
          hasAlpha: alpha,
          blend: job.type === "texture" ? "multiply" : "normal",
        };
      }
      if (!VIDEO.includes(job.ext) || !p.hasVideo) throw new Error("formato não suportado");
      return processVideo(job, id, p, typeDir, thumbPng, thumbJpg);
    }
    case "transition":
      return processVideo(job, id, p, typeDir, thumbPng, thumbJpg);
  }
}

async function processVideo(
  job: Job,
  id: string,
  p: Probe,
  typeDir: string,
  thumbPng: string,
  thumbJpg: string
): Promise<Processed> {
  const mid = (p.duration ?? 1) * 0.45;
  const nativeAlpha = hasAlphaFmt(p.pixFmt);
  const chroma = nativeAlpha ? null : chromaOf(await cornerColor(job.abs, Math.min(0.2, mid)));
  // personagens: fundo chroma sempre vira alfa; transições: só se for chroma
  const keyed = chroma !== null && (job.type === "character" || job.type === "transition" || job.type === "overlay");
  const vertical = job.type === "character" ? "scale=720:-2" : COVER_1080;

  if (nativeAlpha || keyed) {
    const out = path.join(typeDir, `${id}.webm`);
    const key = keyed ? `chromakey=${KEY_HEX[chroma!]}:0.28:0.06,` : "";
    await ff([
      "-i", job.abs, "-an",
      "-vf", `${key}${vertical},fps=30,format=yuva420p`,
      "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "34",
      "-row-mt", "1", "-deadline", "good", "-cpu-used", "4",
      out,
    ]);
    const after = await probe(out);
    await thumbFrom(out, thumbPng, mid, true);
    return {
      file: out,
      thumb: thumbPng,
      width: after.width,
      height: after.height,
      durationSeconds: p.duration,
      hasAlpha: true,
      blend: "normal",
      license: "ok",
      extraTags: keyed ? ["recortado", `chroma ${chroma}`] : [],
    };
  }

  const out = path.join(typeDir, `${id}.mp4`);
  await ff([
    "-i", job.abs, "-an",
    "-vf", `${vertical},fps=30,format=yuv420p`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-movflags", "+faststart",
    out,
  ]);
  const after = await probe(out);
  await thumbFrom(out, thumbJpg, mid, false);
  const name = path.basename(job.abs).toLowerCase();
  const blend: BlendMode =
    job.type === "transition" || job.type === "overlay"
      ? /dirty frame|50d|no sprocket\.mov$/.test(name)
        ? "multiply"
        : "screen"
      : "normal";
  return {
    file: out,
    thumb: thumbJpg,
    width: after.width,
    height: after.height,
    durationSeconds: p.duration,
    hasAlpha: false,
    blend,
    license: "ok",
    extraTags: chroma ? [`fundo ${chroma}`] : [],
  };
}

async function pool<T>(items: T[], size: number, fn: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        await fn(items[i], i);
      }
    })
  );
}

export interface ImportOptions {
  /** Só estes tipos (vazio = todos) */
  only?: AssetType[];
  concurrency?: number;
  onProgress?: (done: number, total: number, label: string) => void;
}

export interface ImportReport {
  packId: string;
  imported: number;
  reused: number;
  skipped: string[];
  failed: { file: string; error: string }[];
}

export async function importPack(packRoot: string, opts: ImportOptions = {}): Promise<ImportReport> {
  const root = path.resolve(packRoot);
  if (!fs.existsSync(root)) throw new Error(`Pasta não encontrada: ${root}`);
  const packName = path.basename(root);
  const packId = slugify(packName);
  const outDir = path.join(libraryDir, packId);
  const thumbDir = path.join(outDir, "thumbs");
  fs.mkdirSync(thumbDir, { recursive: true });

  const catalog: Catalog = loadCatalog();
  const previous = new Map(
    catalog.assets.filter((a) => a.pack === packId).map((a) => [a.source, a] as const)
  );
  const report: ImportReport = { packId, imported: 0, reused: 0, skipped: [], failed: [] };

  const jobs: Job[] = [];
  for (const abs of walk(root)) {
    const rel = path.relative(root, abs).split(path.sep).join("/");
    const ext = path.extname(abs).toLowerCase();
    if (SKIP_EXT.includes(ext)) continue;
    const parts = rel.split("/");
    const top = parts.length > 1 ? parts[0] : "";
    const rule = top ? ruleFor(top) : null;
    if (rule === "skip") continue;
    let type: AssetType | null = rule;
    if (!type) {
      if (![...AUDIO, ...IMAGE, ...VIDEO, ".ttf", ".otf", ".cube"].includes(ext)) continue;
      type = guessType(ext, await probe(abs));
    }
    if (!type) {
      report.skipped.push(rel);
      continue;
    }
    // LUTs: só .cube; fontes: só ttf/otf
    if (type === "lut" && ext !== ".cube") continue;
    if (type === "font" && ![".ttf", ".otf"].includes(ext)) continue;
    if (opts.only && opts.only.length > 0 && !opts.only.includes(type)) continue;
    const collection = parts.length > 2 ? parts.slice(1, -1).join(" / ") : "";
    jobs.push({ abs, rel, collection, type, ext, stat: fs.statSync(abs) });
  }

  const taken = new Set(catalog.assets.filter((a) => a.pack !== packId).map((a) => a.id));
  const result = new Map<string, Asset>();
  let done = 0;
  let sinceSave = 0;

  const pendingSources = new Set(jobs.map((j) => j.rel));
  const persist = (final = false) => {
    const others = catalog.assets.filter(
      (a) => a.pack !== packId || (opts.only?.length ? !opts.only.includes(a.type) : false)
    );
    // gravações intermediárias mantêm o que ainda não foi revisitado; a final
    // descarta o que sumiu do pack
    const notYetVisited = final
      ? []
      : [...previous.values()].filter((p) => !result.has(p.id) && pendingSources.has(p.source));
    const packs = [
      ...catalog.packs.filter((p) => p.id !== packId),
      { id: packId, name: packName, root, importedAt: new Date().toISOString() },
    ];
    saveCatalog({ version: 1, packs, assets: [...others, ...result.values(), ...notYetVisited] });
  };

  // ids estáveis: mesmo arquivo de origem mantém o id da importação anterior
  const idFor = (job: Job): string => {
    const prev = previous.get(job.rel);
    if (prev) {
      taken.add(prev.id);
      return prev.id;
    }
    const baseName = cleanName(path.basename(job.abs));
    const slug = slugify(/^\d{6,}$/.test(baseName) ? `${job.collection || job.type}` : baseName) || job.type;
    let id = `${job.type}_${slug}`.slice(0, 60);
    for (let n = 2; taken.has(id); n++) id = `${job.type}_${slug}_${n}`.slice(0, 64);
    taken.add(id);
    return id;
  };

  const planned = jobs.map((job) => ({ job, id: idFor(job) }));
  // vídeos primeiro (mais lentos) para o pool terminar junto
  planned.sort((a, b) => Number(VIDEO.includes(b.job.ext)) - Number(VIDEO.includes(a.job.ext)));

  await pool(planned, opts.concurrency ?? 4, async ({ job, id }) => {
    const prev = previous.get(job.rel);
    const prevOk =
      prev &&
      prev.sourceSize === job.stat.size &&
      Math.abs(prev.sourceMtimeMs - job.stat.mtimeMs) < 1 &&
      fs.existsSync(fromRecipePath(prev.file));
    try {
      if (prev && prevOk) {
        result.set(id, prev);
        report.reused++;
      } else {
        const out = await processJob(job, id, outDir, thumbDir);
        const baseName = cleanName(path.basename(job.abs));
        const numeric = /^\d{6,}$/.test(baseName);
        const name = numeric ? `${job.collection || job.type} ${result.size + 1}` : baseName;
        result.set(id, {
          id,
          type: job.type,
          name,
          collection: job.collection,
          file: toRecipePath(out.file),
          thumb: out.thumb ? toRecipePath(out.thumb) : null,
          width: out.width,
          height: out.height,
          durationSeconds: out.durationSeconds,
          hasAlpha: out.hasAlpha,
          blend: out.blend,
          tags: tagsFor(numeric ? "" : baseName, job.collection, job.type, out.extraTags),
          // descrição rica vem do passo de tagging por visão (library tag)
          description: prev?.description ?? "",
          license: out.license,
          pack: packId,
          source: job.rel,
          sourceSize: job.stat.size,
          sourceMtimeMs: job.stat.mtimeMs,
          // estilo ouvido por IA: só refaz se mandar analisar de novo
          music: job.type === "music" ? (prev?.music ?? null) : null,
        });
        report.imported++;
      }
    } catch (err) {
      report.failed.push({ file: job.rel, error: err instanceof Error ? err.message.split("\n")[0] : String(err) });
    }
    done++;
    opts.onProgress?.(done, planned.length, job.rel);
    if (++sinceSave >= 25) {
      sinceSave = 0;
      persist();
    }
  });

  persist(true);
  return report;
}
