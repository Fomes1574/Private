# ADR 0020 — Disfarce "Hungry Snake"

Data: 29/10/2026. Estado: aprovado pelo proprietário (D5, `PLANO_REVISAO_2026-10-25.md`, seção 1.3, com os ajustes de 29/10); implementado na entrega E2.

## O que é

Cada pessoa pode ligar em **Ajustes → Disfarce**. Com ele ligado, o app abre num jogo da cobrinha que funciona de verdade, chamado **Hungry Snake**, de um estúdio que não existe (Little Fern Games). Nada na tela fala do Pacto Talk. O jogo é feito no próprio app (canvas, sem biblioteca, sem arquivo de som: a mordida é gerada na hora).

- Jogo: tabuleiro 15×15, modos Clássico e Sem paredes, velocidades Lenta, Normal e Rápida, recorde guardado no aparelho, som e vibração que se desligam, em pé e deitado.
- Controle: deslizar no tabuleiro ou setas na tela (escolha na pausa ou em Opções). Teclado físico sempre funciona (setas/WASD, espaço ou Esc pausa).
- A cobra é desenhada em pixels reais da tela: casa com tamanho inteiro e espessura com a mesma paridade da casa, para ter a mesma grossura na horizontal e na vertical em qualquer densidade de tela (teste automático em 1x, 2x, 2,625x e 3x).

## A porta

**Segurar 3 segundos em qualquer "Recorde"** (na tela inicial, no placar durante a partida, na pausa ou no fim de jogo) abre "Código de contribuidor" ("Apoiou a Little Fern Games no Patreon ou em outra plataforma? Digite o código que você recebeu."). O código é o PIN (ou a frase-senha, se o cofre usa frase). A seta no topo volta para onde a pessoa estava (início, partida pausada ou fim de jogo); segurar durante a partida para a cobra. O dedo pode tremer um pouco (até 24 px) sem cancelar. O toque curto não faz nada, e nada indica que o quadro faz algo.

- PIN certo: entra no Pacto Talk como pelo desbloqueio normal (troca de celular pendente, anexo escolhido antes de trancar, lista).
- Formato errado (menos de 6 números): "Código incompleto". **Não conta** como tentativa.
- Código errado: "Código inválido". Nunca mostra quantas tentativas restam.
- **4ª errada seguida:** volta ao jogo e o Recorde para de responder por 30 minutos (a contagem fica no aparelho, em `snakeHold`; mudar o relógio não estica a pausa além de 30 min).
- **5ª errada seguida** (contada pelo servidor, como sempre): apaga os dados do aparelho. O app volta ao jogo em silêncio, com o disfarce e o recorde mantidos.
- O PIN certo zera a contagem local; o servidor zera a dele.
- Sem cofre (app novo ou apagado), a porta leva ao começo do Pacto Talk.
- Mensagens de rede no jogo: "Sem conexão. Tente de novo."; aparelho desconectado aparece como "Este código expirou."

Trancar (sair do app, tempo, "Bloquear agora") volta ao jogo. Apagar tudo também.

Sair do app segue **Ajustes → Trancar ao sair do app**. No padrão ("Na hora"), qualquer saída tranca: quem foi ao WhatsApp e voltou em 5 segundos cai no jogo e precisa da porta de novo. Quem escolheu "Depois de 1 minuto" ou "Depois de 5 minutos" volta direto às conversas dentro do prazo e cai no jogo depois dele. A única outra exceção é a galeria aberta pelo próprio app (2 minutos, ADR 0019). O disfarce vale a partir da primeira saída depois de ligado.

## Nome e ícone

- **Android:** duas entradas na tela inicial (`activity-alias` `.PactoTalk` e `.HungrySnake`) para a mesma `MainActivity`; o plugin `Disguise` liga uma e desliga a outra (`setComponentEnabledSetting`, `DONT_KILL_APP`), primeiro ligando a nova para nunca ficar sem ícone. Alguns lançadores tiram o atalho da tela inicial na troca; aí é pegar de novo na lista de apps. O nome do app no sistema (Configurações → Apps, desinstalar) passa a ser **"Hungry Snake" para todos**, porque não muda em tempo de execução. O botão voltar do Android fecha a pausa e sai da tela do código.
- **iPhone (PWA):** o título, o ícone (`snake-180.png`), o `apple-mobile-web-app-title` e o manifesto (`snake.webmanifest`) trocam na hora, mas o iPhone só usa isso ao **adicionar à Tela de Início**: é preciso apagar o ícone e adicionar de novo pelo Safari. Os dados não se perdem (ficam no Safari).
- Capa de privacidade (seletor de apps) fica verde como o jogo.

## O que fica guardado fora do banco cifrado

O banco só abre depois do PIN, então o disfarce usa o IndexedDB simples (`mp-app`): `disguise`, `snakePrefs`, `snakeBest` e `snakeHold`. Nenhum é conversa ou chave. `disguise`, `snakePrefs` e `snakeBest` sobrevivem ao "apagar tudo", de propósito.

## Limites (o disfarce engana uma olhada, não uma perícia)

- O pacote `com.pactotalk.app`, as permissões (câmera, microfone, biometria) e o tamanho do app aparecem em Configurações → Apps. Trocar o pacote exigiria reinstalar e parear de novo; fica fora.
- A digital aparece para **qualquer** código com 6 números ou mais, certo ou errado. Ela é uma das três partes da chave do cofre (digital + PIN + parte do servidor) e precisa ser lida antes de saber se o código está certo; tirar isso enfraqueceria a proteção. O que a janela mostra foi ajustado (29/10, 1.0.108): título "Confirmar", e o nome e o ícone do app no sistema são sempre os do Hungry Snake (aplicação, `MainActivity` e a descrição da tarefa aberta). Só a entrada `.PactoTalk` da tela inicial mostra o Pacto. Quem liga o disfarce deve fechar o app nos recentes e abrir pelo ícone novo. No HyperOS (Redmi 15C) a janela da digital mostrava o nome e o ícone do Pacto Talk; conferir de novo no aparelho.
- Quem descobrir o gesto vê a tela do código; sem o PIN, 4 erros pausam e o 5º apaga.

## Testes

`app/test/snake.test.mjs`: regras do jogo; ligar nos Ajustes; trancar, recarregar e apagar mostrando só o jogo; todos os botões; toque curto não abre; 3 s abre; seta volta; formato errado não conta; 4 erros pausam; PIN certo entra e zera; desligar volta ao desbloqueio normal; 5 erros apagam e mantêm o disfarce; conferência visual em pé, deitado e em celular pequeno; grossura da cobra; custo de desenhar (média 0,25 ms por quadro com cobra de 113 casas). No emulador do CI: a entrada da tela inicial é a do Pacto Talk com o disfarce desligado. Falta o teste no celular de verdade (cenário 25 de `TESTE_EM_CELULAR.md`).
