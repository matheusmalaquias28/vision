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

- Timestamps em segundos no tempo do VÍDEO BRUTO (exceto música: fades/offset
  no tempo do vídeo final). Conversão via `packages/recipe/src/time.ts`.
- Timeline guarda segmentos MANTIDOS, ordenados e sem sobreposição.
- Sugestões de IA vivem em `timeline.suggestedCuts` com status
  pending/accepted/rejected; aceitar recorta os segmentos via
  `applyCutToSegments`. Motivos (`reason`): silence (ffmpeg), pause/filler/
  repeat (determinísticos sobre a transcrição, `transcript.ts`) e retake (LLM
  aponta índices de palavras; o servidor converte para tempo). Novas
  sugestões entram por `mergeSuggestions` (dedupe, respeita o que o operador
  já rejeitou); revisão por `reviewSuggestions`.
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
- Caminhos de mídia na receita são relativos à raiz do repo com "/". O dir
  `media/` é servido como raiz estática (publicDir no render); componentes usam
  `mediaSrc()` que remove o prefixo `media/`.
- NUNCA gravar JSON com BOM (PowerShell `Set-Content -Encoding utf8` gera BOM e
  quebra o bundler do Remotion) — usar o Write tool ou Node.

## Comandos

- `npm test` — testes do schema/tempo (vitest)
- `npm run cli -- ingest|transcribe|silence|smart-cuts|cuts|motions|render` — pipeline via CLI
- Type-check: `npx tsc -p <pacote>/tsconfig.json`

## Estado / roadmap

- Fase 1 em andamento: pipeline CLI pronto; falta UI (timeline 3 trilhas +
  Remotion Player) em `apps/web`.
- Fase 2 (NÃO implementar sem pedido): imagens/efeitos sonoros/split screen,
  templates por cliente, fila em lote, multi-usuário.
- Transcrição usa Whisper API (`whisper-1`, `timestamp_granularities: word`);
  requer OPENAI_API_KEY no `.env`.
