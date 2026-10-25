# Registros de decisão de arquitetura (ADR)

Cada ADR registra **uma** decisão: contexto, decisão, alternativas, consequências,
reversibilidade e como testar. A especificação normativa continua sendo
[`../especificacao/PROJETO_MENSAGEIRO_PRIVADO_ARQUITETURA_v7.md`](../especificacao/PROJETO_MENSAGEIRO_PRIVADO_ARQUITETURA_v7.md).
Quando um ADR e a especificação divergirem, vale a especificação até o
proprietário aprovar a mudança e a especificação ganhar nova versão.

Estados usados: **Aceito** (decisão do proprietário), **Aceito como direção**
(depende de prova de conceito), **Proposto** (aguarda o proprietário),
**Bloqueado** (não pode virar código ainda).

| ADR | Título | Estado | Origem |
|---|---|---|---|
| [0001](0001-codigo-fechado-repositorio-privado.md) | Código fechado em repositório privado | Aceito | V7-001 |
| [0002](0002-vodozemac-olm-fanout.md) | vodozemac (Olm) com fan-out, wrapper próprio em WASM | Aceito como direção | V7-002, P-01 |
| [0003](0003-envelope-versionado.md) | Envelope versionado, tamanho fixo e anti-downgrade | Aceito | V7-003, V7-018 |
| [0004](0004-arquitetura-cloudflare-a.md) | Arquitetura Cloudflare A | Aceito (R2 pendente de ativação) | V6-006, V6-007 |
| [0005](0005-desbloqueio-passkey-prf-pin.md) | Desbloqueio por passkey PRF + PIN com chave-envelope | Aceito como direção | V7-019, P-02 |
| [0006](0006-cadeia-de-atualizacao-pwa.md) | Cadeia de atualização da PWA | Aceito como direção | V7-017, P-03 |
| [0007](0007-base-web-unica-pwa-capacitor.md) | Base web única: PWA no iPhone, Capacitor no Android | Aceito como direção | V6-004, V7-020 |
| [0008](0008-sem-telemetria-logs-minimos.md) | Sem telemetria e logs mínimos | Aceito | §1.1, V7-018 |
| [0009](0009-gate-online-criptografico.md) | Gate online criptográfico | Bloqueado até revisão | V7-011, P-24 |
| [0010](0010-banco-local-cifrado.md) | Banco local cifrado | Aceito como direção | P-04 |
| [0011](0011-interface-sem-framework.md) | Interface em JavaScript puro, sem framework | Provisório | D-074 |
| [0012](0012-os-dados-morrem.md) | Os dados morrem: apagar de verdade em cada camada | Aceito | §7, §12, pedido do proprietário |
| [0015](0015-a1-sessao-conversas-anexos.md) | A1: ciclo de sessão, conversa individual e retorno de anexos | Aceito pelo proprietário; liberação pendente de testes | Plano final de 25/10/2026, A1 e D6 |
