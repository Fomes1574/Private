# ADR 0014: parte do servidor na chave do aparelho e banco local sem metadado

Estado: aceito · Base: V7-014 (celular apreendido é a ameaça nº 2), V7-019,
V6-012 (abrir exige autorização online), ADR 0005, ADR 0010, ADR 0012.

## Problema
Antes, KEK = HKDF(PRF ‖ Argon2id(PIN)). O limite de 5 erros era contado pelo
próprio app. Quem copiasse o armazenamento do celular (perícia: FFS,
extração física, backup) podia testar PINs fora do app, sem limite. Além
disso, o banco local guardava em claro o id da mensagem, o id da conversa e
as datas.

## Decisão
1. **KEK = HKDF(PRF ‖ Argon2id(PIN) ‖ S)**, em que S (32 bytes aleatórios) mora
   no servidor (Circle DO, tabela `vaults`). O app manda um **verificador**
   = HKDF(PRF ‖ Argon2id(PIN), "mp/unlock/verifier"); o servidor guarda só o
   SHA-256 dele e devolve S se bater.
   - Erro: o servidor conta. Na 5ª tentativa errada seguida, apaga S (e
     derruba a sessão do aparelho).
   - **PIN de coação**: segundo verificador; se usado, apaga S e responde
     igual a "apagado" (sem pista). O app se apaga e abre como novo.
   - **Homem morto**: S some se o aparelho ficar `dead_days` sem abrir
     (1, 3, 7, 15 padrão, 30 ou desligado). Conferido em cada pedido e no cron.
   - **Código de emergência**: 24 caracteres, gerado no aparelho; o
     servidor guarda só o SHA-256. Usado de qualquer navegador, apaga todo S
     da pessoa.
   - Um cofre por aparelho; registrar exige sessão; a liberação é aberta (o
     app ainda está trancado), limitada pelo próprio contador.
2. **Banco local sem metadado**: chaves do `kv` e ids de mensagem/conversa
   viram HMAC-SHA256 com uma chave de índice (aleatória, guardada cifrada
   pela DEK e trocada a cada rotação); datas ficam dentro da cifra; cada
   registro é preenchido até múltiplos de 256 bytes; `temp_store = MEMORY`.
   A expiração é conferida abrindo os registros (volume pequeno).
3. **Release sem console** (no Android o console do WebView pode ir para o
   logcat). Avisos de segurança sem id nem remetente.
4. **Trancar na hora** ao sair do app é o padrão (1 ou 5 minutos por escolha).

## Consequências
- Abrir o app exige internet (já previsto em V6-012).
- Para quebrar o PIN fora do servidor é preciso, ao mesmo tempo: cópia do
  aparelho, a passkey (PRF) e o banco do servidor (`verifier_hash`).
- Limite conhecido: o SQLite do Durable Object tem recuperação de 30 dias;
  quem controla a conta Cloudflare poderia restaurar um S apagado. Ainda
  faltariam PIN e passkey.
- Atualização sem perda: um cofre v1 abre pelo caminho antigo e, já com a
  sessão aberta, é reembrulhado como v2 (mesma DEK; registra a parte do
  servidor). Se o registro falhar, continua v1 e tenta de novo no próximo
  desbloqueio. O banco no esquema 1 é convertido para o esquema 2 numa
  transação e o arquivo é refeito pela rotação logo em seguida. Nada é
  apagado no caminho (teste: `app/test/migration.test.mjs`, que instala com
  o código antigo e atualiza na mesma origem).
