import { renderStill, selectComposition } from "@remotion/renderer";
import { MotionSchema, TRANSITION_PRESETS, TRANSITION_STYLES, type Motion } from "@vision/recipe";
import { getServeUrl } from "./bundle";

/**
 * Folha de contato dos motions para validação visual: cada variante
 * congelada num frame, renderizada pelo mesmo Remotion do MP4.
 * Uso: npm run cli -- motion-sheet --out sheet.png [--frame 20] [--file media/...] [--only chart,callout]
 * [--image media/.../illus-x.jpg] (ilustração só aparece com uma imagem já gerada)
 */

const m = (kind: string, durationSeconds: number, params: Record<string, unknown> = {}): Motion =>
  MotionSchema.parse({ id: `demo-${kind}`, kind, sourceId: "src_01", sourceTime: 0, durationSeconds, params });

/** Exemplos com texto real em pt-BR (acentos, palavras longas, números) */
export function exampleMotions(illustrationImage: string | null = null): { motion: Motion; label: string }[] {
  return [
    { motion: m("keyword", 1.6, { text: "PERDENDO CLIENTES", variant: "pop" }), label: "keyword · pop" },
    { motion: m("keyword", 1.6, { text: "SEM COMPLICAÇÃO", variant: "slide" }), label: "keyword · slide" },
    { motion: m("keyword", 1.6, { text: "Atenção", variant: "underline", position: "center" }), label: "keyword · underline" },
    { motion: m("keyword", 1.6, { text: "Economia real", variant: "marker" }), label: "keyword · marker" },
    { motion: m("kinetic", 2.2, { text: "Você está perdendo dinheiro", variant: "rise", emphasis: "dinheiro" }), label: "kinetic · rise" },
    { motion: m("kinetic", 2.2, { text: "O segredo das clínicas", variant: "blur" }), label: "kinetic · blur" },
    { motion: m("kinetic", 2.2, { text: "Resultado que aparece", variant: "mask", emphasis: "aparece" }), label: "kinetic · mask" },
    { motion: m("statement", 2.6, { text: "Atendimento que transforma", eyebrow: "Método exclusivo" }), label: "statement · center" },
    { motion: m("statement", 2.6, { text: "Mais pacientes, menos esforço", eyebrow: "Para dentistas", variant: "left" }), label: "statement · left" },
    { motion: m("statement", 3, { text: "Clica no link da bio", eyebrow: "Vagas limitadas", variant: "cta" }), label: "statement · cta" },
    { motion: m("counter", 2.2, { to: 70, suffix: "%", label: "das empresas" }), label: "counter · bold" },
    { motion: m("counter", 2.4, { to: 1500, prefix: "R$ ", label: "de economia por mês", variant: "card" }), label: "counter · card" },
    { motion: m("list", 4, { title: "O que você ganha", items: ["Mais tempo livre", "Economia de dinheiro", "Vendas todo dia"] }), label: "list · check" },
    { motion: m("list", 4, { items: ["Agende a avaliação", "Receba o plano", "Comece o tratamento"], variant: "number" }), label: "list · number" },
    { motion: m("lowerThird", 3.5, { title: "Dra. Fabíola Souza", subtitle: "Ortodontista" }), label: "lowerThird · bar" },
    { motion: m("lowerThird", 3.5, { title: "Dra. Fabíola Souza", subtitle: "Ortodontista", variant: "minimal" }), label: "lowerThird · minimal" },
    { motion: m("bubble", 3, { text: "Quanto custa o clareamento? Dói muito?", sender: "Paciente" }), label: "bubble · left" },
    { motion: m("bubble", 3, { text: "Não dói e cabe no seu bolso 😉", side: "right" }), label: "bubble · right" },
    { motion: m("arrow", 2, { direction: "down", label: "Link na bio" }), label: "arrow · down" },
    { motion: m("arrow", 2, { direction: "right", variant: "straight" }), label: "arrow · right" },
    { motion: m("emoji", 1.4, { emoji: "💰" }), label: "emoji" },
    { motion: m("zoom", 1.2, { style: "punch", scale: 1.15 }), label: "zoom · punch" },
    { motion: m("flash", 0.3, { intensity: "subtle" }), label: "flash · subtle" },
    { motion: m("annotation", 2.6, { text: "Isso muda tudo no seu negócio", target: "muda tudo" }), label: "annotation · marker" },
    { motion: m("annotation", 2.6, { text: "O segredo é a constância", target: "constância", variant: "circle" }), label: "annotation · circle" },
    { motion: m("annotation", 2.6, { text: "Pare de pagar caro", target: "caro", variant: "strike" }), label: "annotation · strike" },
    { motion: m("annotation", 2.6, { text: "Dieta da moda não funciona", target: "Dieta da moda", variant: "crossed" }), label: "annotation · crossed" },
    {
      motion: m("chart", 4, { title: "Faturamento", items: [{ label: "Antes", value: 12 }, { label: "Depois", value: 45 }], prefix: "R$ ", suffix: " mil" }),
      label: "chart · bars",
    },
    {
      motion: m("chart", 4, {
        variant: "columns",
        title: "Pacientes por mês",
        items: [{ label: "Jan", value: 40 }, { label: "Fev", value: 65 }, { label: "Mar", value: 90 }],
        suffix: "",
      }),
      label: "chart · columns",
    },
    { motion: m("chart", 4, { variant: "pie", title: "Clientes que voltam", items: [{ label: "voltam", value: 70 }], suffix: "%" }), label: "chart · pie" },
    {
      motion: m("chart", 4, {
        variant: "pie",
        title: "De onde vêm",
        items: [{ label: "Instagram", value: 55 }, { label: "Google", value: 30 }, { label: "Indicação", value: 15 }],
        suffix: "%",
        position: "center",
      }),
      label: "chart · pie legenda",
    },
    {
      motion: m("chart", 4, {
        variant: "line",
        title: "Seguidores",
        items: [{ label: "Jan", value: 2 }, { label: "Mar", value: 5 }, { label: "Mai", value: 9 }, { label: "Jul", value: 18 }],
        suffix: " mil",
      }),
      label: "chart · line",
    },
    { motion: m("callout", 2, { text: "-20%" }), label: "callout · down" },
    { motion: m("callout", 2, { text: "GRÁTIS", pointer: "left", position: "top" }), label: "callout · left" },
    { motion: m("speedLines", 0.8, {}), label: "speedLines · normal" },
    { motion: m("statement", 3, { text: "Agende agora", variant: "cta", shine: true }), label: "statement · cta shine" },
    { motion: m("screen", 2.6, { text: "O segredo é a constância", emphasis: "constância", eyebrow: "Passo 1" }), label: "screen · papel claro" },
    { motion: m("screen", 2.6, { text: "Ninguém te conta isso", emphasis: "isso", variant: "paper", tone: "dark" }), label: "screen · papel escuro" },
    { motion: m("screen", 2.6, { text: "3 erros que travam suas vendas", emphasis: "travam", eyebrow: "O problema", variant: "grid", tone: "dark" }), label: "screen · grid escuro" },
    { motion: m("screen", 2.6, { text: "Método simples em 3 passos", emphasis: "simples", variant: "grid", tone: "light", align: "left" }), label: "screen · grid claro" },
    { motion: m("screen", 2.6, { text: "Mais tempo para o que importa", emphasis: "tempo", variant: "dots" }), label: "screen · pontos" },
    { motion: m("screen", 2.6, { text: "Você merece se sentir bem", emphasis: "bem", eyebrow: "A solução", variant: "gradient", tone: "dark" }), label: "screen · gradiente" },
    {
      motion: m("screen", 4, {
        layout: "list",
        text: "Como provar a união estável",
        emphasis: "união estável",
        eyebrow: "Passo a passo",
        items: ["Conta conjunta", "Mesmo endereço", "Filhos em comum", "Testemunhas"],
        align: "left",
      }),
      label: "screen · lista número",
    },
    {
      motion: m("screen", 3.6, {
        layout: "list",
        text: "O que você ganha",
        items: ["Mais tempo livre", "Economia de verdade", "Resultado rápido"],
        marker: "check",
        variant: "grid",
        tone: "dark",
        align: "left",
      }),
      label: "screen · lista check",
    },
    ...TRANSITION_STYLES.map((style) => ({
      motion: m("transition", TRANSITION_PRESETS[style].seconds, { style }),
      label: `transition · ${style}`,
    })),
    ...(illustrationImage
      ? [
          { motion: m("illustration", 3, { subject: "exemplo", label: "Ameaça", image: illustrationImage }), label: "illustration · topo" },
          { motion: m("illustration", 3, { subject: "exemplo", image: illustrationImage, position: "center" }), label: "illustration · centro" },
        ]
      : []),
  ];
}

export async function renderMotionSheet(opts: {
  out: string;
  /** Frame congelado de cada célula; "mid" = metade da duração */
  frame: number | "mid";
  file?: string | null;
  only?: string;
  /** Imagem já gerada para os exemplos de ilustração */
  image?: string | null;
}): Promise<string> {
  const serveUrl = await getServeUrl();
  const fps = 30;
  const cells = exampleMotions(opts.image ?? null)
    .filter((e) => !opts.only || opts.only.split(",").includes(e.motion.kind))
    .map(({ motion, label }) => {
      const d = Math.round(motion.durationSeconds * fps);
      const frame = opts.frame === "mid" ? Math.round(d / 2) : Math.min(opts.frame, d - 1);
      return { motion, frame, caption: `${label} · f${frame}` };
    });
  const inputProps = { cells, file: opts.file ?? null, columns: 6 };
  const composition = await selectComposition({ serveUrl, id: "MotionSheet", inputProps });
  await renderStill({ composition, serveUrl, output: opts.out, inputProps, frame: 0 });
  return opts.out;
}
