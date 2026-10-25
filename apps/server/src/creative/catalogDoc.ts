import {
  COMBO_IDS,
  CREATIVE_PRESETS,
  MOTION_CATEGORY_LABEL,
  MOTION_COMBOS,
  MOTION_GALLERY_ORDER,
  MOTION_REGISTRY,
  MOTION_REGISTRY_VERSION,
} from "@vision/recipe";

/**
 * docs/motion-catalog.md gerado do Motion Registry (fonte única):
 * npm run cli -- motion-catalog --out docs/motion-catalog.md
 */
export function motionCatalogMarkdown(): string {
  const out: string[] = [
    "# Catálogo de motions e receitas",
    "",
    `> Gerado de \`packages/recipe/src/motionRegistry.ts\` e \`motionCombos.ts\` (registry v${MOTION_REGISTRY_VERSION}). Não edite à mão: rode \`npm run cli -- motion-catalog --out docs/motion-catalog.md\`.`,
    "",
    "A IA só escolhe tipo, momento e campos desta biblioteca fechada; nunca escreve animação. Textos e números precisam vir da fala ou do briefing do War (o compilador confere).",
    "",
    "## Estilos globais (iguais para todas as demandas)",
    "",
    "| Estilo | Para quê | 1 motion a cada | Máx. por 10 s | Flash |",
    "|---|---|---|---|---|",
    ...Object.entries(CREATIVE_PRESETS).map(
      ([id, p]) =>
        `| ${p.label} (\`${id}\`) | ${p.description} | ${p.secondsPerMotion} s | ${p.maxPer10s} | ${p.flashGapSeconds === Infinity ? "não" : `1 a cada ${p.flashGapSeconds} s`} |`
    ),
    "",
    "## Receitas (combos)",
    "",
  ];
  for (const id of COMBO_IDS) {
    const c = MOTION_COMBOS[id];
    out.push(
      `### ${c.label} — \`${id}\` (v${c.version})`,
      "",
      c.purpose,
      "",
      `- **Quando usar:** ${c.useWhen.join("; ")}`,
      `- **Quando NÃO usar:** ${c.avoidWhen.join("; ")}`,
      `- **Peças:** ${c.uses.map((k) => MOTION_REGISTRY[k].label).join(" + ")} (cada peça segue editável; "Remover receita inteira" tira o grupo)`,
      `- **Duração:** ${c.seconds.min}–${c.seconds.max} s (padrão ${c.seconds.default} s)`,
      `- **Campos da IA:** ${Object.entries(c.aiParams).map(([k, v]) => `\`${k}\` ${v}`).join("; ")}`,
      ""
    );
  }
  out.push("## Motions", "");
  for (const kind of MOTION_GALLERY_ORDER) {
    const m = MOTION_REGISTRY[kind];
    out.push(
      `### ${m.label} — \`${kind}\` (v${m.version}, ${MOTION_CATEGORY_LABEL[m.category]})`,
      "",
      m.purpose,
      "",
      `- **Quando usar:** ${m.useWhen.join("; ")}`,
      `- **Quando NÃO usar:** ${m.avoidWhen.join("; ")}`,
      `- **Duração:** ${m.seconds.min}–${m.seconds.max} s (padrão ${m.seconds.default} s) · intensidade ${m.intensity}/3 · camada \`${m.layer}\``,
      ...(m.variants.length ? [`- **Variantes:** ${m.variants.map((v) => `\`${v.value}\` ${v.label} — ${v.use}`).join("; ")}`] : []),
      `- **Campos da IA:** ${Object.entries(m.aiParams).map(([k, v]) => `\`${k}\` ${v}`).join("; ")}`,
      `- **Checagem de fatos:** ${{ number: "o número precisa ter sido dito ou estar no briefing", words: "≥ 50% das palavras de conteúdo vêm da fala/briefing", loose: "pelo menos uma palavra da fala/briefing", none: "—" }[m.grounding]}`,
      `- **Estilos em que combina:** ${m.styles.map((s) => CREATIVE_PRESETS[s].label).join(", ")}`,
      ""
    );
  }
  return out.join("\n");
}
