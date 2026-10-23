# ADR 0009 · Gate online criptográfico

**Estado:** **Bloqueado** (V7-011, P-24). A especificação exige especificação
formal, análise de falhas e concorrência **e revisão criptográfica independente
antes de virar código.** Este ADR guarda o rascunho da especificação.

## Objetivo
Exigir conexão para abrir texto protegido sem que o servidor veja o conteúdo.

## Rascunho (para revisão, não implementar)
1. O remetente gera por mensagem uma chave de conteúdo `K` e cifra o texto com
   AES-256-GCM sob `K`.
2. Para cada destinatário `d`, sorteia `S_d` aleatório (32 bytes) e calcula
   `P_d = K ⊕ S_d`.
3. `P_d` vai ao destinatário **dentro do ratchet** (o servidor não vê). `S_d` vai
   ao servidor, guardado junto do envelope com `expires_at`. Sozinha, nenhuma
   das partes revela `K`.
4. Para abrir, o destinatário autentica o aparelho e pede `S_d`. O servidor
   entrega se a mensagem estiver dentro do prazo e não revogada, e **destrói**
   `S_d` no vencimento ou no "apagar para todos".
5. O cliente reconstrói `K`, decifra, exibe e descarta `K`.

## Perguntas que a revisão precisa responder
- O servidor sozinho não decifra (só tem `S_d`); o destinatário sozinho não
  decifra depois do vencimento, **se** não guardou `K`. Cliente alterado guarda
  `K` na primeira abertura: não é revogação contra cliente hostil (V7-011).
- Como autenticar o pedido de `S_d` sem criar recibo de leitura (§19)?
- Concorrência com troca de aparelho e com "apagar para todos".
- Disponibilidade: Cloudflare fora do ar = nada abre (falha fechada, aceito).

## O que existe enquanto isso
A política de cliente honesto: o app só mostra conteúdo depois de validar
online prazo, revogações e tombstones (§25.6). Isso está implementado no núcleo.
