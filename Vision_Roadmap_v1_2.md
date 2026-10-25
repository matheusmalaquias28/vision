# VISION — Creative Engine
## Especificação de implementação e roadmap para agente de desenvolvimento

**Versão:** 1.2 · **Data:** 2026-10-24 · **Status:** plano de implementação, não código já integrado

> **Instrução principal ao agente:** trabalhe em cima do repositório real. Antes de implementar, inspecione arquitetura, dependências, packages, scripts, modelo de timeline, integração OpenAI, testes e o arquivo `packages/video/src/Motions.tsx`. Não assuma que os caminhos sugeridos abaixo já existem. Evite refatorações amplas ou substituições do editor atual. Entregue incrementos funcionais, testados, atrás de feature flags quando cabível. Registre decisões, limitações e comandos executados em um relatório final.

## 0. Contexto e objetivo

O Vision é um editor de vídeo programático com IA, operado por editor da Scale. Demandas nascem no WAR e chegam ao Vision; editor organiza tarefas em kanban, recebe e devolve comunicação, importa brutos do Drive, transcreve, remove respiros, ajusta legendas dinâmicas, insere motions e exporta. Volume-alvo: **30–40 vídeos/semana**, normalmente anúncios com até **90 segundos**. O gargalo de velocidade foi reduzido; **o foco agora é elevar a qualidade final mantendo edição manual completa e rapidez**.

### Arquitetura existente (confirmada pelo responsável)

- Motions são **componentes React** implementados em `packages/video/src/Motions.tsx`.
- Animação atual baseada em `useCurrentFrame`, `interpolate`, `spring` e estilos CSS; não há GSAP/Canvas/WebGL atualmente.
- A mesma implementação produz o preview com **Remotion Player** e o MP4 final com **Remotion/Chrome headless**.
- IA **nunca gera código**: seleciona tipos, momentos e parâmetros de biblioteca fechada.
- Pacotes de motion blur e transições do Remotion já estão instalados.
- Não romper WAR, kanban, importação, cortes, legendas, preview, exportação ou edição humana.

### Regra de produto: briefing por demanda, NÃO perfil por cliente

O Vision atende produção de alto volume e ticket/LTV que não justificam onboarding criativo por cliente. **Não implementar** cadastro de direção de arte individual, brand kit obrigatório, biblioteca exclusiva por cliente, aprendizado por cliente ou configuração persistente de estilo de cada contratante. A **única entrada criativa específica da demanda** é o campo de briefing em texto simples enviado pelo WAR (ex.: "edição dinâmica, destacar a oferta, sem emojis, cortes rápidos"). Esse texto pode ser curto, vago, incompleto ou contraditório; não presumir estrutura além do que a integração existente realmente fornece.

**Hierarquia de decisões:** (1) restrições técnicas e de segurança, (2) instruções explícitas e válidas do briefing WAR, (3) eventuais escolhas manuais do editor para a demanda, (4) presets gerais reutilizáveis por estilo de edição/tipo de peça, (5) defaults globais de qualidade. Não interpretar ausência de briefing como permissão para inventar preferências de cliente. Se o briefing não disser nada sobre estilo, usar um padrão global equilibrado e editável.

Implementar um **Briefing Interpreter** leve: extrair do texto livre orientações `requestedStyle`, `desiredPacing`, `requiredElements`, `avoidElements`, `emphasisTopics`, `notes` e `unknowns`, com trechos de evidência retirados do briefing. Separar instruções expressas de inferências; não inventar dados, claims ou identidade visual. Se o briefing mencionar cores/fontes, aplicá-las apenas à demanda atual quando tecnicamente válidas, sem persistir um perfil. O editor deve poder revisar/substituir as decisões a qualquer momento.

### Princípios arquiteturais inegociáveis

1. **IA planeja; código executa.** Nenhum `eval`, `new Function`, scripts, CSS arbitrário, JSX gerado pelo modelo ou plugins remotos executáveis.
2. **Timeline única** como fonte de verdade; Player e render final usam mesmos eventos, componentes, assets e fontes.
3. **Frame determinism:** o frame N deve produzir o mesmo visual, qualquer que seja a ordem de seek/render.
4. **Non-destructive editing:** sugestões são patches versionados; ações manuais, locks, undo/redo e dados originais são preservados.
5. **A estética é orientada por narrativa**, não por quantidade de efeitos.
6. **Fast Path obrigatório:** otimizar o tempo de análise e aplicação na timeline para **até 180 segundos** por vídeo típico de até 90s, sem degradar intencionalmente a qualidade editorial. Medir a distribuição real (p50, p95), não prometer SLA sem benchmark.
6. **Retorno incremental:** a primeira versão não depende de fine-tuning, embeddings ou análise visual cara.
7. **Compatibilidade evolutiva:** preservar eventos antigos e introduzir versionamento/migrações.

## 1. Diagnóstico obrigatório antes de editar código

Agente deve:

- Inspecionar `Motions.tsx`, modelos de projeto/timeline, renderizador, Player, integração de legendas e transcrição, integração WAR, backend e persistência.
- Identificar versões exatas de React, Remotion e OpenAI SDK; verificar alinhamento de versões entre `remotion`, `@remotion/*`, GSAP e demais plugins.
- Mapear todos os tipos atuais de motion: zoom, keyword, emoji, lower third, counter, flash e outros encontrados.
- Anotar quais eventos já têm `id`, `start`, `duration`, `props`, `track`, timestamps e locks.
- Identificar como cortes alteram as posições de palavras, e se timestamps são do vídeo bruto ou timeline editada.
- Identificar onde as chamadas IA são feitas, onde ficam chaves e como são observadas/cobradas.
- Registrar baseline em vídeos reais autorizados: tempo, taxa de aceitação, correções, render, qualidade visual, falhas.
- Criar `docs/vision/architecture-audit.md` com descobertas e divergências das hipóteses deste plano.

**Portão:** não começar integração GSAP ou novo planejador sem estabelecer como a timeline atual funciona.

## 1A. Requisito de produto P0 — Fast Path: qualidade + custo + tempo (NOVO v1.2)

**Objetivo:** anúncios de até 90s, 30–40 vídeos/semana, com **até 2–3 minutos para analisar a demanda, gerar sugestões e aplicá-las na timeline editável**. A qualidade percebida e o tempo de intervenção humana continuam sendo critérios primários; não sacrificar legibilidade e pertinência para reduzir alguns tokens. Essa meta **não inclui o MP4 final renderizado**; medir render/export à parte. Definir em telemetria o marco inicial exato: clique do editor em *Analisar e aplicar* após mídia acessível ao Vision. Registrar separadamente download/upload de brutos do Drive e ingestão, para não esconder gargalos. Se a transcrição for pré-processada automaticamente, medir também end-to-end desde o início da transcrição.

**Orçamento inicial de latência (proposto, não garantido):**

| Estágio | Meta de orçamento para vídeo típico ≤90s | Estratégia |
|---|---:|---|
| Recuperação de briefing, metadata e preparação | 5–10s | I/O assíncrono, cache, evitar downloads duplicados |
| Transcrição com palavras e/ou aproveitamento de transcrição existente | 30–75s | iniciar assim que mídia pronta; serviço já existente; não retrabalhar |
| Planejamento criativo em **uma chamada principal** | 5–20s | saída curta, lista de motions filtrada; medir modelos reais |
| Validação, composição, mapping de frames e aplicação do patch | 2–10s | inteiramente local / backend, sem LLM |
| Margem para fila/rede/variação | saldo até 180s | timeout, cancelamento e fallback |

As parcelas são **orçamentos de engenharia**, não tempos observados. Executar estágios independentes em paralelo com segurança; nenhum estágio deve depender de espera artificial. **Meta operacional:** p50 ≤120s e p95 ≤180s em infraestrutura e vídeos representativos; se p95 não for atingido, documentar gargalo e priorizar correções. Medir também tempo até preview utilizável e tempo total até MP4 separadamente.

### Contrato do caminho rápido

1. **No máximo uma chamada LLM criativa principal por vídeo**: interpretar briefing livre do WAR, identificar intenção, selecionar motions do shortlist e parametrizar eventos em uma única resposta estruturada. As seções "Briefing Interpreter", "Semantic Analyzer" e "Creative Planner" são **módulos lógicos dentro desse mesmo passe**, e não três requisições independentes. Transcrição é uma chamada/custo distinto. Não chamar a IA para cada frase/motion/frame.
2. **Pré-processamento determinístico:** detecção de silêncio por energia/VAD e timestamps, cut map, candidatos por tags, restrições de layout, regras de densidade, normalização de parâmetros, temporal anchoring e aplicação via código. Se a precisão dos cortes exigir avaliação especial, usar os recursos existentes sem novos modelos por padrão.
3. **Shortlist compacto:** enviar à IA só IDs + descrições curtas + propriedades relevantes dos ~6–12 motions compatíveis; não enviar `Motions.tsx`, fontes, arquivos, imagens nem toda a biblioteca. Ajustar tamanho à tarefa e medir custo/qualidade.
4. **Tokens como orçamento configurável, não bloqueio cego:** alvo inicial **até 3.000 tokens de entrada e 1.000 de saída** no planner por vídeo típico; permitir exceção explícita para demandas complexas conforme benchmark. O schema precisa conter apenas operações essenciais; não exigir justificativas verbosas por motion. Contabilizar *tokens reais* (`input_tokens`, `output_tokens`, cached, reasoning quando disponíveis), retries e custo total da transcrição separadamente; nunca alegar custo fixo.
5. **Cache:** hash de `briefing + transcript + wordTimes/cutMap + registryVersion + promptVersion + modelVersion + existingEditVersion` (ajustar para não invalidar por campos irrelevantes). Reabrir Player, fazer seek, trocar cores e mover elementos **não refaz a IA**. Cache pode ser segmentado entre análise semântica e plano quando isso não exigir chamadas extras.
6. **Refinar trecho = opt-in:** segunda chamada apenas quando editor escolher "Refinar com IA" e apenas com intervalo + vizinhança curta; retornar patch local, preservar locks e edits externos. Nunca encadear auto-refino de qualidade indefinidamente.
7. **Sem visão por IA no Fast Path:** análise de todo vídeo/frame por multimodal desativada por padrão; usar regras de safe-area e recursos locais existentes. Amostragem visual de frames por IA é opcional, acionada por dificuldade mensurada e com custo/latência observáveis.
8. **Sem embeddings, múltiplos agentes, fine-tuning, geração de vídeo ou GSAP por requisição** no caminho crítico. GSAP, se aprovado no spike, roda determinístico em Remotion; não acrescenta consumo de tokens criativos.
9. **Fallback confiável:** se LLM atrasar/falhar/retornar schema inválido, oferecer plano heurístico curto ou edição manual intacta. Timeout configurável por etapa, retry **no máximo 1** para falhas transitórias dentro do orçamento, idempotency key, cancelamento e aplicação atômica. Nunca executar patch parcial ou apagar edição humana.
10. **Qualidade mínima:** não inventar números, informações legais ou promessas; respeitar "sem emoji/flash" do briefing, hooks/CTAs, legibilidade, ausência de choque com legendas, variedade e preferência por `no_motion` quando adequado. Um verificador determinístico rejeita conflitos e deixa decisões duvidosas para revisão humana.

### Formato de resposta econômica (exemplo de intenção, adaptar ao schema do repositório)

```json
{
  "schemaVersion": "1",
  "preset": "dynamic",
  "motions": [
    {"motionId":"keyword","anchorWordId":"w42","durationFrames":28,"props":{"text":"PERDENDO CLIENTES","intensity":"normal"}},
    {"motionId":"zoom","anchorWordId":"w83","durationFrames":36,"props":{"scale":1.06}}
  ]
}
```

Não retornar transcrição inteira nem explicações longas. Sempre mapear `anchorWordId` após os cortes e validar IDs/props. **Evitar JSON grande com dezenas de sugestões de baixo valor.** Usar `max_output_tokens` configurado de modo compatível com o modelo, observando se reasoning consome orçamento, e avaliar truncamentos reais.

### Seleção inteligente de modelo e custo

- Começar com **um modelo rápido e econômico** que suporte saída estruturada; escolher a versão após consultar preço/capacidade vigente e fazer benchmark no ambiente real. Não cristalizar preço por milhão de tokens nem afirmar uma fatura estimada como garantida.
- Comparar com modelo de maior capacidade em **20 vídeos de teste** e medir avaliação cega de qualidade, % de motions aceitos, retrabalho, p50/p95, input/output real e custo por vídeo.
- Se o modelo barato falhar significativamente, promover seletivamente casos difíceis **somente com gatilho explícito, limite de orçamento e sinalização ao editor**. Nunca duplicar chamadas em todos os vídeos automaticamente.
- Controlar concorrência e filas para carga de 30–40 vídeos/semana e picos simultâneos; backpressure e métricas por projeto. Evitar análise duplicada no mesmo projeto.

### Instrumentação e contrato de aceitação P0

Emitir eventos: `analysis_clicked`, `media_ready`, `transcription_started/finished`, `planner_started/finished`, `patch_validated`, `patch_applied`, `preview_ready`, `render_started/finished`, `analysis_failed`, com durações e ids de correlação; PII/transcrições não entram em logs analíticos. Dashboard: p50/p95 por estágio/end-to-end, tokens de entrada/saída, taxa de cache hit, custo LLM vs transcrição, erros/timeouts/retries, % de vídeos dentro de 180s e **tempo de intervenção humana até aprovação**.

**Aceite para ativar o Fast Path por padrão:** em lote ≥20 anúncios reais autorizados ≤90s, p95 ≤180s para `analysis_clicked → patch_applied` (alvo; se não alcançar, não declarar concluído), nenhum patch danifica edições manuais, taxa de erro de schema ~0 após validação/fallback, resultado editorial equivalente ou superior ao baseline definido pelos editores, custo/tokens por vídeo observáveis. Registrar também p95 incluindo preparação de mídia e transcrição para não mascarar espera do usuário. Quando não atingir, entregar diagnóstico e melhoria incremental antes do rollout.

## 2. Arquitetura alvo

```text
WAR demand + plain-text briefing + media
             │
             ▼
Briefing Interpreter ──► brief directives (com evidência / defaults)
             │
Transcription / word timestamps / cut map ──► Visual-context sampler (fase posterior)
             │
             ▼
     Semantic Analyzer (IA)
             │  speech acts / intentions / importance / entities / pacing
             ▼
Motion Retrieval ──► Motion Registry (manifests + Zod + renderers)
             │        ▲
             │        └── Reusable Style Presets / Editorial Recipes / Approved Examples
             ▼
     Creative Planner (IA)
             │  declarative proposal; no executable source
             ▼
Validation + Composition Engine + Timeline Compiler
             │  conflict policies, anchors, track layering, frame conversion
             ▼
    Versioned Timeline Patch / Diff
             │
             ▼
Editor review + apply / reject / undo ──► Feedback Store
             │
             ▼
Remotion Player == Remotion Render
```

Separar **Analyzer** (entende o conteúdo), **Retriever** (seleciona candidatos), **Planner** (decide o que aplicar), **Compiler** (valida e resolve tempos/posições), **Runtime Remotion** (desenha). Evitar um prompt monolítico.

## 3. Estrutura sugerida de diretórios (adaptar à base real)

```text
packages/video/src/
  Motions.tsx                  # preservar, decompor gradualmente se necessário
  motions/
    registry.ts                # manifests / lookup
    schemas.ts                 # validação por tipo
    components/                # migração opcional, incremental
    recipes.ts                 # composições reutilizáveis
    MotionTrack.tsx            # ponte timeline -> Remotion
  timeline/
    types.ts
    timeMapping.ts
    compiler.ts
    compositionRules.ts
    patch.ts
packages/shared/src/vision/
  creativeSchemas.ts           # contrato de resposta IA; se já há shared, reutilizar
apps/<backend-existente>/...
  creative/analyzer.ts
  creative/retriever.ts
  creative/planner.ts
  creative/evaluation.ts
  creative/feedback.ts
  creative/prompts/
docs/vision/
  architecture-audit.md
  motion-catalog.md
  evaluation.md
```

Os caminhos são sugestões; **não criar aplicação/backend duplicados**.

## 4. Motion Registry (P0)

Criar manifesto tipado por motion com:

- `id`, `version`, `label`, `description`, `category`, `useWhen`, `avoidWhen`, `intentTags`;
- `propsSchema` (Zod), defaults, ranges e presets visuais;
- duração mínima/máxima, escala temporal suportada, safe areas e constraints;
- intensidade (`subtle/normal/strong`), compatibilidade com subtítulos, layering e combinações;
- custos de render aproximados/performance flags;
- componentes e previews reais; thumbnails/frames de demonstração, se viável;
- exemplos aprovados e observações de uso editorial genéricas (posteriormente).

**Exemplo de contrato (ilustrativo; adequar aos componentes existentes):**

```ts
import {z} from 'zod';

const KeywordProps = z.object({
  text: z.string().min(1).max(64),
  emphasis: z.enum(['subtle', 'normal', 'strong']),
  position: z.enum(['top', 'center', 'bottom']),
  colorToken: z.string(), // resolver em paleta global / preset geral / override pontual do briefing; nunca CSS livre
});

export const motionRegistry = {
  keyword: {
    id: 'keyword', version: 1,
    description: 'Ênfase tipográfica de argumento central',
    useWhen: ['benefício', 'objeção', 'dor', 'CTA'],
    avoidWhen: ['fala periférica', 'conflito com legendas'],
    minFrames: 10, maxFrames: 120,
    propsSchema: KeywordProps,
    // Component: ExistingKeywordMotion
  },
} as const;
```

**Separar schema interno do registry dos schemas de IA:** respostas estruturadas do modelo devem usar objeto raiz, campos exigidos e tipos compatíveis com o subconjunto JSON Schema suportado. Validar novamente com Zod no servidor. Para variantes, preferir `type` discriminador e validadores server-side por tipo, sem assumir que union raiz funciona no Structured Outputs.

**Aceite:** todos os motions existentes registráveis sem mudar sua aparência; tipo inválido ou prop inválida falha com erro controlado; registry alimenta tanto a IA quanto os controles do editor.

## 5. Timeline e sincronização por frames (P0)

Adotar referências temporais explícitas:

- `sourceTime`: timestamp do bruto/transcrição;
- `editedTime`: tempo da timeline depois de cortes;
- `localFrame`: frame no escopo de um `Sequence`.

A IA pode ancorar um evento em `wordId` + `offsetMs`; o compilador converte por `cutMap` para o frame definitivo. Não calcular tempo editado somente subtraindo pausas totais quando existem cortes, reordenações e clipes múltiplos.

```ts
export type MotionProposal = {
  id: string;
  type: string;
  anchor: {kind: 'word'; wordId: string; offsetMs: number}
        | {kind: 'timeline'; timeMs: number};
  durationMs: number;
  layer: 'overlay' | 'emphasis' | 'transition';
  props: Record<string, unknown>;
  reason: string;
};
```

**Implementação:** resolver para `startFrame` e `durationInFrames` inteiros, usando `fps` e política documentada de arredondamento; lidar com eventos cortados/fora da timeline, valores negativos, transições e variação de FPS. Renderizar pelo mesmo `MotionTrack` em Player e exportação; `Sequence from=... durationInFrames=...` e `useCurrentFrame()` local.

**Aceite:** não há drift nos eventos após remover/editar respiros; casos de borda a 24/25/30/60 fps cobertos; preview e MP4 equivalentes em frames amostrados.

## 6. Semantic Analyzer (P1)

Entrada: briefing **textual e livre** enviado pelo WAR, instruções estruturadas extraídas pelo Briefing Interpreter, transcrição por palavras, cut map e contexto de mídia. Objetivo comercial somente se explicitado no briefing ou disponível na demanda real. Não exigir brand kit nem perfil do cliente. Saída: oportunidades narrativas, não motions.

Rótulos sugeridos: `hook`, `pain`, `problem`, `urgency`, `statistic`, `comparison`, `benefit`, `objection`, `credibility`, `testimonial`, `cta`, `transition`, `neutral`.

Para cada trecho: `startWordId`, `endWordId`, `intent`, `importance`, `visualGoal`, `claims`, `tone`, `confidence`, `densityHint` e justificativa breve. O analisador deve identificar também **trechos que não merecem efeitos**. Nunca inventar porcentagens, prazos, resultados nem conteúdo jurídico factual ausente do vídeo/briefing.

**Qualidade:** no Fast Path, executar esta análise dentro da **mesma chamada principal** de planejamento criativo; não disparar uma nova chamada por trecho ou janela. Para anúncios ≤90s, passar a transcrição inteira compactada (com âncoras) quando couber no orçamento. Processamento em janelas só se for inevitável em vídeos fora do escopo e sem explosão de chamadas; separar transcrição original da interpretação. Cache por hash da transcrição + briefing + versão do prompt/modelo.

## 7. Motion Retrieval & Planner (P1)

**Recuperação inicial:** tags/intenção + compatibilidade de estética + duração + nível de intensidade. Para acervo pequeno, filtros e scoring determinístico são suficientes; embeddings ficam como melhoria após evidência de limitação.

**Scoring inicial parametrizável:** adequação semântica 35%, aderência ao briefing/preset geral 25%, ritmo/contexto 20%, feedback editorial agregado 20% (pesos meramente experimentais; sem histórico, redistribuir). Aplicar hard filters antes do ranking: tipo aprovado, tempo suficiente, props válidas, compatibilidade com o briefing da demanda e restrições globais.

Passar à IA somente candidatos recuperados com descrições curtas e exemplos. Output: **plano declarativo limitado a motions da whitelist**, razões e grau de prioridade. Incluir escolha `no_motion`. Diferenciar camada de corte/legenda/motion/transição. Planejamento deve considerar contexto da timeline inteira para não criar ritmo repetitivo.

**Structured Outputs:** no Fast Path, unir o Briefing Interpreter, a classificação narrativa desta seção e a escolha dos motions **numa única requisição de planejamento**. Usar Responses API, schema estrito suportado e helper Zod compatível com versão real do SDK; lidar com recusas, saídas incompletas, timeout, retries limitados e fallback seguro. O modelo é configurável, não fixo no código. Chave OpenAI somente server-side. Nunca aceitar o JSON da IA diretamente para executar animações.

## 8. Composition Engine e direção de arte (P1/P2)

Criar regras determinísticas:

1. Densidade máxima configurável por 10s / minuto; não repetir o mesmo motion em sequência sem motivo.
2. Safe areas para legendas e overlays de interface/formatos 9:16, 4:5, 16:9.
3. Conflitos espaciais (bounding boxes) e temporais: reposicionar, escalonar, reduzir ou rejeitar.
4. Duração mínima de leitura baseada em caracteres/linhas; evitar motions rápidos ilegíveis.
5. Presets globais reutilizáveis `premium`, `dynamic`, `educational`, `testimonial`, `minimal`, selecionados pelo briefing ou por default; **sem ajustes persistidos por cliente**.
6. Limites específicos para flashes, strobing, shakes e transições agressivas (acessibilidade e conforto visual).
7. Cap de elementos simultâneos por composição; hierarquia tipográfica, alinhamento e contraste.
8. Transições de cena só em fronteiras reais de clipes/blocos, não por palavra-chave isolada.

**Atenção a propriedade `transform`:** composição de zoom + entrada + shake precisa usar wrappers aninhados ou transformação combinada; não sobrescrever o mesmo CSS transform com múltiplos motions concorrentes.

**Fase posterior:** amostragem visual de frames-chave para caixas de rosto, assunto, texto e espaço negativo. Armazenar somente metadados necessários e respeitar privacidade/retention; não enviar vídeo inteiro à IA em toda edição.

## 9. Motion Recipes (P2)

Adicionar biblioteca de **receitas compostas** que orquestram motions existentes com offsets relativos e prioridades: `pain_point_emphasis`, `statistic_reveal`, `premium_lower_third`, `cta_reveal`, `comparison_stack`, `testimonial_quote`.

Formato exemplo:

```json
{
  "id": "pain_point_emphasis",
  "version": 1,
  "baseDurationFrames": 45,
  "steps": [
    {"type": "zoom", "offsetFrames": 0, "durationFrames": 45},
    {"type": "keyword", "offsetFrames": 8, "durationFrames": 30},
    {"type": "flash", "offsetFrames": 4, "durationFrames": 3}
  ]
}
```

Não implementar Flash indiscriminadamente: receita apenas quando compatível com o briefing e regras globais, com limite de intensidade e segurança. Permitir substituir partes da receita manualmente. Escolhas devem ser editáveis no mesmo timeline.

## 10. GSAP: decisão técnica, não pressuposto (P2 spike)

**Recomendação:** **não migrar motions existentes para GSAP agora**. Remotion `interpolate`/`spring` é excelente para efeitos atuais e entrega determinismo naturalmente. GSAP poderá trazer ganho em **coreografia complexa de múltiplos elementos, timelines com labels, sequenciamento, easing refinado e animações SVG/DOM mais elaboradas**; não melhora automaticamente tipografia, ritmo, composição ou direção de arte.

O Remotion documenta `@remotion/gsap` com `useGsapTimeline()` guiado pelo frame. Investigar essa integração **na versão instalada** antes de adotar. Não usar `gsap.to()` com ticker em tempo real, `requestAnimationFrame`, callbacks com side effects ou animações dependentes de montagem/seek. Não supor compatibilidade de versão ou licença sem verificar.

**Spike obrigatório:**

- Criar **apenas 2–3** motions premium experimentais: `kinetic_headline`, `editorial_stat_reveal`, `premium_lower_third`.
- Produzir pares equivalentes Remotion puro x GSAP frame-driven; comparar fluidez, coordenação, capacidade criativa, render, tamanho do bundle, memória e manutenção.
- Buscar frames N em ordem aleatória (ex.: 0, 20, 8, 44, 20) e exigir pixel-identidade do mesmo frame; comparar Player e render headless.
- Verificar limites do `@remotion/gsap`, cleanup, refs, SSR/headless, fontes e resize.
- Avaliar se efeitos avançados podem ser alcançados com `spring`, `interpolate`, `Easing`, máscaras CSS/SVG, nesting e `@remotion/transitions` sem adicionar dependências.

**Critério de adoção:** só habilitar GSAP por motion se oferecer **ganho visual demonstrável** em avaliação cega de edição e passar determinismo/performance. Caso contrário, manter animações Remotion. Habilitar atrás de flag e preservando fallback. Nunca reescrever a biblioteca inteira por preferência tecnológica.

## 11. Briefing WAR + presets globais de edição (P1/P2)

**Substitui integralmente o conceito de perfil por cliente.** O WAR envia à demanda um briefing simples em texto livre; não exigir formulário padronizado ou enriquecimento manual. Implementar adaptador para capturar a string original e associá-la à demanda/timeline. Não exigir brand kit, paleta própria, fonte própria, histórico do cliente nem configuração de onboarding.

**Briefing Interpreter:** receber `briefingText` e produzir instruções internas como `stylePreset`, `pacing`, `mustInclude`, `avoid`, `keyMessages`, `optionalOverrides`, `unspecified` e `evidence` (frase de origem do briefing). Exemplo: "edição dinâmica, destacar 3 benefícios, não usar emojis" → preset `dynamic`, três benefícios como foco e proibição de motion emoji. Instruções vagas não devem virar regras rígidas; conflitos e impossibilidades ficam visíveis ao editor. Se o campo estiver vazio, usar defaults gerais e o conteúdo da transcrição; nunca gerar informações de cliente ausentes.

**Presets são compartilhados por todas as demandas:** `balanced` (default), `premium`, `dynamic`, `educational`, `testimonial`, `minimal` e outros apenas se houver necessidade comprovada. Cada preset estabelece densidade de motion, intensidade, ritmo, estilo de legenda e restrições de composição. Os presets são **biblioteca global**, não registros por cliente. Briefing explícito pode sobrescrever o preset da demanda, respeitadas as regras técnicas e de segurança.

**Overrides pontuais:** se o briefing trouxer detalhes como "usar vermelho" ou "sem flash", aplicar a **essa edição** e persistir apenas como parte do projeto, não no cadastro do cliente. Editor pode trocar o preset ou editar decisões a qualquer instante. Alteração da demanda no WAR deve sinalizar revisão do briefing e evitar sobrescrever ajustes manuais já realizados.

**Aceite:** com briefing curto, longo, vazio, contraditório e com proibições explícitas, o planejador produz resultados coerentes, explicáveis e editáveis; nenhum fluxo depende de configuração por cliente. Não criar telas de perfil de marca, custo de implantação extra ou trabalho de cadastro para os editores.

## 12. Refinar trecho com IA (P2)

Na timeline, permitir selecionar range e pedir: `mais premium`, `mais dinâmico`, `reforçar palavras`, `reduzir efeitos`, `melhorar ritmo`. Enviar apenas o briefing atual (ou suas instruções extraídas), preset global escolhido, contexto necessário + eventos existentes + locks. Retornar **proposed patch** (`add`, `update`, `remove`) com diff, preview e botões **Aplicar / Rejeitar**. Editor pode desfazer tudo em um undo atômico.

Não remover ajustes manuais bloqueados. Não regenerar projeto completo. Backend deve exigir `baseRevision`; em caso de revision divergente, recalcular diff ou pedir atualização, jamais sobrescrever silenciosamente trabalho do editor. Idempotency key e log das operações.

## 13. Memória editorial e melhoria contínua (P3)

Capturar `proposalId`, motion, contexto, parâmetros, decisão final, tipo de intervenção e alterações (tempo, tamanho, cor, posição, substituição, remoção). Não tratar toda exclusão como feedback negativo inequívoco. Registrar `reason` opcional e distinção entre rejeição estética, conflito de layout, timing e erro factual.

Recuperar exemplos de timelines previamente aprovadas por intenção narrativa, estilo genérico e tipo de peça, **sem segmentação por cliente**. Inicialmente heurísticas/tags; embeddings opcionais depois. Construir dataset de pares `proposta -> aprovado`, anonimizado quando apropriado. **Fine-tuning só após benchmarks demonstrarem necessidade e volume/qualidade de exemplos adequados.**

## 14. QA visual e avaliação objetiva (P0–P3)

Montar conjunto de pelo menos 20 vídeos autorizados e representativos, de categorias variadas, com edição humana aprovada; conservar permissões e dados protegidos. Avaliar vídeos às cegas por editores/gestores, sem favorecer a ferramenta.

### Métricas

- **Primary:** qualidade percebida (rubrica 1–5: clareza narrativa, legibilidade, consistência visual, ritmo, acabamento, adequação ao briefing).
- **Primary:** minutos de intervenção humana por vídeo **até aprovação**.
- Taxa de aceitação de motions e número de patches/correções.
- Percentual de vídeos aprovados na primeira revisão.
- Erros de timing, textos falsos, colisões visuais, overlays cortados, legenda ilegível.
- Custo OpenAI por vídeo, latência de planejamento, preview FPS e render por minuto de output.
- Determinismo de render (mesmo frame, mesma saída visual em ambiente controlado).

**Metas iniciais propostas (ajustar ao baseline):** zero invalidações de schema, zero eventos fora da timeline, zero adulterações de cortes manuais, >90% de frames de teste dentro da tolerância visual definida; ganho mensurável de avaliação visual sem aumentar significativamente o tempo por vídeo. Não prometer porcentagem de aceitação antes de medi-la.

### Testes obrigatórios

- Unit: schemas, whitelist, defaults, constraints, scoring, cálculo de fps, cortes e anchors.
- Property-based: tempos não negativos, duração limitada, `wordId` inexistente, múltiplos clipes, vídeos vazios.
- Integration: plano IA -> compiler -> timeline -> Player -> MP4.
- Snapshot visual em frames-chave 9:16, 4:5, 16:9, vários FPS, fontes e legendas.
- Seek aleatório, remount, export headless e comparação de frames.
- Falhas OpenAI, API lenta, schema inválido, ausência de candidate motion, queda de rede: fallback manual seguro.
- Controle de acesso por cliente/projeto e não exposição de brutos/briefings entre tenants.

## 15. Operação, custos, performance e segurança

- Fast Path P0 conforme seção 1A: uma chamada criativa principal por vídeo, transcrição separada e toda validação/composição/renderização sem LLM.
- Cache das análises por versão do prompt/modelo e hashes do input; replanejar apenas trechos afetados.
- Limitar o conjunto de candidatos por trecho e número de sugestões; evitar varredura por IA da biblioteca inteira em cada request.
- Instrumentar custos/tokens/latência e observabilidade por etapa, sem salvar conteúdo sensível desnecessariamente.
- Modelos e prompts versionados; saída inclui `schemaVersion`, `plannerVersion`, `briefInterpreterVersion`, `stylePresetVersion`.
- Checar permissões de vídeo/briefing do WAR; dados de clientes segregados; retenção e exclusão documentadas.
- Clamping e saneamento de todos os parâmetros (`fontSize`, `scale`, `opacity`, `color`, texto, asset ids, caminhos), para evitar travamentos e injeções.
- Export sempre reproduz exatamente uma revisão congelada da timeline, sem novas decisões da IA em render time.
- Respeitar condições comerciais/licenciamento de Remotion, bibliotecas, assets e fontes no cenário de uso da Scale e eventual SaaS.

## 16. Contrato de implementação da IA

A IA pode retornar **apenas decisões de edição e metadados permitidos**; não pode enviar HTML/CSS/JS ou comandos. Exemplo de envelope:

```json
{
  "schemaVersion": 1,
  "projectRevision": 27,
  "segments": [
    {
      "startWordId": "w143",
      "endWordId": "w150",
      "intent": "pain",
      "importance": 0.9,
      "visualGoal": "emphasize_loss"
    }
  ],
  "proposals": [
    {
      "id": "proposal_001",
      "motionId": "keyword",
      "anchorWordId": "w146",
      "offsetMs": -80,
      "durationMs": 1100,
      "props": {
        "text": "PERDENDO CLIENTES",
        "emphasis": "strong",
        "position": "center",
        "colorToken": "brand.primary"
      },
      "reason": "Enfatizar a principal consequência negativa"
    }
  ]
}
```

**Nota:** trata-se de exemplo de formato de domínio, **não** um schema pronto para submissão ao Structured Outputs. Gerar um schema estrito compatível com a versão SDK/modelo disponível; validar `props` com schema específico por motion depois do parse e projetar objetos sem campos dinâmicos quando exigido.

### Ordem de validação

1. Saída de modelo completa e parseável; compatibilidade do schema.
2. Autorização de projeto/cliente; revisão base válida.
3. `motionId` dentro da lista recuperada/autorizada; versão suportada.
4. Props por tipo + limites, cores/fontes por token, números fundados no texto/briefing.
5. Anchor/wordId válido e mapeamento de source para timeline.
6. Regras de layout, safe area, density, conflitos e motion accessibility.
7. Gerar patch com diff e audit trail; aplicar só após aprovação, ou por política explícita.

## 17. Roadmap executivo (dependências + entregáveis)

| Fase | Prioridade | Construção | Entrega verificável | Depende de |
|---|---|---|---|---|
| 0 | P0 | Audit + baseline + dataset de avaliação | mapa real da arquitetura, 20 casos e métricas iniciais | acesso ao repositório |
| 1 | P0 | Registry tipado + schemas + adapters | motions atuais catalogados, validados e sem regressão visual | fase 0 |
| 2 | P0 | Time mapping + compiler + tests | anchors precisos pós-corte; saída estável Player/MP4 | fase 1 |
| 3 | P1 | Semantic Analyzer + candidate retrieval **local** | tags e shortlist sem chamada LLM adicional; intenções inferidas no planner único | fases 1–2 |
| 4 | **P0** | **Fast Path Creative Planner: 1 chamada criativa + Structured Outputs + patch + telemetria** | first-pass em até 180s end-to-end alvo, consumo medido e fallback seguro | fase 3 |
| 5 | P1 | Composition Engine + briefing WAR + presets globais | legibilidade, densidade e alinhamento consistentes | fases 2–4 |
| 6 | P2 | Receitas compostas + polish de motions | motions premium reutilizáveis, sem conflitos | fase 5 |
| 7 | P2 | Spike GSAP frame-driven | decisão documentada Go/No-Go + 2–3 protótipos | fase 6 |
| 8 | P2 | Refinar trecho com IA, diff, locks, undo | ajustes locais sem perder edição humana | fases 4–5 |
| 9 | P3 | Feedback store + exemplos aprovados | evolução mensurável das sugestões | fases 4, 8 |
| 10 | P3 | Análise visual de frames + posição inteligente | menos oclusões; overlays respeitam rostos/legendas | fase 5 |
| 11 | P3 | Avaliação contínua + tuning e observabilidade | dashboard e comparação de versões | todas |

**Sequência recomendada para começar hoje:** fases 0 → 1 → 2 → 3 → 4, **incluindo observabilidade, orçamento e teste de p95 do Fast Path antes do rollout**. Não começar pela troca de engine de animação; primeiro elevar a qualidade de decisão e garantir aplicabilidade segura.

## 18. Critérios de aceite por milestone

### M1 — Registry e compiler
- Todos os motions atuais têm entrada no registry e continuam funcionando.
- Parser rejeita IDs/props inválidos e mantém timeline intocada.
- Eventos ancorados em palavras acompanham cortes sem drift.
- Tests + snapshots passam sem alteração visual involuntária.

### M2 — AI Creative Planner
- Para 20 vídeos teste, existem propostas válidas e explicáveis, com opção `no_motion`.
- Não há estatísticas/textos inventados nem motion fora dos limites.
- Primeiro passe é editável e reversível.
- Fast Path: apenas **uma chamada criativa** por vídeo típico, além da transcrição; sem chamadas individuais por trecho/motion.
- Meta de `analysis_clicked → patch_applied`: **p95 ≤180s** em lote real de ≥20 vídeos ≤90s; expor também tempo de preparação/upload e render à parte.
- Entrada/saída de tokens, cache, retries, custo e gargalos mensuráveis; meta inicial 3k/1k tokens do planner, refinada por benchmark.
- Taxas de custo e latência observáveis; qualidade editorial não inferior ao baseline.

### M3 — Acabamento visual
- Briefing WAR interpretado e presets gerais aplicados, sem configurar perfil por cliente.
- Redução documentada de conflitos e do excesso de motion.
- Comparação cega mostra benefício versus baseline ou fornece lista objetiva de ajustes.

### M4 — Refinamento interativo
- Editor refina intervalo sem refazer todo o projeto.
- Locks, revisão, diff, rollback, undo funcionam.
- Nenhuma edição manual fora do trecho é perdida.

### M5 — Decisão GSAP
- Spike concluído e testado em Player/export/seek.
- GSAP só adotado para os casos em que ganho visual compensa dependência e custo.
- Nenhum componente pré-existente reescrito sem justificativa.

## 19. Instruções de execução para o agente

**Primeira resposta do agente no repositório:** inventário do que existe, lista de riscos e plano de arquivos específicos para M1. Em seguida, **implementar M1** e executar lint, typecheck, testes e render de smoke. Prosseguir para a fase seguinte somente após M1 estar validado. Se tarefas exigirem decisão de produto, escolher defaults conservadores e documentar, sem bloquear melhorias seguras.

Em cada fase, entregar:

1. Arquivos criados/modificados com responsabilidades explicadas.
2. Contratos/schema e migrations se necessários.
3. Testes adicionados e resultados reais.
4. Demo/antes-depois e métricas, quando houver dados disponíveis.
5. Pendências, performance, segurança e próximos passos.

**Não declarar pronto algo que não foi executado/testado.** Não inserir credenciais no código. Não instalar dependências sem justificar. Nunca alterar o fluxo existente do WAR ou do Drive quando desnecessário. Priorizar experiência do editor e qualidade de produto acima da quantidade de features.

## 20. Documentação técnica a consultar e revalidar

- Remotion `useCurrentFrame`: https://www.remotion.dev/docs/use-current-frame
- Remotion `interpolate`: https://www.remotion.dev/docs/interpolate
- Remotion transitions: https://www.remotion.dev/docs/transitions
- Remotion API `@remotion/gsap`: https://www.remotion.dev/docs/api
- Integração frame-driven GSAP (fonte): https://github.com/remotion-dev/remotion/blob/main/packages/gsap/src/use-gsap-timeline.ts
- OpenAI Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- OpenAI SDK Structured Outputs: https://github.com/openai/openai-node/blob/main/docs/structured-outputs.md

Consultar documentação correspondente à **versão instalada** antes de escrever integração. A existência de documentação de `@remotion/gsap` não significa que este projeto já possui o pacote ou que sua versão suporta a mesma API.

---

## Resumo para o agente

**Missão:** transformar o Vision de um editor que aplica efeitos sugeridos por IA em um editor com **direção criativa programática**, padrão visual premium e capacidade de aprender com aprovação humana, mantendo **React + Remotion** como runtime principal. A IA interpreta e planeja; o registry autoriza; o compiler valida; a timeline apresenta; o editor controla; o Remotion renderiza. Usar GSAP **somente quando o spike provar ganho real de qualidade e determinismo**.
