# Relatório: APK Android de produção (Pacto Talk), outubro 2026

Cada item tem quatro estados, sem misturar:
- **Implementado**: o código está no repositório.
- **Teste automático**: um teste do CI passa (Chromium, Node/workerd ou emulador Android).
- **Android real**: visto num celular de verdade. **Nenhum item foi testado em celular de verdade ainda.** Os testes automáticos não substituem isso.
- **Pendente**: o que falta e de quem depende.

## P1 Notificações

**Decisão do proprietário (24/10/2026): sem Firebase.** O APK não tem nenhum
código ou serviço do Google. Consequência: no Android **não há aviso com o
app fechado**; com o app aberto, as mensagens chegam na hora pela conexão
própria do app. O código do servidor para FCM fica inativo (só liga com o
segredo `FCM_SERVICE_ACCOUNT`, que não será criado).

| Item | Implementado | Teste automático | Android real | Pendente |
|---|---|---|---|---|
| APK sem Firebase/Google (sem dependência, sem plugin, sem permissão de notificação) | Sim | Sim: o CI recusa qualquer menção a firebase/google-services/play-services no projeto; a verificação do APK recusa permissões fora da lista | Não | — |
| Ajustes no Android explicam que não há aviso com o app fechado (não aparece como erro) | Sim | Sim (`app/test/push.test.mjs`) | Não | — |
| iPhone/navegador com Web Push ("novas mensagens", aviso sem conteúdo), só para serviços de push conhecidos | Sim | Sim (servidor e interface) | — | Teste no iPhone |
| Botão no iPhone: aguardando permissão / ativadas / recusadas / erro | Sim | Sim | — | Teste no iPhone |
| Silenciada, app aberto, desativar, troca de aparelho, apagar tudo | Sim | Sim | — | — |

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
| Assinatura v2/v3 + digital conferida + verificação (sem depuração, sem backup, sem tráfego em claro, lista fechada de permissões) | Sim (`android-release.yml`, `verificar-apk.sh`) | Sim: release de teste com chave descartável a cada push. Desde 24/10 a lista aceita só: INTERNET, USE_BIOMETRIC, USE_FINGERPRINT, CAMERA, RECORD_AUDIO, MODIFY_AUDIO_SETTINGS e a permissão interna do próprio pacote | — | — |
| versionCode crescente, sem downgrade | Sim | Parcial (o build recebe o número) | Não | Cenário 2 |
| FLAG_SECURE, recentes sem prévia, WebView sem depuração, backup desligado | Sim | Sim, no emulador (linha seguinte); a prévia dos recentes não é medida no emulador | Não | Cenário 9 |
| Teste no emulador Android 14 com o APK de release | Sim (`teste-emulador.sh`) | **Passou (24/10, execução 32 do workflow `android`), em emulador `user` (ro.debuggable=0, como celular).** Confirmado: instala; pacote sem DEBUGGABLE e sem ALLOW_BACKUP; `run-as` recusado ("package not debuggable"); câmera e microfone não vêm concedidos; a interface abre; **FLAG_SECURE**: print de controle da tela inicial com conteúdo, print com o app aberto recusado pelo Android, janela da MainActivity com `SECURE`; nenhuma porta de depuração de WebView (lista de sockets legível); nada do console no logcat; o app sobrevive ao ir para o fundo. Emulador **não** é celular de verdade | Não | Cenários de `TESTE_EM_CELULAR.md` |
| GitHub Release com APK e SHA-256 | Sim | Não: precisa dos segredos | — | Rodar `android-release` |
| **APK assinado pronto para instalar** | Sim: Release `android-1.0.103` (24/10/2026, commit `bbe5965`, com a recuperação da administradora), SHA-256 `6ea1a173243d9265b6029ca12d657e24da12cf3f1c54d377d5ce684831ef964d`, certificado `8ff069c6458f4101138f89dd857a736e796f19c76ddf84d7bf63d2d13a619665`. Anterior: 1.0.102 (`7d362d9`) | Sim: verificação do workflow aprovou assinatura, flags e permissões (câmera, internet, microfone, biometria); suíte do app 28/28 e servidor 41/41 no mesmo código | Não | Instalar, recuperar a administradora e rodar `TESTE_EM_CELULAR.md` |
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

1. ~~Rodar `deploy-api`~~ (feito em 24/10).
2. Gerar a chave do APK e cadastrar os segredos (`APK_RELEASE.md`).
3. Rodar `android-release`, conferir SHA-256 e certificado, e instalar.
4. Migrar a administradora (`MIGRAR_DEBUG_PARA_RELEASE.md`). **Anote o PIN novo antes de aprovar.**
5. Rodar `TESTE_EM_CELULAR.md` nos dois aparelhos.
6. Decidir R-01 (recuperação da administradora).
