# Relatório · Prova 5 · Ver uma vez com consumo atômico

**Pergunta:** o Durable Object garante que cada destinatário abre a mídia uma
única vez, mesmo com pedidos simultâneos, que o remetente não reabre e que a
mídia some quando todos viram, quando vence ou quando o autor apaga?

**Resposta:** sim, no Worker local (workerd, o mesmo runtime da Cloudflare),
nos dois modos de armazenamento. Falta rodar na Cloudflare de verdade e testar o
"segurar para ver" no iPhone.

## O que foi construído
- Um Durable Object por mídia (SQLite). Lista de destinatários congelada no
  envio (§15.1). Prazo absoluto do servidor: `aceite + TTL`, TTL de 12 h a 15 dias.
- Consumo sem `await` entre ler e gravar o direito: o DO atende uma chamada por
  vez, então dois pedidos simultâneos não veem os dois `pending`.
- Consumo **antes** de baixar: se a conexão cair, a visualização é perdida
  (escolha conservadora de §15.3).
- Quando não sobra direito pendente, apaga tudo (`deleteAll`): direitos,
  pedaços, metadados. Alarme no prazo apaga mesmo com pendentes.
- "Apagar para todos" só pelo autor (V7-010). Membro removido perde o direito e
  não segura a limpeza (§15.7).
- **Sem rota de status**: o remetente não descobre quem viu (§15.9).
- Erros com código fixo, sem ecoar a entrada; sem logs de requisição.
- Armazenamento: pedaços de 1,9 MB no SQLite do DO (modo padrão, sem cartão) ou
  objeto no R2 (`--env r2`). Mesmo comportamento nos dois.

## Resultados automatizados (workerd local, modos DO e R2)

| Teste | DO | R2 |
|---|---|---|
| Cada destinatário abre uma vez; remetente e estranho recebem 403 | ok | ok |
| Bytes devolvidos iguais aos enviados (3 MB, 2 pedaços) | ok | ok |
| Quem ainda não viu continua podendo; último consumo apaga | ok | ok |
| 20 pedidos simultâneos do mesmo destinatário: só 1 abre | ok | ok |
| Apagar para todos: só o autor; pendentes revogados | ok | ok |
| Membro removido não segura a limpeza | ok | ok |
| Prazo vence: ninguém abre (alarme) | ok | ok |
| Prazo fora de 12 h–15 d, destinatários inválidos, token falso | recusados | recusados |

Página no Chromium: Bia vê uma vez, segunda tentativa "Já vista", Ana não
reabre, Caio vê; prazo mostrado em horário de Brasília.

## O que os testes pegaram
- O SQLite do Durable Object devolve `ArrayBuffer`; a cópia como `Uint8Array`
  gerava mídia **zerada** sem erro nenhum. Corrigido e coberto pelo teste de
  bytes iguais.
- O visualizador em tela cheia ignorava `hidden` por causa do CSS e cobria a
  página. Corrigido.
- `frame-ancestors` não vale em `<meta>`: foi para o cabeçalho (`_headers`).

## Aparelhos reais (com o deploy)

| Ambiente | Envia | Vê uma vez | Some ao soltar | Some ao abrir a Central de Controle | O que o print mostra |
|---|---|---|---|---|---|
| iPhone · Tela de Início | | | | | |
| Android · Chrome | | | | | |

## Limites
- A chave da mídia (CEK) fica, nesta prova, na memória da página. No app ela
  vai por Olm só para os destinatários (ADR 0002); e para "ver uma vez" ela não
  deveria ser entregue antes da abertura (§15.4), o que depende do gate online
  (ADR 0009, bloqueado até revisão).
- Mídia de até 25 MB lida inteira na memória do Worker. Vídeo de 5 minutos vai
  precisar de streaming por pedaços (Prova 6 mede os tamanhos).
- Tokens de teste por HMAC. O servidor real autentica o aparelho por chave.
