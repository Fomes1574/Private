# Servidor (API)

Worker da Cloudflare na Arquitetura A ([ADR 0004](../docs/adr/0004-arquitetura-cloudflare-a.md)).
Regras de negócio vêm de [`packages/protocol`](../packages/protocol).

| Peça | Onde | O que guarda |
|---|---|---|
| `Circle` (DO único) | `src/circle.js` | identidades (máx. 10), convites (só hash), aparelho único, sessões (só hash), chaves de uso único, pareamento por QR, recuperação, eventos de segurança, inscrições de push |
| `Room` (DO por conversa) | `src/room.js` | membros, líder, política; carimba prazo e grava o fan-out no D1 |
| `MediaBox` (DO por mídia) | `src/media.js` | pedaços cifrados (ou R2), direitos por destinatário, alarme do prazo |
| `DocQuota` (DO por pessoa) | `src/docs.js` | os 3 documentos ativos; o 4º revoga o mais antigo |
| `Live` (DO por pessoa) | `src/live.js` | WebSocket "sincronize" e push sem conteúdo |
| D1 | `migrations/` | envelopes cifrados, metadados mínimos, tombstones, quem está em qual conversa |

## Rotas

Públicas: `GET /v1/time`, `POST /v1/bootstrap`, `POST /v1/invites/redeem`,
`POST /v1/auth/challenge`, `POST /v1/auth/session`, `POST /v1/devices/pair/start`,
`POST /v1/devices/pair/status`, `GET /v1/push/key`.

Com sessão: diretório e chaves (`/v1/directory`, `/v1/keys`, `/v1/keys/claim`),
convites, pareamento, guardião e recuperação, congelar/remover (administradora),
eventos de segurança, push, conversas (`/v1/rooms…`), mensagens, apagar para
todos, `/v1/sync` e `/v1/ack`, mídia (`/v1/rooms/:id/media`, `/v1/media/:id/open`,
`/v1/media/:id/revoke`), documentos (`/v1/docs/publish`) e `/v1/live` (WebSocket,
token no subprotocolo).

Toda resposta traz `x-mp-time` (horário do servidor para o relógio confiável)
e `cache-control: no-store`. Erros têm código fixo e não ecoam a entrada.

## Autenticação
Cada aparelho tem uma chave ECDSA P-256 **não extraível**. Sessão = assinar
`mp-auth-v1:{nonce}:{deviceId}` de um desafio de uso único (2 min). Token de
sessão de 12 h, guardado só como hash.

## Rodar e testar
```sh
npm ci
npm test          # sobe workerd + D1 + DOs locais e testa a API inteira
npm run check     # wrangler deploy --dry-run
```

## O que ainda não está aqui (de propósito)
- **Gate online criptográfico (V7-011):** bloqueado até revisão independente
  ([ADR 0009](../docs/adr/0009-gate-online-criptografico.md)).
- **Assinatura dos eventos de política pelo aparelho:** o servidor valida pela
  sessão; a verificação ponta a ponta das assinaturas é do cliente.
- **Stories (P-09)** e **denúncia (P-16)**: dependem de decisões pendentes.
