import { duplicateAudioClip, splitAudioClip } from "./audioClips";
import type { AudioClip, Motion, Overlay, Recipe, Segment } from "./schema";
import { outputDuration, outputToSource, segmentDuration, sourceToOutput, splitSegmentAt } from "./time";

/**
 * Copiar/recortar/colar/duplicar/dividir da timeline (menu do botão direito e
 * Ctrl+C/X/V/D). Itens por chave "tipo:id", a mesma do `data-sel` dos blocos.
 * A cópia guarda o início de cada item relativo ao primeiro; colar põe o
 * grupo no instante pedido. A regra das camadas (enforceLanes, no commit do
 * editor) tira de cima de outro item o que for colado.
 */
export type ClipboardItem =
  | { kind: "motion"; offset: number; motion: Motion }
  | { kind: "overlay"; offset: number; overlay: Overlay }
  | { kind: "audio"; offset: number; clip: AudioClip }
  | { kind: "segment"; offset: number; segment: Segment };

export interface ClipboardData {
  items: ClipboardItem[];
  /** Do início do primeiro ao fim do último (duplicar cola logo depois) */
  span: number;
  /** Início do primeiro item quando foi copiado */
  from: number;
}

const idOf = (key: string) => key.slice(key.indexOf(":") + 1);
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Onde cada trecho começa no vídeo final */
function segmentStarts(segments: Segment[]): number[] {
  let acc = 0;
  return segments.map((s) => {
    const at = acc;
    acc += segmentDuration(s);
    return at;
  });
}

/** null = nada copiável (legenda não entra: é texto da fala) */
export function copyItems(recipe: Recipe, keys: string[]): ClipboardData | null {
  const segments = recipe.timeline.segments;
  const total = outputDuration(segments);
  const starts = segmentStarts(segments);
  const raw: { item: ClipboardItem; start: number; end: number }[] = [];
  for (const key of keys) {
    const id = idOf(key);
    if (key.startsWith("motion:")) {
      const m = recipe.motions.find((x) => x.id === id);
      const start = m ? sourceToOutput(segments, m.sourceId, m.sourceTime) : null;
      if (m && start !== null) raw.push({ item: { kind: "motion", offset: 0, motion: m }, start, end: start + m.durationSeconds });
    } else if (key.startsWith("overlay:")) {
      const o = recipe.overlays.find((x) => x.id === id);
      if (o) raw.push({ item: { kind: "overlay", offset: 0, overlay: o }, start: o.start, end: o.end ?? total });
    } else if (key.startsWith("audio:")) {
      const c = recipe.audioClips.find((x) => x.id === id);
      if (c) raw.push({ item: { kind: "audio", offset: 0, clip: c }, start: c.start, end: c.start + c.duration });
    } else if (key.startsWith("segment:")) {
      const i = segments.findIndex((x) => x.id === id);
      if (i >= 0) raw.push({ item: { kind: "segment", offset: 0, segment: segments[i] }, start: starts[i], end: starts[i] + segmentDuration(segments[i]) });
    }
  }
  if (raw.length === 0) return null;
  const from = Math.min(...raw.map((x) => x.start));
  const to = Math.max(...raw.map((x) => x.end));
  return {
    items: raw.sort((a, b) => a.start - b.start).map((x) => ({ ...x.item, offset: r3(x.start - from) })),
    span: r3(to - from),
    from,
  };
}

function freshId(prefix: string, taken: Set<string>): string {
  let n = taken.size + 1;
  let id = `${prefix}${n}`;
  while (taken.has(id)) id = `${prefix}${++n}`;
  taken.add(id);
  return id;
}

/** Cola no instante `at` (vídeo final). Devolve as chaves dos itens novos */
export function pasteItems(recipe: Recipe, data: ClipboardData, at: number): { recipe: Recipe; keys: string[] } {
  const keys: string[] = [];
  // trechos de vídeo entram juntos na emenda mais perto de `at`
  let segments = recipe.timeline.segments;
  const segs = data.items.filter((i): i is Extract<ClipboardItem, { kind: "segment" }> => i.kind === "segment");
  if (segs.length > 0) {
    const bounds = [...segmentStarts(segments), outputDuration(segments)];
    let idx = 0;
    bounds.forEach((b, i) => {
      if (Math.abs(b - at) < Math.abs(bounds[idx] - at)) idx = i;
    });
    const taken = new Set(segments.map((s) => s.id));
    const copies = segs.map((s) => ({ ...s.segment, id: freshId(`${s.segment.id}c`, taken) }));
    segments = [...segments.slice(0, idx), ...copies, ...segments.slice(idx)];
    keys.push(...copies.map((c) => `segment:${c.id}`));
  }
  const total = outputDuration(segments);

  const motionIds = new Set(recipe.motions.map((m) => m.id));
  const groups = new Map<string, string>();
  const motions = [...recipe.motions];
  const overlays = [...recipe.overlays];
  const overlayIds = new Set(overlays.map((o) => o.id));
  const audioClips = [...recipe.audioClips];
  const audioIds = new Set(audioClips.map((c) => c.id));
  const stamp = Date.now().toString(36);

  for (const item of data.items) {
    const start = at + item.offset;
    if (item.kind === "motion") {
      const anchor = outputToSource(segments, Math.min(Math.max(start, 0), Math.max(total - 0.05, 0)));
      if (!anchor) continue;
      const m = item.motion;
      // combo colado é um combo novo (não se mistura com o original)
      const group = m.group === null ? null : (groups.get(m.group) ?? groups.set(m.group, `${m.group}~${stamp}`).get(m.group)!);
      const copy: Motion = {
        ...m,
        id: freshId(`mo_${stamp}_`, motionIds),
        sourceId: anchor.sourceId,
        sourceTime: r3(anchor.seconds),
        group,
        status: "accepted",
      };
      motions.push(copy);
      keys.push(`motion:${copy.id}`);
    } else if (item.kind === "overlay") {
      const o = item.overlay;
      const s = r2(Math.max(0, start));
      const copy: Overlay = { ...o, id: freshId(`ov_${stamp}_`, overlayIds), start: s, end: o.end === null ? null : r2(s + (o.end - o.start)) };
      overlays.push(copy);
      keys.push(`overlay:${copy.id}`);
    } else if (item.kind === "audio") {
      const copy: AudioClip = { ...duplicateAudioClip(item.clip, freshId(`aud_${stamp}_`, audioIds)), start: r2(Math.max(0, start)), motionId: null };
      audioClips.push(copy);
      keys.push(`audio:${copy.id}`);
    }
  }
  return {
    recipe: { ...recipe, timeline: { ...recipe.timeline, segments }, motions, overlays, audioClips },
    keys,
  };
}

/** Dividir no instante `at`: trecho de vídeo, clipe de áudio ou overlay. Fora dele, nada muda */
export function splitItemAt(recipe: Recipe, key: string, at: number): Recipe {
  const id = idOf(key);
  const segments = recipe.timeline.segments;
  if (key.startsWith("segment:")) {
    const i = segments.findIndex((s) => s.id === id);
    const start = segmentStarts(segments)[i];
    if (i < 0 || at <= start || at >= start + segmentDuration(segments[i])) return recipe;
    return { ...recipe, timeline: { ...recipe.timeline, segments: splitSegmentAt(segments, at) } };
  }
  if (key.startsWith("audio:")) {
    const clip = recipe.audioClips.find((c) => c.id === id);
    const parts = clip ? splitAudioClip(clip, at, `aud_${Date.now().toString(36)}`) : null;
    if (!parts) return recipe;
    return { ...recipe, audioClips: recipe.audioClips.flatMap((c) => (c.id === id ? parts : [c])) };
  }
  if (key.startsWith("overlay:")) {
    const o = recipe.overlays.find((x) => x.id === id);
    const end = o ? (o.end ?? outputDuration(segments)) : 0;
    if (!o || at - o.start < 0.1 || end - at < 0.1) return recipe;
    const taken = new Set(recipe.overlays.map((x) => x.id));
    const second: Overlay = { ...o, id: freshId(`${o.id}_`, taken), start: r2(at) };
    return {
      ...recipe,
      overlays: recipe.overlays.flatMap((x) => (x.id === id ? [{ ...x, end: r2(at) }, second] : [x])),
    };
  }
  return recipe;
}
