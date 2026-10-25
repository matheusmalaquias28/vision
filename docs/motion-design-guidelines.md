# Diretrizes de motion design do Vision

Regras que os componentes (`packages/video/src/Motions.tsx`), o validador de
composição (`validateComposition`) e o prompt do planner seguem. Valem para
humanos e para a IA.

## 1. Narrativa antes de efeito

- Todo motion responde a uma intenção da fala: gancho, dor, benefício, número,
  prova, CTA. Trecho neutro fica **sem motion** — isso é uma escolha válida.
- Textos e números vêm da fala ou do briefing do War. O compilador recusa
  número que não foi dito e texto sem relação com a fala.
- Receitas (combos) existem para momentos-chave: um gancho, uma revelação de
  número, uma pilha de benefícios, um CTA. Não repita receita sem motivo.

## 2. Ritmo e densidade

| Estilo | 1 motion a cada | Máx. começando em 10 s | Mesmo tipo de novo após |
|---|---|---|---|
| Equilibrado | 5 s | 2 | 6 s |
| Dinâmico | 3,5 s | 3 | 4 s |
| Premium | 6,5 s | 2 | 8 s |
| Minimalista | 10 s | 1 | 12 s |
| Educativo | 5 s | 2 | 6 s |

Um combo conta como um motion. O briefing explícito vale sobre o estilo; o
estilo vale sobre o padrão global.

## 3. Camadas: uma coisa de cada vez

- **Texto** (palavra-chave, frase cinética, chamada, número, lista, nome,
  mensagem): nunca dois ao mesmo tempo.
- **Câmera** (zoom): um único compositor — escala e foco do zoom dominante num
  só `transform` do vídeo. Nada de zoom por cima de zoom.
- **Elemento** (seta, emoji) e **tela cheia** (flash): também um por vez.
- Peças do mesmo combo podem dividir o tempo (texto + câmera + seta).

## 4. Área segura em 9:16 (1080×1920)

- Legenda (terço inferior) ocupa ~78–90% da altura: motions não descem disso.
- Topo (8–14%): palavra-chave "topo", chamadas premium, número, nome/cargo.
- Centro/peito (~50–62%): CTA e seta, abaixo do rosto e acima da legenda.
- Não há detecção de rosto: os padrões assumem pessoa falando com o rosto em
  ~20–45% da altura. Quando o enquadramento for outro, o editor arrasta o
  elemento no preview (posição livre em % da largura/ALTURA).
- Posições sempre por `top` em % da altura — nunca `padding-top` em %.

## 5. Tipografia

- Fonte principal = a da legenda do projeto (peso 900 nos destaques, 800 nas
  chamadas). Fonte de apoio = Inter (rótulos, cargo, linha de cima).
- Quebra balanceada (`text-wrap: balance`): nada de palavra órfã na 2ª linha.
- Tamanho encolhe com o comprimento do texto (frase cinética, chamada, pílula).
- Texto claro sobre vídeo: sombra suave; contorno grosso só no estilo
  dinâmico/legenda.
- Testado com acentos (ç, ã, é), palavras longas, números pt-BR (1.500; 2,5).

## 6. Movimento

- Cada família tem seu ritmo: springs com amortecimento diferente para selo,
  palavras e balão; `bezier(0.16, 1, 0.3, 1)` (saída exponencial) para
  revelações premium; desenho de traço para setas e checks.
- Entrada, permanência e saída sempre definidas (saída de 6–10 frames).
- Tudo é função do frame (`useCurrentFrame`, `interpolate`, `spring`): sem
  relógio, `setTimeout` ou aleatório não semeado. O frame N é igual no Player e
  no MP4, em qualquer ordem de seek.
- Movimento contínuo (seta que vai e volta, pulso do CTA) é discreto e periódico.

## 7. Segurança visual

- Flash: raro, só no dinâmico/equilibrado, espaçado (12–20 s), nunca no
  premium/minimalista/educativo e nunca quando o briefing proíbe. Variante
  "sutil" para quem quer discrição.
- Sem strobe, sem tremida forte. Zoom punch até 25%, smooth até 12%.

## 8. Anti-padrões

- Palavra-chave genérica ("isso", "então") — recusada pelo compilador.
- Número sem contexto ou inventado — recusado.
- Emoji em peça premium/institucional — fora do catálogo nesses estilos.
- Empilhar flash + zoom + emoji + destaque no mesmo instante.
- Mensagem/depoimento que não foi dito (balão simulando app real).
- CTA no meio do vídeo.
