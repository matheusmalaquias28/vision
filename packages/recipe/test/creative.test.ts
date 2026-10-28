import { describe, expect, it } from "vitest";
import {
  buildFacts,
  checkGrounding,
  compilePlan,
  LIST_SCREEN_SECONDS,
  formatCatalogForPrompt,
  getCandidateCombos,
  getCandidateMotions,
  interpretBriefing,
  spokenWords,
  validateComposition,
  type CreativePlan,
  type RankedCandidate,
} from "../src/creative";
import { MOTION_COMBOS, COMBO_IDS } from "../src/motionCombos";
import { applyAccentToAll, resolveMotionAccent, videoMotionAccent } from "../src/motions";
import { MOTION_REGISTRY, parseChartItems, parseSlotNumber } from "../src/motionRegistry";
import { MOTION_KINDS, MotionSchema, parseRecipe, type Recipe } from "../src/schema";

/** Receita com uma fala por palavra a cada 0,5 s e um corte opcional */
function recipe(text: string, opts: { briefing?: string; cut?: [number, number]; motions?: unknown[] } = {}): Recipe {
  const words = text.split(" ").map((w, i) => ({ text: w, start: i * 0.5, end: i * 0.5 + 0.4 }));
  const total = words.length * 0.5 + 1;
  const segments = opts.cut
    ? [
        { id: "seg_01", sourceId: "src_01", sourceStart: 0, sourceEnd: opts.cut[0] },
        { id: "seg_02", sourceId: "src_01", sourceStart: opts.cut[1], sourceEnd: total },
      ]
    : [{ id: "seg_01", sourceId: "src_01", sourceStart: 0, sourceEnd: total }];
  return parseRecipe({
    version: 2,
    projectId: "t",
    createdAt: "2026-10-01T00:00:00Z",
    briefing: opts.briefing ?? "",
    sources: [{ id: "src_01", file: "media/a.mp4", durationInSeconds: total, width: 1080, height: 1920, fps: 30 }],
    timeline: { segments },
    captions: { blocks: [{ id: "b1", sourceId: "src_01", start: 0, end: total, text, words }] },
    motions: opts.motions ?? [],
    render: { width: 1080, height: 1920, fps: 30 },
  });
}

const FALA =
  "você está perdendo clientes todos os dias e setenta por cento das empresas não sabem disso " +
  "com o nosso método você ganha tempo economiza dinheiro e vende mais clica no link da bio agora";

describe("registry", () => {
  it("todo tipo tem manifesto completo e defaults válidos no MotionSchema", () => {
    for (const k of MOTION_KINDS) {
      const m = MOTION_REGISTRY[k];
      expect(m.kind).toBe(k);
      expect(m.purpose.length).toBeGreaterThan(10);
      expect(m.useWhen.length).toBeGreaterThan(0);
      expect(m.avoidWhen.length).toBeGreaterThan(0);
      expect(m.seconds.min).toBeLessThanOrEqual(m.seconds.default);
      expect(m.seconds.default).toBeLessThanOrEqual(m.seconds.max);
      const parsed = MotionSchema.safeParse({
        id: "x",
        kind: k,
        sourceId: "src_01",
        sourceTime: 1,
        durationSeconds: m.seconds.default,
        params: m.defaults(),
      });
      expect(parsed.success, k).toBe(true);
    }
  });

  it("projeto antigo (sem variantes) continua com o visual original", () => {
    const m = MotionSchema.parse({ id: "a", kind: "keyword", sourceId: "s", sourceTime: 1, params: { text: "OI" } });
    expect(m.params).toMatchObject({ variant: "pop", intensity: "normal" });
    expect(m.group).toBeNull();
    const z = MotionSchema.parse({ id: "z", kind: "zoom", sourceId: "s", sourceTime: 1 });
    expect(z.params).toMatchObject({ focusX: 50, focusY: 40, style: "punch" });
  });

  it("slots inválidos caem no default ou são recusados pelo schema", () => {
    expect(MOTION_REGISTRY.keyword.fromSlots({ text: "OI", variant: "explosão" }).variant).toBeUndefined();
    expect(MOTION_REGISTRY.zoom.fromSlots({ style: "punch", scale: "9" }).scale).toBe(1.25);
    expect(MOTION_REGISTRY.list.fromSlots({ items: "a|b|c|d|e|f|g" }).items).toHaveLength(5);
    const list = MOTION_REGISTRY.list.fromSlots({ items: "só um" });
    expect(MotionSchema.safeParse({ id: "x", kind: "list", sourceId: "s", sourceTime: 0, params: list }).success).toBe(false);
  });

  it("números em pt-BR e en", () => {
    expect(parseSlotNumber("70%")).toBe(70);
    expect(parseSlotNumber("1.500")).toBe(1500);
    expect(parseSlotNumber("2,5")).toBe(2.5);
    expect(parseSlotNumber("R$ 1.299,90")).toBe(1299.9);
    expect(parseSlotNumber("abc")).toBeNull();
  });

  it("combos expandem só em tipos do registry, com peças válidas", () => {
    for (const id of COMBO_IDS) {
      const c = MOTION_COMBOS[id];
      const pieces = c.build({ text: "ganhe tempo", number: "70", suffix: "%", items: "tempo|dinheiro|vendas" }, c.seconds.default);
      expect(pieces.length).toBeGreaterThan(1);
      for (const p of pieces) {
        expect(MOTION_KINDS).toContain(p.kind);
        expect(p.offset + p.duration).toBeLessThanOrEqual(c.seconds.default + 1e-9);
      }
    }
  });
});

describe("interpretBriefing", () => {
  it("extrai proibições e estilo do texto livre", () => {
    const d = interpretBriefing("Vídeo dinâmico e profissional. Destacar três benefícios, a porcentagem e o CTA final. Não usar emoji nem flashes.");
    expect(d.style).toBe("dynamic");
    expect(d.avoid).toEqual(expect.arrayContaining(["emoji"]));
    expect(d.wants).toEqual(expect.arrayContaining(["list", "counter", "cta", "emphasis"]));
  });

  it("entende variações de proibição", () => {
    expect(interpretBriefing("sem flash, evitar zoom").avoid).toEqual(expect.arrayContaining(["flash", "zoom"]));
    expect(interpretBriefing("nada de emojis por favor").avoid).toContain("emoji");
    expect(interpretBriefing("edição premium e sóbria").style).toBe("premium");
    expect(interpretBriefing("").style).toBeNull();
    expect(interpretBriefing("legendas e música").avoid).toEqual([]);
  });

  it("pedido explícito não vira proibição", () => {
    const d = interpretBriefing("pode usar emojis à vontade");
    expect(d.avoid).not.toContain("emoji");
    expect(d.wants).toContain("emoji");
  });
});

describe("retrieval", () => {
  it("tira do catálogo o que o briefing proíbe e o que o estilo não usa", () => {
    const directives = interpretBriefing("estilo premium, sem emoji");
    const kinds = getCandidateMotions({ style: "premium", directives, durationSeconds: 60 });
    expect(kinds).not.toContain("emoji");
    expect(kinds).not.toContain("flash");
    expect(kinds.length).toBeLessThanOrEqual(16);
    const combos = getCandidateCombos({ style: "premium", directives, durationSeconds: 60 }, kinds);
    expect(combos).toContain("cta-focus");
  });

  it("combo sai se um tipo dele foi proibido", () => {
    const directives = interpretBriefing("sem zoom");
    const kinds = getCandidateMotions({ style: "balanced", directives, durationSeconds: 60 });
    const combos = getCandidateCombos({ style: "balanced", directives, durationSeconds: 60 }, kinds);
    expect(combos).toEqual(expect.arrayContaining(["cta-focus", "myth-truth"]));
    expect(combos.every((id) => !MOTION_COMBOS[id].uses.includes("zoom"))).toBe(true);
  });

  it("catálogo compacto não leva código nem schema", () => {
    const text = formatCatalogForPrompt(["keyword", "counter"], ["statistic-reveal"]);
    expect(text).toContain("- keyword:");
    expect(text).toContain("- statistic-reveal:");
    expect(text).not.toMatch(/function|=>|z\.object/);
    expect(text.length).toBeLessThan(1800);
  });
});

describe("compilePlan", () => {
  const plan = (events: CreativePlan["events"]): CreativePlan => ({ style: "dynamic", events });
  const all = { kinds: [...MOTION_KINDS], combos: [...COMBO_IDS] };

  it("ancora na palavra depois dos cortes e valida params", () => {
    // corta "todos os dias" (palavras 4–6): a palavra 7 ("e") vira a 4ª no corte
    const r = recipe(FALA, { cut: [2.0, 3.5] });
    const words = spokenWords(r);
    const idx = words.findIndex((w) => w.word.text === "setenta");
    const { candidates, rejected } = compilePlan(
      r,
      plan([{ type: "motion", id: "keyword", word: idx, seconds: 1.5, params: [{ k: "text", v: "SETENTA" }, { k: "variant", v: "marker" }] }]),
      all
    );
    expect(rejected).toEqual([]);
    expect(candidates[0].sourceTime).toBeCloseTo(words[idx].word.start, 3);
    expect(candidates[0].params).toMatchObject({ text: "SETENTA", variant: "marker" });
  });

  it("recusa número que não foi dito e aceita o que foi", () => {
    const r = recipe(FALA.replace("setenta", "70"));
    const ok = compilePlan(r, plan([{ type: "motion", id: "counter", word: 8, seconds: 2, params: [{ k: "number", v: "70" }, { k: "suffix", v: "%" }] }]), all);
    expect(ok.rejected).toEqual([]);
    const bad = compilePlan(r, plan([{ type: "motion", id: "counter", word: 8, seconds: 2, params: [{ k: "number", v: "93" }] }]), all);
    expect(bad.candidates).toEqual([]);
    expect(bad.rejected[0].reason).toMatch(/93/);
  });

  it("número por extenso também vale", () => {
    const facts = buildFacts(recipe(FALA), spokenWords(recipe(FALA)));
    expect(checkGrounding({ kind: "counter", params: { from: 0, to: 70, decimals: 0, prefix: "", suffix: "%", label: "", variant: "bold" } }, facts)).toBeNull();
  });

  it("recusa texto inventado, tipo fora do catálogo e palavra inexistente", () => {
    const r = recipe(FALA);
    const { candidates, rejected } = compilePlan(
      r,
      plan([
        { type: "motion", id: "keyword", word: 2, seconds: null, params: [{ k: "text", v: "GARANTIA VITALÍCIA" }] },
        { type: "motion", id: "emoji", word: 3, seconds: null, params: [{ k: "emoji", v: "🔥" }] },
        { type: "motion", id: "keyword", word: 999, seconds: null, params: [{ k: "text", v: "CLIENTES" }] },
      ]),
      { kinds: ["keyword"], combos: [] }
    );
    expect(candidates).toEqual([]);
    expect(rejected.map((x) => x.reason)).toEqual([
      expect.stringMatching(/não vem da fala/),
      "tipo fora do catálogo desta demanda",
      "palavra inexistente",
    ]);
  });

  it("combo vira peças com o mesmo grupo, editáveis", () => {
    const r = recipe(FALA);
    const words = spokenWords(r);
    const at = words.findIndex((w) => w.word.text === "clica");
    const { candidates, rejected } = compilePlan(
      r,
      plan([{ type: "combo", id: "cta-focus", word: at, seconds: 3, params: [{ k: "text", v: "Clica no link da bio" }] }]),
      all
    );
    expect(rejected).toEqual([]);
    expect(candidates.map((c) => c.kind)).toEqual(["statement", "arrow"]);
    expect(new Set(candidates.map((c) => c.group))).toEqual(new Set(["cta-focus:1"]));
  });

  it("duração fica dentro do manifesto e do fim do vídeo", () => {
    const r = recipe(FALA);
    const last = spokenWords(r).length - 3;
    const { candidates } = compilePlan(r, plan([{ type: "motion", id: "zoom", word: last, seconds: 99, params: [] }]), all);
    const total = r.timeline.segments[0].sourceEnd;
    expect(candidates[0].durationSeconds).toBeLessThanOrEqual(MOTION_REGISTRY.zoom.seconds.max);
    expect(candidates[0].sourceTime + candidates[0].durationSeconds).toBeLessThanOrEqual(total + 1e-9);
  });
});

describe("validateComposition", () => {
  const cand = (kind: RankedCandidate["kind"], t: number, priority: number, extra: Partial<RankedCandidate> = {}): RankedCandidate =>
    ({
      ...MotionSchema.parse({
        id: "x",
        kind,
        sourceId: "src_01",
        sourceTime: t,
        durationSeconds: MOTION_REGISTRY[kind].seconds.default,
        params: MOTION_REGISTRY[kind].defaults(),
      }),
      priority,
      ...extra,
    }) as RankedCandidate;

  it("um texto por vez e prioridade decide", () => {
    const r = recipe(FALA);
    const { accepted, rejected } = validateComposition(r, [cand("keyword", 5, 1), cand("kinetic", 5.5, 0)], "dynamic");
    expect(accepted.map((a) => a.kind)).toEqual(["kinetic"]);
    expect(rejected[0].reason).toMatch(/camada text/);
  });

  it("premium não usa flash; flashes espaçados no dinâmico", () => {
    const r = recipe(FALA);
    expect(validateComposition(r, [cand("flash", 6, 0)], "premium").accepted).toEqual([]);
    const dyn = validateComposition(r, [cand("flash", 3, 0), cand("flash", 9, 1)], "dynamic");
    expect(dyn.accepted).toHaveLength(1);
  });

  it("respeita motions manuais já na timeline", () => {
    const r = recipe(FALA, {
      motions: [{ id: "man", kind: "keyword", sourceId: "src_01", sourceTime: 5, durationSeconds: 2, origin: "manual", params: { text: "MANUAL" } }],
    });
    const { accepted } = validateComposition(r, [cand("statement", 5.5, 0)], "balanced");
    expect(accepted).toEqual([]);
  });

  it("densidade do estilo minimalista", () => {
    const r = recipe(FALA);
    const many = [cand("keyword", 2, 0), cand("zoom", 8, 1), cand("arrow", 12, 2), cand("kinetic", 16, 3)];
    const { accepted } = validateComposition(r, many, "minimal");
    expect(accepted.length).toBeLessThanOrEqual(2);
  });

  it("peças de combo podem dividir o tempo entre camadas", () => {
    const r = recipe(FALA);
    const group = "cta-focus:1";
    const { accepted } = validateComposition(
      r,
      [cand("statement", 14, 0, { group }), cand("arrow", 14.5, 0, { group })],
      "balanced"
    );
    expect(accepted).toHaveLength(2);
  });
});

describe("ajustes do teste real", () => {
  const all = { kinds: [...MOTION_KINDS], combos: [...COMBO_IDS] };
  it("CTA na última frase recua para caber, em vez de sumir", () => {
    const r = recipe(FALA);
    const words = spokenWords(r);
    const last = words.length - 2; // ~1,5 s antes do fim, menos que o mínimo do combo
    const { candidates, rejected } = compilePlan(
      r,
      { style: "balanced", events: [{ type: "combo", id: "cta-focus", word: last, seconds: null, params: [{ k: "text", v: "clica no link" }] }] },
      all
    );
    expect(rejected).toEqual([]);
    const total = r.timeline.segments[0].sourceEnd;
    for (const c of candidates) expect(c.sourceTime + c.durationSeconds).toBeLessThanOrEqual(total + 1e-6);
  });

  it("palavra-chave genérica é recusada", () => {
    const r = recipe(FALA);
    const { rejected } = compilePlan(
      r,
      { style: "balanced", events: [{ type: "motion", id: "keyword", word: 3, seconds: null, params: [{ k: "text", v: "isso" }] }] },
      all
    );
    expect(rejected[0].reason).toMatch(/genérico/);
  });

  it("unidade não gruda no número", () => {
    expect(MOTION_REGISTRY.counter.fromSlots({ number: "2", suffix: "meses" }).suffix).toBe(" meses");
    expect(MOTION_REGISTRY.counter.fromSlots({ number: "70", suffix: "%" }).suffix).toBe("%");
    expect(MOTION_REGISTRY.counter.fromSlots({ number: "1500", prefix: "R$" }).prefix).toBe("R$ ");
  });
});

describe("estilo nas receitas", () => {
  const all = { kinds: [...MOTION_KINDS], combos: [...COMBO_IDS] };
  it("gancho premium usa máscara e câmera suave; destaque fora da frase é descartado", () => {
    const r = recipe(FALA);
    const { candidates } = compilePlan(
      r,
      {
        style: "dynamic",
        events: [
          { type: "combo", id: "impact-hook", word: 1, seconds: null, params: [{ k: "text", v: "perdendo clientes todos" }, { k: "emphasis", v: "dinheiro" }] },
        ],
      },
      all,
      "premium"
    );
    const kinetic = candidates.find((c) => c.kind === "kinetic")!;
    const zoom = candidates.find((c) => c.kind === "zoom")!;
    expect(kinetic.params).toMatchObject({ variant: "mask", emphasis: "" });
    expect(zoom.params).toMatchObject({ style: "smooth" });
  });
});

describe("cor de destaque dos motions", () => {
  it("motion > padrão do vídeo > legenda (projeto antigo continua com a cor da legenda)", () => {
    const r = recipe(FALA);
    expect(r.motionStyle.accentColor).toBeNull();
    expect(videoMotionAccent(r)).toBe(r.captions.style.highlightColor);
    expect(resolveMotionAccent(null, null, "#FFD700")).toBe("#FFD700");
    expect(resolveMotionAccent(null, "#00AAFF", "#FFD700")).toBe("#00AAFF");
    expect(resolveMotionAccent("#FF3355", "#00AAFF", "#FFD700")).toBe("#FF3355");
  });

  it("aplicar a todos vira padrão do vídeo e limpa as cores individuais", () => {
    const r = recipe(FALA, {
      motions: [
        { id: "a", kind: "keyword", sourceId: "src_01", sourceTime: 1, params: { text: "A" }, accentColor: "#ff0000" },
        { id: "b", kind: "keyword", sourceId: "src_01", sourceTime: 5, params: { text: "B" } },
      ],
    });
    const out = applyAccentToAll(r, "#112233");
    expect(out.motionStyle.accentColor).toBe("#112233");
    expect(out.motions.every((m) => m.accentColor === null)).toBe(true);
    expect(videoMotionAccent(out)).toBe("#112233");
  });

  it("só aceita #RRGGBB (nada de CSS livre)", () => {
    const bad = MotionSchema.safeParse({ id: "x", kind: "keyword", sourceId: "s", sourceTime: 0, params: { text: "A" }, accentColor: "red; background:url(x)" });
    expect(bad.success).toBe(false);
  });
});

describe("motions do Remotion Elements", () => {
  const motion = (kind: string, params: Record<string, unknown>) =>
    MotionSchema.safeParse({ id: "x", kind, sourceId: "src_01", sourceTime: 0, params });

  it("defaults: marcação, selo, linhas de velocidade e brilho do CTA", () => {
    const a = motion("annotation", { text: "Isso muda tudo" });
    expect(a.success && a.data.params).toMatchObject({ target: "", variant: "marker", position: "center" });
    const s = motion("speedLines", {});
    expect(s.success && s.data.params).toEqual({ intensity: "normal", tone: "light" });
    const st = motion("statement", { text: "Agende agora", variant: "cta" });
    expect(st.success && st.data.params).toMatchObject({ shine: false });
    expect(motion("callout", { text: "PROMOÇÃO IMPERDÍVEL" }).success).toBe(false);
    expect(motion("chart", { items: [] }).success).toBe(false);
  });

  it("itens do gráfico a partir de “rótulo: valor”", () => {
    expect(parseChartItems("Antes: 30|Depois: 1.500|sem número|: 5|Mês 3: 2,5")).toEqual([
      { label: "Antes", value: 30 },
      { label: "Depois", value: 1500 },
      { label: "Mês 3", value: 2.5 },
    ]);
    expect(parseChartItems(undefined)).toEqual([]);
  });

  it("gráfico só com números ditos", () => {
    const r = recipe("antes eram 30 clientes por mês e agora são 70 clientes");
    const all = { kinds: [...MOTION_KINDS], combos: [...COMBO_IDS] };
    const ev = (items: string) =>
      compilePlan(
        r,
        {
          style: "educational",
          events: [{ type: "motion", id: "chart", word: 1, seconds: 4, params: [{ k: "items", v: items }, { k: "title", v: "Clientes por mês" }] }],
        },
        all
      );
    const ok = ev("Antes: 30|Agora: 70");
    expect(ok.rejected).toEqual([]);
    expect(ok.candidates[0].params).toMatchObject({ variant: "bars", items: [{ label: "Antes", value: 30 }, { label: "Agora", value: 70 }] });
    const bad = ev("Antes: 30|Agora: 90");
    expect(bad.candidates).toEqual([]);
    expect(bad.rejected[0].reason).toMatch(/90/);
  });

  it("número visível no texto (selo de desconto) precisa ter sido dito", () => {
    const callout = (text: string) => ({ kind: "callout" as const, params: { text, pointer: "down" as const, position: "center" as const } });
    const dito = recipe("hoje tem vinte por cento de desconto");
    const factsDito = buildFacts(dito, spokenWords(dito));
    expect(checkGrounding(callout("-20%"), factsDito)).toBeNull();
    expect(checkGrounding(callout("-50%"), factsDito)).toMatch(/50/);
    const digitos = recipe("hoje tem 20% de desconto");
    expect(checkGrounding(callout("-20%"), buildFacts(digitos, spokenWords(digitos)))).toBeNull();
  });

  it("linhas de velocidade seguem as regras do flash", () => {
    const r = recipe(FALA);
    const cand = (kind: "flash" | "speedLines", t: number, priority: number) =>
      ({
        ...MotionSchema.parse({ id: `${kind}-${t}`, kind, sourceId: "src_01", sourceTime: t, durationSeconds: 0.6, params: MOTION_REGISTRY[kind].defaults() }),
        priority,
      }) as RankedCandidate;
    expect(validateComposition(r, [cand("speedLines", 6, 0)], "premium").accepted).toEqual([]);
    expect(validateComposition(r, [cand("flash", 3, 0), cand("speedLines", 5, 1)], "dynamic").accepted).toHaveLength(1);
    const directives = interpretBriefing("estilo premium");
    expect(getCandidateMotions({ style: "premium", directives, durationSeconds: 60 })).not.toContain("speedLines");
  });

  it("briefing pede ou proíbe gráfico", () => {
    expect(interpretBriefing("sem gráficos, por favor").avoid).toContain("chart");
    const quer = interpretBriefing("quero um gráfico comparando antes e depois");
    expect(quer.wants).toContain("chart");
    expect(quer.avoid).not.toContain("chart");
    const kinds = getCandidateMotions({ style: "balanced", directives: quer, durationSeconds: 60 });
    expect(kinds).toContain("chart");
  });
});

describe("tela cheia (screen)", () => {
  const cand = (kind: RankedCandidate["kind"], t: number, priority: number, params?: Record<string, unknown>): RankedCandidate =>
    ({
      ...MotionSchema.parse({
        id: `${kind}-${t}`,
        kind,
        sourceId: "src_01",
        sourceTime: t,
        durationSeconds: MOTION_REGISTRY[kind].seconds.default,
        params: params ?? MOTION_REGISTRY[kind].defaults(),
      }),
      priority,
    }) as RankedCandidate;

  it("uma a cada 15 s e nada de texto por baixo (ficaria escondido); zoom por baixo pode", () => {
    const r = recipe(FALA);
    const two = validateComposition(r, [cand("screen", 2, 0), cand("screen", 9, 1)], "balanced");
    expect(two.accepted).toHaveLength(1);
    expect(two.rejected[0].reason).toMatch(/perto demais/);
    const covered = validateComposition(r, [cand("screen", 4, 0), cand("keyword", 5, 1)], "dynamic");
    expect(covered.accepted.map((a) => a.kind)).toEqual(["screen"]);
    expect(covered.rejected[0].reason).toMatch(/coberto/);
    const hides = validateComposition(r, [cand("keyword", 5, 0), cand("screen", 4, 1)], "dynamic");
    expect(hides.rejected[0].reason).toMatch(/esconderia/);
    const camera = validateComposition(r, [cand("screen", 4, 0), cand("zoom", 5, 1)], "dynamic");
    expect(camera.accepted).toHaveLength(2);
  });

  it("minimalista não usa; texto precisa vir da fala", () => {
    const directives = interpretBriefing("estilo minimalista");
    expect(getCandidateMotions({ style: "minimal", directives, durationSeconds: 60 })).not.toContain("screen");
    const facts = buildFacts(recipe(FALA), spokenWords(recipe(FALA)));
    const screen = (text: string) => ({ kind: "screen" as const, params: { ...MOTION_REGISTRY.screen.defaults(), text, emphasis: "" } });
    expect(checkGrounding(screen("Você está perdendo clientes"), facts)).toBeNull();
    expect(checkGrounding(screen("Garantia vitalícia total"), facts)).toMatch(/não vem da fala/);
  });

  it("lista: itens contam na checagem da fala", () => {
    const facts = buildFacts(recipe(FALA), spokenWords(recipe(FALA)));
    const list = (items: string[]) => ({
      kind: "screen" as const,
      params: { ...MOTION_REGISTRY.screen.defaults(), text: "Você está perdendo clientes", emphasis: "", layout: "list" as const, items },
    });
    expect(checkGrounding(list(["perdendo clientes", "você está"]), facts)).toBeNull();
    expect(checkGrounding(list(["garantia vitalícia", "frete grátis sempre", "brinde exclusivo"]), facts)).toMatch(/não vem da fala/);
  });
});

describe("receita mandada como motion", () => {
  it("o compilador trata como receita em vez de recusar", () => {
    const r = recipe(FALA);
    const words = spokenWords(r);
    const { candidates, rejected } = compilePlan(
      r,
      { style: "dynamic", events: [{ type: "motion", id: "benefit-stack", word: 2, seconds: null, params: [{ k: "items", v: "ganha tempo|economiza dinheiro" }] }] } as unknown as CreativePlan,
      { kinds: [...MOTION_KINDS], combos: ["benefit-stack"] }
    );
    expect(words.length).toBeGreaterThan(2);
    expect(rejected).toEqual([]);
    expect(candidates.map((c) => c.kind).sort()).toEqual(["list", "zoom"]);
  });
});

describe("transições na sugestão da IA", () => {
  const longa = `${FALA} ${FALA} ${FALA}`;
  const cand = (t: number, priority: number): RankedCandidate =>
    ({
      ...MotionSchema.parse({ id: `tr-${t}`, kind: "transition", sourceId: "src_01", sourceTime: t, durationSeconds: 1, params: { style: "burn" } }),
      priority,
    }) as RankedCandidate;

  it("compilador leva a transição ao corte mais perto; sem corte, recusa", () => {
    const r = recipe(FALA, { cut: [2.0, 3.5] });
    const words = spokenWords(r);
    const near = words.findIndex((w) => w.outputTime >= 2.2);
    const { candidates } = compilePlan(r, { style: "dynamic", events: [{ type: "motion", id: "transition", word: near, seconds: null, params: [{ k: "variant", v: "flare" }] }] }, { kinds: [...MOTION_KINDS], combos: [] });
    // flare dura 0,67 s: começa 0,335 s antes do corte (2,0 s)
    expect(candidates[0].sourceTime).toBeCloseTo(2.0 - 0.335, 2);
    expect(candidates[0].durationSeconds).toBeCloseTo(0.67, 2);
    const semCorte = recipe(FALA);
    const far = compilePlan(semCorte, { style: "dynamic", events: [{ type: "motion", id: "transition", word: 6, seconds: null, params: [] }] }, { kinds: [...MOTION_KINDS], combos: [] });
    expect(far.candidates).toEqual([]);
    expect(far.rejected[0].reason).toMatch(/só em corte/);
  });

  it("no máximo 3, com 10 s entre elas e longe do começo e do fim", () => {
    const r = recipe(longa);
    const { accepted, rejected } = validateComposition(r, [cand(0.5, 0), cand(5, 1), cand(9, 2), cand(17, 3), cand(29, 4), cand(41, 5)], "dynamic");
    expect(accepted.map((a) => a.sourceTime)).toEqual([5, 17, 29]);
    expect(rejected.map((x) => x.reason)).toEqual([
      expect.stringMatching(/começo ou do fim/),
      expect.stringMatching(/perto demais de outra/),
      expect.stringMatching(/máximo de 3/),
    ]);
  });

  it("minimalista não usa; briefing pode pedir ou proibir", () => {
    const min = interpretBriefing("estilo minimalista");
    expect(getCandidateMotions({ style: "minimal", directives: min, durationSeconds: 60 })).not.toContain("transition");
    expect(interpretBriefing("sem transições").avoid).toContain("transition");
    expect(interpretBriefing("pode usar transições rápidas").wants).toContain("transition");
  });
});

describe("tela cheia em lista", () => {
  it("ganha 4,5 s quando a IA não pede duração", () => {
    const r = recipe("hoje eu vou te mostrar três erros que travam vendas preço sem valor atendimento lento sem prova social");
    const plan = {
      style: "balanced",
      events: [
        {
          type: "motion",
          id: "screen",
          word: 5,
          seconds: null,
          params: [
            { k: "text", v: "três erros que travam vendas" },
            { k: "items", v: "preço sem valor|atendimento lento|sem prova social" },
          ],
        },
      ],
    } as unknown as CreativePlan;
    const { candidates } = compilePlan(r, plan, { kinds: [...MOTION_KINDS], combos: [] });
    expect(candidates.find((c) => c.kind === "screen")!.durationSeconds).toBe(LIST_SCREEN_SECONDS);
  });
});
