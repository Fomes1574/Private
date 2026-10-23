# Riscos pendentes (outubro 2026)

Ordem: do mais grave para o menos grave. "Decisão" = precisa do proprietário.

| ID | Risco | Gravidade | Estado / o que fazer |
|---|---|---|---|
| R-01 | **A administradora não tem recuperação.** A recuperação exige aprovação da administradora + do guardião, e ela não aprova a si mesma. Se a administradora perder o celular e o PIN, ninguém administra mais o círculo | Alta | **Decisão.** Opções: (a) uma segunda administradora; (b) recuperação da administradora por guardião + N membros + espera maior (ex.: 72 h com aviso a todos); (c) aceitar o risco e guardar o PIN e o código de emergência com cuidado. Não implementei sem decisão |
| R-02 | Nada foi testado em celular de verdade: notificações (FCM e HyperOS), câmera/microfone no WebView, FLAG_SECURE, biometria, troca de aparelho | Alta | `TESTE_EM_CELULAR.md`. Os testes automáticos rodam em Chromium e emulador e **não** aprovam o app |
| R-03 | HyperOS mata apps em segundo plano: sem "Início automático", o aviso não chega com o app fechado | Média | Orientar os membros (`TESTE_EM_CELULAR.md`, "Antes"). O código não tem como forçar isso |
| R-04 | Push revela ao Google (FCM) e à Apple (Web Push) **que** houve aviso e **quando** | Média | Inerente a qualquer push. A mensagem vai vazia; quem quiser zero metadado desliga as notificações |
| R-05 | O debug instalado se apaga ao aprovar a troca (código antigo, que não muda) | Média | Mitigado: o app novo guarda tudo antes de mostrar o código, e o servidor só derruba o antigo quando o novo confirma (`MIGRAR_DEBUG_PARA_RELEASE.md`). Falta repetir no aparelho |
| R-06 | Chave de assinatura do APK: perdida, ninguém atualiza mais; vazada, alguém publica APK falso que atualiza por cima | Alta se acontecer | Gerada offline; cópia em dois lugares offline; usada só pelo workflow, com digital conferida. Recomendado: aprovação manual no environment `release`. Se vazar: `ROTACAO_DE_CREDENCIAIS.md` |
| R-07 | Visualizador de PDF ainda não existe: documento só abre se for texto puro | Média | Planejado: pdf.js sem scripts, fontes embutidas, anotações nem formulários, dentro do app. Outros formatos (Office, HTML, SVG, ZIP) ficam recusados por segurança |
| R-08 | Gate online de texto (ADR 0009) segue bloqueado: precisa de revisão criptográfica independente | Média | Não implementado de propósito. Sem revisão, não vira código |
| R-09 | WebView do Android depende do Chrome/WebView do sistema: celular sem atualização de WebView fica com falhas conhecidas | Média | Orientar: manter "Android System WebView" atualizado pela Play Store |
| R-10 | Apagar não é garantia absoluta: memória flash, backups do sistema de quem recebeu, fotos da tela por outro celular | Inerente | O app apaga a chave (o dado vira ruído) e reescreve o banco. Não prometemos irrecuperabilidade absoluta, nem que print é impossível em todo aparelho |
| R-11 | FLAG_SECURE bloqueia print e gravação na maioria dos Android, mas root, alguns gravadores via HDMI/USB e câmera externa contornam | Inerente | Documentado; sem promessa absoluta |
| R-12 | Histórico não passa na troca de aparelho | Baixa | De propósito (V7-015). Decisão se algum dia quiser transferir (exigiria canal direto entre os dois celulares) |
| R-13 | O Firebase SDK fala com servidores do Google (Firebase Installations) mesmo sem Analytics | Baixa | Só depois de a pessoa ativar as notificações (token automático desligado) |
| R-14 | Credenciais que podem ter sido expostas em conversas, prints ou logs | Depende | `ROTACAO_DE_CREDENCIAIS.md`: trocar cada uma sem derrubar contas |

## O que foi corrigido nesta rodada (antes era risco)

- **Migração destrutiva.** Cofre v1 e banco no esquema 1 eram apagados ao abrir. Agora migram sem perda (`app/test/migration.test.mjs`).
- **Troca de aparelho podia perder a conta.** O aparelho antigo caía na aprovação, antes de o novo guardar as chaves. Agora a troca tem duas fases e é durável (`server/test/api.test.mjs`, `app/test/pairing.test.mjs`).
- **Notificação no APK nunca funcionava.** `serviceWorker.ready` ficava esperando para sempre. Agora há FCM nativo, e a tela mostra o estado.
- **WebView liberava qualquer recurso pedido pela página.** Agora só câmera e microfone, e só para `https://localhost`.
- **Web Push aceitava qualquer endereço https.** Agora só os serviços de push conhecidos.
