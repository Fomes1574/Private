# Correção de conectividade Android ↔ Cloudflare (outubro 2026)

## Causa

O APK Capacitor carrega a UI de `https://localhost` (seu `androidScheme` é `https`, hostname padrão `localhost`); `mp-api` inicialmente aceitava apenas `APP_ORIGIN` da PWA, causando CORS preflight sem `Access-Control-Allow-Origin` e o erro `Failed to fetch` na primeira instalação.

## Solução

- `server/src/index.js`: aceita CORS para duas origens exatas: a PWA configurada e `https://localhost`. Não usa `*` nem reflete origens arbitrárias.
- `server/test/cors.test.mjs`: testa ambas origens, preflight e respostas, e recusa origens estranhas no worker local.
- `server/scripts/check-deployed-cors.mjs`: o workflow `deploy-api` testa a API publicada, incluindo `/v1/bootstrap`, sem enviar `MP_SETUP_CODE` e sem criar conta.

## Implantação obrigatória

O erro vem do SERVIDOR. Apenas baixar um novo APK não resolve. Depois que os testes passarem, no GitHub Actions executar manualmente `deploy-api` na branch principal com confirmação `PUBLICAR-API`. O workflow publica a nova API e verifica as duas origens antes de ficar verde.

Não alterar `androidScheme`, `hostname`, `applicationId` ou origem da PWA: mudanças poderiam invalidar o armazenamento local e as chaves dos usuários.

## Segurança

CORS não é mecanismo de autenticação. Continuam obrigatórios token de sessão, assinatura do aparelho, verificação do código de primeira instalação e autorização por recurso. Não usar credenciais reais nos testes de integração. Isso corrige um defeito identificado, mas testes reais no Xiaomi continuam necessários.
