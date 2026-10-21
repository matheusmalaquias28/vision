# Rodando o VISION localmente

## Pré-requisitos

- Node.js 20+ (npm incluso)
- Chave da OpenAI para transcrição (Whisper): crie um `.env` na raiz com:

  ```
  OPENAI_API_KEY=sk-...
  ```

Os binários de ffmpeg/ffprobe vêm dos pacotes npm (`ffmpeg-static`/`ffprobe-static`) — não precisa instalar nada no sistema.

## Instalação

```bash
npm install
```

## Rodar a aplicação

### Servidor (API + pipeline)

```bash
npm run dev:server
```

Sobe em http://localhost:4000 (mude com a variável `PORT`).

### UI web (timeline + Remotion Player)

```bash
npm run dev:web
```

Sobe o Vite (por padrão em http://localhost:5173). Rode junto com o servidor em outro terminal.

## Editando pelo texto (painel Transcrição)

1. **Transcrever** → **Sugerir cortes**. As sugestões aparecem no texto, coloridas
   por motivo (pausa, vício, repetição, retomada), com ✓/✕. Nada é aplicado
   sem aceitar.
2. Clique numa palavra para ir até ela; arraste ou use Shift+clique para
   selecionar. <kbd>⌫</kbd> corta a seleção; numa palavra riscada, <kbd>⌫</kbd>
   restaura.
3. Duplo clique numa palavra corrige o texto da legenda.
4. <kbd>Ctrl Z</kbd> / <kbd>Ctrl Shift Z</kbd> desfaz/refaz qualquer edição.

O modelo das retomadas é `CUTS_MODEL` (padrão: `DIRECTOR_MODEL` ou `gpt-4o`).

## Motions (painel Motions)

1. **Sugerir motions**: a IA lê a fala e propõe zooms, palavras-chave, emojis,
   nome/cargo, números animados e flashes, presos à palavra que os motivou.
   O campo ao lado aceita um pedido ("mais zooms, sem emoji").
2. As sugestões aparecem tracejadas na trilha Motions e em prévia no player
   (desmarque "Prévia no player" para ver só os aceitos). ✓/✕ na lista, ou
   aceitar/rejeitar todas.
3. Clique num motion para editar texto, intensidade e duração; editar uma
   sugestão já a aceita. "+ Adicionar no playhead" cria um motion manual.
4. O render final usa só os aceitos. Cor e fonte vêm do estilo da legenda.

O modelo é `MOTIONS_MODEL` (padrão: `DIRECTOR_MODEL` ou `gpt-4o`).

## Biblioteca de assets (packs)

```bash
npm run cli -- library import "<pasta do pack>"   # converte e cataloga (incremental)
npm run cli -- library tag                         # IA de visão descreve ícones/fundos/etc.
npm run cli -- library stats                       # resumo por tipo
```

- O pack é organizado por subpasta (EFEITOS SONOROS, ICONES, TRANSIÇÕES...).
  Templates do Premiere/AE (`.mogrt`, `.aegraphic`, `.prproj`) são ignorados:
  não rodam fora desses programas.
- Saída em `media/library/<pack>/` (fora do git) + `media/library/catalog.json`.
  Transições viram 1080×1920 com modo de mescla (screen/multiply); fundos
  chroma (personagens em vermelho, transições green screen) viram WebM com
  transparência.
- Rodar de novo só processa o que mudou no pack.
- Músicas entram marcadas como "licença: verificar" (muitas são faixas
  comerciais): confirme os direitos antes de usar em vídeo de cliente.
- No editor: aba **Biblioteca** no painel da esquerda.

## Pipeline via CLI (alternativa ao servidor)

```bash
npm run cli -- ingest <video>        # importa o vídeo bruto e cria a receita
npm run cli -- transcribe <projeto>  # transcreve com Whisper (requer OPENAI_API_KEY)
npm run cli -- silence <projeto>     # detecta silêncios
npm run cli -- smart-cuts <projeto>  # pausas, vícios, repetições + retomadas (IA); --no-ai pula o LLM
npm run cli -- cuts <projeto>        # lista/aceita/rejeita sugestões de corte
npm run cli -- motions <projeto>     # IA sugere motions (--instructions "...", --accept-all)
npm run cli -- render <projeto>      # renderiza o vídeo final com Remotion
```

## Testes e type-check

```bash
npm test                                        # testes de schema/tempo (vitest)
npx tsc -p packages/recipe/tsconfig.json        # type-check por pacote
npx tsc -p packages/video/tsconfig.json
npx tsc -p apps/server/tsconfig.json
```

## Observações

- Nunca gere JSON de receita com BOM (evite `Set-Content -Encoding utf8` no PowerShell) — quebra o bundler do Remotion.
- Caminhos de mídia na receita são relativos à raiz do repo, com `/`; os arquivos ficam em `media/`.
