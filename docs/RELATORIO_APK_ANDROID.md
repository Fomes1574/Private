# Relatório: APK Android de produção (Pacto Talk), outubro 2026

Cada item tem quatro estados, sem misturar:
- **Implementado**: o código está no repositório.
- **Teste automático**: um teste do CI passa (Chromium, Node/workerd ou emulador Android).
- **Android real**: visto num celular de verdade. **Nenhum item foi testado em celular de verdade ainda.** Os testes automáticos não substituem isso.
- **Pendente**: o que falta e de quem depende.

## P1 Notificações

| Item | Implementado | Teste automático | Android real | Pendente |
|---|---|---|---|---|
| FCM nativo no APK, aviso **vazio**; o app escreve "novas mensagens" | Sim (`NovasMensagensService`, `server/src/fcm.js`) | Sim: FCM falso confere a mensagem exata, sem texto, conversa, remetente, id ou cifra (`server/test/fcm.test.mjs`) | Não | Firebase do proprietário (`FIREBASE_MINIMO.md`); cenários 3–5 de `TESTE_EM_CELULAR.md` |
| iPhone/navegador com Web Push, só para serviços de push conhecidos | Sim | Sim (servidor) | — | Teste no iPhone |
| Ambiente explícito (`android` × `web`) sem expor o dos outros | Sim (`app/src/push.js`; o tipo fica só no servidor) | Sim | Não | — |
| Botão: aguardando permissão / ativadas / recusadas / erro | Sim | Sim, com plugin simulado (`app/test/push.test.mjs`) | Não | — |
| Silenciada, app aberto, token inválido, desativar, troca de aparelho, permissão retirada, apagar tudo | Sim | Sim | Não | — |
| Firebase mínimo: sem login Google dos membros, sem Analytics, sem id de publicidade, token só ao ativar | Sim (manifesto, dependência só `firebase-messaging`) | Sim: CI confere o manifesto; a verificação do APK confere as permissões | Não | — |

## P2 Câmera, microfone e anexos

| Item | Implementado | Teste automático | Android real | Pendente |
|---|---|---|---|---|
| CAMERA, RECORD_AUDIO, MODIFY_AUDIO_SETTINGS no manifesto, pedidas só no uso | Sim | Sim: emulador confere que não vêm concedidas | Não | Cenários 6–8 |
| WebView libera câmera e microfone só para `https://localhost`; o resto é negado | Sim (`MainActivity`) | Não (o emulador do CI não tem câmera) | Não | Cenário 6 |
| Câmera do app, áudio até 1 h, compressão e cifra antes do envio | Já existia | Sim (Chromium) | Não | Cenários 6–8 (vídeo 5 min, 4K, interrupções) |

## P3 APK de distribuição

| Item | Implementado | Teste automático | Android real | Pendente |
|---|---|---|---|---|
| Chave permanente fora do repositório (página offline) | Sim (`tools/gerar-chave-android.html`) | Sim (certificado X.509 conferido) | — | Proprietário gerar a chave e cadastrar segredos |
| Assinatura v2/v3 + digital conferida + verificação (sem depuração, sem backup, sem tráfego em claro, lista fechada de permissões) | Sim (`android-release.yml`, `verificar-apk.sh`) | Sim: release de teste com chave descartável a cada push. Na execução de 23/10 o APK saiu aprovado com exatamente estas permissões: INTERNET, ACCESS_NETWORK_STATE, USE_BIOMETRIC, USE_FINGERPRINT, POST_NOTIFICATIONS, WAKE_LOCK, c2dm RECEIVE, CAMERA, RECORD_AUDIO, MODIFY_AUDIO_SETTINGS e a permissão interna do próprio pacote | — | — |
| versionCode crescente, sem downgrade | Sim | Parcial (o build recebe o número) | Não | Cenário 2 |
| FLAG_SECURE, recentes sem prévia, WebView sem depuração, backup desligado | Sim | Emulador: ver a linha seguinte | Não | Cenário 9 |
| Teste no emulador Android 14 com o APK de release | Sim (`teste-emulador.sh`) | **Ainda sem resultado**: na 1ª execução o emulador não ligou por falta de disco no runner do GitHub (não é defeito do app); corrigido no workflow e rodando de novo | — | Conferir a próxima execução do workflow `android` |
| GitHub Release com APK e SHA-256 | Sim | Não: precisa dos segredos | — | Rodar `android-release` |
| **APK assinado pronto para instalar** | Pipeline pronto | — | — | **Não existe ainda**: depende da chave do proprietário (`APK_RELEASE.md`) |
| Migração da administradora do debug sem perder a conta | Sim (pacote novo + troca durável em duas fases) | Sim: debug antigo aprova e se apaga, app novo morto antes e depois (`app/test/pairing.test.mjs`, `server/test/api.test.mjs`) | Não | Cenário 1, com o celular dela |

## P4 Funções no Android

| Item | Implementado | Teste automático | Android real | Pendente |
|---|---|---|---|---|
| Composer, menus, mídia, editor, ver uma vez, prazos 12 h–15 d (Brasília), apagar, 3 documentos/20 MB, fotos e fundo, convites, liderança, desbloqueio, privacidade ao minimizar | Já existiam | Sim (Chromium, 27 testes do app) | Não | Cenários 9–10 |
| Sem confirmação de leitura, sem "online", sem marca d'água | Sim (nada disso existe) | Sim | — | — |
| PDF dentro do app, só desenhado (sem scripts, links, formulários, XFA, FontFace ou eval); nunca abre outro app | Sim (pdf.js 6.4.299 copiado com hash conferido) | Sim: PDF com JavaScript, ação automática e link; nada roda, nada abre | Não | Cenário 10 |
| Formatos recusados: Office, HTML, SVG, ZIP, executáveis e outros | Sim (lista positiva: texto UTF-8 e PDF, conferidos pelo conteúdo) | Sim | — | Não dá para mostrar esses formatos com segurança dentro do app |

## P5 Criptografia

| Item | Implementado | Teste automático | Android real | Pendente |
|---|---|---|---|---|
| vodozemac/Olm, Keystore, banco cifrado, rotação, prazos, identidade | Preservados (nada mudou na criptografia) | Sim (suítes existentes) | Não | — |
| Atualizar sem perder: cofre v1→v2, banco esquema 1→2 | Sim (antes apagava) | Sim (`app/test/migration.test.mjs`, instala com código antigo) | Não | — |
| Troca de aparelho durável em duas fases | Sim | Sim | Não | Cenário 1 |
| Mensagem adulterada, repetição, concorrência, apagar, revogação, perda | Já existiam | Sim (núcleo do cliente e servidor) | — | — |
| ADR 0009 (gate online) | Revisado; **segue bloqueado** | — | — | Revisão criptográfica independente |
| Troca de credenciais sem derrubar contas | Plano em `ROTACAO_DE_CREDENCIAIS.md` | — | — | Troca suave das chaves de assinatura (PWA e APK) |

## P7 Testes

- CI: servidor (R2 e DO), núcleo do cliente, protocolo, cripto, app inteiro pela interface, release de teste e emulador.
- Celular de verdade: roteiro com 10 cenários para Xiaomi/HyperOS e outro fabricante (`TESTE_EM_CELULAR.md`). **Nada aprovado** até alguém rodar.

## Riscos

`RISCOS_PENDENTES.md`. O mais grave: **a administradora não tem recuperação**
(R-01, precisa de decisão).

## O que o proprietário precisa fazer, em ordem

1. Rodar `deploy-api`. A troca durável e o FCM precisam da API nova.
2. Firebase mínimo (`FIREBASE_MINIMO.md`), se quiser notificação no Android.
3. Gerar a chave do APK e cadastrar os segredos (`APK_RELEASE.md`).
4. Rodar `android-release`, conferir SHA-256 e certificado, e instalar.
5. Migrar a administradora (`MIGRAR_DEBUG_PARA_RELEASE.md`). **Anote o PIN novo antes de aprovar.**
6. Rodar `TESTE_EM_CELULAR.md` nos dois aparelhos.
7. Decidir R-01 (recuperação da administradora).
