# ADR 0011 · Interface em JavaScript puro, sem framework

**Estado:** Aceito como direção provisória (não fecha a D-074).

## Contexto
A D-074 propõe Svelte 5, mas o proprietário ainda não decidiu. O app precisava
existir para juntar as provas e ser testado no aparelho.

## Decisão
Interface em módulos ES puros (`app/src`), sem framework e sem etapa de
compilação de interface. Toda construção de tela passa por `ui.js`, que só usa
`createElement` e `textContent`: nenhum HTML vindo de texto, o que casa com a
regra "mensagem nunca vira HTML" e com Trusted Types (`require-trusted-types-for`).

## Consequências
- Zero dependência de terceiros na interface; menos código para auditar.
- Mais código repetido nas telas do que com um framework.
- Trocar para Svelte depois é viável: as regras ficam em `packages/` (protocolo,
  cliente, cripto), não nas telas.

## Reversível?
Sim. Se a D-074 escolher Svelte 5, só `app/src/screens` muda.
