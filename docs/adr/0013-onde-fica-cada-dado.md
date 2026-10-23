# ADR 0013: onde fica cada dado (D1, R2, Durable Objects)

Estado: aceito · Base: §8, §9 e §24 da especificação v7 (Arquitetura A)

## Decisão
| Dado | Onde | Por quê (§8) |
|---|---|---|
| Envelopes cifrados de mensagens, metadados mínimos (autor, aceite, prazo), tombstones de "apagar para todos", quem está em qual conversa | **D1** | "D1: envelopes de texto cifrado, permissões, políticas e índices mínimos" |
| Cota interna de bytes guardados (reserva atômica antes do upload) | **D1** (`media_usage`) | §24: "reservas atômicas … negar novo upload de forma segura" |
| Fotos, vídeos, áudios, documentos (mídia temporária, prefixo `m/`) | **R2** privado, só ciphertext | "R2 privado: mídias/documentos … cifrados, retenção curta" |
| Foto de perfil, foto de grupo, fundo (prefixo `v/`) | **R2** privado, só ciphertext | "exceções persistentes de perfil/grupo" no R2 |
| Direitos de abrir (ver uma vez), prazo de cada objeto, consumo atômico | **Durable Object** `MediaBox` | "bloqueios atômicos de abrir uma vez" |
| Membros, liderança e política de cada conversa | **Durable Object** `Room` (+ espelho em `room_members` no D1) | "liderança e reconciliação de concorrência" |
| Identidades, aparelhos, convites, sessões, chaves públicas, eventos de segurança, guardião/recuperação | **Durable Object** `Circle` (SQLite do DO) | Limite de 10 pessoas, convite de uso único e troca de aparelho precisam ser **atômicos** (sem corrida); um único DO serializa isso. §9 lista essas entidades como "lógicas, não tabelas SQL aprovadas" |
| 3 documentos ativos por pessoa | **Durable Object** `DocQuota` | "reserva de quota" atômica (4º revoga o 1º) |
| WebSocket "sincronize" e push sem conteúdo | **Durable Object** `Live` | "sessão tempo real" |

## Regras que garantem que os dados morrem
- Mídia temporária no R2: apagada pelo alarme do `MediaBox` no vencimento,
  no último "ver uma vez", no "apagar para todos" e na revogação do 4º
  documento; **e** a regra de ciclo de vida do bucket apaga qualquer `m/`
  com mais de 16 dias e uploads interrompidos em 1 dia.
- D1: o filtro de prazo vale na leitura (nada vencido é entregue) e o cron
  de 15 em 15 minutos apaga o que venceu.
- Foto de perfil/grupo: só a versão atual existe; trocar apaga a anterior.

## O que NÃO é usado e por quê
- **SQLite do Durable Object como depósito de mídia** (`BLOB_BACKEND = "do"`):
  a §8 diz para não usar como depósito principal de vídeos. Fica só como
  modo de teste/alternativa; produção usa R2.
- **URL pré-assinada do R2**: proibida para "ver uma vez" (§8). Todo acesso
  passa pelo Worker, que confere o direito no `MediaBox`.
