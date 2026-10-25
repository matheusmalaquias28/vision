import type { Recipe } from "./schema";

/**
 * Vários itens selecionados de uma vez na timeline (retângulo ou
 * Shift/Ctrl+clique), por tipo. Chave de cada item: "<tipo>:<id>", a mesma
 * do atributo `data-sel` dos blocos da timeline.
 */
export interface TimelineSelection {
  captions: string[];
  motions: string[];
  overlays: string[];
  /** Trechos do vídeo (a trilha de áudio do vídeo é o mesmo trecho) */
  segments: string[];
  /** Música e efeitos */
  audio: string[];
}

const KEY_TO_FIELD: Record<string, keyof TimelineSelection> = {
  caption: "captions",
  motion: "motions",
  overlay: "overlays",
  segment: "segments",
  audio: "audio",
};

export const EMPTY_SELECTION: TimelineSelection = { captions: [], motions: [], overlays: [], segments: [], audio: [] };

export function selectionCount(s: TimelineSelection | null): number {
  return s ? s.captions.length + s.motions.length + s.overlays.length + s.segments.length + s.audio.length : 0;
}

export function selectionHas(s: TimelineSelection | null, key: string): boolean {
  if (!s) return false;
  const i = key.indexOf(":");
  const field = KEY_TO_FIELD[key.slice(0, i)];
  return !!field && s[field].includes(key.slice(i + 1));
}

/** Chaves "tipo:id" → seleção (sem repetir; trecho aparece em duas trilhas) */
export function selectionFromKeys(keys: string[]): TimelineSelection {
  const out: TimelineSelection = { captions: [], motions: [], overlays: [], segments: [], audio: [] };
  for (const key of keys) {
    const i = key.indexOf(":");
    const field = KEY_TO_FIELD[key.slice(0, i)];
    const id = key.slice(i + 1);
    if (field && id && !out[field].includes(id)) out[field].push(id);
  }
  return out;
}

export function selectionKeys(s: TimelineSelection | null): string[] {
  if (!s) return [];
  return (Object.entries(KEY_TO_FIELD) as [string, keyof TimelineSelection][]).flatMap(([k, f]) => s[f].map((id) => `${k}:${id}`));
}

/** Shift/Ctrl+clique: põe ou tira um item */
export function toggleInSelection(s: TimelineSelection | null, key: string): TimelineSelection {
  const keys = selectionKeys(s);
  return selectionFromKeys(keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]);
}

/** Junta duas seleções (Shift+retângulo soma ao que já estava) */
export function mergeSelections(a: TimelineSelection | null, b: TimelineSelection): TimelineSelection {
  return selectionFromKeys([...selectionKeys(a), ...selectionKeys(b)]);
}

/**
 * Apaga tudo o que está selecionado numa mudança só (um Ctrl+Z desfaz tudo).
 * O vídeo precisa de ao menos um trecho: se todos os trechos estiverem na
 * seleção, os trechos ficam e o resto é apagado (`keptAllSegments`).
 */
export function deleteTimelineItems(recipe: Recipe, s: TimelineSelection): { recipe: Recipe; keptAllSegments: boolean } {
  const drop = (ids: string[]) => new Set(ids);
  const seg = drop(s.segments);
  const segments = recipe.timeline.segments.filter((x) => !seg.has(x.id));
  const keptAllSegments = segments.length === 0 && recipe.timeline.segments.length > 0;
  const cap = drop(s.captions);
  const mo = drop(s.motions);
  const ov = drop(s.overlays);
  const au = drop(s.audio);
  return {
    recipe: {
      ...recipe,
      timeline: keptAllSegments ? recipe.timeline : { ...recipe.timeline, segments },
      captions: { ...recipe.captions, blocks: recipe.captions.blocks.filter((b) => !cap.has(b.id)) },
      motions: recipe.motions.filter((m) => !mo.has(m.id)),
      overlays: recipe.overlays.filter((o) => !ov.has(o.id)),
      audioClips: recipe.audioClips.filter((c) => !au.has(c.id)),
    },
    keptAllSegments,
  };
}
