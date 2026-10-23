# ADR 0007 · Base web única: PWA no iPhone, Capacitor no Android

**Estado:** Aceito como direção (V6-004, V7-020, D-068). Prova de APK pendente.

## Decisão
Um só código TypeScript e a mesma cripto em WASM:
- iPhone: PWA instalada na Tela de Início.
- Android: o mesmo app empacotado com Capacitor, arquivos dentro do APK assinado,
  `FLAG_SECURE` na Activity (todas as telas), distribuição limitada do Google
  (até 20 aparelhos).

## Consequências
- No Android o código não vem do servidor a cada abertura: resolve a troca
  silenciosa de código para metade do grupo.
- A interface não revela a plataforma de ninguém (§4).
- Framework de interface ainda **não** decidido (D-074 propõe Svelte 5). Fica
  para depois das provas, porque não muda nenhuma propriedade de segurança.
