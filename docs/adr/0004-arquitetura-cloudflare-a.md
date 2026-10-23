# ADR 0004 · Arquitetura Cloudflare A

**Estado:** Aceito (V6-006, V6-007). Ativação do R2 **pendente do proprietário**.

## Decisão
- **Workers:** autenticação, autorização, cotas, carimbo de tempo, headers.
- **Durable Objects:** WebSocket, consumo atômico de "ver uma vez", reserva de
  cota de documentos, liderança e concorrência.
- **D1:** envelopes cifrados ainda válidos, políticas assinadas, índices opacos,
  tombstones, convites (só hash), sessões (só hash).
- **R2 privado:** mídia e documentos **só cifrados**, IDs aleatórios, sem URL
  pública; acesso sempre mediado pelo Worker.
- App e API em **origens separadas** (`app.` e `api.`), para que um bug na API
  não vire acesso ao código.

## Ponto aberto que depende do proprietário
Pesquisas de out/2026 indicam que a Cloudflare **pede forma de pagamento para
ativar o R2**, mesmo dentro da franquia grátis (10 GB-mês). O projeto não pode
cadastrar cartão sem decisão expressa (§48.1). Enquanto isso não for decidido:
- O código do R2 fica pronto e testado localmente.
- Alternativa sem cartão, se o proprietário recusar o R2: guardar a mídia cifrada
  em pedaços de até 1,9 MB no SQLite do Durable Object (5 GB grátis, falha em vez
  de cobrar). O código isola o armazenamento de blobs atrás de uma interface
  para essa troca não afetar o resto.

## Consequências
- Tempo real e regras de expiração dependem da Cloudflare; fora do ar, o app
  falha fechado (§52).
- Exclusão lógica imediata, física depois (lifecycle do R2 até 24 h, Time Travel
  do D1). A proteção real é não ter a chave no servidor (crypto-shredding).
