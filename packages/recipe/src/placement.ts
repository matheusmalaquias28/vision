import type { Asset } from "./library";
import type { Overlay, Segment } from "./schema";
import { outputDuration, segmentDuration } from "./time";

/** Transição a até essa distância (s) de um corte gruda nele */
const SNAP_TO_CUT_SECONDS = 1.5;

/** Tipos da biblioteca que viram overlay na timeline */
export const VISUAL_ASSET_TYPES = ["icon", "character", "background", "transition", "overlay", "texture"] as const;

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Instantes (tempo final) das emendas entre segmentos */
export function cutPoints(segments: Segment[]): number[] {
  const out: number[] = [];
  let acc = 0;
  segments.forEach((s, i) => {
    if (i > 0) out.push(round2(acc));
    acc += segmentDuration(s);
  });
  return out;
}

export function canPlaceAsset(asset: Asset): boolean {
  return (VISUAL_ASSET_TYPES as readonly string[]).includes(asset.type);
}

/**
 * Converte um item da biblioteca num overlay pronto, com o comportamento
 * típico de cada tipo. `at` é o tempo do vídeo final (playhead ou ponto do
 * drop). Retorna null para tipos que não são visuais.
 */
export function overlayFromAsset(
  asset: Asset,
  at: number,
  segments: Segment[],
  id: string
): Overlay | null {
  if (!canPlaceAsset(asset)) return null;
  const total = outputDuration(segments);
  const kind = /\.(mp4|webm|mov)$/i.test(asset.file) ? ("video" as const) : ("image" as const);
  const media = asset.durationSeconds;

  let start = Math.max(0, at);
  let duration: number | null;
  let layout: Overlay["layout"];
  let position: Overlay["position"] = "center";
  let scale = 0.4;
  let opacity = 1;

  switch (asset.type) {
    case "transition": {
      layout = "fullscreen";
      duration = media ?? 0.8;
      const near = cutPoints(segments)
        .map((c) => ({ c, d: Math.abs(c - at) }))
        .sort((a, b) => a.d - b.d)[0];
      if (near && near.d <= SNAP_TO_CUT_SECONDS) start = Math.max(0, near.c - duration / 2);
      break;
    }
    case "background":
      layout = "fullscreen";
      duration = 5;
      break;
    case "overlay":
      layout = "fullscreen";
      // moldura estática acompanha o vídeo todo; vídeo (linhas) dura o que dura
      duration = kind === "image" ? null : (media ?? 2);
      break;
    case "texture":
      layout = "fullscreen";
      duration = null;
      opacity = 0.35;
      break;
    case "character":
      layout = "sticker";
      position = "bottom";
      scale = 0.62;
      duration = Math.min(media ?? 3, 4);
      break;
    case "icon":
    default:
      layout = "sticker";
      // "center" cai no rosto em vídeo vertical de pessoa falando
      position = "top";
      scale = 0.38;
      duration = 2;
      break;
  }

  start = Math.min(start, Math.max(0, total - 0.1));
  const end = duration === null ? null : Math.min(round2(start + duration), round2(total));

  return {
    id,
    kind,
    text: asset.name,
    file: asset.file,
    start: round2(start),
    end,
    position,
    layout,
    blend: asset.blend,
    opacity,
    scale,
    assetId: asset.id,
    mediaDurationSeconds: kind === "video" ? media : null,
    placement: null,
    framing: null,
  };
}
