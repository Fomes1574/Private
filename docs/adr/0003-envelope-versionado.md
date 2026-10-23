# ADR 0003 · Envelope versionado, tamanho fixo e anti-downgrade

**Estado:** Aceito (V7-003, V7-018, V7-021)

## Decisão
Todo dado cifrado que sai do aparelho tem cabeçalho com `v` (versão do formato)
e `alg` (suíte). O receptor recusa versão ou suíte que não conhece ou que foi
marcada como depreciada. Não existe negociação para baixo.

O conteúdo interno (texto, reação, resposta, edição, apagar para todos,
mudança de política) vai **dentro** do envelope autenticado, com:
`kind`, `msg_id`, `room_id`, `sender`, `sent_at_client`, `policy_rev` e o corpo.
O servidor não distingue tipos.

Antes de cifrar, o texto interno é preenchido até o próximo tamanho da
escada fixa (256 B, 1 KiB, 4 KiB, 16 KiB, 64 KiB). Isso esconde o tamanho
real do texto de quem vê o tráfego (V7-018).

`expires_at` **não** vem do remetente: o servidor carimba `accepted_at` e
calcula `expires_at` a partir da política assinada vigente (§10).

## Plano de migração pós-quântica
1. Reservar `alg` novos (ex.: `olm.v1+mlkem768`) sem mudar o resto do envelope.
2. Durante a janela de transição, aceitar as duas suítes **somente** entre pares
   que já anunciaram suporte à nova; nunca voltar à antiga depois de usar a nova.
3. Depois da janela, marcar a suíte antiga como depreciada e recusar.

## Testes
Núcleo `packages/protocol`: preenchimento, recusa de versão desconhecida,
recusa de suíte depreciada, idempotência por `msg_id`.
