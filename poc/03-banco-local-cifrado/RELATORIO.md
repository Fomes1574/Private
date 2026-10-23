# Relatório · Prova 3 · Banco local cifrado

**Pergunta:** um SQLite cifrado no OPFS persiste no app da Tela de Início do
iPhone, aguenta volume, migra sem corromper e some quando a chave some?

**Resposta até agora:** sim no Chromium (automatizado). **Falta o iPhone**, e
falta deixar o app instalado parado alguns dias para ver se o iOS apaga.

## O que foi construído
- SQLite oficial em WASM, sem `eval` (cabe na CSP rígida), VFS `opfs-sahpool`
  (não precisa de COOP/COEP; uma conexão só, coerente com V7-013).
- `secure_delete = ON` e `journal_mode = DELETE`: o SQLite sobrescreve páginas
  apagadas. Não é garantia física no flash (§28.7), mas reduz sobras no arquivo.
- Cifra por registro, AAD = `mp/msg/v1/{id}/{conversa}/{prazo}`.
- Migração em transação por passo; recusa downgrade de esquema.
- Leitura sempre apaga as vencidas **antes** de devolver qualquer linha (§25.6).
- O instante "agora" vem de quem chama; o worker não usa o próprio relógio.

## Resultados automatizados

| Teste | Node | Chromium |
|---|---|---|
| Migra até v2 e recusa downgrade | ok | — |
| Migração que falha no meio desfaz e preserva dados | ok | — |
| Texto não aparece em claro no arquivo | ok | — |
| Vencidas apagadas antes de ler | ok | ok (após "fechar" e voltar 1 min depois) |
| Prazo alterado no arquivo invalida a mensagem | ok | — |
| Outra chave não lê (crypto-shredding) | ok | ok ("Destruir a chave") |
| Persistência no OPFS após fechar e reabrir | — | ok (1.000 mensagens) |
| 10 mil mensagens: gravar / ler 50 | ~1,2 s / ~18 ms | — |

## Aparelhos reais

| Ambiente | Gravar 10.000 (ms) | Persiste após fechar | Vencidas somem antes de aparecer | `persist` | Dados após 3 dias parado |
|---|---|---|---|---|---|
| iPhone · Safari (aba) | | | | | |
| iPhone · Tela de Início | | | | | |
| Android · Chrome | | | | | |

## O que o teste ensinou
- O Worker tem relógio próprio: o "agora" precisa ser passado de fora. No app
  real será o tempo confirmado pelo servidor (§10), e o banco recusa listar
  sem ele.
- O SQLite tenta ligar outros VFS de OPFS por padrão e loga erro; foram
  desligados por configuração (`sqlite-config.js`) em vez de ignorados.

## Limites
- Nesta prova a chave é uma `CryptoKey` não extraível guardada no IndexedDB.
  No app real ela vem do cofre da prova 2 e não fica no disco desembrulhada.
- Colunas `room`, `expires_at` e `accepted_at` ficam em claro no arquivo local
  (necessárias para apagar vencidas sem decifrar). São IDs aleatórios e
  instantes; não há texto nem nome.
- Alternativa avaliada e não usada: SQLite3 Multiple Ciphers (cifra o arquivo
  inteiro). Fica como opção se a cifra por registro pesar no iPhone.
