# Prova 5 · Ver uma vez com consumo atômico

Worker + Durable Object (um por mídia). Cada destinatário tem um direito
`pending → consumed | revoked`; o primeiro pedido de abertura consome o direito
**antes** de baixar os bytes. O servidor só recebe a mídia cifrada.

- `src/index.js` Worker (rotas `/v1/...`) e o Durable Object `MediaBox`.
- `web/` página de teste com "segurar para ver" (servida pelo próprio Worker).
- `wrangler.toml` modo padrão guarda os pedaços cifrados no SQLite do DO
  (grátis, sem cartão); `--env r2` usa o R2.

```sh
npm ci
npm test                     # sobe o Worker local e testa os dois modos
npm run dev -- --var TOKEN_SECRET:<32+ caracteres> --var DEV_TOKENS:1
```

`DEV_TOKENS=1` libera uma rota que emite tokens de teste. **Só para a prova.**
