import { z } from "zod";

/**
 * Biblioteca de assets (packs importados). Fica em media/library/ com os
 * arquivos já otimizados para web e um catalog.json descrevendo cada item —
 * é esse catálogo que o editor lista e que a IA recebe para escolher.
 */
export const ASSET_TYPES = [
  "sfx",
  "music",
  "icon",
  "character",
  "background",
  "transition",
  "overlay",
  "texture",
  "font",
  "lut",
  "guide",
] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const ASSET_TYPE_LABEL: Record<AssetType, string> = {
  sfx: "Efeito sonoro",
  music: "Música",
  icon: "Ícone",
  character: "Personagem",
  background: "Plano de fundo",
  transition: "Transição",
  overlay: "Overlay",
  texture: "Textura",
  font: "Fonte",
  lut: "LUT de cor",
  guide: "Guia",
};

/**
 * Como o asset visual se mistura ao vídeo:
 * normal (tem alfa ou é opaco) · screen (luz sobre fundo preto: some o preto)
 * · multiply (moldura/textura clara: some o branco)
 */
export const BLEND_MODES = ["normal", "screen", "multiply"] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

export const AssetSchema = z.object({
  id: z.string().min(1),
  type: z.enum(ASSET_TYPES),
  /** Nome legível (derivado do arquivo; editável) */
  name: z.string().min(1),
  /** Subpasta de origem no pack (ex.: "BOOM CINEMATIC", "COM GLOW") */
  collection: z.string().default(""),
  /** Arquivo otimizado, relativo à raiz do repo ("media/library/...") */
  file: z.string().min(1),
  /** Miniatura para a UI (null para áudio/fonte/lut) */
  thumb: z.string().nullable().default(null),
  width: z.number().int().positive().nullable().default(null),
  height: z.number().int().positive().nullable().default(null),
  durationSeconds: z.number().positive().nullable().default(null),
  hasAlpha: z.boolean().default(false),
  blend: z.enum(BLEND_MODES).default("normal"),
  /** Para busca e para a IA escolher; geradas do nome e/ou por visão */
  tags: z.array(z.string()).default([]),
  description: z.string().default(""),
  /** "verify" = pode ter direito autoral de terceiros (ex.: música comercial) */
  license: z.enum(["ok", "verify"]).default("ok"),
  /** Origem, para reimportar só o que mudou */
  pack: z.string().min(1),
  source: z.string().min(1),
  sourceSize: z.number().int().nonnegative(),
  sourceMtimeMs: z.number().nonnegative(),
});

export const CatalogSchema = z.object({
  version: z.literal(1),
  packs: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        root: z.string().min(1),
        importedAt: z.string(),
      })
    )
    .default([]),
  assets: z.array(AssetSchema).default([]),
});

export type Asset = z.infer<typeof AssetSchema>;
export type Catalog = z.infer<typeof CatalogSchema>;

export function emptyCatalog(): Catalog {
  return { version: 1, packs: [], assets: [] };
}

/** Busca simples por texto (nome, tags, descrição, coleção) e tipo */
export function searchAssets(
  assets: Asset[],
  query: string,
  types: AssetType[] = []
): Asset[] {
  const terms = query
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .split(/\s+/)
    .filter(Boolean);
  return assets.filter((a) => {
    if (types.length > 0 && !types.includes(a.type)) return false;
    if (terms.length === 0) return true;
    const hay = [a.name, a.collection, a.description, ...a.tags]
      .join(" ")
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "");
    return terms.every((t) => hay.includes(t));
  });
}
