# VISION — editor de vídeo com IA (uso pessoal)

Vídeos curtos (máx 1:30). A IA gera uma "receita de edição" em JSON; o Remotion
renderiza. Nenhuma decisão da IA é aplicada sem revisão do operador.

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
- Sugestões de IA vivem em `timeline.suggestedCuts` com status
  pending/accepted/rejected; aceitar recorta os segmentos via
  `applyCutToSegments`. Motivos (`reason`): silence (ffmpeg), pause/filler/
  repeat (determinísticos sobre a transcrição, `transcript.ts`) e retake (LLM
  aponta índices de palavras; o servidor converte para tempo). Novas
  sugestões entram por `mergeSuggestions` (dedupe, respeita o que o operador
  já rejeitou); revisão por `reviewSuggestions`.
- Antes de detectar, `refineTranscriptTimings` apara das palavras do Whisper o
  silêncio real do áudio (ele estica palavras sobre pausas). Vícios/muletas
  usam contexto (pausa em volta, abertura de fala) + a mesma chamada de LLM das
  retomadas (kind "filler"). Ritmo das pausas: `PAUSE_PACES` (suave/normal/
  acelerado), escolhido no editor e enviado em `smart-cuts`.
- Editor por texto: cortar palavras usa `wordsCutRange` (inclui a pausa
  seguinte); restaurar usa `wordsRestoreRange` + `restoreSourceRange` (só o
  áudio da palavra). Palavras cortadas somem da legenda no render.
- Motions (`recipe.motions`): biblioteca FECHADA (zoom, keyword, emoji,
  lowerThird, counter, flash) em `packages/video/src/Motions.tsx`. A IA só
  escolhe tipo/âncora/params (validados pelo `MotionSchema`); nunca gera
  código de animação. Âncora no tempo do BRUTO (`sourceId`+`sourceTime`, segue
  os cortes); `durationSeconds` no tempo final. Render usa só `accepted`;
  o editor passa `previewPending` para mostrar sugestões. Posições em % da
  ALTURA (`top`), nunca `padding-top` % (é relativo à largura).
- Música e SFX são `recipe.audioClips` (kind music|sfx, start/duration/offset,
  fades relativos ao clipe); helpers em `audioClips.ts`. `audio.music`/`sfx`
  antigos são convertidos por `migrateRecipeData`.
- Posição livre (arrastada no preview): `placement` {x,y} = centro do elemento
  em % da largura/ALTURA, em `captions.style`, overlays e motions (null = layout
  padrão). Render marca o elemento com `data-vision-drag` (`Positioned.tsx`);
  o editor desenha as alças em `DragLayer.tsx` e grava via `setPlacement`.
- `recipe.layerOrder` empilha as camadas visuais (primeira = na frente); a
  composição e a timeline seguem essa ordem.
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
- Type-check: `npx tsc -p <pacote>/tsconfig.json`

## Estado / roadmap

- Fase 1 em andamento: pipeline CLI pronto; falta UI (timeline 3 trilhas +
  Remotion Player) em `apps/web`.
- Fase 2 (NÃO implementar sem pedido): imagens/efeitos sonoros/split screen,
  templates por cliente, fila em lote, multi-usuário.
- Transcrição usa Whisper API (`whisper-1`, `timestamp_granularities: word`);
  requer OPENAI_API_KEY no `.env`.
