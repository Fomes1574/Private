# Pacto Talk — entregas A2, B, C e D (e revisão da A1)

Data: 25/10/2026. Base: A1 do GPT (`c95fd00`, branch `codex/pacto-talk-a1-2026-10-25`), incorporada ao branch `ccr-de59a90b-gr4vug`.
Decisões: `PLANO_REVISAO_2026-10-25.md` e ADR 0016.

Estado: **implementado e testado automaticamente**. **Nada foi testado em celular de verdade.** Falta CI no GitHub, deploy da API (migração 0003) e um APK novo. Legenda dos estados: implementado / teste automático / celular de verdade.

## Revisão da A1 (feita pelo GPT)

Código conferido: escopo sensível por tela e sessão, microfone, visualizadores, seletor nativo com token, fila do banco, conversa individual única. Está consistente com o plano. Suítes rodadas aqui: protocolo, cliente, servidor e interface, todas aprovadas. Um teste do cliente falhava só neste ambiente: o Node reaproveitava uma conexão que o servidor local já tinha fechado. O teste passou a repetir uma vez esse caso, só para GET. Nenhuma regra foi relaxada.

## O que foi feito

| Item | O que mudou | Teste automático |
|---|---|---|
| S1/S8 | Avisos guardados cifrados e mostrados na conversa; número de segurança da dupla; QR (leitura onde houver leitor de QR); "verificado"; mídia pausada se a chave de um verificado mudar | `client/test/a2.test.mjs`, `app/test/app.test.mjs` |
| S3 | Administradora confirma quem está no círculo; não confirmado não recebe apelido, foto nem stories; aviso para a administradora na lista | `client/test/a2.test.mjs` |
| S5 | Teclado anônimo no Android (`IncognitoWebView`) | Compila só no CI (sem SDK Android aqui) |
| S7 | Mídia em degraus de tamanho (formato 2) | `client/test/media-crypto.test.mjs`, `client/test/c.test.mjs` |
| S12 | Parte S do cofre cifrada por chave no R2, apagada junto | `server/test/a2.test.mjs` |
| S13 | Alarme de vencimento apaga a mídia do R2 (provado com gancho só local) | `server/test/a2.test.mjs` |
| F04 | Apagar para todos revoga a mídia no servidor, antes de apagar | `server/test/a2.test.mjs`, `client/test/e2e.test.mjs` |
| F05 | Desfazer vínculo/encerrar revoga ver uma vez pendente | `server/test/a2.test.mjs` |
| F07 | Visualizador fecha quando a mensagem vence ou some | Indireto (`app.test.mjs`) |
| F09, D7 | Edição só da mesma conversa, só nos primeiros 15 min; reação/voto/fixar só de membro | `client/test/a2.test.mjs` |
| F10, F11 | Fila de envio sem duplicar; mídia órfã revogada | `client/test/c.test.mjs` |
| F15 | PDF desenha só as páginas perto da tela (até 6 em memória) | `app.test.mjs` (PDF) |
| F16 | Cota de documentos no próprio envio | `server/test/a2.test.mjs` |
| F18, N2, N3, F03 | Estado da conversa atualizado; removidos fora da busca; recuperação cancelada recomeça limpa; nome/foto não voltam após excluir | Parcial (`app.test.mjs`) |
| D1 | Busca por trecho em pessoas, grupos e mensagens | `protocol/test/search.test.mjs`, `app.test.mjs` |
| D2, D9, D10 | Prévia (desligável), contador, fixar até 3, marcar como não lida | `app.test.mjs` |
| D3 | Limpar × excluir só neste aparelho; grupo só depois de sair | `app.test.mjs` (limpar) |
| D4 | Lote de até 5 fotos com edição, ver uma vez e legenda por foto; seletor do Android com várias | Sem teste de interface do lote (câmera simulada só no teste de câmera) |
| D6, D8 | Ver uma vez por toque (A1) + aviso do iPhone | `app.test.mjs` |
| b.1–b.10 | Segurar a mensagem (reações + menu), deslizar para responder, selecionar várias, separadores e faixa de não lidas, ✓, formatação, @menção, áudio com cadeado/pausa/onda/ouvir | `app.test.mjs` (segurar, reação, formatação, não lidas) |
| b.7, b.11–b.17 | Áudio de ver uma vez, fixar mensagem, favoritas, mídia da conversa, busca geral, responder em particular, descrição do grupo, papel de parede local | `client/test/c.test.mjs` (núcleo); interface sem teste dedicado |
| D (b.18–b.21) | Enquete, vídeo redondo, anotações só no aparelho, foto HD | `client/test/c.test.mjs`, `app.test.mjs` (enquete e anotações) |

## Resultados dos testes automáticos (25/10/2026, neste ambiente)

| Suíte | Resultado |
|---|---|
| Protocolo | 36 passaram |
| Criptografia | 5 passaram |
| Cliente (com servidor local real) | 32 passaram |
| Servidor, mídia no R2 | 53 passaram |
| Servidor, mídia no Durable Object | 52 passaram (o teste S13 confere o R2 só no modo R2) |
| Interface (Chromium, todos os arquivos) | 53 passaram |

Numa das rodadas completas da interface, o teste da câmera falhou uma vez: o vídeo gravado pela câmera simulada saiu sem trilha de vídeo, com a máquina sobrecarregada. Ele passou isolado duas vezes e nas duas rodadas completas seguintes. Fica registrado, sem ser descartado: se aparecer no CI, deve ser investigado.

Android: o ambiente não tem SDK. O build do APK, com `IncognitoWebView` e o seletor de várias fotos, só será conferido no CI.

## Compatibilidade

Versões antigas do app **não abrem** mídia em degraus, áudio de ver uma vez, enquete, voto e fixar: a mensagem é recusada com aviso e nada vaza. Por isso, todos os membros devem atualizar juntos, seguindo a seção "Para liberar".

## Para liberar

1. CI verde no GitHub (inclui o build Android com `IncognitoWebView` e o seletor com várias fotos).
2. `deploy-api` (aplica a migração `0003_message_media.sql`).
3. Novo APK (`android-release`) e nova versão da PWA.
4. `TESTE_EM_CELULAR.md`, cenários 11 a 16, nos dois Androids e no iPhone.

## Limites honestos

- O teste S2 (vídeo decifrado no disco) continua dependendo do celular.
- A leitura de QR usa o leitor do sistema (`BarcodeDetector`). Onde não existir, como no iPhone, a verificação é comparando os números.
- A administradora é fixada na primeira vez que o aparelho vê o círculo (R-19).
- Nenhum app impede quem recebe de fotografar a tela; no iPhone, também não dá para bloquear print.
