# @mp/protocol · regras decididas

Biblioteca sem dependências com as regras da especificação v7 que valem para
app e servidor. Cada função cita a seção ou decisão de origem.

| Módulo | O quê | Origem |
|---|---|---|
| `ttl.js` | Prazos 12 h–15 d, padrão 5 d, vencimento a partir do aceite do servidor | §10, V6-009 |
| `time.js` | Exibição em Brasília; relógio confiável ancorado no servidor | §10, §13, V6-011 |
| `envelope.js` | Conteúdo interno versionado, tipos, preenchimento em degraus | ADR 0003, V7-003, V7-018, V7-021 |
| `room.js` | 1:1 e grupo: líder, política, ceder liderança, sucessão, desfazer vínculo | V7-004, V7-005, V7-008, V6-010, V6-023 |
| `nickname.js` | Apelido normalizado, único, busca local por prefixo | V7-006 |
| `documents.js` | 3 documentos ativos por pessoa, quarto revoga o mais antigo | §16, V6-019, V6-020 |
| `reconcile.js` | Ordem obrigatória antes de exibir; edição; quem apaga para todos | §25.6, V7-009, V7-010 |
| `notify.js` | Texto fixo da notificação; opções de silenciar | V6-021, §18 |

```sh
npm test
```
