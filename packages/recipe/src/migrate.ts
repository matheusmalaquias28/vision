/**
 * Repara ids de segmento repetidos. Versões antigas de applyCutToSegments
 * geravam `${id}b` sem checar colisão, e receitas salvas nessa época têm ids
 * duplicados (React/Remotion usam o id como key do trecho de vídeo). Os ids
 * não são referenciados em nenhum outro lugar, então renomear é seguro.
 */
function dedupeSegmentIds(raw: unknown): unknown {
  const r = raw as Record<string, any>;
  const segments = r?.timeline?.segments;
  if (!Array.isArray(segments)) return raw;
  const seen = new Set<string>();
  let changed = false;
  const fixed = segments.map((s: any) => {
    if (typeof s?.id !== "string" || !seen.has(s.id)) {
      if (typeof s?.id === "string") seen.add(s.id);
      return s;
    }
    changed = true;
    let n = 2;
    while (seen.has(`${s.id}_${n}`)) n++;
    const id = `${s.id}_${n}`;
    seen.add(id);
    return { ...s, id };
  });
  return changed ? { ...r, timeline: { ...r.timeline, segments: fixed } } : raw;
}

/**
 * Migra receitas v1 (fonte única) para v2 (multi-clipe) e repara dados
 * gravados por versões com bug. Aplicada em todo load.
 */
export function migrateRecipeData(raw: unknown): unknown {
  return migrateAudioClips(dedupeSegmentIds(migrateV1(raw)));
}

/** Duração que o SFX antigo (só um instante) reservava no render */
const LEGACY_SFX_SECONDS = 4;

/**
 * audio.music (faixa única do vídeo inteiro) e sfx (instantes) viram
 * audioClips: clipes com início, duração e corte próprios na timeline.
 */
function migrateAudioClips(raw: unknown): unknown {
  const r = raw as Record<string, any>;
  if (!r || typeof r !== "object" || Array.isArray(r.audioClips)) return raw;
  const music = r.audio?.music;
  if (!music && !Array.isArray(r.sfx)) return raw;
  const total = (r.timeline?.segments ?? []).reduce(
    (acc: number, s: any) => acc + Math.max(0, (s?.sourceEnd ?? 0) - (s?.sourceStart ?? 0)),
    0
  );
  const clips: unknown[] = [];
  if (music?.file) {
    clips.push({
      id: "aud_music",
      kind: "music",
      file: music.file,
      start: 0,
      duration: Math.max(total, 0.1),
      offset: music.startOffsetSeconds ?? 0,
      volume: music.volume ?? 0.15,
      fadeInSeconds: music.fadeInSeconds ?? 0,
      fadeOutSeconds: music.fadeOutSeconds ?? 0,
      // a faixa antiga tocava em loop até o fim do vídeo
      loop: true,
    });
  }
  for (const sfx of Array.isArray(r.sfx) ? r.sfx : []) {
    if (!sfx?.file) continue;
    clips.push({
      id: sfx.id,
      kind: "sfx",
      file: sfx.file,
      start: sfx.at ?? 0,
      duration: LEGACY_SFX_SECONDS,
      volume: sfx.volume ?? 0.8,
    });
  }
  const { sfx: _sfx, ...rest } = r;
  const { music: _music, ...audio } = r.audio ?? {};
  return { ...rest, audio, audioClips: clips };
}

function migrateV1(raw: unknown): unknown {
  const r = raw as Record<string, any>;
  if (!r || typeof r !== "object" || r.version !== 1) return raw;
  const srcId = "src_01";
  const { source, ...rest } = r;
  return {
    ...rest,
    version: 2,
    briefing: "",
    template: null,
    sources: [{ ...source, id: srcId, enhancedAudio: null }],
    timeline: {
      segments: (r.timeline?.segments ?? []).map((s: any) => ({
        ...s,
        sourceId: srcId,
      })),
      suggestedCuts: (r.timeline?.suggestedCuts ?? []).map((c: any) => ({
        ...c,
        sourceId: srcId,
      })),
    },
    captions: {
      ...r.captions,
      blocks: (r.captions?.blocks ?? []).map((b: any) => ({
        ...b,
        sourceId: srcId,
      })),
    },
    overlays: [],
    sfx: [],
    audio: { ...r.audio, useEnhanced: false, narration: null },
    effects: { punchIn: false },
  };
}
