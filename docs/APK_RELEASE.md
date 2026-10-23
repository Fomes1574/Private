# APK de distribuição (release) do Pacto Talk

## Resumo

| Item | Como está |
|---|---|
| Pacote | `com.pactotalk.app` (debug: `com.pactotalk.app.debug`) |
| Assinatura | Chave RSA 4096 **permanente** do proprietário. Gerada no navegador dele, guardada fora do repositório, usada só pelo workflow `android-release` |
| Esquemas de assinatura | v2/v3 via `apksigner` (minSdk 24, então sem v1) |
| Versão | `versionCode` sempre crescente (número da execução + 100, nunca menor que o último publicado); `versionName` = `1.0.<versionCode>` |
| Downgrade | O Android recusa instalar versão menor por cima |
| Troca de chave | O Android recusa atualização com outra chave. O workflow também recusa assinar se a chave não bater com `ANDROID_CERT_SHA256` |
| Verificação antes de publicar | `scripts/android/verificar-apk.sh` (detalhes abaixo) |
| Publicação | GitHub Release `android-1.0.N` com o APK, o `.sha256`, a digital do certificado e o relatório da verificação |

`verificar-apk.sh` confere:
- a assinatura e o certificado esperado;
- o pacote e o número da versão;
- que o APK não é depurável;
- backup desligado e tráfego em claro desligado;
- as permissões contra uma lista fechada;
- que não há chave ou mapa de código dentro do APK.

## Configurar (uma vez)

1. Abra `tools/gerar-chave-android.html` **no seu computador**: baixe o arquivo e abra no navegador. Funciona sem internet.
2. Gere a chave e **baixe a cópia de segurança**. Guarde em dois lugares offline (pendrive guardado + gerenciador de senhas).
   - Perder esta chave significa que ninguém consegue mais atualizar o app; seria preciso instalar outro pacote e migrar todo mundo.
3. No GitHub → Settings → Secrets and variables → Actions:
   - Secrets: `ANDROID_SIGNING_KEY` e `ANDROID_SIGNING_CERT` (copie da página).
   - Variables: `ANDROID_CERT_SHA256` (a impressão digital) e `MP_API_ORIGIN` (`https://…` da API).
   - Opcional, para notificações: `GOOGLE_SERVICES_JSON` (`docs/FIREBASE_MINIMO.md`).
4. (Recomendado) Settings → Environments → `release` → **Required reviewers**: você. Assim a chave só é usada depois do seu clique.

## Publicar uma versão

GitHub → Actions → **android-release** → Run workflow → digite `PUBLICAR-APK`.

A Release sai com:
- `Pacto-Talk-1.0.N.apk` e `Pacto-Talk-1.0.N.apk.sha256`;
- nas notas: o SHA-256 do APK, a digital do certificado, se tem notificações, e o relatório da verificação.

## Conferir no celular antes de instalar

1. Compare o SHA-256 do arquivo baixado com o das notas. Pode usar um app de hash ou o computador: `sha256sum Pacto-Talk-1.0.N.apk`.
2. A digital do certificado nas notas tem que ser **sempre a mesma**. Se mudar, não instale.
3. Na primeira instalação, o Android pede para permitir "instalar apps desconhecidos" para o navegador ou gerenciador de arquivos. Permita só durante a instalação.
4. Atualizações: instale o APK novo por cima. Os dados ficam, porque a chave é a mesma.

## O que o CI testa em todo push (sem a chave verdadeira)

O workflow `android` compila o release com a **mesma configuração** da
distribuição e assina com uma chave descartável gerada pela mesma página. Em
seguida, roda a mesma verificação e abre o APK num emulador Android 14
(`scripts/android/teste-emulador.sh`). O emulador confere:
- flags reais do pacote: não depurável, sem backup;
- `run-as` recusado;
- câmera, microfone e notificação ainda **não** concedidos;
- a interface abre;
- janela com FLAG_SECURE e print da tela preto;
- sem porta de depuração do WebView;
- nada do console no logcat;
- o app sobrevive ao ir para o fundo.

Emulador não é celular de verdade: veja `docs/TESTE_EM_CELULAR.md`.

## Permissões do APK (lista fechada)

| Permissão | Para quê |
|---|---|
| INTERNET, ACCESS_NETWORK_STATE | Falar com a API |
| USE_BIOMETRIC (USE_FINGERPRINT em Android antigo) | Digital libera o segredo do Keystore |
| POST_NOTIFICATIONS, WAKE_LOCK, c2dm RECEIVE | Aviso "novas mensagens" (FCM); pedida só ao tocar em Ativar |
| CAMERA, RECORD_AUDIO, MODIFY_AUDIO_SETTINGS | Câmera do app, áudio e vídeo; pedidas só na hora do uso |

Fora da lista, por decisão:
- armazenamento/arquivos;
- localização;
- contatos;
- rede local;
- id de publicidade (removido de propósito).

A câmera e o microfone só são liberados para a própria página do app
(`https://localhost`). Qualquer outro recurso que o WebView peça é negado.
