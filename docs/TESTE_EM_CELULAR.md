# Teste em celular Android de verdade

Nada aqui foi feito ainda. Os testes automáticos rodam no Chromium e num
emulador, e **não aprovam** o app no celular. Marque cada linha só depois de
ver acontecer no aparelho.

Aparelhos: **1)** Xiaomi/Redmi/POCO com HyperOS. **2)** Outro fabricante
(Samsung, Motorola ou Pixel). Anote modelo, versão do Android e versão do app
(Ajustes → Versão do app).

| Aparelho | Modelo | Android / HyperOS | Versão do app |
|---|---|---|---|
| 1 | | | |
| 2 | | | |

## Antes (HyperOS)

Sem push no Android (decisão de 24/10/2026), não é preciso mexer em "Início
automático" nem em bateria para avisos. Anote só se o HyperOS fecha o app
enquanto ele está aberto em primeiro plano (não deveria).

## Cenários

Legenda: ✅ ok · ❌ falhou (anote o que viu) · — não se aplica

| # | Cenário | Como testar | Esperado | 1 | 2 |
|---|---|---|---|---|---|
| 1 | Migração da administradora | `MIGRAR_DEBUG_PARA_RELEASE.md`, com o debug antigo | Mesma conta, admin no app novo; debug se apaga; ninguém perde nada. Repita fechando o app novo à força entre os passos 4 e 7 | | |
| 2 | Instalar e atualizar | Instale a 1.0.N e depois a 1.0.N+1 por cima. Tente instalar uma versão menor | Atualiza sem perder dados; versão menor recusada | | |
| 3 | Mensagem com o app **aberto** | Outra pessoa manda mensagem | Mensagem aparece em segundos, sem notificação | | |
| 4 | Sem serviços do Google | Ajustes → Notificações | Texto explica que no Android não há aviso com o app fechado (sem Firebase, por decisão); nenhuma notificação aparece com o app fechado | | |
| 5 | Voltar ao app depois de horas fechado | Feche o app, receba mensagens, abra de novo | Pede o PIN e as mensagens aparecem | | |
| 6 | Câmera e microfone | Câmera do app: frontal, traseira, trocar, foto, vídeo com som, cancelar. Áudio de 1 min, e um longo (até 1 h, se der) | Pede permissão só na 1ª vez; nada vai para a galeria; vídeo com som; ao cancelar ou sair, a luz da câmera apaga | | |
| 7 | Interrupção | No meio de gravação de vídeo e áudio: ligação recebida, trocar de app, bloquear a tela | Gravação para sem travar; câmera e microfone liberados; app tranca | | |
| 8 | Mídia pesada | Vídeo de 5 min; vídeo 4K da galeria (modo máximo desligado); foto grande | Comprime antes de enviar; mostra erro claro se não der; nada sai sem cifra | | |
| 9 | Privacidade ao minimizar | Abra uma conversa e vá aos recentes; tente print e gravar a tela; espelhe a tela (Cast) | Recentes sem conteúdo; print e gravação pretos ou bloqueados; app trancado ao voltar | | |
| 10 | Prazos, apagar, ver uma vez, documentos | Mensagem de 12 h; apagar para todos; foto de ver uma vez; documento de texto e PDF | Somem no prazo (horário de Brasília); ver uma vez abre uma vez só; documento abre dentro do app, sem chamar outro app | | |
| 11 | Galeria (D12/D13) e lote de fotos (D4) | Modo máximo desligado: anexar → Galeria. Escolha 6 itens entre fotos e um vídeo; volte em menos de 2 min. Repita demorando mais de 2 min no seletor | Abre o seletor de **fotos** do Android (grade, não a tela de Arquivos), só fotos e vídeos, no máximo 5. Volta rápida: **sem PIN**, direto na tela de preparar com as fotos; vídeo depois, com "normal" ou "ver uma vez". Mais de 2 min: pede PIN e, depois dele, volta **direto na conversa** com a seleção. Nada vai como documento | | |
| 12 | Microfone (F12) e áudio (b.6) | Segure o microfone, deslize para a esquerda; segure e deslize para cima (cadeado), pause, pare, "Ouvir"; saia do app no meio | Cancelar e sair desligam o microfone na hora (ícone do sistema some); nada é enviado sozinho | | |
| 13 | Teclado anônimo (S5) | Digite uma palavra rara no app; depois tente no teclado de outro app | O teclado do sistema não sugere a palavra fora do app | | |
| 14 | Verificar contato (S8) | Menu da conversa → Participantes → Verificar; um lê o QR do outro (Android) ou comparam os números | Números iguais nos dois; "✓ Verificado". Depois que um trocar de aparelho: aviso na conversa e mídia pausada até conferir de novo | | |
| 15 | Vídeo grande no disco (S2) | `ENTREGA_A1_2026-10-25.md`, roteiro S2, no pacote `.debug` | Registrar o resultado do `verificar-blobs.py` | | |
| 16 | Prazo de 12 h no servidor | Foto com prazo de 12 h; depois de vencer | Some dos dois aparelhos; abrir a referência antiga não funciona | | |
| 17 | Atualização sem perda | Instale o APK novo assinado pela mesma chave sobre o APK de distribuição anterior, sem desinstalar | Mesma conta, PIN e dados ainda válidos; versão nova em Ajustes | | |
| 18 | Troca autorizada | Atualize primeiro o antigo. Ajustes → Trocar de celular → Gerar autorização; no novo, Já uso em outro celular → PIN → autorização; confirme pedido/código no antigo | Autorização única de 5 min; antigo só cai após confirmação no novo | | |
| 19 | Troca interrompida | Feche o novo antes da aprovação e depois da aprovação; reabra com PIN e termine | Mesma conta; antigo permanece ativo até a confirmação; sem perder administradora | | |
| 20 | Autorização vencida/usada | Use autorização já consumida ou espere 5 min antes de iniciar | Recusa clara; nenhum aparelho ativo é desconectado; gerar outra permite tentar novamente | | |
| 21 | Cinco fotos, escolha individual | Escolha cinco, edite/legende cada uma; marque duas como ver uma vez, depois três, todas e nenhuma em lotes separados | Cada foto preserva edição/legenda/modo; prévias não mostram conteúdo de ver uma vez; destinatário abre somente as permitidas | | |
| 22 | Borracha e ① na câmera | Câmera do app → foto → Editar: desenhe, toque na borracha e apague só um pedaço, depois "Desfazer". Na tela de preparar, toque no ① ao lado da legenda | A borracha apaga só o desenho, nunca a foto; desfazer devolve. ① liga "ver uma vez" e tira a legenda | | |
| 23 | Ajustes enxutos | Abra Ajustes | Sem "Notificações", sem "Guardião", sem "Fotos íntimas" e sem a opção de prévia (a prévia aparece sempre na lista; ver uma vez nunca) | | |
| 24 | Nova interface (E4) | Percorra lista, conversa, anexar, preparar foto, editor, ajustes, novo grupo, anotações e stories; toque em todos os ícones do topo e da caixa de mensagem. Ative "reduzir movimento" no sistema e repita | Todo ícone faz o que o nome diz; nada fica escondido atrás do teclado ou de outro botão; textos curtos e sem corte; sem animação com "reduzir movimento" | | |

## Também anotar

- Biometria: cadastrar uma digital nova deve exigir configurar de novo (a chave do Keystore é invalidada).
- Sem internet: o app não abre (é de propósito) e mostra o aviso certo.
- Bateria: depois de 24 h com o app instalado, o consumo dele em Configurações → Bateria.

## Registro

Data, quem testou, aparelho, e para cada ❌: o que fez, o que viu e um print
(se a tela deixar). Abra uma issue sem dado pessoal.
