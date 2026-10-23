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

Configurações → Apps → Pacto Talk:
- **Início automático: ligado**. Sem isso, o HyperOS mata o app e o aviso não chega com ele fechado.
- **Economia de bateria: Sem restrições**.
- **Notificações: permitidas**, canal "Mensagens" com som.

Anote se foi preciso mexer. Isso vai para o guia dos membros.

## Cenários

Legenda: ✅ ok · ❌ falhou (anote o que viu) · — não se aplica

| # | Cenário | Como testar | Esperado | 1 | 2 |
|---|---|---|---|---|---|
| 1 | Migração da administradora | `MIGRAR_DEBUG_PARA_RELEASE.md`, com o debug antigo | Mesma conta, admin no app novo; debug se apaga; ninguém perde nada. Repita fechando o app novo à força entre os passos 4 e 7 | | |
| 2 | Instalar e atualizar | Instale a 1.0.N e depois a 1.0.N+1 por cima. Tente instalar uma versão menor | Atualiza sem perder dados; versão menor recusada | | |
| 3 | Notificação com o app **aberto** | Outra pessoa manda mensagem | Mensagem aparece; **sem** notificação | | |
| 4 | Notificação em **segundo plano** e com o app **fechado** (arrastado dos recentes) e com o celular bloqueado há 10+ min | Outra pessoa manda mensagem | Uma notificação "novas mensagens", sem nome, prévia ou número; tocar abre o app trancado | | |
| 5 | Silenciar, revogar e desligar | (a) silencie a conversa; (b) retire a permissão nas configurações e abra o app; (c) Ajustes → Desativar; (d) troque de celular | (a) nada; (b) tela diz "Recusadas" e nada chega; (c) nada chega; (d) o antigo não recebe mais | | |
| 6 | Câmera e microfone | Câmera do app: frontal, traseira, trocar, foto, vídeo com som, cancelar. Áudio de 1 min, e um longo (até 1 h, se der) | Pede permissão só na 1ª vez; nada vai para a galeria; vídeo com som; ao cancelar ou sair, a luz da câmera apaga | | |
| 7 | Interrupção | No meio de gravação de vídeo e áudio: ligação recebida, trocar de app, bloquear a tela | Gravação para sem travar; câmera e microfone liberados; app tranca | | |
| 8 | Mídia pesada | Vídeo de 5 min; vídeo 4K da galeria (modo máximo desligado); foto grande | Comprime antes de enviar; mostra erro claro se não der; nada sai sem cifra | | |
| 9 | Privacidade ao minimizar | Abra uma conversa e vá aos recentes; tente print e gravar a tela; espelhe a tela (Cast) | Recentes sem conteúdo; print e gravação pretos ou bloqueados; app trancado ao voltar | | |
| 10 | Prazos, apagar, ver uma vez, documentos | Mensagem de 12 h; apagar para todos; foto de ver uma vez; documento de texto e PDF (quando houver visualizador) | Somem no prazo (horário de Brasília); ver uma vez abre uma vez só; documento abre dentro do app, sem chamar outro app | | |

## Também anotar

- Biometria: cadastrar uma digital nova deve exigir configurar de novo (a chave do Keystore é invalidada).
- Sem internet: o app não abre (é de propósito) e mostra o aviso certo.
- Bateria: depois de 24 h com o app instalado, o consumo dele em Configurações → Bateria.

## Registro

Data, quem testou, aparelho, e para cada ❌: o que fez, o que viu e um print
(se a tela deixar). Abra uma issue sem dado pessoal.
