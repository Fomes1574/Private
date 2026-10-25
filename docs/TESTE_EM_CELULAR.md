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
| 11 | Seletor de arquivos (F17) e lote de fotos (D4) | Modo máximo desligado: anexar → "Galeria: várias fotos (até 5)", escolha 6; desbloqueie e "Continuar com o anexo" | App tranca ao abrir o seletor; ao voltar pede PIN; aceita só 5 e avisa; cada foto com edição, "1" e legenda próprios | | |
| 12 | Microfone (F12) e áudio (b.6) | Segure o microfone, deslize para a esquerda; segure e deslize para cima (cadeado), pause, pare, "Ouvir"; saia do app no meio | Cancelar e sair desligam o microfone na hora (ícone do sistema some); nada é enviado sozinho | | |
| 13 | Teclado anônimo (S5) | Digite uma palavra rara no app; depois tente no teclado de outro app | O teclado do sistema não sugere a palavra fora do app | | |
| 14 | Verificar contato (S8) | Menu da conversa → Participantes → Verificar; um lê o QR do outro (Android) ou comparam os números | Números iguais nos dois; "✓ Verificado". Depois que um trocar de aparelho: aviso na conversa e mídia pausada até conferir de novo | | |
| 15 | Vídeo grande no disco (S2) | `ENTREGA_A1_2026-10-25.md`, roteiro S2, no pacote `.debug` | Registrar o resultado do `verificar-blobs.py` | | |
| 16 | Prazo de 12 h no servidor | Foto com prazo de 12 h; depois de vencer | Some dos dois aparelhos; abrir a referência antiga não funciona | | |

## Também anotar

- Biometria: cadastrar uma digital nova deve exigir configurar de novo (a chave do Keystore é invalidada).
- Sem internet: o app não abre (é de propósito) e mostra o aviso certo.
- Bateria: depois de 24 h com o app instalado, o consumo dele em Configurações → Bateria.

## Registro

Data, quem testou, aparelho, e para cada ❌: o que fez, o que viu e um print
(se a tela deixar). Abra uma issue sem dado pessoal.
