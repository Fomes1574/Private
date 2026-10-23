# Prova 2 · Face ID (passkey PRF) + PIN

O cofre guarda a chave do banco (DEK) embrulhada. Para abrir, precisa do
segredo PRF que o aparelho só devolve depois do Face ID **e** do PIN, esticado
com Argon2id. Desenho completo no [ADR 0005](../../docs/adr/0005-desbloqueio-passkey-prf-pin.md).

- `crate/` Argon2id (RustCrypto `argon2 =0.6.0`) compilado para WASM.
- `web/vault.js` criação e abertura do cofre (WebCrypto: HKDF, AES-GCM).
- `web/passkey.js` WebAuthn com extensão PRF.
- `test/` testes do cofre em Node; `../../e2e/poc2.test.mjs` testa a página com
  autenticador virtual com PRF no Chromium.

```sh
./build.sh      # recompila o WASM
npm test        # testes do cofre
node ../../scripts/serve.mjs   # http://localhost:8080/poc2/
```

Passkey exige HTTPS e um endereço próprio: a cópia dentro do Claude não serve
para esta prova. Ela precisa do deploy na Cloudflare.
