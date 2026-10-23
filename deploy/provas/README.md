# Deploy das provas

Um Worker (`mp-provas`) serve as seis provas em `/poc1/` … `/poc6/` e a API da
Prova 5 em `/v1/`. Publicação só pelo CI (`.github/workflows/deploy-provas.yml`),
disparada à mão. Passo a passo da conta: `docs/CLOUDFLARE_PASSO_A_PASSO.md`.

- `build.mjs` monta `dist/` e o `_headers` com a CSP de cada prova (Trusted
  Types ligado, COOP/COEP, HSTS, sem referrer).
- `npm run check` faz um `wrangler deploy --dry-run`.
- Local: `npm run dev` e depois `E2E_BASE=http://localhost:8790` nos testes
  de `e2e/` (passkey não aceita IP; use `localhost`).
