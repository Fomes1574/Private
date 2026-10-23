# Relatório · Prova 1 · vodozemac em WASM

**Pergunta:** a vodozemac compilada para WebAssembly troca mensagens cifradas,
salva o estado e sobrevive a fechar e reabrir o app num iPhone de verdade?

**Resposta até agora:** sim no Chromium de desktop (automatizado). **Falta o
iPhone e o Android**, que são o que decide a prova.

## O que foi construído

- Wrapper Rust próprio (`crate/src/lib.rs`, ~200 linhas) sobre `vodozemac 0.11.1`
  com `wasm-bindgen 0.2.129`. Expõe conta, chaves de uso único, sessão de
  saída e de entrada, cifrar, decifrar e salvar/restaurar estado cifrado.
- Envelope com versão e algoritmo desde a primeira mensagem
  (`{v: 1, alg: "olm.v1.curve25519-aes-sha2", t, body}`), recusando o que não
  reconhece (V7-003).
- Página com Alice e Bob, fila de “Bob offline”, persistência no IndexedDB
  numa transação por operação, trava de instância única (Web Locks, V7-013),
  CSP restrita (`script-src 'self' 'wasm-unsafe-eval'`), manifesto para a Tela
  de Início e diagnóstico copiável.

## Resultados

### Automatizados (Linux)

| Teste | Node 22 | Chromium 141 headless |
|---|---|---|
| Troca nos dois sentidos | ok | ok (100 mensagens) |
| Salvar e restaurar estado cifrado | ok | ok |
| Chave de estado errada não abre | ok | ok |
| Mensagens fora de ordem | ok | ok |
| Replay recusado | ok | ok |
| Texto adulterado recusado | ok | ok |
| Versão de envelope desconhecida recusada | ok | ok |
| Chave de uso único não serve duas vezes | ok | — |
| Fila offline sobrevive a fechar e reabrir | — | ok |
| Identidades iguais após reabrir | — | ok |
| Segunda aba barrada | — | ok |

Números no Chromium de desktop: WASM carrega em ~12 ms, restaurar o estado leva
~9 ms, cifrar uma mensagem de 200 bytes para 9 destinatários (fan-out) leva ~2 ms.

Tamanho: `vz_poc_bg.wasm` tem 375 KB (136 KB com gzip). Recompilar do zero na
mesma máquina dá o mesmo SHA-256
(`6de828fa04c3e0d00b65de9a483c334fd50685d789d0f2f2380a2d7512aa5631`).
O build remove os caminhos da máquina (`--remap-path-prefix`) e usa toolchain fixa (`rust-toolchain.toml`); compilar com outro `CARGO_HOME` e em outra pasta deu o mesmo hash. O CI recompila e falha se o WASM do repositório for diferente.

### Aparelhos reais

| Ambiente | Abre | Troca | Fila sobrevive a fechar | Testes | WASM ms | Fan-out ms | `persisted` |
|---|---|---|---|---|---|---|---|
| iPhone · Safari (aba) | | | | | | | |
| iPhone · Tela de Início | | | | | | | |
| Android · Chrome | | | | | | | |

Preencher com o relatório copiado da página (botão “Copiar relatório”).

Enquanto não há Cloudflare, existe uma cópia de arquivo único (WASM embutido)
publicada como artefato privado no Claude. Ela serve para o teste em aba do
Safari e do Chrome, mas **não** para a Tela de Início: o artefato roda dentro
de um quadro do claude.ai, com CSP e origem que não são as do app. O resultado
que vale para a Tela de Início só sai do endereço próprio.

## O que ficou de fora de propósito ou não funciona ainda

- **Chave do estado guardada crua no IndexedDB.** É provisória: a prova 2 troca
  por uma chave liberada pelo Face ID (passkey PRF) + PIN. Hoje, quem lê o
  IndexedDB lê a chave.
- **Tamanho das mensagens aparece** (63 bytes para textos curtos). O
  preenchimento até tamanhos fixos (V7-018) entra no formato real do envelope.
- **Cripto roda na thread principal.** Mover para um Web Worker (D-073) é passo
  seguinte; o custo medido é pequeno, então não é urgente.
- **Sem pós-quântico.** É limitação conhecida da vodozemac; o risco precisa ser
  aceito por escrito (D-054).
- **Formato de sessão v1** (`SessionConfig::version_1`, MAC truncado, igual ao
  libolm). O v2 da vodozemac ainda é experimental.
- **Memória do WASM não é zerada com garantia.** O wrapper zera a chave de
  estado após usar e o texto da primeira mensagem, mas o resto depende do
  alocador (§23.3).
- `cargo audit` e revisão das dependências transitivas ainda não foram feitos.

## Decisão que esta prova destrava

Se passar no iPhone e no Android: vodozemac + wrapper próprio vira a base
(V7-002), sem depender do `matrix-sdk-crypto-wasm`, que traz o cliente Matrix
inteiro. Se falhar no iPhone: registrar o erro exato aqui antes de tentar outra
rota.
