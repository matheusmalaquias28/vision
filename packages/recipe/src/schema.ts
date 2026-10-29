import { z } from "zod";
import { MusicWantSchema } from "./music";
import { ColorGradeSchema } from "./color";
import { FramingSchema } from "./framing";
import { TRANSITION_STYLES } from "./transitions";
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
  fontFamily: z.string().min(1).default("Poppins"),
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
  strokeWidthPx: z.number().int().min(0).max(40).default(6),
  strokeColor: z.string().default("#000000"),
  /**
   * pop (padrão antigo) · none · smooth (sobe e aparece, destaque gradual) ·
   * reveal (palavra a palavra) · box (pílula atrás da palavra falada) ·
   * blur (sai do desfoque, letras se aproximam)
   */
  animation: z.enum(["pop", "none", "smooth", "reveal", "box", "blur"]).default("pop"),
  /**
   * Obsoleto (ignorado no render): a legenda tem tamanho fixo; frase longa é
   * quebrada em partes que cabem em `maxLines` linhas.
   */
  autoFit: z.boolean().default(false),
  /** Linhas por vez na tela; a frase que não cabe vira partes na sequência da fala */
  maxLines: z.number().int().min(1).max(3).default(2),
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
  /** Som de um motion (`motionSfx.ts`): acompanha o motion; null = clipe solto */
  motionId: z.string().nullable().default(null),
  /** Música sugerida pela IA fica "pending": toca no preview, só entra no MP4 aceita */
  status: z.enum(["accepted", "pending"]).default("accepted"),
  origin: z.enum(["manual", "ai"]).default("manual"),
  /** Motivo da sugestão ("energia 4/5 · animada · sem voz") */
  note: z.string().default(""),
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
  /** Ajuste de cor deste vídeo (LOG/flat, exposição…); null = original */
  color: ColorGradeSchema.nullable().default(null),
  /** Enquadramento (subir/descer, zoom) quando o vídeo é cortado para caber, ex. no split; null = centro */
  framing: FramingSchema.nullable().default(null),
});

/** Cor só em hexadecimal #RRGGBB: nada de CSS livre na receita */
export const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "cor deve ser #RRGGBB");

/**
 * Visual do texto livre (overlay "title": headline, aviso, chamada), à parte
 * da legenda. Os padrões reproduzem o título antigo: projetos salvos renderizam igual.
 */
export const TitleStyleSchema = z.object({
  /** px num quadro de 1080 de largura */
  fontSize: z.number().min(16).max(240).default(58),
  fontWeight: z.number().int().min(300).max(900).default(900),
  uppercase: z.boolean().default(true),
  align: z.enum(["left", "center", "right"]).default("center"),
  color: HexColorSchema.default("#FFFFFF"),
  /** Contorno (0 = sem) */
  strokeWidth: z.number().min(0).max(30).default(10),
  strokeColor: HexColorSchema.default("#000000"),
  /** Caixa atrás do texto (null = sem caixa) */
  boxColor: HexColorSchema.nullable().default(null),
  /** Largura máxima em % da largura do quadro (quebra linha depois disso) */
  maxWidth: z.number().min(20).max(100).default(88),
});
export type TitleStyle = z.infer<typeof TitleStyleSchema>;
export const DEFAULT_TITLE_STYLE: TitleStyle = TitleStyleSchema.parse({});

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
     * overlay: destaque central · pip: janela no canto · split-bottom /
     * split-top: metade de baixo / de cima (o vídeo principal vai para a
     * outra metade) · fullscreen: cobre o quadro (fundos, transições,
     * molduras) · sticker: elemento solto sobre o vídeo (ícones, personagens)
     */
    layout: z.enum(["overlay", "pip", "split-bottom", "split-top", "fullscreen", "sticker"]).default("overlay"),
    /** Mescla com o vídeo: screen some o preto (luz), multiply some o branco */
    blend: z.enum(BLEND_MODES).default("normal"),
    opacity: z.number().min(0).max(1).default(1),
    /** Largura do sticker como fração da largura do quadro */
    scale: z.number().min(0.05).max(1).default(0.4),
    /** Item da biblioteca de origem (null = upload avulso) */
    assetId: z.string().nullable().default(null),
    /** Duração da mídia; overlay mais longo que isso repete em loop */
    mediaDurationSeconds: z.number().positive().nullable().default(null),
    /** Posição livre (null = usa `position`); ignorada em fullscreen e split */
    placement: PointSchema.nullable().default(null),
    /** Enquadramento da mídia dentro da área (split, PiP, tela cheia); null = centro */
    framing: FramingSchema.nullable().default(null),
    /** Só no kind "title" */
    titleStyle: TitleStyleSchema.default({}),
  })
  .refine((o) => (o.kind === "title" ? o.text.length > 0 : o.file !== null), {
    message: "overlay: title exige text; image/video exigem file",
  });

/**
 * Biblioteca fechada de motions: a IA escolhe QUAL e QUANDO, nunca escreve
 * animação. Visual herda fonte e cor de destaque do estilo da legenda.
 */
export const MOTION_KINDS = [
  "zoom",
  "keyword",
  "emoji",
  "lowerThird",
  "counter",
  "flash",
  "kinetic",
  "statement",
  "list",
  "bubble",
  "arrow",
  "annotation",
  "chart",
  "callout",
  "speedLines",
  "screen",
  "transition",
  "illustration",
] as const;
export type MotionKind = (typeof MOTION_KINDS)[number];

/** Intensidade visual comum (escala, contraste, tamanho), sem CSS livre */
export const MOTION_INTENSITIES = ["subtle", "normal", "strong"] as const;
const intensity = z.enum(MOTION_INTENSITIES).default("normal");

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
  /**
   * Peças de uma receita de motion (combo) compartilham "<combo>:<n>": dá
   * para remover o grupo de uma vez, mas cada peça segue editável sozinha.
   */
  group: z.string().max(60).nullable().default(null),
  /** Cor de destaque só deste motion (null = cor padrão dos motions do vídeo) */
  accentColor: HexColorSchema.nullable().default(null),
  /** Tamanho do elemento na tela (1 = padrão do tipo); câmera e tela cheia ignoram */
  size: z.number().min(0.3).max(3).default(1),
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
        /** Ponto que fica parado no zoom, em % do quadro (padrão: rosto em vídeo vertical) */
        focusX: z.number().min(0).max(100).default(50),
        focusY: z.number().min(0).max(100).default(40),
      })
      .default({}),
  }),
  z.object({
    ...motionBase,
    kind: z.literal("keyword"),
    params: z.object({
      text: z.string().min(1).max(40),
      position: z.enum(["top", "center"]).default("top"),
      /** pop: selo inclinado (visual original) · slide · underline · marker (marca-texto) */
      variant: z.enum(["pop", "slide", "underline", "marker"]).default("pop"),
      intensity,
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
      /** bar: barra de cor + cartão escuro (original) · minimal: texto com fio fino */
      variant: z.enum(["bar", "minimal"]).default("bar"),
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
      /** bold: número grande com contorno (original) · card: cartão com barra de progresso */
      variant: z.enum(["bold", "card"]).default("bold"),
    }),
  }),
  z.object({
    ...motionBase,
    kind: z.literal("flash"),
    params: z
      .object({
        color: z.string().default("#FFFFFF"),
        /** normal: pico de 85% (original) · subtle: 45%, para quem pede discrição */
        intensity: z.enum(["subtle", "normal"]).default("normal"),
      })
      .default({}),
  }),
  z.object({
    ...motionBase,
    kind: z.literal("kinetic"),
    params: z.object({
      text: z.string().trim().min(1).max(60),
      /** rise: palavras sobem em cascata · blur: foco entrando · mask: revelação por máscara */
      variant: z.enum(["rise", "blur", "mask"]).default("rise"),
      position: z.enum(["top", "center"]).default("center"),
      /** Palavra da frase pintada na cor de destaque ("" = nenhuma) */
      emphasis: z.string().max(30).default(""),
    }),
  }),
  z.object({
    ...motionBase,
    kind: z.literal("statement"),
    params: z.object({
      text: z.string().trim().min(1).max(70),
      /** Linha pequena acima do texto ("" = sem) */
      eyebrow: z.string().max(30).default(""),
      /** center: chamada centralizada · left: alinhada à esquerda · cta: chamada para ação com botão */
      variant: z.enum(["center", "left", "cta"]).default("center"),
      /** Brilho que atravessa o texto/botão (inspirado no Shine do Remotion Elements) */
      shine: z.boolean().default(false),
    }),
  }),
  z.object({
    ...motionBase,
    kind: z.literal("list"),
    params: z.object({
      title: z.string().max(40).default(""),
      items: z.array(z.string().trim().min(1).max(40)).min(2).max(5),
      variant: z.enum(["check", "number"]).default("check"),
      position: z.enum(["top", "center"]).default("center"),
    }),
  }),
  z.object({
    ...motionBase,
    kind: z.literal("bubble"),
    params: z.object({
      text: z.string().trim().min(1).max(120),
      /** Quem "fala" ("" = sem nome) */
      sender: z.string().max(30).default(""),
      side: z.enum(["left", "right"]).default("left"),
    }),
  }),
  z.object({
    ...motionBase,
    kind: z.literal("arrow"),
    params: z
      .object({
        /** Para onde a seta aponta */
        direction: z.enum(["down", "up", "left", "right"]).default("down"),
        label: z.string().max(30).default(""),
        variant: z.enum(["curve", "straight"]).default("curve"),
      })
      .default({}),
  }),
  // ── Adaptados do Remotion Elements (marcações, gráficos, callout, speed lines) ──
  z.object({
    ...motionBase,
    kind: z.literal("annotation"),
    params: z.object({
      /** Frase mostrada na tela */
      text: z.string().trim().min(1).max(70),
      /** Palavra(s) da frase que recebem a marcação ("" = a palavra mais longa) */
      target: z.string().max(40).default(""),
      /** marker: marca-texto · circle: círculo · strike: risco · crossed: rabisco de "errado" */
      variant: z.enum(["marker", "circle", "strike", "crossed"]).default("marker"),
      position: z.enum(["top", "center"]).default("center"),
    }),
  }),
  z.object({
    ...motionBase,
    kind: z.literal("chart"),
    params: z.object({
      /** pie: pizza · bars: barras horizontais · columns: colunas · line: linha (evolução) */
      variant: z.enum(["pie", "bars", "columns", "line"]).default("bars"),
      title: z.string().max(40).default(""),
      items: z
        .array(z.object({ label: z.string().trim().min(1).max(24), value: z.number() }))
        .min(1)
        .max(7),
      prefix: z.string().max(6).default(""),
      suffix: z.string().max(8).default(""),
      position: z.enum(["top", "center"]).default("top"),
    }),
  }),
  z.object({
    ...motionBase,
    kind: z.literal("callout"),
    params: z.object({
      /** Texto curto do selo: "-20%", "GRÁTIS", "NOVO" */
      text: z.string().trim().min(1).max(14),
      /** Para onde o bico aponta */
      pointer: z.enum(["down", "up", "left", "right"]).default("down"),
      position: z.enum(["top", "center"]).default("center"),
    }),
  }),
  z.object({
    ...motionBase,
    kind: z.literal("speedLines"),
    params: z
      .object({
        intensity: z.enum(["subtle", "normal"]).default("normal"),
        /** light: linhas brancas · dark: linhas pretas */
        tone: z.enum(["light", "dark"]).default("light"),
      })
      .default({}),
  }),
  z.object({
    ...motionBase,
    kind: z.literal("screen"),
    params: z
      .object({
      /** Frase grande da tela (2–12 palavras); no modelo lista é o título */
      text: z.string().trim().min(1).max(90),
      /** Modelo do texto: frase grande (padrão) ou lista com itens entrando um a um */
      layout: z.enum(["phrase", "list"]).default("phrase"),
      /** Itens do modelo lista (2–5, curtos) */
      items: z.array(z.string().trim().min(1).max(40)).max(5).default([]),
      /** Marcador dos itens da lista: número (passos) ou check (benefícios) */
      marker: z.enum(["number", "check"]).default("number"),
      /** Linha pequena acima ("PASSO 1", "O PROBLEMA") */
      eyebrow: z.string().max(30).default(""),
      /** Palavra(s) da frase na cor de destaque */
      emphasis: z.string().max(40).default(""),
      /** Fundo animado: papel · grid · pontos · gradiente */
      variant: z.enum(["paper", "grid", "dots", "gradient"]).default("paper"),
      /** light: papel creme/fundo claro · dark: papel escuro/fundo escuro */
      tone: z.enum(["light", "dark"]).default("light"),
      /** slide: a tela sobe por cima do vídeo · fade: aparece suave */
      transition: z.enum(["slide", "fade"]).default("slide"),
      align: z.enum(["center", "left"]).default("center"),
      /** A legenda some enquanto a tela está cheia (o texto já está nela) */
      hideCaptions: z.boolean().default(true),
      })
      .refine((p) => p.layout !== "list" || p.items.length >= 2, {
        message: "a lista precisa de 2 a 5 itens",
        path: ["items"],
      }),
  }),
  z.object({
    ...motionBase,
    kind: z.literal("transition"),
    params: z
      .object({
        /** Modelo (vídeo da biblioteca + som): luz, queima de filme, glitch, varrida, papel */
        style: z.enum(TRANSITION_STYLES).default("flare"),
      })
      .default({}),
  }),
  z.object({
    ...motionBase,
    kind: z.literal("illustration"),
    params: z.object({
      /** O que desenhar (objeto/cena simbólica do ponto-chave); o estilo é fixo no código */
      subject: z.string().trim().min(2).max(300),
      /** Legenda curta no cartão, com marca-texto (opcional) */
      label: z.string().max(40).default(""),
      /** Imagem gerada (assets do projeto); null = ainda não gerada (não aparece no MP4) */
      image: z.string().nullable().default(null),
      position: z.enum(["top", "center"]).default("top"),
      /** Tamanho do cartão (1 = 800 px de largura, o padrão antigo) */
      size: z.number().min(0.4).max(1.25).default(1),
    }),
  }),
]);

export const EffectsSchema = z.object({
  /**
   * OBSOLETO: o zoom nos cortes agora são motions de zoom visíveis na timeline
   * (`punchInMotions`). `migrateRecipeData` converte true em motions e zera.
   */
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
    /** Aparência comum dos motions do vídeo */
    motionStyle: z
      .object({
        /** Cor de destaque padrão (null = a cor de destaque da legenda) */
        accentColor: HexColorSchema.nullable().default(null),
        /** Motion aceito/inserido ganha efeito sonoro da biblioteca */
        autoSfx: z.boolean().default(true),
      })
      .default({}),
    audio: AudioSchema.default({}),
    /** Trilha que o vídeo pede, descrita pelo planner (base do "outra música") */
    musicWant: MusicWantSchema.nullable().default(null),
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
