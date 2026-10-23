# ADR 0006 · Cadeia de atualização da PWA

**Estado:** Aceito como direção (V7-017). Depende da Prova 4.

## Decisão
1. Service worker serve só arquivos da versão **fixada** no aparelho. Versão
   nova é baixada inteira, conferida e fica em espera.
2. A troca só acontece com aceite na tela "Atualização disponível", mostrando o
   **código curto** da versão (primeiros 8 caracteres do hash do manifesto).
3. Manifesto de release lista todos os arquivos com SHA-256 e é **assinado**
   (Ed25519) por chave que fica fora da Cloudflare. A chave pública vai dentro
   do próprio app; trocar a chave exige versão assinada pela chave antiga.
4. **Anti-downgrade:** número de versão monotônico; o SW recusa manifesto com
   número menor ou igual ao instalado.
5. Hash de cada versão publicado no GitHub (fora da Cloudflare) e visível em
   Ajustes > Segurança.
6. Deploy só pelo CI, com token curto (OIDC quando possível) e menor privilégio.
7. Headers: CSP sem inline, `script-src 'self' 'wasm-unsafe-eval'`,
   `require-trusted-types-for 'script'`, `object-src 'none'`, `base-uri 'none'`,
   `frame-ancestors 'none'`, `connect-src` só para a API; COOP `same-origin`,
   COEP `require-corp`, `nosniff`, `Referrer-Policy: no-referrer`, HSTS.
8. Sem `skipWaiting()` automático durante sessão ativa (§50.2).

## Limite honesto
Quem controla a origem pode trocar o próprio service worker. Isso é mitigação,
não garantia (§50.3). No Android o código vai assinado dentro do APK (ADR 0007).
