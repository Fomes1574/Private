# ADR 0002 · vodozemac (Olm) com fan-out, wrapper próprio em WASM

**Estado:** Aceito como direção (V7-002). Prova 1 aprovada em navegador de
desktop; falta iPhone, Android e revisão independente.

## Contexto
É proibido criar protocolo próprio (§7). A biblioteca precisa ser compatível
com código fechado (Apache-2.0, não AGPL), rodar em WASM e ter auditoria.

## Decisão
- `vodozemac` (Apache-2.0, auditada pela Least Authority em 2022) com
  **Olm 1:1 (Double Ratchet) e fan-out por destinatário**, inclusive em grupos.
- **Sem Megolm.** Cada mensagem de grupo é cifrada uma vez por destinatário;
  mídia é cifrada uma vez com chave aleatória (CEK) e só a CEK vai por fan-out.
- Wrapper Rust próprio e mínimo (`poc/01-vodozemac-wasm/crate`), em vez do
  `matrix-sdk-crypto-wasm`, que traz o cliente Matrix inteiro.
- Versões travadas (`=0.11.1`), `Cargo.lock` no repositório, `cargo audit` no CI.
- `SessionConfig::version_1` até a versão 2 deixar de ser experimental.

## Alternativas
- libsignal: tem pós-quântico (PQXDH/SPQR), mas é AGPL. Só com parecer jurídico.
- MLS: exagero para 10 pessoas e exige ordenação de commits no servidor.

## Consequências
- **Sem proteção pós-quântica.** Risco "colher agora, decifrar depois" fica
  registrado como aceito até haver migração (ver ADR 0003, campo de versão).
- Fan-out custa ~2 ms por mensagem para 9 destinatários (medido em desktop).
- CVE-2024-34063 (zeroização perdida em 0.5.x) não afeta 0.11.1, mas mostra que
  zeroização depende das dependências: rever a cada atualização.

## Testes
`poc/01-vodozemac-wasm/test`: troca, persistência, chave errada, fora de ordem,
replay, adulteração, versão desconhecida, chave de uso único reutilizada.
