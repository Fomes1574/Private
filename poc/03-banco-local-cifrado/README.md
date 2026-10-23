# Prova 3 · Banco local cifrado (SQLite WASM no OPFS)

SQLite oficial em WASM (`@sqlite.org/sqlite-wasm 3.53.4-build2`), VFS
`opfs-sahpool`, num Dedicated Worker. Cada mensagem é cifrada por registro com
AES-256-GCM; o AAD amarra id, conversa e prazo. Desenho no
[ADR 0010](../../docs/adr/0010-banco-local-cifrado.md).

- `web/db-core.js` migrações, gravação, leitura, apagar vencidas antes de ler.
- `web/db-worker.js` abre o banco no OPFS e atende a página por mensagens.
- `web/vendor/sqlite/` cópia exata do pacote oficial, com `SHA256SUMS`.

```sh
npm ci && npm run vendor   # atualizar a cópia do SQLite (confere hash)
node vendor.mjs --check    # só conferir
npm test                   # núcleo em Node (banco em memória)
```
