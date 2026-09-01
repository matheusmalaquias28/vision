/**
 * Migra receitas v1 (fonte única) para v2 (multi-clipe).
 * Aplicada em todo load — receitas v2 passam intactas.
 */
export function migrateRecipeData(raw: unknown): unknown {
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
