# VISION — editor de vídeo com IA (uso pessoal)

Vídeos curtos (máx 1:30). A IA gera uma "receita de edição" em JSON; o Remotion
renderiza. Cortes entram APLICADOS (sem aprovação; o operador desfaz no
editor). O resto da IA (motions, transições, música, imagens) entra pendente
e é planejado DEPOIS dos cortes, sobre o vídeo final.

## Arquitetura

- `packages/recipe` — fonte da verdade: schema zod da receita, tipos e
  utilitários de tempo (`sourceToOutput`, `applyCutToSegments`...). Qualquer
  mudança no formato da receita começa aqui, com testes.
- `packages/video` — composições Remotion. `src/index.ts` registra o root (só
  para bundle/render); consumidores importam de `src/exports.ts`.
- `apps/server` — pipeline ffmpeg/Whisper + CLI (`src/cli.ts`) + render.
- Binários ffmpeg/ffprobe vêm de `ffmpeg-static`/`ffprobe-static` (npm), não do
  sistema.

## Convenções críticas

- Timestamps em segundos no tempo do VÍDEO BRUTO (exceto overlays e
  `audioClips`: tempo do vídeo final). Conversão via `packages/recipe/src/time.ts`.
- Timeline guarda segmentos MANTIDOS, ordenados e sem sobreposição.
- Cortes detectados vivem em `timeline.suggestedCuts` (registro do que foi
  cortado e por quê). Motivos (`reason`): silence (ffmpeg), pause/filler/
  repeat (determinísticos sobre a transcrição, `transcript.ts`) e retake (LLM
  aponta índices de palavras; o servidor converte para tempo). Entram por
  `mergeSuggestions` (dedupe) e são APLICADOS na hora por
  `applySuggestedCuts` (`apps/server/src/pipeline/applyCuts.ts`:
  `applyCutSuggestions` → legenda reagrupada pelo vídeo cortado
  (`regroupBlocks` com `timeline`: o limite conta só palavras que ficam,
  quebra em pausa cortada) → sons dos motions acompanham). Sem aprovação no
  editor: palavra cortada aparece riscada no texto e restaura com ⌫.
  "Cortar" de novo (outro ritmo) desfaz as pausas aplicadas antes
  (`undoAppliedCuts`, não devolve clipe apagado) e mede de novo. Status
  pending só sobra em projeto antigo (botão "Aplicar cortes pendentes").
- Antes de detectar, `refineTranscriptTimings` apara das palavras do Whisper o
  silêncio real do áudio (ele estica palavras sobre pausas). Silêncio =
  silencedetect −35 dB ∪ limiar do próprio clipe (`quietRangesFromLevels`:
  RMS em janelas de 50 ms, entre o fundo p10 e a fala p90) — em sala com
  ruído o limiar fixo não acha nada. Vícios/muletas
  usam contexto (pausa em volta, abertura de fala) + a mesma chamada de LLM das
  retomadas (kind "filler"). Ritmo das pausas: `PAUSE_PACES` (suave/normal/
  acelerado), escolhido no editor e enviado em `smart-cuts`.
- Editor por texto: cortar palavras usa `wordsCutRange` (inclui a pausa
  seguinte); restaurar usa `wordsRestoreRange` + `restoreSourceRange` (só o
  áudio da palavra). Palavras cortadas somem da legenda no render.
- Motions (`recipe.motions`): biblioteca FECHADA (18 tipos) desenhada em
  `packages/video/src/Motions.tsx` (+ `ElementsMotions.tsx`: marcação desenhada,
  gráfico, selo e linhas de velocidade adaptados do Remotion Elements; +
  `ScreenMotion.tsx`: tela cheia com fundo animado — papel, grid, pontos,
  gradiente — que quebra o quadro; modelo `layout` "phrase" (padrão, frase
  palavra a palavra) ou "list" (título + 2–5 `items` entrando um a um,
  `marker` número/check; a IA pede passando items com |); esconde a legenda se `hideCaptions`, no
  máx. 1 a cada 15 s e nada de texto por baixo, regras em `validateComposition`); metadados no **Motion Registry**
  (`packages/recipe/src/motionRegistry.ts`: finalidade, usar/evitar, camada,
  durações, variantes, campos da IA). Tipo novo = schema + manifesto +
  componente + teste; variante nova nunca muda o padrão antigo (projetos
  salvos renderizam igual). Receitas de motion = "combos"
  (`motionCombos.ts`; "recipe" já é a receita de edição): expandidas no
  código em motions com o mesmo `group`. A IA só escolhe tipo/âncora/campos;
  nunca gera código de animação. Âncora no tempo do BRUTO (`sourceId`+`sourceTime`, segue
  os cortes); `durationSeconds` no tempo final. Render usa só `accepted`;
  o editor passa `previewPending` para mostrar sugestões. Posições em % da
  ALTURA (`top`), nunca `padding-top` % (é relativo à largura).
- Creative Planner (`apps/server/src/creative/`): briefing do War lido no
  código (`interpretBriefing`: estilo e proibições), catálogo filtrado
  (`getCandidateMotions`), UMA chamada com Structured Outputs, depois
  `compilePlan` (âncora, params, fatos) e `validateComposition` (densidade e
  camadas por estilo; mesmo tipo solto no máx. ~1/3 da cota). Roda depois
  dos cortes aplicados (projeto antigo com corte pendente: planeja como se
  aplicado, `withPendingCutsApplied`); cortes marcados com ‖ no prompt; `transitionFillers` completa transições
  nas trocas de clipe se a IA puser poucas. Fala que vira lista ("em casos
  de", "esses são os pontos", "3 erros", "primeiro… segundo";
  `detectEnumerations`) põe a tela cheia no catálogo (qualquer estilo, salvo
  proibição), é listada no prompt e a tela cheia em modelo lista entra com
  prioridade máxima na composição. Modelo padrão `gpt-4.1`
  (`CREATIVE_MODEL` troca). Cache por hash em `creative-cache.json` do projeto;
  métricas em `data/creative-metrics.jsonl`. Sem perfil por cliente: só o
  briefing da demanda + estilos globais. O briefing é o MÍNIMO, não o limite
  (prompt): pedidos e proibições valem, e a IA completa a edição (gancho,
  ênfases, câmera, transições, CTA); sem estilo no briefing prefere dynamic.
  Docs: `docs/motion-catalog.md` (gerado), `docs/motion-design-guidelines.md`.
- Música e SFX são `recipe.audioClips` (kind music|sfx, start/duration/offset,
  fades relativos ao clipe); helpers em `audioClips.ts`. `audio.music`/`sfx`
  antigos são convertidos por `migrateRecipeData`.
- Música automática (`music.ts`): cada música da biblioteca tem `asset.music`
  (estilo), gerado uma vez por `npm run cli -- library music`
  (`library/analyzeMusic.ts`): medição do sinal no código (`musicFeatures.ts`:
  BPM → andamento, batida/graves/brilho/intensidade como pistas) + `gpt-audio`
  ouvindo 2 trechos com as pistas (energia, humor, gênero, voz, uso; temp 0,
  2ª tentativa se responder sem JSON). Sozinha a IA errava gênero/energia e
  cada fórmula de sinal errava um gênero. O planner descreve a trilha que o
  vídeo pede (`music` na saída → `recipe.musicWant`); `rankMusic` escolhe
  (evita voz cantada) e `suggestMusicClip` põe um clipe music `status:
  "pending"`, `origin: "ai"`, `note` = motivo. Pendente toca só no preview
  (`previewPending`); o render ignora. Painel Áudio: Aceitar / Outra música
  (`swapMusicClip`, próxima do ranking) / Recusar. Trilha já aceita ou posta à
  mão não é trocada. "sem música/trilha" no briefing desliga.
- Legenda com TAMANHO FIXO (padrão Poppins 900, contorno 6px): nunca encolher
  a fonte por frase (`autoFit` é obsoleto e ignorado). Frase que não cabe em
  `maxLines` linhas vira partes equilibradas (`paginateWords` em
  `captions.ts`, medida injetada; no render `measureText` só depois de
  `useGoogleFont` devolver pronto), trocadas no tempo da fala.
  `captions.style.animation`: pop (padrão antigo, não mudar), none e os modelos
  suaves smooth/reveal/box/blur (`Captions.tsx`: tudo curva no tempo, destaque
  da palavra com `interpolateColors`, saída em fade antes da próxima parte; no
  box a folga da pílula vale para todas as palavras e entra na paginação).
  Modelos prontos no painel (`CAPTION_MODELS` em `StylePanel.tsx`). Na folga
  depois da última palavra, vale o bloco que começou por último.
- Cor de destaque dos motions: `motion.accentColor` > `recipe.motionStyle.
  accentColor` > `captions.style.highlightColor` (`resolveMotionAccent`); só
  #RRGGBB. "Aplicar a todos" = `applyAccentToAll`. A IA não escolhe cor.
- Ajuste de cor por vídeo bruto: `source.color` (`ColorGradeSchema` em
  `color.ts`: exposure/contrast/saturation/temperature; null = original). O
  render aplica filtro CSS brightness→contrast→saturate + camada soft-light de
  temperatura isolada no vídeo (`SegmentVideo`): preview = MP4. "Automático" =
  `POST /api/projects/:id/color/auto` (ffmpeg signalstats em 7 quadros, faixa
  pc/tv do arquivo → `autoGradeFromStats`, conservador: nunca reduz contraste
  nem saturação); não grava, o editor aplica e o operador salva.
- TUDO que a edição aplica aparece na timeline e é editável/removível: nada
  de efeito escondido lido só pela composição. Template/automação materializa
  itens da receita (motions, audioClips, overlays). Ex.: o zoom nos cortes do
  template Dinâmico são motions de zoom do grupo "punch-in" (`withPunchIn`);
  o antigo `effects.punchIn` é convertido por `migrateRecipeData` e ignorado.
- Som dos motions (`motionSfx.ts`): clipe sfx comum em `audioClips` com
  `motionId` — o operador move, troca, muda volume ou apaga sem mexer no
  motion. Estilo pelo tipo/variante (`sfxStyleFor` → `SFX_STYLES`, nomes da
  biblioteca; sem IA). `applyMotionSfxRules(antes, depois)` roda em todo
  `commit` do editor: motion apagado/recusado leva o som, motion que mudou de
  lugar (arrasto/corte) leva o som com a mesma distância, motion recém-aceito
  ou inserido ganha som se `motionStyle.autoSfx`. Zooms "punch-in" não têm som.
- Split e enquadramento (`framing.ts`): overlay `split-bottom`/`split-top`
  ocupa uma metade e, enquanto está ativo (`activeSplitAt`), o vídeo
  principal vai para a outra metade (não fica escondido atrás). `framing`
  {x,y,zoom} (object-position + scale, só em mídia cortada/cover) existe no
  overlay e na fonte (vídeo principal, vale em todos os trechos dela).
  AbsoluteFill do Remotion fixa height 100%: metade precisa de height "50%".
- Camadas da timeline (`mediaRules.ts`): áudio só em trilha de áudio
  (Música, Efeitos, Áudio do vídeo), nunca com vídeo/texto; vídeo de overlay
  sai sem som. Arquivo solto do computador vai pela `dropTarget` (áudio →
  Música/Efeitos mesmo se solto em cima do vídeo; vídeo → clipe da sequência,
  som na trilha do vídeo, ou overlay se solto em Overlays; imagem → Overlays).
  Limites `UPLOAD_LIMITS` (vídeo 60 s/300 MB, áudio 5 min/40 MB, imagem 20 MB)
  checados no editor antes de subir e de novo no servidor (`checkClipUpload`).
- Transições (`transitions.ts`, kind `transition`): 5 modelos fixos da
  biblioteca (luz, queima, glitch, varrida, papel), cada um ≤ 1,3 s com som
  próprio. Sempre num corte (`snapToCut`, ±1,5 s da palavra, centralizada),
  máx. 3 por vídeo, ≥ 10 s entre elas, fora dos 1,5 s das pontas
  (`validateComposition`). Planner só oferece se os arquivos existem no
  catálogo; render pula (onError) se faltarem. O vídeo da transição toca
  mudo: o som é um clipe sfx comum, e TODA transição tem o seu
  (`ensureTransitionSfx`, mesmo com `autoSfx` desligado): roda em todo
  commit, no planner, ao abrir o projeto e antes do render; som segue o
  status da transição (sugestão → som pendente, só no preview).
- Ilustração (`illustration.ts`, kind `illustration`): imagem gerada na
  Magnific (Nano Banana Pro Flash), SEMPRE 1:1 em 1K, estilo colagem de papel
  fixo em `illustrationPrompt` (a IA só descreve O QUE desenhar: slot text →
  `subject`). Máx. 3 por vídeo, ≥ 8 s entre elas. Geração em
  `creative/illustrate.ts` (POST + polling, baixa a imagem para
  `assets/illus-<hash>`, cache por descrição em `illustrations.json`, teto de
  12 por projeto) via `POST /api/projects/:id/illustrations` ou
  `cli illustrate`. Fora do plano de motions (`getCandidateMotions` exclui;
  replanejar não apaga imagem pendente). `analyzeAndApply` (Analisar e
  aplicar + análise automática) gera 2 (`AUTO_IMAGES`) no fim, só se o
  projeto ainda não tem nenhuma ilustração e com `MAGNIFIC_API_KEY`; falha
  não derruba a análise. Mais imagens pelo botão "Sugerir imagens"
  (`creative/illustrationPlanner.ts`, `POST .../illustrations/suggest`:
  1 chamada de IA escolhe os pontos-chave → `compilePlan` +
  `validateComposition`/`mergeMotionSuggestions` com `onlyKinds:
  ["illustration"]`, que não mexem nas outras sugestões pendentes → imagens
  geradas em paralelo, entram pendentes já com a imagem) ou pelo "Gerar
  imagem" do painel. Sem `params.image` não entra no MP4 (o Player mostra um
  cartão "ainda não gerada").
- Densidade (`validateComposition`): câmera (zooms, inclusive punch-in),
  transições e ilustrações não contam na cota de motions por janela de 10 s
  (têm regras próprias; a ilustração ainda respeita a camada ocupada).
  Transições e ilustrações também ficam fora da cota total do estilo.
- Controle das imagens geradas: galeria no painel de Motions
  (`IllustrationGallery.tsx`; `GET/DELETE /api/projects/:id/illustrations`):
  reaproveitar sem gastar crédito (inserir no playhead, trocar na selecionada),
  variação, apagar só fora de uso (apagada segue contando no teto;
  `MAGNIFIC_MAX_PER_PROJECT`, padrão 12).
- Análise automática (`creative/autoAnalyze.ts`): subir os brutos (demanda ou
  avulso) dispara no servidor transcrição → cortes aplicados (com a IA das
  retomadas) + legenda reagrupada → plano de motions → 2 imagens (motions e
  imagens pendentes), em fila (1 projeto por vez). Andamento em
  `analysis.json` do projeto (`GET /api/projects/:id/analysis`; também em cada
  vídeo da demanda); o editor acende a seta da etapa e recarrega a receita no
  fim. Substitui o antigo Diretor IA (que aplicava cortes de silêncio,
  música, narração e título sem revisão).
- Render e temporários (`render/bundle.ts`): UM bundle do Remotion por
  processo (`getServeUrl`, aquecido na subida em produção/Linux; no Windows
  em dev fica para o 1º render), mídia por link no Linux, CLI apaga no
  `finally` (`releaseBundle`), órfãos (`.vision-owner` com PID morto, ou
  `remotion-*` > 2 h) apagados na subida e no `retention`. Fila = 1 render por
  vez; render recusa com < 3 GB livres. Nunca chamar `bundle()` direto. No
  Windows o bundle é uma CÓPIA de media/ da hora em que nasceu: antes de cada
  render `syncBundleMedia` copia o que a receita usa e é novo
  (`recipeMediaFiles`). Imagem no render: nunca `<Img onError>` do Remotion
  (não libera o delayRender no erro e trava até o timeout); ver
  `useImageGate` em `IllustrationMotion.tsx`. Player do editor com
  `numberOfSharedAudioTags` 32 (`PlayerPanel.tsx`): cada trecho tem seu
  `<Audio>` montado 3 s antes; com muitos cortes curtos + música + sons o
  padrão (5) estoura e o Player quebra (⚠️).
- Formato de trabalho: na entrada (`createProject`, clipe inserido) e antes do
  render, vídeo de câmera (10 bits, 4:2:2, faixa 0–255, HEVC, >1920 px, áudio
  PCM) vira H.264 8 bits 4:2:0 BT.709 16–235 ≤1920 px + AAC
  (`pipeline/normalize.ts`; original fica como `original-*`, a limpeza apaga
  os dois). Sem isso o navegador e o render do Remotion decodificam o mesmo
  arquivo com brilho diferente (render saía mais escuro). Celular comum passa
  direto. HDR (HLG/PQ) fica como está. CLI: `npm run cli -- normalize <id>`.
- Posição livre (arrastada no preview): `placement` {x,y} = centro do elemento
  em % da largura/ALTURA, em `captions.style`, overlays e motions (null = layout
  padrão). Render marca o elemento com `data-vision-drag` (`Positioned.tsx`);
  o editor desenha as alças em `DragLayer.tsx` e grava via `setPlacement`.
- `recipe.layerOrder` empilha as camadas visuais (primeira = na frente); a
  composição e a timeline seguem essa ordem.
- Uma camada nunca tem dois itens ao mesmo tempo (`lanes.ts`): cada camada
  de motion do registry (câmera, texto, elemento, tela cheia; combo pode ter
  peças em camadas diferentes), overlays e música. `enforceLanes(antes,
  depois)` roda em todo `commit` do editor (antes do som dos motions): item
  novo ou que MUDOU DE LUGAR e caiu em cima de outro vai para o espaço livre
  mais perto (combo anda inteiro); sem espaço, a mudança é desfeita. Item
  que não mudou fica (corte e edição de texto nunca empurram nada). Bordas
  arrastadas param no vizinho (`edgeLimits`). Na timeline, motions ganham
  uma sub-linha por camada em uso; efeitos sonoros PODEM tocar juntos (o som
  acompanha o motion) e só descem para sub-linhas (`packRows`).
- Menu do botão direito na timeline + Ctrl+C/X/V/D (`clipboard.ts`:
  `copyItems`/`pasteItems`/`splitItemAt`, por chave "tipo:id" do
  `data-sel`): recortar, copiar, colar no instante clicado (Ctrl+V: no
  playhead), duplicar logo depois, dividir aqui (trecho, áudio, overlay),
  apagar, aceitar/recusar sugestão. Colado vira aceito; combo colado ganha
  grupo novo; som colado se solta do motion. Ações em `timelineAction`
  (`Editor.tsx`); seleção única é exclusiva entre trecho/áudio/overlay/motion.
- Ação do servidor que lê a receita gravada (Tratar áudio, narração, passos
  do topo) grava antes as edições não salvas (`saveIfDirty`); o áudio
  tratado entra por `serverPatch` sobre a receita atual (edição feita
  enquanto o servidor trabalhava não some).
- Caminhos de mídia na receita são relativos à raiz do repo com "/". O dir
  `media/` é servido como raiz estática (publicDir no render); componentes usam
  `mediaSrc()` que remove o prefixo `media/`.
- NUNCA gravar JSON com BOM (PowerShell `Set-Content -Encoding utf8` gera BOM e
  quebra o bundler do Remotion) — usar o Write tool ou Node.

## Demandas do War (`apps/server/src/demands/`)

- Entrada única `POST /api/webhooks/war` (header `x-webhook-secret`); separa
  por `event`: demanda completa (sem event), `demanda.status`, `demanda.nota`.
  Só `tipo === "video"`. Saída para o War usa `x-api-key` (mesmo
  `DEMANDAS_WEBHOOK_SECRET`). Entrada NUNCA dispara saída (evita loop).
- Cliente = `clientId` do War (estável); sem ele, `nome:<slug>`, migrado quando o
  id aparece. Demanda = `id` do War. Nota = `criadoEm` (identidade nos dois lados).
- Uma `DemandVideo` por unidade de `quantidadeVideos`, ligada a um projeto;
  entrega no Drive como "Título NN.mp4" (re-render substitui o arquivo).
- BANCO COMPARTILHADO com outro sistema: o Vision só existe no schema `vision`
  (`db/vision.sql`, aplicado à mão; nunca `supabase db push`) e conecta como
  `vision_app` (`VISION_DATABASE_URL`), que só lê/grava dados nesse schema.
  Nunca usar service role nem tocar em `public`/outros schemas; SQL sempre
  qualificado `vision.<tabela>`. Mudança de tabela = novo bloco idempotente em
  `db/vision.sql`. Sem a variável, `store.ts` usa `data/demands-db.json`
  (fora de `media/`, que é público).

## Comandos

- `npm test` — testes do schema/tempo (vitest)
- `npm run cli -- ingest|transcribe|silence|smart-cuts|cuts|motions|render` — pipeline via CLI
- `npm run cli -- db-check` — confere a conexão `VISION_DATABASE_URL` (só leitura)
- `npm run cli -- user add|list|passwd|disable` — acessos (login próprio em
  `vision.users`, sessão em cookie assinado e amarrado à senha; `src/auth.ts`
  protege API e media/, só o webhook do War fica aberto). Papéis superadmin >
  admin (só editores) > editor; regras em `src/users.ts` (tela Usuários).
- `npm run cli -- analyze <id>` (Fast Path com tempos) · `motions <id>`
  (só o planner) · `motion-sheet --out x.png` (folha de contato visual,
  render headless) · `motion-catalog` (regenera o catálogo)
- `npm run cli -- retention [--dry-run] [--project id]` — limpeza de brutos e
  renders antigos; automática só com `VISION_RETENTION=on` (nunca em dev)
- Type-check: `npx tsc -p <pacote>/tsconfig.json`

## Estado / roadmap

- Fase 1 em andamento: pipeline CLI pronto; falta UI (timeline 3 trilhas +
  Remotion Player) em `apps/web`.
- Fase 2 (NÃO implementar sem pedido): imagens/efeitos sonoros/split screen,
  templates por cliente, fila em lote, multi-usuário.
- Transcrição usa Whisper API (`whisper-1`, `timestamp_granularities: word`);
  requer OPENAI_API_KEY no `.env`.
