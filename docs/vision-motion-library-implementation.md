# Motion Library + Creative Engine — auditoria e plano

Documento da Fase 0 dos dois briefs (Creative Engine Roadmap v1.2 e Motion
Library Agent Prompt), tratados como uma arquitetura só. Registra o que já
existia, o que muda e o que fica de fora.

## 1. O que já existe (auditado em 2026-10-24)

| Área | Onde | Estado |
|---|---|---|
| Versões | `remotion` 4.0.519 (+ `@remotion/transitions`, `@remotion/motion-blur`, `@remotion/layout-utils`), React 19.2, Zod 3.25, `openai` 4.104 | sem GSAP |
| Contrato dos motions | `packages/recipe/src/schema.ts` → `MotionSchema` (união discriminada por `kind`) | 6 tipos: zoom, keyword, emoji, lowerThird, counter, flash |
| Tempo | âncora no BRUTO (`sourceId` + `sourceTime`), duração no tempo FINAL; `sourceToOutput`/`outputToSource` em `time.ts` | já acompanha cortes sem drift; Player e render usam o mesmo `placeMotions` |
| Render | `packages/video/src/Motions.tsx` (componentes React + `useCurrentFrame`/`interpolate`/`spring`) e `VisionComposition.tsx` (zoom aplicado no vídeo via `zoomScaleAt`) | determinístico; o mesmo componente no Player e no MP4 |
| Revisão | `status` pending/accepted/rejected + `origin` ai/manual; `mergeMotionSuggestions` substitui só pendentes da IA; `reviewMotions`; `retimeMotion` | edição manual preservada; undo/redo no Editor |
| Posição livre | `placement` {x,y} arrastado no preview (`DragLayer.tsx`, `data-vision-drag`) | ok |
| Editor | `MotionPanel.tsx` (lista, adicionar no playhead, propriedades por tipo), trilha de motions na `Timeline.tsx` | ok |
| IA de motions | `apps/server/src/pipeline/motions.ts`: 1 chamada `chat.completions` (`json_object`, gpt-4o) com transcrição indexada por palavra; valida params com o `MotionSchema` | sem catálogo, sem registro de tokens/latência, prompt com lista fixa de tipos |
| Outras chamadas de IA | Whisper (transcrição, com refino local por silêncio), `retakes.ts` (retomadas/muletas, opcional), `director.ts` (plano de montagem a partir do briefing) | — |
| Briefing | `recipe.briefing` (vem do War via `demand.briefing` ao criar o projeto) | já chega ao diretor e ao prompt de motions |
| Laboratório | `packages/video/src/lab/MotionLab.tsx` + `#lab` | protótipos (tipografia cinética, marca-texto, zoom com blur, burst, transições) — fonte de ideias, não lido pela receita |

## 2. Divergências em relação aos briefs

- O termo **"Recipe"** já significa a receita de edição inteira (`Recipe`).
  As "Motion Recipes" dos briefs viram **combos** no código (`motionCombos`),
  e "receitas de motion" na interface.
- Os tempos já usam âncora no bruto + duração no final; não é preciso criar um
  segundo modelo de timeline (`sourceTime/editedTime/localFrame` já existem na
  prática: `sourceTime`, `sourceToOutput`, `Sequence` local).
- Não há locks explícitos: o que protege a edição humana é `status` +
  `origin` (a IA só substitui as próprias sugestões pendentes). Mantido.
- O identificador estável gravado nas receitas continua sendo `kind`
  (sem migração). O registro dá a cada `kind` categoria, versão e metadados.

## 3. Plano executado nesta etapa

1. **Registry** (`packages/recipe/src/motionRegistry.ts`): um manifesto por
   tipo — finalidade, quando usar/evitar, gatilhos, intensidade, camada,
   durações, variantes, campos que a IA preenche — + `aiMotionCatalog()`
   (DTO compacto) + `getCandidateMotions()` (filtro determinístico).
2. **Lote 1 de motions**: os tipos atuais ganham variantes com o visual antigo
   como padrão (projetos salvos renderizam igual) e entram 5 tipos novos —
   `kinetic` (frase cinética, com variante de máscara), `statement` (chamada
   premium), `list` (benefícios), `bubble` (mensagem) e `arrow` (seta/callout).
3. **Combos** (`motionCombos.ts`): impact-hook, statistic-reveal,
   benefit-stack, cta-focus — expandidos em motions comuns com um `group`
   compartilhado; cada peça continua editável.
4. **Creative Planner** (`apps/server/src/creative/`): briefing interpretado
   localmente (proibições e estilo) + UMA chamada com Structured Outputs;
   compilador local (âncora por palavra pós-corte, slots → params validados,
   números checados na fala/briefing) e validador de composição (densidade,
   sobreposição, flash, câmera).
5. **Instrumentação**: tempos por etapa, tokens reais, cache por hash,
   propostos/aplicados/rejeitados com motivo.
6. **Galeria** no painel de motions com descrição de uso e UM preview sob
   demanda.

## 4. Entregue

| Fase | O quê | Onde |
|---|---|---|
| 1 Registry | 15 manifestos (finalidade, usar/evitar, camada, durações, variantes, campos da IA, checagem de fatos), catálogo compacto, filtro determinístico | `packages/recipe/src/motionRegistry.ts`, `creative.ts` |
| 2 Lote 1 | keyword (pop/slide/underline/marker), kinetic (rise/blur/mask = text-mask-reveal), statement (center/left/cta), counter (bold/card), list (check/number), lowerThird (bar/minimal), bubble, zoom punch/smooth com foco, arrow, flash sutil — padrões antigos inalterados | `packages/video/src/Motions.tsx` |
| 2b Remotion Elements | annotation (Text Marker/Circle Marker/Strike Through/Crossed Off via `@remotion/rough-notation`), chart (Pie/Horizontal Bar/Vertical Bar/Line Chart), callout (Wiggling Callout via `@remotion/shapes`), speedLines, brilho (Shine em CSS) no botão do CTA. Movimento do original, visual do Vision (cor de destaque, fonte da legenda, cartão escuro); sem `Interactive` (o painel edita) | `packages/video/src/ElementsMotions.tsx` |
| 3 Receitas | impact-hook, statistic-reveal, benefit-stack, cta-focus; expandidas no código, grupo editável, variante pelo estilo | `packages/recipe/src/motionCombos.ts` |
| 4 Galeria | categorias, busca, usar/evitar, variantes, 1 Player só para o item aberto, inserir no playhead (motion ou receita) | `apps/web/src/editor/MotionGallery.tsx` |
| 5 Planner | briefing do War lido no código + 1 chamada com Structured Outputs (`zodResponseFormat`), cache por hash, fallback heurístico | `apps/server/src/creative/planner.ts` |
| 6 Compilador | âncora por palavra pós-corte, slots → params pelo manifesto, MotionSchema, números/textos checados, recuo de CTA no fim, densidade/camadas/flash/repetição | `compilePlan`, `validateComposition` |
| 7 Observabilidade | tempos por etapa, tokens reais, cache, recusas com motivo em `data/creative-metrics.jsonl` (sem transcrição/briefing); Fast Path "Analisar e aplicar" | `fastPath.ts`, `npm run cli -- analyze` |

Docs: `docs/motion-catalog.md` (gerado do registry), `docs/motion-design-guidelines.md`.

## 5. Medido vs. proposto

**Medido (3 projetos reais, 33–80 s, OpenAI `gpt-4o-mini`):**

| Medida | Resultado |
|---|---|
| Planner (1 chamada) | 5,1–6,2 s |
| Tokens por vídeo | 2.922–3.279 entrada + 281–356 saída (alvo 3k/1k) |
| Fast Path completo, vídeo de 79 s sem transcrição | 29,6 s (transcrição 16,0 · cortes 8,4 · planner 5,3) — meta 180 s |
| Mesma entrada de novo | 14 ms, 0 tokens (cache) |
| Testes | 162 passando (registry, briefing, retrieval, compilador, validador, planner com OpenAI simulada: válido/erro/recusa/cache) |
| Render | folha de contato de todas as variantes renderizada pelo Remotion headless (o mesmo do MP4) e conferida em frames de entrada e de repouso; Player do editor e galeria conferidos no navegador |

**Apenas proposto (falta medir):** p50/p95 em lote de ≥ 20 anúncios reais,
avaliação cega de qualidade, taxa de aceitação de motions pelos editores,
comparação `gpt-4o-mini` × `gpt-4o`, render MP4 completo cronometrado com os
motions novos.

## 6. Fora desta etapa / riscos

- Spike GSAP (Fase 9): sem lacuna visual que justifique; tudo segue em Remotion puro.
- Lote 2 (~36 motions, 8–12 receitas): só depois do feedback dos editores.
- Remotion Elements: o código é copiado do site (não é pacote npm) e a licença
  não aparece na página dos elements; a Remotion exige licença de empresa para
  times maiores — conferir antes de uso comercial em escala. Elements com
  `HtmlInCanvas`/`@remotion/effects` (Shine original, Lens Blur) ficaram de fora:
  o brilho foi refeito em CSS para o preview ficar igual ao MP4.
- Gráficos: todo valor e todo número visível (selo "-20%") precisa ter sido
  dito ou estar no briefing; rótulos sem relação com a fala são recusados.
- Sem detecção de rosto: posições padrão assumem rosto em 20–45% da altura;
  em enquadramentos diferentes o editor arrasta (risco: CTA/sublinhado sobre o rosto).
- `.mov` HEVC do iPhone pode não tocar no Chrome do editor (problema anterior, não destes motions).
- "Refinar trecho com IA", feedback store e análise visual de frames: não implementados.
- Modelo padrão `gpt-4o-mini` (econômico, com saída estruturada); trocar por
  `CREATIVE_MODEL` se a qualidade não convencer no benchmark.
