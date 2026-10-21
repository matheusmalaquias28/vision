import fs from "node:fs";
import { z } from "zod";
import type { Asset, AssetType } from "@vision/recipe";
import { fromRecipePath } from "../paths";
import { ffmpegPath, runBinaryOut } from "../pipeline/ffbin";
import { requireOpenAI } from "../pipeline/transcribe";
import { loadCatalog, saveCatalog } from "./catalog";

/**
 * Descreve assets visuais olhando as miniaturas (modelo com visão), em lotes.
 * É o que permite à IA de edição escolher um ícone pelo que ele MOSTRA, e não
 * pelo nome do arquivo (muitos são só números).
 */

const VISUAL: AssetType[] = ["icon", "character", "background", "transition", "overlay", "texture"];
const BATCH = 24;

const ResponseSchema = z.object({
  items: z
    .array(
      z.object({
        i: z.number().int(),
        description: z.string(),
        tags: z.array(z.string()).default([]),
      })
    )
    .default([]),
});

const HINT: Partial<Record<AssetType, string>> = {
  icon: "ícones/stickers que aparecem sobre o vídeo para ilustrar o que a pessoa fala",
  character: "personagens recortados (silhuetas) para ilustrar situações e emoções",
  background: "planos de fundo para telas de texto, citações ou split screen",
  transition: "transições curtas (luz/film burn/glitch) aplicadas sobre o corte entre cenas",
  overlay: "molduras e elementos sobrepostos ao vídeo inteiro",
  texture: "texturas sobrepostas para dar acabamento (papel, grão, grunge)",
};

/**
 * PNG com transparência é achatado sobre cinza médio antes de ir para o
 * modelo: sobre branco (o padrão dele) os ícones brancos somem, e sobre preto
 * somem as silhuetas pretas dos personagens.
 */
async function toDataUrl(file: string): Promise<string | null> {
  const abs = fromRecipePath(file);
  if (!fs.existsSync(abs)) return null;
  if (!abs.toLowerCase().endsWith(".png")) {
    return `data:image/jpeg;base64,${fs.readFileSync(abs).toString("base64")}`;
  }
  const jpg = await runBinaryOut(ffmpegPath, [
    "-v", "error", "-i", abs,
    "-filter_complex",
    "color=c=0x7a7a7a:s=256x256[bg];[0:v]format=rgba[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2:shortest=1",
    "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "-",
  ]);
  return `data:image/jpeg;base64,${jpg.toString("base64")}`;
}

async function describeBatch(type: AssetType, batch: Asset[]): Promise<Map<string, { description: string; tags: string[] }>> {
  const client = requireOpenAI();
  const content: any[] = [
    {
      type: "text",
      text: `Você cataloga uma biblioteca de edição de vídeos curtos (Reels/TikTok) em pt-BR.
As imagens abaixo são ${HINT[type] ?? "assets visuais"}. Cada uma vem precedida do seu número. O fundo cinza liso é só para visualização (o asset é transparente): não descreva o fundo.
Para CADA imagem, escreva:
- "description": 1 frase curta em pt-BR dizendo o que mostra E em que momento de um vídeo usar (ex.: "Boneco comemorando com troféu; use quando o falante cita uma conquista ou resultado").
- "tags": 5 a 10 palavras-chave em pt-BR (objetos, emoções, cores, estilo).
Responda APENAS com JSON: {"items": [{"i": 0, "description": "...", "tags": ["..."]}]}`,
    },
  ];
  for (const [i, a] of batch.entries()) {
    const url = a.thumb ? await toDataUrl(a.thumb) : null;
    if (!url) continue;
    content.push({ type: "text", text: `#${i} (${a.name})` });
    content.push({ type: "image_url", image_url: { url, detail: "low" } });
  }
  const completion = await client.chat.completions.create({
    model: process.env.TAG_MODEL ?? "gpt-4o-mini",
    response_format: { type: "json_object" },
    temperature: 0.2,
    messages: [{ role: "user", content }],
  });
  const parsed = ResponseSchema.parse(JSON.parse(completion.choices[0]?.message?.content ?? "{}"));
  const out = new Map<string, { description: string; tags: string[] }>();
  for (const item of parsed.items) {
    const asset = batch[item.i];
    if (asset) out.set(asset.id, { description: item.description.trim(), tags: item.tags });
  }
  return out;
}

export interface TagOptions {
  /** Refaz também os que já têm descrição */
  force?: boolean;
  only?: AssetType[];
  /** Máximo de itens nesta execução (teste barato antes do lote todo) */
  limit?: number;
  onProgress?: (done: number, total: number) => void;
}

export async function tagAssets(opts: TagOptions = {}): Promise<{ tagged: number; failed: number }> {
  const catalog = loadCatalog();
  const types = opts.only?.length ? opts.only.filter((t) => VISUAL.includes(t)) : VISUAL;
  const todo = catalog.assets
    .filter((a) => types.includes(a.type) && a.thumb && (opts.force || !a.description))
    .slice(0, opts.limit ?? Infinity);
  let tagged = 0;
  let failed = 0;
  let done = 0;
  for (const type of types) {
    const ofType = todo.filter((a) => a.type === type);
    for (let i = 0; i < ofType.length; i += BATCH) {
      const batch = ofType.slice(i, i + BATCH);
      try {
        const result = await describeBatch(type, batch);
        // recarrega e mescla: o import pode estar gravando ao mesmo tempo
        const fresh = loadCatalog();
        for (const a of fresh.assets) {
          const r = result.get(a.id);
          if (!r) continue;
          a.description = r.description;
          a.tags = [...new Set([...a.tags, ...r.tags.map((t) => t.toLowerCase())])].slice(0, 20);
          tagged++;
        }
        saveCatalog(fresh);
        failed += batch.length - result.size;
      } catch {
        failed += batch.length;
      }
      done += batch.length;
      opts.onProgress?.(done, todo.length);
    }
  }
  return { tagged, failed };
}
