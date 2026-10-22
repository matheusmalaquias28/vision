import { z } from "zod";
import { BLEND_MODES } from "./library";

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

/**
 * Posição livre de um elemento, arrastado no preview: centro do elemento em %
 * da LARGURA (x) e da ALTURA (y) do quadro. null = posição padrão do layout.
 */
export const PointSchema = z.object({
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(100),
});

export const CaptionStyleSchema = z.object({
  preset: z.enum(["capcut-bold"]).default("capcut-bold"),
  fontFamily: z.string().min(1).default("Archivo Black"),
  fontSizePx: z.number().int().positive().default(64),
  /** Peso CSS (100 fino … 900 black); peso que a fonte não tem é simulado pelo navegador */
  fontWeight: z.number().int().min(100).max(900).multipleOf(100).default(900),
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
  /** Posição livre de todas as legendas (null = usa `position`) */
  placement: PointSchema.nullable().default(null),
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

/**
 * silence: ffmpeg silencedetect · pause: buraco entre palavras da transcrição
 * filler: vício de linguagem · repeat: palavra repetida em sequência
 * retake: retomada/começo falso (sugerido pela IA)
 */
export const CUT_REASONS = ["silence", "pause", "filler", "repeat", "retake"] as const;
export type CutReason = (typeof CUT_REASONS)[number];

export const SuggestedCutSchema = z
  .object({
    id: z.string().min(1),
    sourceId: z.string().min(1),
    sourceStart: seconds,
    sourceEnd: seconds,
    reason: z.enum(CUT_REASONS),
    confidence: z.number().min(0).max(1),
    status: z.enum(["pending", "accepted", "rejected"]).default("pending"),
    /** Explicação curta para o operador (ex.: texto cortado, motivo da IA) */
    note: z.string().default(""),
  })
  .refine((s) => s.sourceEnd > s.sourceStart, {
    message: "suggestedCut: duração deve ser positiva",
  });

export const TimelineSchema = z.object({
  // ordem do array = ordem no vídeo final; clipes podem se intercalar
  segments: z.array(SegmentSchema).min(1),
  suggestedCuts: z.array(SuggestedCutSchema).default([]),
});

/**
 * Clipe de áudio solto na timeline (música ou efeito sonoro). Vive no tempo
 * do VÍDEO FINAL, como overlays: não acompanha cortes no bruto.
 */
export const AUDIO_CLIP_KINDS = ["music", "sfx"] as const;
export type AudioClipKind = (typeof AUDIO_CLIP_KINDS)[number];

export const AudioClipSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(AUDIO_CLIP_KINDS),
  file: z.string().min(1),
  /** Início no vídeo final */
  start: seconds,
  /** Duração no vídeo final */
  duration: z.number().positive(),
  /** Quanto do começo do arquivo é pulado */
  offset: seconds.default(0),
  volume: z.number().min(0).max(1).default(0.8),
  /** Fades relativos ao próprio clipe */
  fadeInSeconds: seconds.default(0),
  fadeOutSeconds: seconds.default(0),
  /** Repete o arquivo se o clipe for mais longo que ele (trilha de fundo) */
  loop: z.boolean().default(false),
  mediaDurationSeconds: z.number().positive().nullable().default(null),
  /** Item da biblioteca de origem (null = arquivo avulso) */
  assetId: z.string().nullable().default(null),
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
  narration: NarrationSchema.nullable().default(null),
});

export const SourceSchema = z.object({
  id: z.string().min(1),
  file: z.string().min(1),
  /** Nome original do arquivo enviado (guia para o operador; "" em projetos antigos) */
  name: z.string().default(""),
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
    /**
     * overlay: destaque central · pip: janela no canto · split-bottom: metade
     * de baixo · fullscreen: cobre o quadro (fundos, transições, molduras)
     * · sticker: elemento solto sobre o vídeo (ícones, personagens)
     */
    layout: z.enum(["overlay", "pip", "split-bottom", "fullscreen", "sticker"]).default("overlay"),
    /** Mescla com o vídeo: screen some o preto (luz), multiply some o branco */
    blend: z.enum(BLEND_MODES).default("normal"),
    opacity: z.number().min(0).max(1).default(1),
    /** Largura do sticker como fração da largura do quadro */
    scale: z.number().min(0.05).max(1).default(0.4),
    /** Item da biblioteca de origem (null = upload avulso) */
    assetId: z.string().nullable().default(null),
    /** Duração da mídia; overlay mais longo que isso repete em loop */
    mediaDurationSeconds: z.number().positive().nullable().default(null),
    /** Posição livre (null = usa `position`); ignorada em fullscreen/split-bottom */
    placement: PointSchema.nullable().default(null),
  })
  .refine((o) => (o.kind === "title" ? o.text.length > 0 : o.file !== null), {
    message: "overlay: title exige text; image/video exigem file",
  });

/**
 * Biblioteca fechada de motions: a IA escolhe QUAL e QUANDO, nunca escreve
 * animação. Visual herda fonte e cor de destaque do estilo da legenda.
 */
export const MOTION_KINDS = ["zoom", "keyword", "emoji", "lowerThird", "counter", "flash"] as const;
export type MotionKind = (typeof MOTION_KINDS)[number];

const motionBase = {
  id: z.string().min(1),
  /** Âncora no clipe BRUTO (em geral o início de uma palavra): acompanha cortes */
  sourceId: z.string().min(1),
  sourceTime: seconds,
  /** Duração no tempo do vídeo final, a partir da âncora */
  durationSeconds: z.number().min(0.1).max(15).default(1.5),
  /** Só "accepted" vai para o render; "pending" aparece como prévia no editor */
  status: z.enum(["pending", "accepted", "rejected"]).default("accepted"),
  origin: z.enum(["ai", "manual"]).default("manual"),
  note: z.string().default(""),
  /** Posição livre arrastada no preview (null = posição do tipo/params); zoom e flash ignoram */
  placement: PointSchema.nullable().default(null),
};

export const MotionSchema = z.discriminatedUnion("kind", [
  z.object({
    ...motionBase,
    kind: z.literal("zoom"),
    params: z
      .object({
        scale: z.number().min(1).max(1.6).default(1.15),
        /** punch: entra seco (ênfase) · smooth: aproxima devagar (explicação) */
        style: z.enum(["punch", "smooth"]).default("punch"),
      })
      .default({}),
  }),
  z.object({
    ...motionBase,
    kind: z.literal("keyword"),
    params: z.object({
      text: z.string().min(1).max(40),
      position: z.enum(["top", "center"]).default("top"),
    }),
  }),
  z.object({
    ...motionBase,
    kind: z.literal("emoji"),
    params: z.object({
      emoji: z.string().min(1).max(16),
      position: z.enum(["top", "center", "side"]).default("side"),
    }),
  }),
  z.object({
    ...motionBase,
    kind: z.literal("lowerThird"),
    params: z.object({
      title: z.string().min(1).max(40),
      subtitle: z.string().max(60).default(""),
    }),
  }),
  z.object({
    ...motionBase,
    kind: z.literal("counter"),
    params: z.object({
      from: z.number().default(0),
      to: z.number(),
      decimals: z.number().int().min(0).max(2).default(0),
      prefix: z.string().max(8).default(""),
      suffix: z.string().max(12).default(""),
      label: z.string().max(40).default(""),
    }),
  }),
  z.object({
    ...motionBase,
    kind: z.literal("flash"),
    params: z.object({ color: z.string().default("#FFFFFF") }).default({}),
  }),
]);

export const EffectsSchema = z.object({
  /** Zoom rápido (punch-in) no início de cada segmento */
  punchIn: z.boolean().default(false),
});

/**
 * Camadas visuais, empilhadas na ordem de layerOrder: a primeira fica na
 * frente de todas, a última no fundo. A timeline mostra as trilhas nessa ordem.
 */
export const VISUAL_LAYERS = ["captions", "motions", "overlays", "video"] as const;
export type VisualLayer = (typeof VISUAL_LAYERS)[number];

export const LayerOrderSchema = z
  .array(z.enum(VISUAL_LAYERS))
  .default([...VISUAL_LAYERS])
  .refine((order) => order.length === VISUAL_LAYERS.length && new Set(order).size === order.length, {
    message: "layerOrder: precisa listar cada camada visual uma vez",
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
    audioClips: z.array(AudioClipSchema).default([]),
    layerOrder: LayerOrderSchema,
    motions: z.array(MotionSchema).default([]),
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
    r.motions.forEach((m, i) => {
      if (!ids.has(m.sourceId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `motion aponta para fonte inexistente "${m.sourceId}"`,
          path: ["motions", i],
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
export type AudioClip = z.infer<typeof AudioClipSchema>;
export type Narration = z.infer<typeof NarrationSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type Overlay = z.infer<typeof OverlaySchema>;
export type Point = z.infer<typeof PointSchema>;
export type Motion = z.infer<typeof MotionSchema>;
export type MotionOf<K extends MotionKind> = Extract<Motion, { kind: K }>;
export type Recipe = z.infer<typeof RecipeSchema>;

export function parseRecipe(data: unknown): Recipe {
  return RecipeSchema.parse(data);
}
