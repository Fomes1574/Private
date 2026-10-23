# Estado das pendências da especificação

"Feito" significa código com teste automatizado; "aparelho" significa que
falta o teste no iPhone/Android real.

| ID | Assunto | Estado no repositório |
|---|---|---|
| P-01 | Biblioteca E2EE em WASM | Feito (Prova 1 e app); aparelho pendente |
| P-02 | Face ID (PRF) + PIN | Feito (Prova 2 e app); aparelho pendente |
| P-03 | Atualização com versão travada | Feito (Prova 4 e app); aparelho pendente |
| P-04 | Banco local cifrado + rotação de chave ao apagar | Feito (Prova 3, app, ADR 0012); aparelho pendente |
| P-05 | Ver uma vez, consumo atômico | Feito (Prova 5, API, app); falta deploy e aparelho |
| P-06 | Android com Capacitor e FLAG_SECURE | Release assinável (`docs/APK_RELEASE.md`), verificado e aberto em emulador no CI; notificação FCM; falta o teste no aparelho (`docs/TESTE_EM_CELULAR.md`) |
| P-07 | Origem e `manifest.id` | Decisão 3 do proprietário |
| P-12 | Formatos de documento | Lista positiva: texto UTF-8 e PDF (pdf.js só desenha: sem scripts, links, formulários, XFA, FontFace ou eval). Office, HTML, SVG, imagens soltas, ZIP e executáveis recusados (não há como mostrar com segurança dentro do app) |
| P-13 | Limites de bytes de vídeo | Fluxo feito (95 MiB, cai para econômico); medir no aparelho |
| P-14 | Cota e ativação do R2 | Decidido: R2 para a mídia (conta com cartão); bucket e regra de 16 dias criados pelo deploy-api; testes rodam nos modos R2 e DO |
| P-24 | Gate online de texto | **Bloqueado**: precisa de revisão independente (ADR 0009) |
| §22 | Prazo padrão das stories | 24 h implementado como candidato; confirmar |
| — | Recuperação da administradora | **Não existe** (exige ela mesma): decisão em `docs/RISCOS_PENDENTES.md`, R-01 |
| — | Troca suave das chaves de assinatura (PWA e APK) | Pendente: `docs/ROTACAO_DE_CREDENCIAIS.md`, itens 7 e 8 |
| — | Transferir histórico na troca de aparelho | Não feito: troca hoje começa do zero (mais seguro; decidir se vale) |
