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
| P-06 | Android com Capacitor e FLAG_SECURE | APK compila no CI; falta instalar e testar no aparelho |
| P-07 | Origem e `manifest.id` | Decisão 3 do proprietário |
| P-12 | Formatos de documento | Lista positiva começa só com texto UTF-8; PDF e outros precisam de decisão (visualizador seguro) |
| P-13 | Limites de bytes de vídeo | Fluxo feito (95 MiB, cai para econômico); medir no aparelho |
| P-14 | Cota e ativação do R2 | Decisão 1 do proprietário (hoje usa o SQLite do Durable Object) |
| P-24 | Gate online de texto | **Bloqueado**: precisa de revisão independente (ADR 0009) |
| §22 | Prazo padrão das stories | 24 h implementado como candidato; confirmar |
| — | Transferir histórico na troca de aparelho | Não feito: troca hoje começa do zero (mais seguro; decidir se vale) |
