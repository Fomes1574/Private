# Prova 4 · Atualização com versão travada

O service worker serve só a versão fixada no aparelho. Uma versão nova é
baixada inteira, conferida (assinatura Ed25519 do manifesto e SHA-256 de cada
arquivo), fica em espera e só entra quando a pessoa aceita vendo o **código
curto** da versão. Downgrade e repetição são recusados. Desenho no
[ADR 0006](../../docs/adr/0006-cadeia-de-atualizacao-pwa.md).

- `src/sw.js` o service worker (a chave pública entra no build).
- `src/app/` o app de teste, que vira v1 e v2.
- `build.mjs` gera `web/` com as releases assinadas e os canais de teste.
  A chave privada é efêmera: criada, usada e descartada no build.
- [`RELEASES.md`](RELEASES.md) os códigos publicados fora da Cloudflare.

```sh
npm run build   # gera web/ (nova chave a cada build)
npm test        # confere assinaturas e hashes publicados
```
