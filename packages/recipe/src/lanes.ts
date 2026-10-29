import { audioClipEnd } from "./audioClips";
import { MOTION_REGISTRY } from "./motionRegistry";
import { placeMotions } from "./motions";
import type { AudioClip, Motion, Overlay, Recipe } from "./schema";
import { outputDuration, outputToSource } from "./time";

/**
 * Uma camada da timeline nunca tem dois itens ao mesmo tempo (eles ficavam
 * um por cima do outro na tela e na timeline). Camadas: cada camada de
 * motion do registry (câmera, texto, elemento, tela cheia — um combo tem
 * peças em camadas diferentes e pode), os overlays de mídia e a música. Efeitos
 * sonoros podem tocar juntos (o som de cada motion acompanha o motion): a
 * timeline só os empilha em sub-linhas. Textos livres (overlay "title":
 * headline, aviso) também: uma headline do início ao fim convive com outros
 * textos e com as imagens/vídeos dos overlays.
 */

/** Trecho ocupado no vídeo final */
export interface Span {
  start: number;
  end: number;
}

interface LaneItem extends Span {
  key: string;
  lane: string;
  /** Peças de um combo andam juntas */
  group: string | null;
}

const EPS = 1e-3;

const overlaps = (a: Span, b: Span) => a.start < b.end - EPS && b.start < a.end - EPS;

export function motionLane(m: Pick<Motion, "kind">): string {
  return `motion:${MOTION_REGISTRY[m.kind].layer}`;
}

/** Itens de todas as camadas com regra (motions não recusados, overlays, música) */
function laneItems(recipe: Recipe): LaneItem[] {
  const total = outputDuration(recipe.timeline.segments);
  const items: LaneItem[] = placeMotions(recipe, true).map((p) => ({
    key: `motion:${p.motion.id}`,
    lane: motionLane(p.motion),
    group: p.motion.group,
    start: p.outputStart,
    end: p.outputEnd,
  }));
  for (const o of recipe.overlays) {
    if (o.kind === "title") continue;
    items.push({ key: `overlay:${o.id}`, lane: "overlay", group: null, start: o.start, end: o.end ?? total });
  }
  for (const c of recipe.audioClips) {
    if (c.kind === "music") items.push({ key: `audio:${c.id}`, lane: "music", group: null, start: c.start, end: audioClipEnd(c) });
  }
  return items;
}

/** Trechos ocupados na camada de `key` ("motion:id", "overlay:id", "audio:id"), sem ele mesmo */
export function laneSpansFor(recipe: Recipe, key: string): Span[] {
  const items = laneItems(recipe);
  const self = items.find((i) => i.key === key);
  if (!self) return [];
  return items.filter((i) => i.lane === self.lane && i.key !== key);
}

/**
 * Início mais perto de `start` em que [início, início+dur] cabe em [0, total]
 * sem sobrepor nenhum trecho (encostar pode). null = não cabe em lugar nenhum.
 */
export function fitInLane(spans: Span[], start: number, dur: number, total: number): number | null {
  const candidates = [start, ...spans.flatMap((s) => [s.end, s.start - dur])];
  let best: number | null = null;
  for (const c of candidates) {
    if (c < -EPS || c + dur > total + EPS) continue;
    if (spans.some((s) => overlaps(s, { start: c, end: c + dur }))) continue;
    if (best === null || Math.abs(c - start) < Math.abs(best - start)) best = c;
  }
  return best === null ? null : Math.max(0, best);
}

/** Até onde as bordas de um item em [start, end] podem ir sem encostar nos vizinhos da camada */
export function edgeLimits(spans: Span[], start: number, end: number): { minStart: number; maxEnd: number } {
  let minStart = 0;
  let maxEnd = Infinity;
  for (const s of spans) {
    if (s.end <= start + EPS) minStart = Math.max(minStart, s.end);
    if (s.start >= end - EPS) maxEnd = Math.min(maxEnd, s.start);
  }
  return { minStart, maxEnd };
}

/** Deslocamento mínimo que tira todas as peças de sobreposição (null = não há) */
function fitUnit(pieces: LaneItem[], fixed: LaneItem[], total: number): number | null {
  const sameLane = (p: LaneItem) => fixed.filter((f) => f.lane === p.lane);
  const deltas = [0];
  for (const p of pieces) {
    for (const s of sameLane(p)) deltas.push(s.end - p.start, s.start - p.end);
  }
  const first = Math.min(...pieces.map((p) => p.start));
  const last = Math.max(...pieces.map((p) => p.end));
  let best: number | null = null;
  for (const d of deltas) {
    if (first + d < -EPS || last + d > Math.max(total, last) + EPS) continue;
    const ok = pieces.every((p) => !sameLane(p).some((s) => overlaps(s, { start: p.start + d, end: p.end + d })));
    if (ok && (best === null || Math.abs(d) < Math.abs(best))) best = d;
  }
  return best;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Roda em toda mudança do editor: item novo ou que mudou de lugar e caiu em
 * cima de outro da mesma camada vai para o espaço livre mais perto (combo
 * anda inteiro). Sem espaço, a mudança desse item é desfeita (novo: não
 * entra). Item que não mudou fica onde está — um corte nunca empurra
 * motions; edição de texto/cor também não mexe na posição.
 */
export function enforceLanes(prev: Recipe | null, next: Recipe): Recipe {
  const prevItems = new Map((prev ? laneItems(prev) : []).map((i) => [i.key, i]));
  const prevObj = new Map<string, Motion | Overlay | AudioClip>();
  if (prev) {
    for (const m of prev.motions) prevObj.set(`motion:${m.id}`, m);
    for (const o of prev.overlays) prevObj.set(`overlay:${o.id}`, o);
    for (const c of prev.audioClips) prevObj.set(`audio:${c.id}`, c);
  }
  const objOf = (key: string): Motion | Overlay | AudioClip | undefined => {
    const id = key.slice(key.indexOf(":") + 1);
    if (key.startsWith("motion:")) return next.motions.find((m) => m.id === id);
    if (key.startsWith("overlay:")) return next.overlays.find((o) => o.id === id);
    return next.audioClips.find((c) => c.id === id);
  };

  const items = laneItems(next);
  const moved = (i: LaneItem) => {
    if (prevObj.get(i.key) === objOf(i.key)) return false;
    const before = prevItems.get(i.key);
    return !before || before.lane !== i.lane || Math.abs(before.start - i.start) > EPS || Math.abs(before.end - i.end) > EPS;
  };
  const changed = items.filter(moved);
  if (changed.length === 0) return next;
  const fixed = items.filter((i) => !changed.includes(i));

  // unidades: peças do mesmo combo juntas, o resto sozinho
  const units = new Map<string, LaneItem[]>();
  for (const i of changed) {
    const k = i.group ? `group:${i.group}` : i.key;
    units.set(k, [...(units.get(k) ?? []), i]);
  }
  const total = outputDuration(next.timeline.segments);
  const shift = new Map<string, number>();
  const revert = new Set<string>();
  for (const pieces of [...units.values()].sort((a, b) => a[0].start - b[0].start)) {
    const d = fitUnit(pieces, fixed, total);
    if (d === null) {
      for (const p of pieces) revert.add(p.key);
      continue;
    }
    for (const p of pieces) {
      if (Math.abs(d) > EPS) shift.set(p.key, d);
      fixed.push({ ...p, start: p.start + d, end: p.end + d });
    }
  }
  if (shift.size === 0 && revert.size === 0) return next;

  const segments = next.timeline.segments;
  const motions: Motion[] = [];
  for (const m of next.motions) {
    const key = `motion:${m.id}`;
    if (revert.has(key)) {
      const old = prevObj.get(key) as Motion | undefined;
      if (old) motions.push(old);
      continue;
    }
    const d = shift.get(key);
    if (d === undefined) {
      motions.push(m);
      continue;
    }
    const start = items.find((i) => i.key === key)!.start + d;
    const anchor = outputToSource(segments, start);
    if (!anchor) {
      const old = prevObj.get(key) as Motion | undefined;
      if (old) motions.push(old);
      continue;
    }
    motions.push({ ...m, sourceId: anchor.sourceId, sourceTime: r3(anchor.seconds) });
  }
  const overlays: Overlay[] = [];
  for (const o of next.overlays) {
    const key = `overlay:${o.id}`;
    if (revert.has(key)) {
      const old = prevObj.get(key) as Overlay | undefined;
      if (old) overlays.push(old);
      continue;
    }
    const d = shift.get(key);
    overlays.push(d === undefined ? o : { ...o, start: r2(o.start + d), end: r2((o.end ?? total) + d) });
  }
  const audioClips: AudioClip[] = [];
  for (const c of next.audioClips) {
    const key = `audio:${c.id}`;
    if (revert.has(key)) {
      const old = prevObj.get(key) as AudioClip | undefined;
      if (old) audioClips.push(old);
      continue;
    }
    const d = shift.get(key);
    audioClips.push(d === undefined ? c : { ...c, start: r2(Math.max(0, c.start + d)) });
  }
  return { ...next, motions, overlays, audioClips };
}

/** Sub-linhas para itens que podem se sobrepor (efeitos sonoros): primeira linha livre de cada um */
export function packRows<T extends Span>(items: T[]): { item: T; row: number }[] {
  const rowEnds: number[] = [];
  return [...items]
    .sort((a, b) => a.start - b.start)
    .map((item) => {
      let row = rowEnds.findIndex((end) => end <= item.start + EPS);
      if (row < 0) {
        row = rowEnds.length;
        rowEnds.push(item.end);
      } else {
        rowEnds[row] = item.end;
      }
      return { item, row };
    });
}
