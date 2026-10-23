# Mensageiro Privado

Código fechado (V7-001). Este repositório começa pelas **provas de conceito**:
peças pequenas e descartáveis que confirmam, num iPhone e num Android de verdade,
se as partes mais arriscadas da arquitetura funcionam antes de escrever o app.

| # | Prova | Pasta | Estado |
|---|---|---|---|
| 1 | vodozemac em WASM: troca cifrada, estado salvo, fechar e reabrir | [`poc/01-vodozemac-wasm`](poc/01-vodozemac-wasm) | Funciona no Chromium; falta aparelho real |
| 2 | Face ID por passkey (PRF) + PIN liberando a chave do banco | [`poc/02-passkey-prf-pin`](poc/02-passkey-prf-pin) | Funciona no Chromium (autenticador virtual); falta iPhone |
| 3 | Banco local cifrado (SQLite/WASM) no app da Tela de Início | [`poc/03-banco-local-cifrado`](poc/03-banco-local-cifrado) | Funciona no Chromium; falta iPhone |
| 4 | Atualização com versão travada e manifesto assinado | [`poc/04-atualizacao-sw`](poc/04-atualizacao-sw) | Funciona no Chromium; falta iPhone |
| 5 | Ver uma vez com consumo atômico no Durable Object | [`poc/05-ver-uma-vez`](poc/05-ver-uma-vez) | Funciona no Worker local; falta Cloudflare e iPhone |
| 6 | Comprimir vídeo no aparelho (WebCodecs) | [`poc/06-video-safari`](poc/06-video-safari) | Fluxo ok no Chromium (VP9); H.264 só no iPhone/Android |

Cada pasta tem um `RELATORIO.md` com o que funcionou e o que não funcionou.

## Onde está cada coisa

- [`docs/especificacao/`](docs/especificacao/) especificação normativa v7 (fonte da verdade).
- [`docs/adr/`](docs/adr/) decisões de arquitetura registradas.
- [`docs/ACOES_DO_PROPRIETARIO.md`](docs/ACOES_DO_PROPRIETARIO.md) o que só o dono pode fazer (contas, aparelhos, decisões com custo).
- [`docs/PENDENCIAS.md`](docs/PENDENCIAS.md) estado de cada pendência P-xx.
- [`SECURITY.md`](SECURITY.md) regras de segurança e o que o projeto não promete.

## Regras do repositório

- Nada de chaves, tokens ou senhas no código, nem em arquivos de exemplo.
  Ative o hook local uma vez: `git config core.hooksPath .githooks`.
- Dependências com versão travada (`=x.y.z` no Cargo, `Cargo.lock` no repositório).
- Provas são descartáveis: o app de verdade não importa código daqui sem revisão.
