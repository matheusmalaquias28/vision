import { z } from "zod";

const seconds = z.number().finite().min(0);

export const WordSchema = z
  .object({
    text: z.string().min(1),
    start: seconds,
    end: seconds,
  })
  .refine((w) => w.end >= w.start, { message: "word: end deve ser >= start" });

/**
 * sourceId aponta para a fonte cujos timestamps as palavras usam.
 * null = palavras em tempo do VÍDEO FINAL (usado pela narração).
 */
export const CaptionBlockSchema = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1).nullable().default(null),
  words: z.array(WordSchema).min(1),
});

export const CaptionStyleSchema = z.object({
  preset: z.enum(["capcut-bold"]).default("capcut-bold"),
  fontFamily: z.string().min(1).default("Archivo Black"),
  fontSizePx: z.number().int().positive().default(64),
  textColor: z.string().default("#FFFFFF"),
  highlightColor: z.string().default("#FFD700"),
  position: z.enum(["center", "bottom-third"]).default("bottom-third"),
  maxWordsPerBlock: z.number().int().min(1).max(8).default(4),
  uppercase: z.boolean().default(true),
  wordsPerLine: z.number().int().min(0).max(8).default(0),
  maxWidthPct: z.number().int().min(40).max(100).default(85),
  strokeWidthPx: z.number().int().min(0).max(40).default(12),
  strokeColor: z.string().default("#000000"),
  animation: z.enum(["pop", "none"]).default("pop"),
  autoFit: z.boolean().default(true),
});

export const SegmentSchema = z
  .object({
    id: z.string().min(1),
    sourceId: z.string().min(1),
    sourceStart: seconds,
    sourceEnd: seconds,
  })
  .refine((s) => s.sourceEnd > s.sourceStart, {
    message: "segment: duração deve ser positiva",
  });

export const SuggestedCutSchema = z
  .object({
    id: z.string().min(1),
    sourceId: z.string().min(1),
    sourceStart: seconds,
    sourceEnd: seconds,
    reason: z.literal("silence"),
    confidence: z.number().min(0).max(1),
    status: z.enum(["pending", "accepted", "rejected"]).default("pending"),
  })
  .refine((s) => s.sourceEnd > s.sourceStart, {
    message: "suggestedCut: duração deve ser positiva",
  });

export const TimelineSchema = z.object({
  // ordem do array = ordem no vídeo final; clipes podem se intercalar
  segments: z.array(SegmentSchema).min(1),
  suggestedCuts: z.array(SuggestedCutSchema).default([]),
});

export const MusicSchema = z.object({
  file: z.string().min(1),
  volume: z.number().min(0).max(1).default(0.15),
  fadeInSeconds: seconds.default(0),
  fadeOutSeconds: seconds.default(0),
  startOffsetSeconds: seconds.default(0),
});

export const NarrationSchema = z.object({
  file: z.string().min(1),
  volume: z.number().min(0).max(2).default(1),
  /** Onde a narração começa, no tempo do vídeo final */
  offsetSeconds: seconds.default(0),
});

export const AudioSchema = z.object({
  originalVolume: z.number().min(0).max(2).default(1),
  /** Usa o áudio tratado (enhancedAudio das fontes) no lugar do original */
  useEnhanced: z.boolean().default(false),
  music: MusicSchema.nullable().default(null),
  narration: NarrationSchema.nullable().default(null),
});

export const SourceSchema = z.object({
  id: z.string().min(1),
  file: z.string().min(1),
  durationInSeconds: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  /** Áudio tratado (denoise+loudnorm) gerado pelo pipeline; null = não gerado */
  enhancedAudio: z.string().nullable().default(null),
});

/** Overlays vivem no tempo do VÍDEO FINAL (decoram a edição pronta) */
export const OverlaySchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["title", "image", "video"]),
    text: z.string().default(""),
    file: z.string().nullable().default(null),
    start: seconds,
    /** null = até o fim do vídeo */
    end: seconds.nullable().default(null),
    position: z.enum(["top", "center", "bottom"]).default("top"),
    layout: z.enum(["overlay", "pip", "split-bottom"]).default("overlay"),
  })
  .refine((o) => (o.kind === "title" ? o.text.length > 0 : o.file !== null), {
    message: "overlay: title exige text; image/video exigem file",
  });

export const SfxSchema = z.object({
  id: z.string().min(1),
  file: z.string().min(1),
  /** Momento no tempo do vídeo final */
  at: seconds,
  volume: z.number().min(0).max(1).default(0.8),
});

export const EffectsSchema = z.object({
  /** Zoom rápido (punch-in) no início de cada segmento */
  punchIn: z.boolean().default(false),
});

export const RenderSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  fps: z.number().positive(),
  codec: z.enum(["h264"]).default("h264"),
});

export const RecipeSchema = z
  .object({
    version: z.literal(2),
    projectId: z.string().min(1),
    createdAt: z.string().datetime(),
    /** Direcionamento do gestor que originou a demanda */
    briefing: z.string().default(""),
    template: z.string().nullable().default(null),
    sources: z.array(SourceSchema).min(1),
    timeline: TimelineSchema,
    captions: z.object({
      style: CaptionStyleSchema.default({}),
      blocks: z.array(CaptionBlockSchema).default([]),
    }),
    overlays: z.array(OverlaySchema).default([]),
    sfx: z.array(SfxSchema).default([]),
    audio: AudioSchema.default({}),
    effects: EffectsSchema.default({}),
    render: RenderSchema,
  })
  .superRefine((r, ctx) => {
    const ids = new Set(r.sources.map((s) => s.id));
    r.timeline.segments.forEach((s, i) => {
      if (!ids.has(s.sourceId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `segment aponta para fonte inexistente "${s.sourceId}"`,
          path: ["timeline", "segments", i],
        });
      }
    });
    r.timeline.suggestedCuts.forEach((c, i) => {
      if (!ids.has(c.sourceId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `suggestedCut aponta para fonte inexistente "${c.sourceId}"`,
          path: ["timeline", "suggestedCuts", i],
        });
      }
    });
    r.captions.blocks.forEach((b, i) => {
      if (b.sourceId !== null && !ids.has(b.sourceId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `caption block aponta para fonte inexistente "${b.sourceId}"`,
          path: ["captions", "blocks", i],
        });
      }
    });
  });

export type Word = z.infer<typeof WordSchema>;
export type CaptionBlock = z.infer<typeof CaptionBlockSchema>;
export type CaptionStyle = z.infer<typeof CaptionStyleSchema>;
export type Segment = z.infer<typeof SegmentSchema>;
export type SuggestedCut = z.infer<typeof SuggestedCutSchema>;
export type Timeline = z.infer<typeof TimelineSchema>;
export type Music = z.infer<typeof MusicSchema>;
export type Narration = z.infer<typeof NarrationSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type Overlay = z.infer<typeof OverlaySchema>;
export type Sfx = z.infer<typeof SfxSchema>;
export type Recipe = z.infer<typeof RecipeSchema>;

export function parseRecipe(data: unknown): Recipe {
  return RecipeSchema.parse(data);
}
