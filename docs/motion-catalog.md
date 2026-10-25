# Catálogo de motions e receitas

> Gerado de `packages/recipe/src/motionRegistry.ts` e `motionCombos.ts` (registry v2). Não edite à mão: rode `npm run cli -- motion-catalog --out docs/motion-catalog.md`.

A IA só escolhe tipo, momento e campos desta biblioteca fechada; nunca escreve animação. Textos e números precisam vir da fala ou do briefing do War (o compilador confere).

## Estilos globais (iguais para todas as demandas)

| Estilo | Para quê | 1 motion a cada | Máx. por 10 s | Flash |
|---|---|---|---|---|
| Equilibrado (`balanced`) | padrão: ênfases pontuais, variedade, sem exagero | 5 s | 2 | 1 a cada 20 s |
| Dinâmico (`dynamic`) | ritmo alto: punches, frases cinéticas, mais motions | 3.5 s | 3 | 1 a cada 12 s |
| Premium (`premium`) | sóbrio: poucos motions, tipografia elegante, câmera suave, sem flash | 6.5 s | 2 | não |
| Minimalista (`minimal`) | o mínimo: só o essencial, sem flash nem emoji | 10 s | 1 | não |
| Educativo (`educational`) | clareza: listas, números e setas; sem flash | 5 s | 2 | não |

## Receitas (combos)

### Gancho de impacto — `impact-hook` (v1)

Abertura forte: punch de câmera + frase cinética. Sem flash.

- **Quando usar:** primeira frase/gancho do vídeo; promessa central forte
- **Quando NÃO usar:** mais de uma vez por vídeo; tom sóbrio demais
- **Peças:** Zoom de câmera + Frase cinética (cada peça segue editável; "Remover receita inteira" tira o grupo)
- **Duração:** 1.6–3.5 s (padrão 2.4 s)
- **Campos da IA:** `text` 2–6 palavras do gancho (frase, não palavra solta); `emphasis` 1 palavra DA FRASE para destacar (opcional)

### Revelação de número — `statistic-reveal` (v1)

Número dito ganha cartão com contagem + aproximação lenta da câmera.

- **Quando usar:** estatística, porcentagem ou valor DITO na fala
- **Quando NÃO usar:** número não foi dito; número sem contexto
- **Peças:** Número + Zoom de câmera (cada peça segue editável; "Remover receita inteira" tira o grupo)
- **Duração:** 2.2–4 s (padrão 3 s)
- **Campos da IA:** `number` só o número dito; `prefix` unidade antes, ex.: R$; `suffix` unidade depois: %, mil, dias, meses; `label` o que o número mede (até 4 palavras)

### Pilha de benefícios — `benefit-stack` (v1)

Benefícios ditos entram um a um, com aproximação discreta.

- **Quando usar:** falante enumera 2–5 benefícios ou passos
- **Quando NÃO usar:** itens não ditos; itens longos
- **Peças:** Lista de benefícios + Zoom de câmera (cada peça segue editável; "Remover receita inteira" tira o grupo)
- **Duração:** 3–6 s (padrão 4.5 s)
- **Campos da IA:** `items` 2–5 itens separados por | (até 4 palavras cada); `title` título curto (opcional)

### Foco no CTA — `cta-focus` (v1)

Chamada para ação elegante no fim: chamada com botão + seta para baixo.

- **Quando usar:** CTA final (“clica no link”, “chama no direct”, “agende”)
- **Quando NÃO usar:** não há CTA na fala nem no briefing; meio do vídeo
- **Peças:** Chamada premium + Seta (cada peça segue editável; "Remover receita inteira" tira o grupo)
- **Duração:** 2.2–4.5 s (padrão 3.2 s)
- **Campos da IA:** `text` a ação (até 6 palavras); `eyebrow` até 3 palavras (opcional)

## Motions

### Palavra-chave — `keyword` (v2, Tipografia)

Destaca 1 a 3 palavras centrais no momento em que são ditas.

- **Quando usar:** benefício; dor; alerta; oferta; palavra que resume a frase
- **Quando NÃO usar:** conectivo ou palavra genérica; outro texto animado na tela; trecho sem importância
- **Duração:** 0.8–2.5 s (padrão 1.6 s) · intensidade 2/3 · camada `text`
- **Variantes:** `pop` Selo — energético, inclinado (dinâmico); `slide` Deslizar — entrada lateral limpa (equilibrado); `underline` Sublinhado — elegante, sem caixa (premium); `marker` Marca-texto — didático, faixa pintada atrás (educativo)
- **Campos da IA:** `text` 1–3 palavras ditas naquele momento; `variant` pop|slide|underline|marker; `position` top|center
- **Checagem de fatos:** ≥ 50% das palavras de conteúdo vêm da fala/briefing
- **Estilos em que combina:** Equilibrado, Dinâmico, Educativo, Premium

### Frase cinética — `kinetic` (v1, Tipografia)

Frase curta de impacto entrando palavra a palavra (hook, promessa, tese).

- **Quando usar:** gancho nos primeiros segundos; promessa ou tese central; frase de efeito curta
- **Quando NÃO usar:** frase longa (> 6 palavras); explicação técnica; outro texto animado na tela
- **Duração:** 1.2–3.5 s (padrão 2.2 s) · intensidade 2/3 · camada `text`
- **Variantes:** `rise` Cascata — palavras sobem em sequência (dinâmico); `blur` Foco — entra desfocada e assenta (cinematográfico); `mask` Máscara — revelação por máscara com faixa (premium)
- **Campos da IA:** `text` 2–6 palavras da fala; `variant` rise|blur|mask; `emphasis` 1 palavra da frase para destacar (opcional); `position` top|center
- **Checagem de fatos:** ≥ 50% das palavras de conteúdo vêm da fala/briefing
- **Estilos em que combina:** Dinâmico, Premium, Equilibrado

### Marcação desenhada — `annotation` (v1, Tipografia)

Frase da fala com uma marcação desenhada à mão em uma palavra (Remotion Elements: Text Marker, Circle Marker, Strike Through, Crossed Off).

- **Quando usar:** destacar a palavra que importa numa frase (marker); circular o termo-chave (circle); riscar o jeito antigo, o mito ou o erro (strike); negar algo com ênfase: “isso não funciona” (crossed)
- **Quando NÃO usar:** frase longa (> 8 palavras); outro texto animado na tela; tom sóbrio demais para traço à mão
- **Duração:** 1.6–4 s (padrão 2.6 s) · intensidade 2/3 · camada `text`
- **Variantes:** `marker` Marca-texto — destaque positivo de uma palavra; `circle` Círculo — aponta o termo central; `strike` Risco — o que está errado ou ficou para trás; `crossed` Rabisco — negação forte, “esqueça isso”
- **Campos da IA:** `text` frase da fala, 2–8 palavras; `emphasis` palavra(s) DA FRASE que recebem a marcação; `variant` marker|circle|strike|crossed; `position` top|center
- **Checagem de fatos:** ≥ 50% das palavras de conteúdo vêm da fala/briefing
- **Estilos em que combina:** Equilibrado, Dinâmico, Educativo

### Chamada premium — `statement` (v1, Tipografia)

Chamada sóbria com hierarquia: tese, promessa ou CTA final.

- **Quando usar:** CTA no final (variant cta); promessa central em tom premium; conclusão
- **Quando NÃO usar:** frase longa; promessa que não foi dita; tom muito descontraído
- **Duração:** 1.6–4.5 s (padrão 2.6 s) · intensidade 1/3 · camada `text`
- **Variantes:** `center` Centralizada — tese/promessa no centro; `left` À esquerda — editorial, com fio de destaque; `cta` CTA — chamada para ação com botão (final do vídeo)
- **Campos da IA:** `text` até 8 palavras (CTA: o que fazer); `eyebrow` até 3 palavras acima (opcional); `variant` center|left|cta
- **Checagem de fatos:** pelo menos uma palavra da fala/briefing
- **Estilos em que combina:** Premium, Equilibrado, Minimalista, Educativo

### Tela cheia — `screen` (v1, Tipografia)

Quebra o quadro do vídeo: tela cheia com fundo animado (papel, grid, pontos ou gradiente) e uma frase grande entrando palavra a palavra.

- **Quando usar:** tese, virada ou pergunta que merece parar o vídeo; abrir uma parte: “passo 1”, “o problema”, “a solução” (eyebrow); promessa ou conclusão curta que precisa de destaque total
- **Quando NÃO usar:** mais de uma a cada 15 s; nos primeiros 1,5 s quando o rosto é o gancho; frase longa (> 12 palavras); enquanto a pessoa mostra algo na câmera
- **Duração:** 1.5–5 s (padrão 2.6 s) · intensidade 3/3 · camada `fullscreen`
- **Variantes:** `paper` Papel — textura de papel animada: caderno, educativo, próximo; `grid` Grid — grid sutil em movimento: tecnologia, dados, método; `dots` Pontos — malha de pontos: leve, moderno; `gradient` Gradiente — gradiente em movimento: premium, emocional
- **Campos da IA:** `text` frase da fala, 2–10 palavras; `emphasis` palavra(s) DA FRASE em destaque; `eyebrow` rótulo curto opcional (PASSO 1, O PROBLEMA); `variant` paper|grid|dots|gradient
- **Checagem de fatos:** ≥ 50% das palavras de conteúdo vêm da fala/briefing
- **Estilos em que combina:** Equilibrado, Dinâmico, Educativo, Premium

### Ilustração — `illustration` (v1, Elementos)

Imagem gerada por IA no estilo colagem de papel (halftone, papel rasgado, marca-texto) que ilustra um ponto-chave da fala, num cartão que entra, se move de leve e sai.

- **Quando usar:** ponto-chave concreto que vira imagem: “ameaça por mensagem” → celular com mensagem; conceito abstrato com símbolo claro: justiça → martelo e balança; explicar um processo ou documento: contrato, carimbo, mapa
- **Quando NÃO usar:** mais de 3 no vídeo ou menos de 8 s de outra; nos primeiros 1,5 s quando o rosto é o gancho; assunto que exige pessoa real, marca ou texto legível; tema sensível de forma explícita (violência): use um símbolo
- **Duração:** 2–4.5 s (padrão 3 s) · intensidade 2/3 · camada `text`
- **Campos da IA:** `text` o que desenhar: objeto ou cena simbólica do ponto-chave, 3–12 palavras, sem pessoas reconhecíveis e sem texto; `label` legenda opcional, até 4 palavras DA FALA; `position` top|center
- **Checagem de fatos:** —
- **Estilos em que combina:** Equilibrado, Educativo, Premium, Dinâmico

### Número — `counter` (v2, Dados)

Número, valor, prazo ou porcentagem DITO na fala, contando até o valor.

- **Quando usar:** número concreto dito (%, R$, prazo, quantidade)
- **Quando NÃO usar:** número não aparece na fala nem no briefing; estimativa vaga
- **Duração:** 1.4–3.5 s (padrão 2.2 s) · intensidade 2/3 · camada `text`
- **Variantes:** `bold` Destaque — número grande com contorno (dinâmico); `card` Cartão — cartão com barra de progresso (premium/educativo)
- **Campos da IA:** `number` só o número dito (ex.: 70); `prefix` unidade antes do número, ex.: R$; `suffix` unidade logo depois do número: %, mil, dias, meses; `label` o que o número mede, até 4 palavras (ex.: de prazo); `variant` bold|card
- **Checagem de fatos:** o número precisa ter sido dito ou estar no briefing
- **Estilos em que combina:** Equilibrado, Dinâmico, Premium, Educativo

### Gráfico — `chart` (v1, Dados)

Gráfico animado com números DITOS: comparação, parte do todo ou evolução (Remotion Elements: Pie, Bar, Column e Line Chart).

- **Quando usar:** comparar 2–5 números ditos (bars/columns); porcentagem ou parte do todo (pie); evolução no tempo: antes → depois, meses, anos (line)
- **Quando NÃO usar:** algum número não foi dito; um número só sem comparação (use counter); explicação sem dados
- **Duração:** 2.8–6 s (padrão 4 s) · intensidade 2/3 · camada `text`
- **Variantes:** `bars` Barras — comparação entre itens; `columns` Colunas — comparação lado a lado, poucos itens; `pie` Pizza — porcentagem / parte do todo; `line` Linha — evolução ao longo do tempo
- **Campos da IA:** `variant` bars|columns|pie|line; `items` 2–6 itens “rótulo: número” separados por | (números DITOS); `title` o que o gráfico mostra, até 5 palavras; `suffix` unidade: %, mil, dias…
- **Checagem de fatos:** o número precisa ter sido dito ou estar no briefing
- **Estilos em que combina:** Educativo, Equilibrado, Premium, Dinâmico

### Lista de benefícios — `list` (v1, Dados)

2 a 5 benefícios, passos ou itens DITOS, entrando um a um.

- **Quando usar:** enumeração de benefícios; passo a passo; o que está incluso
- **Quando NÃO usar:** itens que não foram ditos; menos de 2 itens; itens longos
- **Duração:** 2.5–6 s (padrão 4 s) · intensidade 2/3 · camada `text`
- **Variantes:** `check` Checks — benefícios/inclusos; `number` Numerada — passos em ordem
- **Campos da IA:** `items` 2–5 itens separados por | (até 4 palavras cada); `title` título curto (opcional); `variant` check|number
- **Checagem de fatos:** ≥ 50% das palavras de conteúdo vêm da fala/briefing
- **Estilos em que combina:** Educativo, Equilibrado, Premium, Dinâmico

### Nome/cargo — `lowerThird` (v2, Sobreposições)

Identifica quem fala: nome e profissão exatamente como ditos.

- **Quando usar:** falante se apresenta (nome e/ou profissão)
- **Quando NÃO usar:** nome não foi dito; mais de uma vez no vídeo
- **Duração:** 2–5 s (padrão 3.5 s) · intensidade 1/3 · camada `text`
- **Variantes:** `bar` Barra — cartão escuro com barra de cor (padrão); `minimal` Minimalista — texto com fio fino, sem caixa (premium)
- **Campos da IA:** `title` nome como dito; `subtitle` profissão como dita; `variant` bar|minimal
- **Checagem de fatos:** ≥ 50% das palavras de conteúdo vêm da fala/briefing
- **Estilos em que combina:** Equilibrado, Dinâmico, Premium, Minimalista, Educativo

### Mensagem — `bubble` (v1, Sobreposições)

Balão de mensagem para uma pergunta, objeção ou depoimento CITADO na fala.

- **Quando usar:** falante cita uma pergunta de cliente; objeção comum; depoimento dito
- **Quando NÃO usar:** mensagem inventada; texto que não foi dito; simular app real
- **Duração:** 1.8–5 s (padrão 3 s) · intensidade 1/3 · camada `text`
- **Variantes:** `left` Recebida — pergunta/objeção de outra pessoa; `right` Enviada — resposta do falante
- **Campos da IA:** `text` a mensagem citada (até 15 palavras); `sender` quem disse (opcional); `side` left|right
- **Checagem de fatos:** ≥ 50% das palavras de conteúdo vêm da fala/briefing
- **Estilos em que combina:** Equilibrado, Dinâmico, Educativo

### Selo chamativo — `callout` (v1, Elementos)

Balão com bico que balança para chamar o olho: oferta, desconto, novidade (Remotion Elements: Wiggling Callout).

- **Quando usar:** oferta ou desconto dito (“-20%”, “grátis”); novidade ou destaque curtíssimo; apontar para o produto
- **Quando NÃO usar:** texto longo (> 2 palavras); oferta que não foi dita; tom premium
- **Duração:** 1.2–3.5 s (padrão 2 s) · intensidade 3/3 · camada `text`
- **Variantes:** `down` Bico ↓ — aponta para baixo (produto, legenda, link); `up` Bico ↑ — aponta para cima; `left` Bico ← — aponta para a esquerda; `right` Bico → — aponta para a direita
- **Campos da IA:** `text` 1–2 palavras ou o desconto dito (ex.: -20%); `direction` down|up|left|right; `position` top|center
- **Checagem de fatos:** pelo menos uma palavra da fala/briefing
- **Estilos em que combina:** Dinâmico, Equilibrado

### Zoom de câmera — `zoom` (v2, Câmera)

Movimento de câmera no vídeo: punch é um impulso curto de ênfase; smooth aproxima devagar.

- **Quando usar:** frase de impacto (punch); explicação ou momento emocional (smooth); reforço de um combo
- **Quando NÃO usar:** zooms seguidos; trecho já cheio de texto animado; falante muito perto da câmera
- **Duração:** 0.6–5 s (padrão 1.2 s) · intensidade 2/3 · camada `camera`
- **Variantes:** `punch` Punch — ênfase seca de 1–1,5 s; `smooth` Suave — aproximação lenta de 3–5 s, cinematográfica
- **Campos da IA:** `style` punch|smooth; `scale` 1.05–1.25 (punch até 1.25, smooth até 1.12)
- **Checagem de fatos:** —
- **Estilos em que combina:** Equilibrado, Dinâmico, Premium, Minimalista, Educativo

### Seta — `arrow` (v1, Elementos)

Seta desenhada apontando para algo: link na bio, botão, produto, abaixo.

- **Quando usar:** “clica no link”, “aqui embaixo”; apontar produto na tela; reforço do CTA
- **Quando NÃO usar:** nada para apontar; uso repetido
- **Duração:** 1–3.5 s (padrão 2 s) · intensidade 1/3 · camada `element`
- **Variantes:** `curve` Curva — traço orgânico; `straight` Reta — seta seca e direta
- **Campos da IA:** `direction` down|up|left|right; `label` até 3 palavras (opcional); `variant` curve|straight
- **Checagem de fatos:** pelo menos uma palavra da fala/briefing
- **Estilos em que combina:** Equilibrado, Dinâmico, Educativo, Minimalista

### Emoji — `emoji` (v1, Elementos)

Emoji animado para emoção ou objeto concreto citado.

- **Quando usar:** emoção clara; objeto concreto (💰 dinheiro, ⏰ prazo)
- **Quando NÃO usar:** briefing pede sem emoji; tom premium, sério ou institucional; uso frequente
- **Duração:** 0.8–2.5 s (padrão 1.4 s) · intensidade 2/3 · camada `element`
- **Campos da IA:** `emoji` 1 emoji; `position` side|top|center
- **Checagem de fatos:** —
- **Estilos em que combina:** Dinâmico, Equilibrado

### Linhas de velocidade — `speedLines` (v1, Elementos)

Linhas radiais de energia por um instante: impacto, surpresa, virada (Remotion Elements: Speed Lines).

- **Quando usar:** revelação ou surpresa (“de repente”, “e aí…”); punchline com energia; junto de um punch de câmera
- **Quando NÃO usar:** tom premium, minimalista ou educativo; mais de 1 a cada 12 s; cobrir um texto importante
- **Duração:** 0.4–1.5 s (padrão 0.8 s) · intensidade 3/3 · camada `fullscreen`
- **Variantes:** `subtle` Sutil — linhas mais transparentes; `normal` Normal — impacto pleno
- **Campos da IA:** `intensity` subtle|normal
- **Checagem de fatos:** —
- **Estilos em que combina:** Dinâmico

### Transição — `transition` (v1, Elementos)

Transição rápida (até 1,3 s) com vídeo da biblioteca e som, num corte: luz, queima de filme, glitch, varrida de luz ou papel.

- **Quando usar:** virada de assunto ou começo de outra parte do roteiro (cai no corte mais perto); antes do CTA ou de uma revelação; entre clipes diferentes
- **Quando NÃO usar:** mais de 3 no vídeo ou menos de 10 s de outra transição; nos primeiros ou últimos 1,5 s; no meio de uma frase sem corte por perto; vídeo calmo ou minimalista
- **Duração:** 0.5–1.3 s (padrão 1 s) · intensidade 2/3 · camada `fullscreen`
- **Variantes:** `flare` Luz — luz quente rápida: leve e positiva, combina com quase tudo; `burn` Queima de filme — analógico, nostálgico: virada na história; `glitch` Glitch — digital: tecnologia ou quebra de expectativa (“mas espera…”); `swipe` Varrida de luz — energia: passar para a próxima parte ou para o CTA; `paper` Papel — didático, caderno: combina com a tela cheia de papel
- **Campos da IA:** `variant` flare|burn|glitch|swipe|paper
- **Checagem de fatos:** —
- **Estilos em que combina:** Dinâmico, Equilibrado, Educativo, Premium

### Flash — `flash` (v2, Elementos)

Clarão curto de virada de assunto ou punchline. Raro.

- **Quando usar:** virada forte de assunto; punchline
- **Quando NÃO usar:** briefing pede sem flash; tom premium ou minimalista; mais de 1 a cada 15 s; junto de outro efeito forte
- **Duração:** 0.15–0.5 s (padrão 0.3 s) · intensidade 3/3 · camada `fullscreen`
- **Variantes:** `subtle` Sutil — pico de 45%; `normal` Normal — pico de 85%
- **Campos da IA:** `intensity` subtle|normal
- **Checagem de fatos:** —
- **Estilos em que combina:** Dinâmico

