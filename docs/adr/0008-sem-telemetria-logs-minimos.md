# ADR 0008 · Sem telemetria e logs mínimos

**Estado:** Aceito (§1.1, V7-018)

## Decisão
- Nenhum analytics, rastreador, SDK de coleta, fonte ou CDN externos.
- Worker **não** registra IP, corpo de requisição, tokens nem IDs de mensagem.
  `observability` desligada no `wrangler.toml`; erros registrados só com código.
- Push com texto fixo `novas mensagens`, sem remetente, grupo, contagem ou tipo.
- Mensagem nunca é renderizada como HTML; só como texto.
- Nenhum segredo em `localStorage`, URL, cache do service worker ou log.

## Testes
Teste de servidor confere que respostas de erro não ecoam dados de entrada e
que nenhum `console.log` imprime corpo ou token.
