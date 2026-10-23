# Critérios de aceite (§26) × o que está testado

Legenda: **ok** = teste automatizado passando no CI · **aparelho** = falta o
teste no iPhone/Android real · **pendente** = não implementado ainda · **limite**
= não tem solução técnica completa (§28).

## A. Identidade e recuperação
| Critério | Estado | Onde |
|---|---|---|
| Convite usado ou vencido não abre conta | ok | `server/test/api.test.mjs` (convite: uso único) |
| 11º usuário não entra em corrida de cadastro | ok | `server/test/api.test.mjs` (limite de 10, sem corrida) |
| Uma identidade não mantém duas sessões ativas | ok | troca por QR derruba o aparelho antigo |
| Troca de aparelho atualiza identidade com aviso | ok | `packages/client/test/e2e.test.mjs` (aviso de segurança) |
| Troca preserva ou não o histórico (escolha) | pendente | hoje começa do zero; transferência do histórico não feita |
| Perda do telefone: dois autorizados, 24 h, sem segredos antigos | ok | recuperação: administradora + guardião, `too_early` |
| Troca de apelido avisa sem trocar a impressão digital | ok | `nickname_change` cifrado; chave não muda |

## B. Criptografia e vazamentos
| Critério | Estado | Onde |
|---|---|---|
| Servidor não lê texto, mídia, legenda | ok | e2e confere D1 sem texto em claro; mídia só cifrada |
| Revisão independente da implementação | pendente | decisão 2 do proprietário (custo) |
| Nenhum segredo em logs, push, URL, localStorage, cache do SW | ok (por desenho) | push sem payload; token no subprotocolo; observability off; sem localStorage |
| Servidor que substitui chave | ok | aviso `key_changed`; sessão só com a chave do diretório |
| Replay, fora de ordem, downgrade | ok | Prova 1 e `packages/crypto/test` |
| Rotação de grupo | ok (fan-out) | sem chave de grupo compartilhada (V7-002) |

## C. Expiração e exclusão
| Critério | Estado | Onde |
|---|---|---|
| TTL 12 h–15 d, sem "Nunca"; Brasília na UI, UTC no servidor | ok | `packages/protocol/test`, rodado em 2 fusos |
| Apagar para mim afeta só quem apagou | ok | e2e do cliente |
| Apagar para todos some e não volta após sincronizar | ok | e2e do cliente e do app |
| Offline não exibe sem autorização válida ao voltar | ok (cliente honesto) | sem tempo confiável nada aparece; gate criptográfico bloqueado (ADR 0009) |
| PWA fechada não mostra vencidas ao reabrir | ok / aparelho | Prova 3 e `view()`; falta iPhone |
| D1/R2 limpam vencidos | ok | cron + alarme do DO |
| Foto de perfil/grupo/fundo até troca, sem versão antiga acessível | ok | `server/test/api.test.mjs` (só a versão atual), cliente e app (perfil e grupo) |

## D. Visto único
| Critério | Estado | Onde |
|---|---|---|
| Autor não reabre; destinatário uma vez | ok | Prova 5, API e cliente |
| Outros pendentes ainda abrem | ok | Prova 5 |
| Todos consumidos ou vencido: apaga | ok | Prova 5 (alarme e último consumo) |
| Dois pedidos simultâneos não abrem duas vezes | ok | 20 pedidos simultâneos |
| Membro removido não impede limpeza | ok | Prova 5 e API |
| Sem marca d'água/nome/data/hora sobre a mídia | ok | visualizador sem sobreposição |

## E. Documentos e processamento
| Critério | Estado | Onde |
|---|---|---|
| 20 MB, 3 globais, 4º revoga o mais antigo | ok | protocolo + API |
| 4º falho mantém os três | ok (por desenho) | só conta depois de publicar |
| Arquivos perigosos não executam; sem exportação | ok (lista positiva) | só texto UTF-8, mostrado como texto puro; HTML no documento não vira página (teste do app). PDF e outros esperam P-12 |
| Vídeo 5 min, áudio 1 h, fotos compactadas | ok / aparelho | foto recodificada e editor; vídeo recodificado (Prova 6) no chat e nas stories; áudio até 1 h. H.264 só no aparelho |
| EXIF/GPS não vão ao servidor | ok | foto recodificada no canvas; vídeo com `tags: {}` |

## F. Plataformas, UI e manutenção
| Critério | Estado | Onde |
|---|---|---|
| Android bloqueia capturas em todas as telas | ok (build) / aparelho | APK compila no CI com FLAG_SECURE e sem miniatura em recentes; falta testar no aparelho |
| iPhone informa limite real de print | ok | Ajustes → "O que este app não promete" |
| Notificação só "novas mensagens" | ok | push sem payload; SW mostra texto fixo |
| Sem online/visto/entregue/digitando | ok | teste do app procura essas palavras |
| PWA atualiza sem perder chaves nem misturar versões | ok / aparelho | Prova 4 |
| Banco migra transacionalmente | ok | Prova 3 |
| Bateria, memória, vídeo, armazenamento esgotado no iPhone | aparelho | — |
| Testes de cliente adulterado, PWA comprometida, servidor malicioso (V7-022) | parcial | falsificação de remetente, release adulterada, troca de chave; falta suíte dedicada |

## G. Recursos de conversa (§17, §18, §22)
| Critério | Estado | Onde |
|---|---|---|
| Legenda cifrada; ver uma vez sem legenda | ok | protocolo e app |
| Rascunho só no aparelho, cifrado, some ao enviar | ok | app |
| Buscar só no que ainda vale, sem índice salvo | ok | app (menu da conversa) |
| Silenciar só suprime push; prazos e entrega iguais; quem envia não sabe | ok | API e app |
| Apagar conversa só para mim; os outros continuam vendo | ok | app |
| Stories: audiência escolhida, prazo próprio, sem contagem de quem viu | ok | API, cliente e app |
| Editor de foto local, sem sobreposição automática | ok | app (girar, desenhar, escrever; cancelar não envia) |
| Mensagem que falha na verificação vira aviso visível | ok | cliente (`message_rejected`) |
