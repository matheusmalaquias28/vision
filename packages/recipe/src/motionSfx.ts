import type { Asset } from "./library";
import { motionOutputStart, PUNCH_IN_GROUP } from "./motions";
import { TRANSITION_PRESETS } from "./transitions";
import type { AudioClip, Motion, Recipe } from "./schema";

/**
 * Efeitos sonoros dos motions. Cada som é um clipe comum da trilha Efeitos
 * (`audioClips`, kind "sfx") marcado com `motionId`: o operador move, troca,
 * muda o volume ou apaga o som sem mexer no motion. O vínculo só serve para:
 * o som acompanhar o motion quando ele (ou o corte) muda de lugar, sair junto
 * quando o motion é apagado/recusado e nascer quando o motion é aceito.
 * A escolha é determinística pelo estilo (nomes dos SFX da biblioteca): sem IA.
 */

export type SfxStyleId =
  | "pop"
  | "ding"
  | "whooshFast"
  | "whooshSoft"
  | "whooshBig"
  | "impact"
  | "shutter"
  | "pencil"
  | "tick"
  | "paper"
  | "glitch";

interface SfxStyle {
  label: string;
  /** Nomes da biblioteca que servem, em ordem de preferência */
  patterns: RegExp[];
  /** O som é cortado aqui (BOOM de 13 s vira um impacto curto, com fade) */
  maxSeconds: number;
  volume: number;
  /** Começa antes do motion (whoosh "puxa" a entrada) */
  lead: number;
}

export const SFX_STYLES: Record<SfxStyleId, SfxStyle> = {
  pop: { label: "Clique / pop", patterns: [/^click moderno/i, /^sfx- ?ui/i, /^click to whoosh/i, /^mouse clicks/i, /^click\b/i], maxSeconds: 1, volume: 0.5, lead: 0 },
  ding: { label: "Plim / acerto", patterns: [/^plin\b/i, /^correto moderno/i], maxSeconds: 1.6, volume: 0.45, lead: 0 },
  whooshFast: { label: "Whoosh rápido", patterns: [/^fast woosh/i, /^swoosh 0\d/i, /^swoosh( \d)?$/i, /^transition woosh/i, /^woosh 1$/i], maxSeconds: 0.8, volume: 0.5, lead: 0.05 },
  whooshSoft: { label: "Whoosh suave", patterns: [/^light whoosh/i, /^whoosh clean/i, /^main swoosh/i, /^cinematic whoosh/i, /simple whoosh/i], maxSeconds: 1.6, volume: 0.45, lead: 0.1 },
  whooshBig: { label: "Whoosh forte", patterns: [/^big woosh/i, /^deep woosh/i, /^drum woosh/i, /^aggresive woosh/i], maxSeconds: 1.5, volume: 0.5, lead: 0.1 },
  impact: { label: "Impacto", patterns: [/deep hit/i, /impact hit/i, /full hit/i, /^boom \d+/i], maxSeconds: 2.5, volume: 0.45, lead: 0 },
  shutter: { label: "Câmera / flash", patterns: [/^cam shutter/i, /^film shutter/i], maxSeconds: 1.2, volume: 0.5, lead: 0 },
  pencil: { label: "Lápis / rabisco", patterns: [/sound lapis/i], maxSeconds: 1.6, volume: 0.5, lead: 0 },
  tick: { label: "Contagem", patterns: [/^gears/i], maxSeconds: 1.6, volume: 0.4, lead: 0 },
  paper: { label: "Papel", patterns: [/^paper transition/i], maxSeconds: 1.4, volume: 0.55, lead: 0 },
  glitch: { label: "Digital", patterns: [/^transition complex/i, /^click to whoosh/i, /^sfx- ?ui/i], maxSeconds: 1.2, volume: 0.45, lead: 0 },
};

/** Estilo de som de cada motion (null = sem som automático) */
export function sfxStyleFor(m: Motion): SfxStyleId | null {
  // os zooms nos cortes já têm o whoosh de transição do template
  if (m.group === PUNCH_IN_GROUP) return null;
  const p = m.params as Record<string, unknown>;
  switch (m.kind) {
    case "keyword":
      return p.variant === "slide" ? "whooshFast" : p.variant === "underline" || p.variant === "marker" ? "pencil" : "pop";
    case "kinetic":
      return "whooshFast";
    case "annotation":
      return "pencil";
    case "statement":
      return p.variant === "cta" ? "ding" : "whooshSoft";
    case "counter":
      return "tick";
    case "chart":
    case "lowerThird":
      return "whooshSoft";
    case "list":
    case "emoji":
    case "callout":
      return "pop";
    case "bubble":
      return "ding";
    case "arrow":
      return "whooshFast";
    case "zoom":
      return p.style === "punch" ? "impact" : null;
    case "flash":
      return "shutter";
    case "speedLines":
      return "whooshBig";
    case "screen":
      return "whooshSoft";
    case "transition":
      return TRANSITION_PRESETS[m.params.style].sfx as SfxStyleId;
    case "illustration":
      return "paper";
  }
}

const sfxOnly = (assets: Asset[]) => assets.filter((a) => a.type === "sfx");

/** SFX da biblioteca que servem para um estilo, na ordem de preferência */
export function sfxForStyle(style: SfxStyleId, assets: Asset[]): Asset[] {
  const pool = sfxOnly(assets);
  const out: Asset[] = [];
  for (const re of SFX_STYLES[style].patterns) {
    for (const a of pool) if (re.test(a.name) && !out.includes(a)) out.push(a);
  }
  return out;
}

/** Variação estável entre motions do mesmo estilo (o mesmo motion sempre ganha o mesmo som) */
function stableIndex(id: string, n: number): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % n;
}

export function pickMotionSfx(m: Motion, assets: Asset[]): Asset | null {
  const style = sfxStyleFor(m);
  if (!style) return null;
  const list = sfxForStyle(style, assets);
  return list.length ? list[stableIndex(m.id, list.length)] : null;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Clipe do som com duração e fade do estilo (estilo do motion ou o padrão) */
function clipFor(m: Motion, motionStart: number, asset: Asset, start?: number, volume?: number): AudioClip {
  const style = SFX_STYLES[sfxStyleFor(m) ?? "pop"];
  const media = asset.durationSeconds ?? style.maxSeconds;
  const duration = Math.max(0.1, Math.min(media, style.maxSeconds));
  return {
    id: `sfx_${m.id}`,
    kind: "sfx",
    file: asset.file,
    start: r2(Math.max(0, start ?? motionStart - style.lead)),
    duration: r2(duration),
    offset: 0,
    volume: volume ?? style.volume,
    fadeInSeconds: 0,
    fadeOutSeconds: media > duration ? r2(Math.min(0.3, duration / 3)) : 0,
    loop: false,
    mediaDurationSeconds: asset.durationSeconds,
    assetId: asset.id,
    motionId: m.id,
    status: "accepted",
    origin: "manual",
    note: "",
  };
}

export function motionSfxClip(recipe: Recipe, motionId: string): AudioClip | null {
  return recipe.audioClips.find((c) => c.motionId === motionId) ?? null;
}

/**
 * Dá som aos motions indicados que ainda não têm (e cujo estilo existe na
 * biblioteca). Dois sons a menos de 0,25 s um do outro viram um só: numa
 * receita (CTA + seta) só a primeira peça toca.
 */
export function attachMotionSfx(recipe: Recipe, motionIds: string[], assets: Asset[]): Recipe {
  const clips = [...recipe.audioClips];
  const segments = recipe.timeline.segments;
  for (const id of motionIds) {
    const m = recipe.motions.find((x) => x.id === id);
    if (!m || m.status === "rejected" || clips.some((c) => c.motionId === id)) continue;
    const start = motionOutputStart(segments, m);
    const asset = pickMotionSfx(m, assets);
    if (start === null || !asset) continue;
    const clip = clipFor(m, start, asset);
    if (clips.some((c) => c.motionId && Math.abs(c.start - clip.start) < 0.25)) continue;
    clips.push(clip);
  }
  return clips.length === recipe.audioClips.length ? recipe : { ...recipe, audioClips: clips };
}

/** Troca o som do motion (mantém início e volume que o operador ajustou) ou cria um */
export function setMotionSfx(recipe: Recipe, motionId: string, asset: Asset): Recipe {
  const m = recipe.motions.find((x) => x.id === motionId);
  if (!m) return recipe;
  const current = motionSfxClip(recipe, motionId);
  const start = motionOutputStart(recipe.timeline.segments, m);
  if (start === null) return recipe;
  const clip = clipFor(m, start, asset, current?.start, current?.volume);
  const others = recipe.audioClips.filter((c) => c.motionId !== motionId);
  return { ...recipe, audioClips: [...others, current ? { ...clip, id: current.id } : clip] };
}

export function removeMotionSfx(recipe: Recipe, motionId: string): Recipe {
  return { ...recipe, audioClips: recipe.audioClips.filter((c) => c.motionId !== motionId) };
}

const accepted = (r: Recipe) => new Set(r.motions.filter((m) => m.status === "accepted").map((m) => m.id));

/**
 * Regras do vínculo, aplicadas a cada mudança do editor (antes → depois):
 * som de motion apagado/recusado sai; motion que mudou de lugar no vídeo
 * final (arrasto, corte) leva o som junto, com a mesma distância; motion que
 * acabou de ser aceito/inserido ganha som (se `motionStyle.autoSfx`). Som
 * mexido pelo operador nesta mesma mudança fica onde ele pôs.
 */
export function applyMotionSfxRules(prev: Recipe | null, next: Recipe, assets: Asset[]): Recipe {
  const motions = new Map(next.motions.map((m) => [m.id, m]));
  const prevClips = new Map((prev?.audioClips ?? []).map((c) => [c.id, c]));
  let changed = false;
  const clips: AudioClip[] = [];
  for (const c of next.audioClips) {
    if (!c.motionId) {
      clips.push(c);
      continue;
    }
    const m = motions.get(c.motionId);
    if (!m || m.status === "rejected") {
      changed = true;
      continue;
    }
    const before = prevClips.get(c.id);
    const pm = prev?.motions.find((x) => x.id === m.id);
    if (prev && before && before === c && pm) {
      const a = motionOutputStart(prev.timeline.segments, pm);
      const b = motionOutputStart(next.timeline.segments, m);
      if (a !== null && b !== null && Math.abs(a - b) > 1e-6) {
        clips.push({ ...c, start: r2(Math.max(0, c.start + (b - a))) });
        changed = true;
        continue;
      }
    }
    clips.push(c);
  }
  let out = changed ? { ...next, audioClips: clips } : next;
  if (prev && out.motionStyle.autoSfx) {
    const was = accepted(prev);
    const fresh = out.motions.filter((m) => m.status === "accepted" && !was.has(m.id)).map((m) => m.id);
    if (fresh.length) out = attachMotionSfx(out, fresh, assets);
  }
  return out;
}

/** Nome do estilo de som de um motion (para o painel) */
export function sfxStyleLabel(m: Motion): string | null {
  const s = sfxStyleFor(m);
  return s ? SFX_STYLES[s].label : null;
}
