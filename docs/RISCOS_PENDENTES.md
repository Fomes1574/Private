# Riscos pendentes (outubro 2026)

Ordem: do mais grave para o menos grave. "Decisão" = precisa do proprietário.

| ID | Risco | Gravidade | Estado / o que fazer |
|---|---|---|---|
| R-01 | ~~A administradora não tinha recuperação~~ **Resolvido em 24/10/2026:** no app, "Administradora: instalar ou recuperar" + código de instalação (`MP_SETUP_CODE`) passa a mesma conta (administradora, conversas, membros) para um aparelho novo, na hora (decisão do proprietário); os contatos veem a troca de chave. Consequência: o código de instalação vira a chave mestra da administradora; guardar offline e trocar se vazar (`ROTACAO_DE_CREDENCIAIS.md`, item 3) | Alta se o código vazar | Testes: `server/test/api.test.mjs`, `app/test/admin-recover.test.mjs` |
| R-02 | Nada foi testado em celular de verdade: câmera/microfone no WebView, FLAG_SECURE, biometria, troca de aparelho | Alta | `TESTE_EM_CELULAR.md`. Os testes automáticos rodam em Chromium e emulador e **não** aprovam o app |
| R-03 | HyperOS mata apps em segundo plano | Baixa | Sem push no Android, não muda nada para avisos; o app reconecta ao abrir |
| R-04 | No iPhone, o Web Push revela à Apple **que** houve aviso e **quando**. No Android não há push (sem Google, decisão de 24/10): sem aviso com o app fechado | Média | Inerente a qualquer push. A mensagem vai vazia; quem quiser zero metadado desliga as notificações |
| R-05 | O debug instalado se apaga ao aprovar a troca (código antigo, que não muda) | Média | Mitigado: o app novo guarda tudo antes de mostrar o código, e o servidor só derruba o antigo quando o novo confirma (`MIGRAR_DEBUG_PARA_RELEASE.md`). Falta repetir no aparelho |
| R-06 | Chave de assinatura do APK: perdida, ninguém atualiza mais; vazada, alguém publica APK falso que atualiza por cima | Alta se acontecer | Gerada offline; cópia em dois lugares offline; usada só pelo workflow, com digital conferida. Recomendado: aprovação manual no environment `release`. Se vazar: `ROTACAO_DE_CREDENCIAIS.md` |
| R-07 | ~~Visualizador de PDF ainda não existe~~ **Resolvido em 24/10/2026** (pdf.js só desenhando; desde 25/10 desenha só as páginas perto da tela) | Baixa | — |
| R-08 | Gate online de texto (ADR 0009) segue bloqueado: precisa de revisão criptográfica independente | Média | Não implementado de propósito. Sem revisão, não vira código |
| R-09 | WebView do Android depende do Chrome/WebView do sistema: celular sem atualização de WebView fica com falhas conhecidas | Média | Orientar: manter "Android System WebView" atualizado pela Play Store |
| R-10 | Apagar não é garantia absoluta: memória flash, backups do sistema de quem recebeu, fotos da tela por outro celular | Inerente | O app apaga a chave (o dado vira ruído) e reescreve o banco. Não prometemos irrecuperabilidade absoluta, nem que print é impossível em todo aparelho |
| R-11 | FLAG_SECURE bloqueia print e gravação na maioria dos Android, mas root, alguns gravadores via HDMI/USB e câmera externa contornam | Inerente | Documentado; sem promessa absoluta |
| R-12 | Histórico não passa na troca de aparelho | Baixa | De propósito (V7-015). Decisão se algum dia quiser transferir (exigiria canal direto entre os dois celulares) |
| R-13 | Android sem aviso com o app fechado (escolha de privacidade: nenhum serviço do Google) | Baixa | Alternativa futura sem Google: UnifiedPush/ntfy próprio; decidir se vale |
| R-14 | Credenciais que podem ter sido expostas em conversas, prints ou logs | Depende | `ROTACAO_DE_CREDENCIAIS.md`: trocar cada uma sem derrubar contas |
| R-15 | ~~Aviso de troca de chave só na memória e só em Ajustes~~ **Resolvido em 25/10/2026 (S1/S8, ADR 0016):** aviso guardado cifrado e mostrado na conversa; número da dupla e QR; contato verificado que troca de chave pausa a mídia | Baixa | Testes: `packages/client/test/a2.test.mjs`, `app/test/app.test.mjs`. Falta conferir no celular |
| R-16 | Vídeo/áudio grande decifrado pode ser gravado em disco pelo armazenamento de blobs do WebView (S2) | Alta, a validar | Teste no APK de depuração na entrega A1; correção em A2 se confirmado |
| R-17 | ~~Parte do servidor restaurável do histórico de 30 dias~~ **Resolvido em 25/10/2026 (S12, ADR 0016):** S cifrada por chave própria no R2, apagada junto com o cofre | Baixa | Teste: `server/test/a2.test.mjs`. Depende de o R2 não guardar versões apagadas (documentação da Cloudflare) |
| R-18 | Versões antigas do app não abrem mídia em degraus (S7), áudio de ver uma vez, enquete, voto e fixar: a mensagem é recusada com aviso | Média | Atualizar todos juntos: deploy da API (migração 0003), novo APK e nova PWA (ADR 0016) |
| R-19 | A administradora é fixada no aparelho na primeira vez que ele vê o círculo (confiança no primeiro uso). Um servidor já invadido nesse primeiro momento poderia indicar outra pessoa | Baixa | Verificar a administradora pessoalmente (número de segurança) ao entrar |

## O que foi corrigido nesta rodada (antes era risco)

- **Migração destrutiva.** Cofre v1 e banco no esquema 1 eram apagados ao abrir. Agora migram sem perda (`app/test/migration.test.mjs`).
- **Troca de aparelho podia perder a conta.** O aparelho antigo caía na aprovação, antes de o novo guardar as chaves. Agora a troca tem duas fases e é durável (`server/test/api.test.mjs`, `app/test/pairing.test.mjs`).
- **Notificação no APK nunca funcionava.** `serviceWorker.ready` ficava esperando para sempre. Agora a tela diz claramente o que acontece (no Android, sem aviso com o app fechado, por decisão).
- **WebView liberava qualquer recurso pedido pela página.** Agora só câmera e microfone, e só para `https://localhost`.
- **Web Push aceitava qualquer endereço https.** Agora só os serviços de push conhecidos.
