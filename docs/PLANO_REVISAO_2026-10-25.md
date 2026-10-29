# Pacto Talk — plano consolidado e revisão de privacidade (versão final)

Data: 25/10/2026  
Repositório: [Fomes1574/Private](https://github.com/Fomes1574/Private), branch `ccr-de59a90b-gr4vug`  
Código analisado: commit `03fa5d0` (o código é idêntico em `9965770`; só a documentação mudou)  
Estado: **A1 (GPT, revisada), A2, B, C e D implementadas** em 25/10/2026 no branch `ccr-de59a90b-gr4vug`, com testes automáticos. Ver `ENTREGA_A1_2026-10-25.md`, `ENTREGA_A2_B_C_D_2026-10-25.md` e ADR 0016. Publicadas em 27/10/2026 (API, PWA v2, APK 1.0.105; ver `ACOMPANHAMENTO_2026-10-27.md`). Em 28/10/2026 o proprietário aprovou as entregas E1 (galeria) e E2 (disfarce, D5), seção 1.3.

| Versão | Autor | O que trouxe |
|---|---|---|
| v1 | GPT | Plano de envio de 1 a 5 fotos, achados F01–F18, testes e ordem de entrega |
| v2 | Claude | Conferência de F01–F18 no código, bugs novos N1–N3, respostas sobre lista e busca, decisões D1–D5 |
| v3 | Claude | Decisões do proprietário, regra "igual ao WhatsApp", **pesquisa de privacidade e criptografia** (S1–S11), plano e ordem consolidados |
| v3.1 | Claude | Regra do proprietário: **funcionalidades iguais ao WhatsApp, segurança nossa** (os 50 passos). Comparação completa das funções **dentro da conversa** (seção 2.2). **Confirmação do que o prazo apaga de verdade**, inclusive na Cloudflare (seção 3.6, S12–S13) |
| Final | Claude | Revisão de consistência; documento fechado para servir de base à implementação |
| A1 | Codex | Implementação iniciada com autorização do proprietário; relatório e critérios de liberação em `ENTREGA_A1_2026-10-25.md` |
| A2–D | Claude | A1 revisada; A2, B, C e D implementadas; relatório em `ENTREGA_A2_B_C_D_2026-10-25.md` |

Legenda de evidência: **verificado no código** (lido, sem rodar no celular), **reproduzido** (teste isolado com partes simuladas), **a validar** (mecanismo concreto, precisa de teste). Nada deste documento foi testado em celular de verdade.

---

## 0. Resumo

1. **A criptografia está bem feita e faz o que promete contra o servidor e contra quem pega o celular.** As mensagens e as fotos são cifradas no aparelho com chaves que o servidor nunca recebe. O banco local também é cifrado e abre só com o PIN, conferido pelo servidor. Não encontrei nenhuma falha que deixe o servidor, a Cloudflare ou um invasor do servidor ler conteúdo.
2. **Faltam pontos para cumprir 100% do prometido.** Os principais:
   - o aviso de **troca de chave** some ao fechar o app e só aparece em Ajustes (S1);
   - **vídeos grandes podem ir decifrados para o disco** do Android, o que ainda precisa ser confirmado (S2);
   - o **microfone não desliga** ao sair da conversa (F12);
   - a foto de **ver uma vez pode ser gasta sem a pessoa ver** (N1 e S6).
3. **Fotos íntimas:** dá para trocar com muito mais segurança que no WhatsApp quanto ao servidor e ao celular roubado. Ninguém consegue impedir que quem recebe guarde a imagem. No Android o print fica bloqueado; **no iPhone, não** (seção 3.5).
4. As decisões D1–D5 foram aprovadas pelo proprietário (seção 1). "Excluir conversa" vale **só para quem exclui**, como no WhatsApp.
5. **Regra do proprietário (25/10):** o app copia as **funcionalidades** do WhatsApp; a **segurança é nossa**, guiada pelos 50 passos (`ANALISE_FORENSE_50.md`) e pelas decisões de privacidade. Quando uma função do WhatsApp fere um dos 50 passos, ela fica de fora ou é adaptada (seção 2.2).
6. **Prazo de 1 dia apaga de verdade?** Sim:
   - a mensagem some do celular e é apagada do servidor;
   - a mídia é apagada do R2 da Cloudflare no minuto do vencimento;
   - **a chave que abria a mídia deixa de existir**: ela nunca esteve no servidor, e no celular some junto com a troca da chave do banco.
   
   Ressalva: a Cloudflare guarda **30 dias de histórico** do banco do servidor. Esse histórico tem só conteúdo cifrado, que não dá mais para abrir, e metadados. Detalhes e a correção proposta na seção 3.6.
7. **Próximo passo:** liberar: CI verde, `deploy-api` (migração 0003), novo APK e PWA, e os cenários 11 a 16 de `TESTE_EM_CELULAR.md`. Todos os membros atualizam juntos (ADR 0016).

---

## 1. Decisões do proprietário

### 1.1 Aprovadas em 25/10/2026 ("siga suas recomendações")

| ID | Decisão |
|---|---|
| D1 | Busca por **qualquer trecho** do nome, sem diferenciar acento nem maiúscula, com ordem de relevância (seção 7.3). "ara" acha "Kara" e "aquele_cara" |
| D2 | **Contador de não lidas** (só no aparelho, sem recibo para ninguém) e **prévia da última mensagem** na lista, com opção "Mostrar prévia na lista" em Ajustes. Mídia de ver uma vez nunca aparece em prévia |
| D3 | Separar **"Limpar conversa"** de **"Excluir conversa"**. As duas valem **só no aparelho de quem faz**: a outra pessoa continua com tudo até vencer (regra do proprietário, igual ao WhatsApp) |
| D4 | Envio de **1 a 5 fotos** de uma vez, com ver uma vez por foto. Vem **depois** das correções A1/A2 |
| D5 | Nome e ícone disfarçados (aliases): adiado em 25/10; **aprovado em 28/10** como disfarce "Cobrinha" (seção 1.3); nome final **"Hungry Snake"** (29/10, ADR 0020) |

### 1.2 Decididas pela regra "funcionalidade do WhatsApp, segurança nossa" (25/10/2026)

D6, D7, D9 e D10 seguem o WhatsApp porque são funcionalidades. D8 e D11 são proteções nossas.

| ID | Pergunta | Decisão |
|---|---|---|
| D6 | Ver uma vez: "segurar para ver" (hoje) ou "tocar para abrir", como no WhatsApp? | **Tocar para abrir, como no WhatsApp.** Fica aberta até fechar (X ou voltar) e fecha sozinha se o app sair da tela. Segurar não impede print no iPhone e causa o bug S6 |
| D7 | Editar mensagem: sem limite (hoje) ou só nos primeiros 15 min, como no WhatsApp? | **15 minutos, como no WhatsApp** |
| D8 | Avisar quem envia que, no iPhone, print não é bloqueado? | **Sim**: um aviso fixo ao escolher "ver uma vez" ("No iPhone o app não consegue bloquear print"). Não revela quem usa iPhone |
| D9 | Fixar conversas: sem limite (hoje) ou até 3, como no WhatsApp? | **Até 3, como no WhatsApp** |
| D10 | "Marcar como não lida" na lista, como no WhatsApp? | **Sim**, só local |
| D11 | Teclado anônimo no Android (o teclado não aprende nem guarda o que é digitado no app)? | **Sim**, ligado por padrão (S5) |

### 1.3 Decididas no primeiro uso real (28/10/2026)

Relato do proprietário com o APK 1.0.105: Galeria abriu os arquivos do aparelho, pediu o PIN na volta, a foto não carregou e pareceu ir como anexo. Causas no código: o seletor é o de documentos (`ACTION_OPEN_DOCUMENT`); o app tranca antes de abrir o seletor (F17, `lockAfter` 0); depois do PIN o app vai para a lista e a foto fica esperando no cartão "Continuar com o anexo", que vence em 5 min.

| ID | Decisão |
|---|---|
| D12 | **Galeria como no WhatsApp.** Seletor de fotos do Android (Photo Picker, `ACTION_PICK_IMAGES`): grade só com fotos e vídeos, até 5, sem permissão de arquivos e sem biblioteca do Google; o seletor atual fica só para Android sem Photo Picker. Ao voltar, abre **direto na conversa**, na tela de preparar (editar, "1", HD, legenda; vídeo com normal ou ver uma vez). Foto e vídeo nunca vão como documento. Erros claros (formato não aceito, foto só na nuvem). iPhone: conferir que a Galeria abre só fotos e vídeos |
| D13 | **Opção A: sem PIN na volta do seletor aberto pelo próprio app, em até 2 minutos.** Cobertura de privacidade e bloqueio de print continuam; passou de 2 min, ou saiu do app por outro motivo, tranca como hoje. Risco aceito: quem pegar o celular nesses 2 min entra sem PIN |
| D5 | **Aprovada (antes adiada): disfarce "Cobrinha", ligado nos Ajustes por cada pessoa.** Ao abrir, um jogo da cobrinha que funciona de verdade, feito no próprio app, sem biblioteca. Entrada: **pausar o jogo e segurar 3 s no "Recorde"**, depois a senha; senha errada volta ao jogo sem mensagem e conta para o bloqueio. Ao trancar, volta ao jogo. Android: ícone e nome trocam pelo app (activity-alias), sem reinstalar; avisar que o atalho da tela inicial pode sumir. O **nome fixo do app no sistema** (Configurações → Apps, topo das notificações) passa a ser **"Cobrinha" para todos**. *(29/10: o nome ficou "Hungry Snake", de um estúdio fictício, Little Fern Games; a porta abre "Código de contribuidor"; 4 erros pausam o Recorde por 30 min e o 5º continua apagando; a tela do código tem seta para voltar ao jogo. O pacote visível é `com.pactotalk.app`. Ver ADR 0020.)* Notificações disfarçadas. iPhone: ícone e nome só mudam removendo e adicionando de novo à Tela de Início (a confirmar em iPhone). O pacote interno (`com.mensageiro.privado`) e as permissões continuam visíveis em Configurações: o disfarce engana uma olhada, não uma perícia |
| D14 | **Prévia na lista obrigatória para todos.** Sai a opção "Mostrar prévia na lista". Ver uma vez continua sem prévia |
| D15 | **Sem notificações**, no Android e no iPhone. Sai a seção "Notificações" dos Ajustes e o registro de Web Push; o código de push do servidor deixa de ser usado |
| D16 | **Sai o guardião.** Perdeu o celular: no celular novo, "Perdi meu celular" → a pessoa digita o PIN → a administradora aprova lendo o código do celular novo (pessoalmente ou por chamada de vídeo) → todos veem o aviso de troca de chave. O celular antigo é desligado da conta na hora. As conversas antigas não voltam (as chaves ficaram no celular perdido). A confirmar com o proprietário: manter ou não a espera de 24 h. Ressalva técnica: o PIN conferido pelo servidor precisa de um verificador próprio, com limite de tentativas, separado do cofre do aparelho |
| — | **Pessoas do círculo:** como hoje, só a administradora vê o painel de pessoas, confirma, congela e remove. Os outros membros veem só os contatos para conversar |

Achado ao revisar (28/10): o guardião que não é a administradora **não tem botão** para autorizar a recuperação (a opção só existe no painel da administradora). Recuperação só funcionava quando a própria administradora era o guardião. D16 elimina o problema.

### 1.4 Pedidos do proprietário em 28/10/2026 (fase de projeto)

| ID | Pedido | Situação no código |
|---|---|---|
| P1 | Desbloqueio demora para carregar | Depois do PIN, tudo roda em fila: Argon2id (64 MiB, na linha principal), parte do servidor, banco, login, diretório e sincronização, e só então a lista aparece. Pesquisar e medir (entrega E3) |
| P2 | Borracha no editor de foto | Não existe: hoje só desenhar, girar e cortar |
| P3 | Câmera sem opção de ver uma vez | A opção existe, mas é um botão "1" pequeno no meio de outros botões de texto. Colocar o ① ao lado da legenda, como no WhatsApp |
| P4 | Ícones de Galeria e Documento são riscos estranhos | São os caracteres ▧ e ▤. Trocar por ícones desenhados (SVG próprio, sem biblioteca) |
| P5 | Menos texto, mais minimalista | Ajustes tem parágrafos em quase todas as seções. Sai "Fotos íntimas"; explicações viram uma linha ou um "?" |
| P6 | Nova interface com animações | Proposta visual de 28/10 (lista, conversa com anexar, preparar foto com borracha e ①, ajustes) |

---

## 2. Regra: funcionalidades do WhatsApp, segurança nossa

**Princípio (proprietário, 25/10/2026):**
- **Funcionalidades:** copiar o WhatsApp, inclusive nomes dos botões, gestos, ordem, onde fica cada ação e o que acontece.
- **Segurança:** é própria, guiada pelos 50 passos de `ANALISE_FORENSE_50.md` e pelas decisões de privacidade (especificação v7, ADRs, este documento).
- **Conflito:** quando uma função do WhatsApp fere um dos 50 passos, ela é **adaptada** (mesmo jeito de usar, proteção nossa) ou **fica de fora**, com o passo citado.

### 2.1 Lista de conversas e ações gerais

| Recurso | WhatsApp | Pacto Talk (plano) | Igual? |
|---|---|---|---|
| Lista ordenada pela última mensagem (grupos e individuais) | Sim | Já é assim (`chats.js:37`) | Igual |
| Fixar no topo | Até 3 | Até 3 (D9) | Igual |
| Arquivar | Fica arquivada mesmo com mensagem nova | Já é assim | Igual |
| Contador de não lidas (cinza se silenciada) | Sim | D2 | Igual |
| Marcar como não lida | Sim | D10 | Igual |
| Prévia na lista ("Você:", nome de quem mandou no grupo, "📷 Foto") | Sim | D2, com opção de desligar | Igual + opção extra |
| Busca de pessoas | Pelo começo das palavras | Por qualquer trecho (D1, pedido do proprietário) | Mais ampla |
| **Limpar conversa** | Apaga as mensagens só no seu aparelho; a conversa fica na lista | Igual (D3) | Igual |
| **Excluir conversa** | Some da lista só para você; o outro mantém tudo; reaparece se chegar mensagem nova | Igual (D3, seção 6) | Igual |
| Excluir grupo | Primeiro sair do grupo, depois excluir | Igual (seção 6) | Igual |
| Apagar para mim | Sim | Já existe | Igual |
| Apagar para todos | Só nas primeiras ~48 h; deixa "Mensagem apagada" | Até a mensagem vencer (máx. 15 dias), **sem deixar rastro** | **Diferente de propósito**: apagar mais é melhor para a privacidade; o rastro guardaria id e hora (ADR 0012) |
| Editar | Só nos primeiros 15 min | 15 min (D7) | Igual |
| Ver uma vez | Toca, abre, fecha; não dá print; vence em 14 dias se não abrir | Tocar para abrir (D6). Vence com o prazo da conversa (12 h a 15 dias). Print bloqueado só no Android | Igual no uso; limite real no iPhone |
| Status "aberta" do ver uma vez para quem enviou | Sim | **Não** (sem recibos, V6-022) | **Diferente de propósito** |
| Confirmação de leitura, "online", "digitando" | Sim | **Não** (V6-022) | **Diferente de propósito** |
| Encaminhar, salvar na galeria, compartilhar | Sim | **Não** (nada sai do app) | **Diferente de propósito** |
| Mensagens temporárias | Opcional | **Sempre**, 12 h a 15 dias | **Diferente de propósito** |
| Notificação com o app fechado | Sim | iPhone: aviso vazio. Android: **não** (sem Google, decisão de 24/10) | **Diferente de propósito** |
| Várias fotos de uma vez | Muitas | Até 5 (D4) | Limite próprio |

As referências do WhatsApp estão na seção 10. Antes de implementar cada item, conferir o comportamento atual no próprio WhatsApp: ele muda com o tempo. As páginas oficiais de ajuda não abriram nesta pesquisa, então os números acima (48 h, 15 min, 3 fixadas, 14 dias) vêm de fontes secundárias e precisam dessa conferência.

### 2.2 Funcionalidades dentro da conversa

Inventário do que existe hoje (`chat.js`, `room-menu.js`, `editor.js`, `audio.js`, `viewer.js`) comparado com o WhatsApp. "Passo n" é o item de `ANALISE_FORENSE_50.md` que decide a adaptação.

**a) Já existe e funciona como no WhatsApp**

| Função | Pacto Talk hoje | Ajuste para ficar igual |
|---|---|---|
| Texto, emojis | Sim, com painel próprio de emojis | — |
| Responder (citação) | Sim | Tocar na citação deve levar à mensagem original (falta) |
| Reações | Sim, os mesmos 6 do WhatsApp (👍 ❤️ 😂 😮 😢 🙏) | Abrir pela barra que aparece ao segurar a mensagem (item b.1) |
| Editar ("editada") | Sim, sem limite | Limitar a 15 min (D7) |
| Apagar para mim / para todos | Sim | Para todos: até vencer, sem "Mensagem apagada" (diferença de segurança, seção 2.1) |
| Buscar na conversa | Sim | — |
| Rascunho guardado | Sim (cifrado) | — |
| Foto e vídeo com legenda | Sim (vídeo até 5 min) | Lote de até 5 fotos (D4) |
| Ver uma vez (foto e vídeo) | Sim, "segurar para ver" | Tocar para abrir (D6) |
| Editor de foto | Girar, cortar, desenhar, texto, cores | Desenho não pode sumir ao cortar (seção 5.2) |
| Áudio | Até 1 h, velocidades 1×, 1,5× e 2× | Gravação no estilo WhatsApp (item b.6) |
| Documento | Texto e PDF dentro do app | — |
| Silenciar | 1 h, 8 h, 24 h, 7 dias, até reativar | Já cobre as opções do WhatsApp (8 h, 1 semana, sempre) |
| Fixar, arquivar | Sim | Até 3 fixadas (D9) |
| Grupo: nome, foto, fundo, adicionar, remover, sair, encerrar | Sim | Excluir grupo depois de sair (seção 6) |
| Admin do grupo | Uma líder, que pode ceder (V7-004/005) | Mantido: regra de segurança dos membros confirmados |
| Mensagens temporárias | Sempre ligadas, 12 h a 15 dias | Diferença de segurança (passo 9) |
| Status | Stories para quem a pessoa escolher | Sem lista de "quem viu" (V6-022) |
| Perfil | Apelido, foto e recado | — |

**b) Falta e vamos copiar** (com a proteção nossa ao lado)

| # | Função do WhatsApp | Como fica no Pacto Talk | Proteção | Entrega |
|---|---|---|---|---|
| 1 | Segurar a mensagem: barra de reações em cima + menu (Responder, Reagir, Editar, Fixar, Favoritar, Apagar, Selecionar) | Igual | — | B |
| 2 | Deslizar a mensagem para o lado para responder | Igual | — | B |
| 3 | Selecionar várias mensagens (apagar para mim/todos de uma vez) | Igual | — | B |
| 4 | Separador de data ("Hoje", "Ontem", data) e faixa "N mensagens não lidas" | Igual | Só local | B |
| 5 | Botão "↓" com o número de não lidas para descer ao fim | Igual (resolve N1 junto) | — | A1/B |
| 6 | Áudio: **segurar o microfone** para gravar, **deslizar para cancelar**, **cadeado** para gravar sem segurar, pausar, **ouvir antes de enviar**, onda sonora | Igual | Cancelar solta o microfone na hora (F12); nada vai para arquivo | A1 (cancelamento) + B (gestos) |
| 7 | Áudio de **ver uma vez** | Igual | Mesmo consumo único no servidor | C |
| 8 | Estado de envio: relógio (enviando) → ✓ (enviada) e "toque para reenviar" se falhar | Igual até o ✓ simples | **Sem ✓✓ de entregue e sem azul de lida** (V6-022) | B (com F10) |
| 9 | Formatação: \*negrito\*, \_itálico\_, \~tachado\~, \`\`\`mono\`\`\`, lista e citação | Igual | Mostrado como texto formatado, nunca como HTML | B |
| 10 | **@menção** no grupo | Igual | Só destaca na tela; sem aviso extra fora do app | B |
| 11 | **Fixar mensagem** na conversa (até 3) | Igual, por quanto tempo escolher, sem passar do prazo da mensagem | Anúncio cifrado; some quando a mensagem vence | C |
| 12 | **Favoritar** mensagem (estrela) e lista de favoritas | Igual | Só no aparelho; **a favorita vence junto** (passo 9) | C |
| 13 | **Mídia e documentos da conversa** (galeria da conversa) | Igual | Miniatura só na memória, nunca em arquivo (passo 22); ver uma vez não aparece | C |
| 14 | **Busca em todas as conversas** (mensagens) | Igual | Só no aparelho, no banco cifrado | C |
| 15 | **Responder em particular** (de um grupo para o 1:1) | Igual | — | C |
| 16 | **Descrição do grupo** | Igual | Cifrada, como o nome do grupo | C |
| 17 | **Papel de parede** em conversa individual | Igual | Só no aparelho, cifrado | C |
| 18 | **Enquete** | Igual | Votos cifrados, só para quem está no grupo | D |
| 19 | **Vídeo redondo** (recado em vídeo) | Igual | Câmera do app (passo 20) | D |
| 20 | **Conversa comigo mesmo** (anotações) | Igual | Também vence (passo 9) | D |
| 21 | Foto em **HD** | Opção HD com limite maior | Sempre recodificada, sem EXIF | D |

**c) Adaptadas: mesmo jeito de usar, proteção nossa**

| Função do WhatsApp | Adaptação | Por quê |
|---|---|---|
| Copiar mensagem | **Não copia mensagem recebida** (hoje bloqueado no CSS). Copiar a própria mensagem: avaliar | Passo 47 |
| Links clicáveis com prévia | Link aparece como texto. **Sem prévia** e sem abrir sozinho; se um dia abrir, só com confirmação "Abrir fora do app?" | Buscar a prévia revela o IP e cria miniatura (passos 22 e 36) |
| Dados da mensagem (lida/entregue por pessoa) | Mostra só "Enviada às … · Some em …" (já aparece no menu) | V6-022 |
| Ver uma vez | Tocar para abrir (D6), print bloqueado no Android, aviso no iPhone (D8) | Passo 33 |
| Notificação | Android: nenhuma; iPhone: "novas mensagens" | Passo 25 e decisão de 24/10 |

**d) Ficam de fora** (ferem os 50 passos ou a especificação)

| Função do WhatsApp | Motivo |
|---|---|
| Encaminhar, compartilhar, salvar na galeria, exportar conversa | Passos 40 e 47 (nada sai do app) |
| Backup na nuvem | Passos 26 e 27 |
| WhatsApp Web / computador / segundo aparelho | Passos 29 e 48 (um aparelho por pessoa) |
| Confirmação de leitura, online, visto por último, digitando, "quem viu" o status | V6-022 e passo 34 |
| GIFs e figurinhas de bibliotecas externas | Buscar em serviço externo revela o que se procura; arquivos de fora não passam pela recodificação (V7-016). Figurinha feita no app a partir de foto própria: talvez depois |
| Localização (atual ou em tempo real) | Dado sensível; fora do escopo (passos 24 e 41) |
| Contato (cartão) | O app não usa telefone nem e-mail |
| Chamadas de voz e vídeo | Fora do escopo agora: exigem servidor de mídia e expõem o IP entre as pessoas. Decisão futura, com ADR |
| Comunidades e listas de transmissão | Círculo de no máximo 10 pessoas |
| "Mensagem apagada" no lugar da apagada | ADR 0012: não deixar rastro |

---

## 3. Pesquisa de privacidade e criptografia

### 3.1 O que foi lido

Núcleo do cliente (`packages/client/src/client.js`, `media-crypto.js`, `api.js`), protocolo (`envelope.js`, `room.js`, `ttl.js`), criptografia (`packages/crypto`: vodozemac 0.11.1 + Argon2id em WASM), cofre (`app/src/vault/*`), banco local (`app/src/db/*`), câmera e preparo de mídia (`camera.js`, `media.js`, `pick-image.js`, `video-prep.js`), visualizadores (`viewer.js`), sessão e bloqueio (`session.js`, `main.js`), servidor (`index.js`, `circle.js`, `room.js`, `media.js`, `wrangler.toml`) e `MainActivity.java`. Comparado com a especificação v7 (V7-014, §3, §15, §25) e os ADRs 0002, 0005, 0010, 0012 e 0014.

Também pesquisei: avisos de segurança do vodozemac (nenhum encontrado para 2025–2026; conferir de novo no [RustSec](https://rustsec.org) antes de cada versão), o armazenamento de blobs do Chromium (S2) e o comportamento do WhatsApp.

### 3.2 O que está como planejado

| Proteção | Como está | Resultado |
|---|---|---|
| Mensagens cifradas de ponta a ponta | Olm (vodozemac), uma sessão por pessoa. O servidor só repassa envelopes | Conforme |
| Mensagem falsificada | Remetente, conversa e id dentro da cifra precisam bater com o que o servidor autenticou; senão é recusada e vira aviso | Conforme |
| Tamanho do texto | Preenchido em degraus (256 B a 64 KB): o servidor não sabe o tamanho real | Conforme |
| Foto, vídeo, áudio e documento | Chave AES-256 nova por arquivo, cifra em blocos com proteção contra corte e troca de ordem. A chave vai só dentro do envelope de cada destinatário | Conforme |
| Ver uma vez | Consumo atômico no servidor, um por destinatário. Quem enviou não reabre (a chave some do aparelho dele). A chave de quem recebe some depois da abertura e o banco é refeito | Conforme (bugs de tela em N1/S6) |
| Membros de grupo | Confirmados por anúncio cifrado da líder; o servidor não consegue enfiar um "membro fantasma" num grupo ou conversa | Conforme |
| Prazo | Quem recebe limita o prazo ao que quem enviou pediu (o servidor não estica) | Conforme |
| Celular roubado: abrir o app | Chave do banco = Face ID/digital + PIN (Argon2id) + parte do servidor. 5 erros apagam a parte do servidor. Há PIN de coação, código de emergência e prazo de inatividade | Conforme |
| Celular roubado: copiar os arquivos | Banco SQLite com cada registro cifrado, índices cegos, preenchimento e troca de chave a cada exclusão ("os dados morrem") | Conforme |
| Foto sem GPS e sem dados do aparelho | Câmera do app e galeria são sempre recodificadas (sem EXIF). A câmera não grava nada na galeria | Conforme |
| Print e gravação no Android | `FLAG_SECURE` em todas as telas, sem prévia nos recentes, sem backup, sem depuração | Conforme (emulador; falta celular) |
| Logs no servidor | Observabilidade desligada (`wrangler.toml`), sem telemetria | Conforme |
| Notificação | iPhone: aviso vazio, sem nome nem texto. Android: nenhuma | Conforme |
| Número de segurança | Existe em Ajustes e no menu da conversa | Parcial (S1, S8) |

### 3.3 Lacunas encontradas

| ID | Gravidade | Evidência | Problema | Correção proposta |
|---|---|---|---|---|
| **S1** | **Alta** | Verificado no código | **O aviso de troca de chave é fraco.** Fica só na memória (`client.warnings`): some ao fechar o app e aparece só em Ajustes, não na conversa. O envio continua automático para a chave nova. Assim, um servidor invadido ou alguém com o código de instalação poderia trocar a chave de uma pessoa e o aviso passaria despercebido. Isso contraria a especificação ("nenhuma troca silenciosa de chave pública pelo servidor", §6) e é a ameaça nº 1 da V7-014 | Guardar os avisos cifrados no banco. Mostrar **na própria conversa**, como o WhatsApp ("O código de segurança de Fulano mudou"). Criar o estado **"verificado"** (seção S8). Se um contato verificado trocar de chave, **pausar o envio** de mídia e de ver uma vez até a pessoa conferir de novo ou aceitar explicitamente |
| **S2** | **Alta (a validar)** | Documentação do Chromium | **Vídeo e áudio grandes podem ir decifrados para o disco.** O Chromium guarda blobs na memória até cerca de 1% da RAM no Android (~40–120 MB); acima disso, **escreve em arquivo**. O app cria um blob com o vídeo decifrado inteiro para tocar (até 95 MB), e a gravação da câmera e a compressão também geram blobs grandes. Esse arquivo fica na pasta do app (protegida pela cifra do Android), mas sai da proteção do app e pode sobrar no armazenamento | **Testar primeiro**: no APK de depuração, tocar um vídeo de 90 MB e procurar arquivos na pasta de blobs do WebView. Se confirmar: tocar em pedaços decifrados na memória (Media Source), sem um blob único, e apagar os pedaços ao fechar |
| **S3** | Média | Verificado no código | **A lista de membros do círculo não é confirmada de ponta a ponta.** Nos grupos a líder confirma quem está; no círculo, o app confia no servidor. Um servidor invadido poderia incluir alguém que receberia os apelidos, as fotos de perfil e as stories em que essa pessoa fosse escolhida. Ninguém veria aviso "Fulano entrou" | A administradora assina a lista do círculo (como a líder faz nos grupos). Mostrar "Fulano entrou / saiu / trocou de aparelho" numa linha do tempo de segurança |
| **S4** | Média | Limite do sistema | **No iPhone não dá para bloquear print nem gravação de tela**, e quem enviou não fica sabendo. Já está documentado (§25), mas o app não avisa na hora de enviar | Aviso fixo ao escolher ver uma vez (D8). Texto honesto também em Ajustes → Privacidade |
| **S5** | Média | Verificado no código | **O teclado aprende o que se digita.** Gboard e outros teclados guardam palavras e podem sincronizá-las; teclados de terceiros podem enviar o que foi digitado para fora | Android: pedir ao sistema "não aprender" (`IME_FLAG_NO_PERSONALIZED_LEARNING`) com ajuste no `MainActivity`, como o "teclado anônimo" do Signal (D11). iPhone: não há como; avisar para usar o teclado da Apple |
| **S6** | Média | Verificado no código | **Ver uma vez gasto sem ver.** O direito é consumido no servidor assim que o dedo encosta. Se a pessoa solta antes de a foto baixar, ou se a internet cai no meio, a foto some sem ter sido vista | D6 (tocar para abrir). Mostrar "Abrindo…" até terminar. Consumir e mostrar no mesmo passo. Se a conexão cair no meio, avisar claramente |
| S7 | Baixa | Verificado no código | O servidor vê o **tamanho exato** de cada foto, vídeo e áudio. Isso permite distinguir foto de vídeo e estimar a duração | Arredondar o tamanho cifrado em degraus (por exemplo, múltiplos de 256 KB) |
| S8 | Baixa | Verificado no código | O número de segurança é **de uma pessoa só**: cada um compara o seu. Não há QR nem marca "verificado" | QR de verificação presencial com o número das duas pessoas (como o WhatsApp) e marca "Verificado" na conversa. Faz parte de S1 |
| S9 | Baixa | Verificado no código | **PIN de 6 dígitos no iPhone:** quem tiver **ao mesmo tempo** o servidor e uma cópia do celular pode testar o milhão de PINs fora do app. No Android, falta ainda o segredo do Keystore (hardware), o que torna isso muito mais difícil | Recomendar, em Ajustes, PIN de 8 ou mais dígitos ou frase-senha para quem troca conteúdo sensível |
| S10 | Baixa | Verificado no código | Copiar mensagem recebida já está bloqueado (`user-select: none`, passo 47). O que a própria pessoa digita ou cola passa pela área de transferência e pelo teclado do sistema | Coberto por S5. Se um dia "copiar a própria mensagem" entrar (seção 2.2 c), marcar o conteúdo como sensível no Android |
| S11 | Baixa (a validar) | Plataforma | No iPhone, a cobertura de privacidade é aplicada quando o app sai da tela. É preciso confirmar que a miniatura do seletor de apps não captura a conversa antes disso | Incluir no roteiro de teste do iPhone |
| **S12** | Média | Documentação da Cloudflare | **A "parte do servidor" destruída volta por 30 dias.** O D1 (Time Travel) e o SQLite dos Durable Objects (recuperação no tempo) guardam 30 dias de histórico. Quem controla a conta da Cloudflare, ou a própria Cloudflare por ordem judicial, pode restaurar uma parte S apagada por 5 erros, coação, emergência ou prazo. Restaurar S tira o limite de 5 tentativas; ainda faltam o PIN e a passkey/Keystore. Já aparece como "limite honesto" em `ANALISE_FORENSE_50.md`, mas tem correção | **Destruição por chave ("crypto-shredding")**: guardar S cifrada por uma chave própria de cada cofre, mantida num objeto do **R2**, que não oferece versionamento. Destruir = apagar o objeto do R2. O histórico de 30 dias passa a ter só S cifrada por uma chave que não existe mais. Confirmar antes, na documentação do R2, que objeto apagado não é recuperável |
| S13 | Baixa | Verificado nos testes | Falta teste automático de que a **mídia vencida é apagada do R2** pelo alarme (o teste de vencimento só cobre os envelopes de texto) | Teste: enviar mídia com prazo curto, avançar o alarme e conferir que o objeto saiu do R2, o Durable Object está vazio e abrir devolve "expirada" |

**Conferido e sem problema:** as chaves de uso único do Olm não são assinadas, mas um servidor que troque essas chaves só quebra a conversa, sem conseguir ler (o acordo também usa a chave de identidade). Para o PIN de coação, o código de emergência e a recuperação da administradora, confirmei que a recuperação aparece para os outros como troca de chave. Esse aviso depende de S1.

### 3.4 O app faz o que promete?

| Promessa | Situação |
|---|---|
| O servidor não lê mensagens, fotos, vídeos, áudios e documentos | **Sim** |
| Nenhuma troca de chave passa em silêncio | **Parcial**: S1 |
| Ver uma vez abre uma única vez | **Sim** no servidor; na tela: N1 e S6 |
| Quem enviou não reabre o ver uma vez | **Sim** |
| Print bloqueado | **Android: sim** (exceto celular com root ou outra câmera filmando a tela). **iPhone: não** (limite do sistema, S4) |
| Os dados morrem (somem no prazo e não sobram) | **Sim**: celular, D1 e R2 apagam no prazo e a chave da mídia é destruída (seção 3.6). Ressalvas: S2 a confirmar e o histórico de 30 dias da Cloudflare (S12) |
| Fotos sem localização nem dados do aparelho | **Sim** |
| Apagar para todos | **Texto: sim. Mídia: parcial**: a revogação pode falhar em silêncio (F04) |
| Desfazer vínculo revoga o que estava pendente | **Não ainda** (F05) |
| Sair da conversa desliga câmera e microfone | **Câmera: sim. Microfone: não** (F12) |
| Nada aparece depois de trancar | **Não sempre** (F06) |
| Sem metadados | **Nunca foi prometido.** O servidor vê quem fala com quem, quando, e o tamanho das mídias (S7). Limite documentado |

### 3.5 Os membros podem trocar fotos íntimas sem medo?

**Resposta honesta:** sem medo do **servidor**, de **hackers** e de **quem pegar o celular**, sim, quando as correções S1, F12, F06, N1/S6 e o teste de S2 estiverem feitos. Do **destinatário**, nenhum aplicativo protege: quem recebe pode filmar a tela com outro celular, e no iPhone pode dar print.

| Risco | Proteção atual |
|---|---|
| Cloudflare, servidor invadido ou alguém da hospedagem ver a foto | Protegido: não há chave no servidor |
| Servidor invadido trocar a chave de alguém para interceptar as próximas fotos | **Fraco hoje** (S1). Com S1 e a verificação presencial, protegido |
| Celular roubado ou apreendido | Protegido: PIN + biometria + parte do servidor, 5 tentativas, PIN de coação, código de emergência |
| Foto ficar na galeria ou na nuvem (Google Fotos, iCloud) | Protegido **se tirada pela câmera do app** (modo máximo). Foto escolhida da galeria continua na galeria |
| Localização na foto | Protegido: sempre removida |
| Destinatário no Android dar print | Bloqueado (`FLAG_SECURE`) |
| Destinatário no iPhone dar print ou gravar a tela | **Não bloqueável.** Quem enviou não fica sabendo |
| Destinatário com app modificado ou celular com root | Não protegido: pode guardar tudo (vale para qualquer app, inclusive o WhatsApp) |
| Outra câmera filmando a tela | Não protegido (vale para qualquer app) |

**Recomendações para quem for trocar conteúdo íntimo** (para colocar em Ajustes → Privacidade, depois de S1):
1. Conferir o número de segurança **pessoalmente** uma vez com a pessoa.
2. Usar a **câmera do app** (nunca a galeria) e **ver uma vez**.
3. Usar o **prazo mais curto** na conversa (12 h).
4. Usar PIN de 8 ou mais dígitos.
5. Lembrar que **no iPhone o print não é bloqueado**.
6. Mandar só para quem você confia: a tecnologia protege o caminho, não a pessoa do outro lado.

### 3.6 Prazo de 1 dia: o que é apagado de verdade

Conferido no código: `server/src/index.js` (`scheduled`), `server/src/media.js` (`alarm`, `purge`), `server/src/room.js`, `server/migrations/0001_init.sql`, `deploy-api.yml` (regra do R2), `packages/client/src/client.js`, `app/src/db/db-worker.js` e `app/src/session.js`.

**Como o prazo funciona:**
- Cada conversa tem **dois prazos**: um para mensagens e outro para mídia (menu ⋮ → "Prazos de mensagens e mídia"). Quem muda é a líder (no 1:1, quem iniciou).
- **O prazo novo vale só para o que for enviado depois**, como o app avisa: mensagens antigas mantêm o prazo com que foram enviadas.
- A contagem começa quando o **servidor** aceita a mensagem. O relógio do celular não conta.
- Stories têm prazo próprio (24 h por padrão).

**Linha do tempo de uma foto enviada com prazo de 1 dia:**

| Quando | Onde | O que acontece | Chave |
|---|---|---|---|
| Envio | Celular de quem envia | A foto é cifrada com uma **chave nova só dela** (AES-256). A chave vai dentro do envelope Olm de cada destinatário | Nunca vai ao servidor |
| Envio | Cloudflare | **R2**: a foto cifrada. **Durable Object da mídia**: quem pode abrir e o prazo, com **alarme marcado para o vencimento**. **D1**: um envelope por destinatário e o registro mínimo (conversa, id, remetente, horários) | O servidor nunca recebe a chave |
| Destinatário sincroniza | Cloudflare | O envelope do destinatário é **apagado do D1 na hora** (confirmação), sem esperar o prazo | — |
| Destinatário sincroniza | Celular de quem recebe | A mensagem fica no banco cifrado. O Olm descarta a chave daquele envelope depois de decifrar (sigilo futuro) | A chave da foto fica só dentro do banco cifrado |
| **24 h depois** | Tela | Some na hora: o app compara com o horário do servidor antes de mostrar | — |
| **24 h depois** | Celulares | É apagada do banco na próxima sincronização e, **15 s depois, o banco é refeito num arquivo novo com chave nova**; o arquivo antigo é removido (`secure_delete`). O mesmo acontece ao trancar e a cada 24 h | **A chave da foto deixa de existir**: só estava no registro apagado, e o arquivo antigo estava cifrado com uma chave do banco que também foi destruída |
| **24 h depois** | R2 | O **alarme apaga o objeto do R2** e todo o Durable Object da mídia. Se alguém tentar abrir, recebe "expirada". Rede de segurança: regra do R2 apaga qualquer objeto com mais de 16 dias | — |
| Até 15 min depois | D1 | A limpeza a cada 15 min apaga envelopes não entregues, o registro da mensagem, marcas de apagado e a reserva de cota | — |

**Resposta: sim, apaga de verdade, e a chave é destruída.** A chave que abre a foto nunca esteve na Cloudflare. Nos celulares, ela some quando o banco é refeito com chave nova. Mesmo que alguém tenha copiado o arquivo do banco antes, a chave desse arquivo já não existe.

**Ressalvas honestas:**
1. **Histórico de 30 dias da Cloudflare.** O D1 e os Durable Objects guardam 30 dias de histórico, que podem ser restaurados por quem controla a conta ou pela Cloudflare por ordem judicial.
   - O que daria para restaurar: envelopes **cifrados** e metadados (quem mandou para quem e quando).
   - O conteúdo continua ilegível, porque as chaves que o abririam já foram destruídas nos celulares.
   - Única exceção teórica: um envelope **nunca entregue** cujo destinatário ainda tem o celular. A sessão Olm dele ainda poderia abrir esse envelope, mas exigiria também desbloquear o app dessa pessoa (PIN + biometria + servidor).
   - O R2 não oferece versionamento: o objeto apagado da foto não fica guardado por lá (confirmar na documentação antes de prometer). E mesmo restaurado, seria cifrado sem chave.
2. **Celular desligado ou app fechado.** O registro vencido continua no banco cifrado até a próxima abertura do app. Ninguém consegue ler sem PIN + biometria + parte do servidor, e o interruptor de inatividade destrói a parte do servidor depois do prazo escolhido.
3. **Cliente modificado ou print.** Quem recebeu e guardou por fora (print no iPhone, outra câmera, app adulterado) não perde o que guardou. Vale para qualquer app.
4. **Fotos de perfil e de grupo** não têm prazo. Valem até serem trocadas ou removidas, e só a versão atual existe.
5. **A "parte do servidor" do cofre** é um caso diferente (S12). Ela pode ser restaurada do histórico de 30 dias; a correção proposta é a destruição por chave no R2.

**O que falta para fechar:** S12 (destruição por chave da parte do servidor), S13 (teste automático do alarme da mídia) e um teste no celular: mandar foto com prazo de 12 h e, depois de vencer, conferir que a mensagem sumiu nos dois aparelhos e o objeto sumiu do R2.

---

## 4. Achados de funcionamento (consolidado GPT + Claude)

Gravidade final, depois da conferência no código.

| ID | Gravidade | Evidência | Problema | Correção |
|---|---|---|---|---|
| **F12** | **Crítica** | Reproduzido (R06) e verificado | Ao sair da conversa ou trancar o app, **a gravação de áudio não é cancelada**: o microfone pode continuar ligado. Se o gravador falha depois de pegar o microfone, ele também não é solto | Cancelar e soltar o microfone na saída, no bloqueio e em erros, inclusive em início tardio |
| **F06** | **Alta** | Reproduzido (R05) e verificado | Foto, vídeo, **áudio, texto e PDF** que terminam de baixar depois que o app trancou ou saiu da conversa **abrem ou tocam assim mesmo** | Cancelar ao trancar; antes de mostrar, conferir sessão, foco e conversa atuais |
| **N1** | **Alta** | Verificado no código | A conversa é redesenhada a cada 30 s e a cada sincronização e **pula para o fim**. Também pode trocar o botão de ver uma vez no meio do uso e gastar a única visualização | Atualizar só o que mudou; rolar só se a pessoa já estava no fim; nunca mexer num ver uma vez aberto |
| **F17** | **Alta** | Verificado; confirmar no aparelho | Abrir o seletor de arquivos tira o app da tela; com bloqueio imediato (padrão), o app tranca. **Documento e foto da galeria podem não funcionar no APK** | Retorno autenticado do seletor, sem desligar o bloqueio geral |
| **F14** | Alta (a validar) | Verificado no código | O banco local não tem fila: uma escrita pode se misturar com a troca de chave do banco | Fila única no worker do banco + testes de escrita durante a troca |
| **F01** | Alta | Verificado no código | **Cada toque numa pessoa cria outra conversa** com ela (o servidor sempre gera id novo). A pessoa aparece repetida na lista | Uma conversa ativa por dupla, criada de forma atômica, com repetição segura |
| F02 | Alta | Verificado | "Apagar conversa" limpa, mas a conversa fica na lista | D3 (seção 6) |
| F05 | Alta | Verificado | Desfazer vínculo não revoga as mídias pendentes, ao contrário de sair ou remover do grupo | Revogar no encerramento, como diz a V7-008 |
| F04 | Média | Verificado | "Apagar para todos" de mídia chama a revogação, mas ignora falha (`.catch(() => {})`) e a mensagem some mesmo assim | O servidor revoga a mídia na própria exclusão; nunca falhar em silêncio |
| F16 | Média | Verificado | O documento é publicado antes de contar na cota (3 documentos); se essa etapa falhar, fica fora da cota | Cota dentro da publicação, com limpeza que pode ser repetida |
| F03 | Média | Verificado | Nome, foto e fundo do grupo ficam no aparelho depois de limpar | Limpar junto com "Excluir" (seção 6) |
| F07 | Média | Verificado | O visualizador aberto não fecha quando a mensagem vence ou é apagada | Ligar o visualizador ao prazo e à exclusão |
| F08 | Média | Reproduzido (R02) | A edição é salva no aparelho mesmo se o envio falhar | Estado "edição pendente" e desfazer se falhar |
| F09 | Média | Reproduzido (R01) | Edição e reação não conferem se o alvo é da mesma conversa; a reação não confere se quem reage é membro | Conferir conversa, autor, membro e prazo antes de aplicar |
| F10 | Média | Reproduzido (R03) | Reenviar depois de resposta perdida duplica a mensagem | Id reaproveitado em nova tentativa (essencial para o lote de 5) |
| F11 | Média | Reproduzido (R04) | Upload que deu certo fica órfão se a publicação falhar | Limpeza que pode ser repetida |
| F13 | Média | Verificado | "Atualizar" pelo menu cria outro timer e outro observador a cada uso | Passar pelo roteador |
| F15 | Média | Plausível | 5 fotos grandes ou PDF longo podem estourar a memória | Orçamento de memória; PDF página por página |
| F18 | Baixa | Plausível | A caixa de texto continua aparecendo se a conversa foi encerrada pelo outro lado | Atualizar o estado da conversa na sincronização |
| N2 | Baixa | Verificado | Pessoa removida continua aparecendo na busca | Filtrar pelos membros ativos |
| N3 | Baixa | Verificado | Cancelar a recuperação da administradora e tentar de novo reabre o banco sem fechar o anterior | Voltar à tela inicial ao cancelar |

Notas da conferência: no F04, o GPT dizia que não havia revogação; ela existe, mas é silenciosa. O F09 baixou de Alta para Média, porque exige o id aleatório da mensagem, que só circula entre membros. O F12 e o F17 eram mais graves do que o indicado.

---

## 5. Envio de 1 a 5 fotos (D4)

### 5.1 Fluxo

1. Tocar em anexar e escolher Câmera, Galeria ou Documento, como no WhatsApp.
2. Selecionar de 1 a 5 fotos na galeria, ou tirar uma e adicionar outras pela câmera até 5.
3. A tela de preparo mostra a foto grande e uma faixa de miniaturas numeradas com contador ("3/5").
4. Tocar numa miniatura para editar aquela foto e escolher o modo dela.
5. Remover, trocar, adicionar e reordenar, sempre com no máximo 5. A sexta foto não é descartada em silêncio: o app avisa o limite.
6. Nada sobe antes de tocar em "Enviar" (o texto mostra a quantidade).

Cada foto tem um identificador próprio durante o preparo: remover a foto 2 não passa a edição, a legenda ou o ver uma vez dela para a seguinte. Vídeo continua um por vez.

### 5.2 Edição individual

Cada foto guarda seu recorte, rotação, desenho, texto, desfazer e legenda. Voltar a uma miniatura mantém a edição. Hoje o editor apaga o desenho quando a pessoa recorta ou gira; na versão nova, isso tem de ser resolvido ajustando o desenho ou com um aviso que permita desfazer, nunca apagando em silêncio.

### 5.3 Ver uma vez por foto

O botão "1" num círculo pontilhado (igual ao WhatsApp) vale **só para a foto selecionada**. Qualquer combinação é permitida: nenhuma, uma, várias ou todas as 5. O modo começa **desligado** a cada nova seleção. Atalhos "Todas de ver uma vez" e "Todas comuns" podem existir, mostrando quando há estado misto.

Ver uma vez não tem legenda. Se a foto já tem legenda, o app explica e deixa cancelar; nunca apaga nem envia o texto em silêncio. Texto desenhado sobre a imagem faz parte da imagem protegida. Ao ligar o modo, aparece o aviso do iPhone (D8).

### 5.4 Recebimento

Cada foto tem chave, prazo, exclusão e abertura próprios: abrir a 2 não gasta a 3. Fotos comuns podem aparecer agrupadas. As de ver uma vez aparecem como itens protegidos, sem miniatura, e deslizar pelas comuns nunca abre uma protegida. O contador conta mensagens (5 fotos = 5). Ver a mensagem na conversa tira o "não lida", mas não gasta a abertura. Nada disso gera recibo para quem enviou.

### 5.5 Segurança e desempenho

- Recodificar cada foto no aparelho e enviar só a versão final, cifrada e sem EXIF ou GPS.
- Uma chave por foto, nunca uma para o lote. Ordem e agrupamento só dentro da parte cifrada.
- Processar uma foto por vez, com limites de pixels, memória e tempo, medidos em celular simples (F15).
- Miniaturas de preparo só na memória. Não criar rascunho de mídia em claro.
- Liberar memória e endereços temporários ao remover, cancelar ou trancar, sem prometer apagar cópias internas do navegador (ver S2).
- Câmera do app no modo máximo. Avaliar o seletor de fotos do Android (acesso só às fotos escolhidas, sem serviços do Google) e conferir o limite de 5 dentro do app, porque o seletor alternativo pode ignorar o máximo.
- Avisar que a foto original da galeria continua na galeria.

### 5.6 Envio parcial, repetição e cancelamento

Cada foto tem estado próprio: preparada, aguardando, enviando, enviada, falhou ou cancelada. A ordem é mantida e o modo fica travado depois de tocar em Enviar. Se 3 de 5 foram e a conexão caiu, aparece "3 enviadas; 2 pendentes" e só as pendentes são reenviadas. Cancelar não apaga as já enviadas; para isso existe "Apagar para todos".

Guardar cifrado o necessário antes de transmitir. Reaproveitar id e envelope numa nova tentativa (F10) e consultar o servidor quando o resultado for incerto. A chave de uma foto de ver uma vez pendente só existe até a confirmação, e quem enviou nunca consegue reabrir. Coordenar os envios e as sessões de criptografia por pessoa (não basta disparar 5 envios em paralelo). Upload sem publicação é revogado ou limpo (F11).

---

## 6. Conversas: limpar, excluir, arquivar, encerrar (D3)

**Regra do proprietário:** limpar e excluir valem **só no aparelho de quem faz**. A outra pessoa, ou o grupo, continua com tudo até vencer. Para sumir do aparelho dos outros existe "Apagar para todos", mensagem por mensagem.

| Ação | Onde fica | O que faz | Os outros |
|---|---|---|---|
| **Limpar conversa** | Menu ⋮ da conversa | Apaga as mensagens **do meu aparelho**; a conversa fica na lista | Nada muda |
| **Excluir conversa** (individual) | Segurar na lista ou menu ⋮ | Some da lista **só para mim** e leva junto mensagens, rascunho, prévia, contador e foto/nome locais. Reaparece se chegar mensagem nova, como no WhatsApp | Nada muda; o outro não é avisado |
| **Sair do grupo** | Menu ⋮ do grupo | Deixa de receber; perde as mídias pendentes | Veem que saí |
| **Excluir grupo** | Só depois de sair (como no WhatsApp) | Remove o grupo da minha lista e apaga nome, foto e fundo locais (F03) | Nada muda |
| **Arquivar** | Segurar na lista | Vai para "Arquivadas" e continua arquivada com mensagem nova | Nada muda |
| **Desfazer vínculo** (1:1) | Menu ⋮ | Encerra a conversa **para os dois** e revoga o pendente (F05). Conversa nova = id novo | A conversa fecha para o outro |

Os textos de confirmação dizem com clareza: "Excluir esta conversa só do seu aparelho? Fulano continua vendo as mensagens até vencer." A confirmação de **Desfazer vínculo** é diferente e mais forte, porque vale para os dois.

Detalhes técnicos:
- Excluir grava uma marca mínima cifrada (sem nome nem conteúdo) para que sincronizações antigas não ressuscitem a conversa. Só uma mensagem realmente nova a faz voltar, comparando pelo número de sequência e não pelo relógio do aparelho.
- O banco é refeito com chave nova mesmo quando não havia mensagens.
- Excluir não destrói as sessões de criptografia com a pessoa, que outras conversas podem usar.
- Conversas repetidas (F01) não são fundidas automaticamente: a pessoa pode excluir as sobras.
- Ao reaproveitar a conversa criada pelo outro, a liderança e a confirmação de membros dele são mantidas.

---

## 7. Lista de conversas e busca

### 7.1 Ordem

A lista **já sobe a conversa que recebe mensagem**, em grupos e individuais, como o WhatsApp: fixadas primeiro (até 3, D9), depois pela última mensagem, e arquivadas à parte. Ressalvas: conversa sem mensagens fica no fim, e o F01 hoje pode mostrar a mesma pessoa duas vezes.

### 7.2 Prévia e contador (D2, D10)

- Prévia: apelido, "Você:" nas minhas mensagens e o nome de quem mandou nos grupos. Trecho do texto, ou "📷 Foto", "🎥 Vídeo", "🎤 Áudio", "📄 Documento". Ver uma vez aparece como "📷 Foto de ver uma vez", **nunca com miniatura**. Não abrir mídia nem criar miniatura para preencher a lista.
- Ajustes → "Mostrar prévia na lista" (ligado por padrão). Desligado, mostra só "Nova mensagem".
- Contador: só mensagens recebidas, válidas e ainda não vistas. Reação, edição e eventos não contam. Verde, ou cinza se a conversa está silenciada.
- Marcar como lida quando a mensagem aparece na tela; quem está lendo mensagens antigas não zera o contador.
- "Marcar como não lida" volta o contador (D10).
- Guardar o estado cifrado. Atualizar quando uma mensagem vence sem chegar outra.
- Nenhum recibo, "online" ou "digitando" (V6-022). Tudo aparece só depois do desbloqueio. No Android não há contador no ícone, porque não há notificação.

### 7.3 Busca (D1)

Busca por **qualquer trecho**, sem diferenciar acento nem maiúscula, só no aparelho (o termo nunca vai ao servidor). Busca pessoas **e grupos**. Ordem dos resultados:
1. começa com o termo ("ara" → "Araújo");
2. começo de palavra depois de espaço, `_`, `.` ou `-` ("cara" → "aquele_cara");
3. qualquer posição ("ara" → "Kara", "aquele_cara", "Clara").

Pessoas removidas não aparecem (N2). Exige trocar a regra V7-006 para "busca local por trecho".

---

## 8. Ordem de entrega

| Entrega | Conteúdo | Para avançar |
|---|---|---|
| **A1 — urgente** | F12 (microfone), F06 (nada abre depois de trancar), N1 + S6 + D6 (redesenho e ver uma vez por toque), F17 (seletor × bloqueio), F14 (fila do banco), F01 (conversa duplicada), botão "↓" (2.2 b.5), cancelar áudio ao soltar o microfone (2.2 b.6), **teste de S2** no APK de depuração | Testes automáticos de cada caminho + **teste no celular** de F12, F17 e S2 |
| **A2 — privacidade** | S1 + S8 (aviso de chave na conversa, verificado, QR), S3 (círculo assinado), F04, F05, F16, F07, F09, S2 (correção, se confirmado), S5 (teclado anônimo), **S12 (destruição por chave da parte do servidor)**, S13 (teste do alarme da mídia), F13, F18, N2, N3 | Teste de servidor malicioso trocando chave e incluindo membro (V7-022) |
| **B — conversas** | D3 (limpar/excluir/sair/excluir grupo), F03, D1 (busca), D2 + D10 (prévia, contador, não lida), D7 (editar 15 min), D9 (fixar 3), D8 (aviso iPhone), funções da conversa 2.2 b.1–b.10 (segurar a mensagem, deslizar para responder, selecionar várias, separadores de data, gestos do áudio, ✓ de enviada, formatação, @menção) | Nada ressurge depois de sincronizar ou reiniciar; liderança mantida |
| **C — anexos e extras** | D4 (lote de 5), F10, F11, F15, S7 (tamanho arredondado), funções 2.2 b.7 e b.11–b.17 (áudio de ver uma vez, fixar mensagem, favoritas, mídia da conversa, busca global, responder em particular, descrição do grupo, papel de parede) | 62 combinações de modo e falhas parciais testadas |
| **D** | Funções 2.2 b.18–b.21 (enquete, vídeo redondo, conversa comigo, foto HD) | — |
| **E1 — galeria** (implementada em 28/10, ADR 0019) | D12 + D13 (seção 1.3). Cenários 11, 22 e 23 de `TESTE_EM_CELULAR.md` | Teste no celular: escolher 1 e 5 fotos e um vídeo; voltar em menos e em mais de 2 min |
| **E1+ — ajustes rápidos** (implementados em 28/10) | D14, D15, P2 (borracha), P3 (① na câmera), P4 (ícones), P5 (textos), D16 primeira parte (sem guardião; PIN + código no celular novo aguarda decisão sobre a espera de 24 h) | Entram no mesmo APK da E1 |
| **E3 — desempenho** (implementada em 28/10; `DESEMPENHO_E3_2026-10-28.md`: do PIN até a lista 2,5 s → 1,3–1,5 s no computador) | P1. Medir cada etapa do desbloqueio no celular. Hipóteses: mostrar a lista do banco local logo após abrir o cofre e sincronizar em segundo plano; diretório e sincronização em paralelo; Argon2id em Worker (a tela não trava; o custo não muda); carregar editor, PDF e câmera só quando usados. **Proibido** baixar os parâmetros do Argon2id ou tirar verificações | Tempo antes e depois, no mesmo celular; todas as suítes passando |
| **E2 — disfarce** (implementada em 29/10, ADR 0020; `test/snake.test.mjs`) | D5 (seção 1.3) como **"Hungry Snake"**: porta em pausa → segurar 3 s no Recorde → "Código de contribuidor"; 4 erros pausam o Recorde por 30 min, o 5º apaga; seta volta ao jogo | Teste no celular (cenário 25): ligar/desligar, ícone, gesto, código errado, trancar |
| **E4 — nova interface** (implementada em 28/10; `test/visual.test.mjs` confere 24 telas em tamanho de celular) | P6: tema, ícones, telas e animações curtas (abrir conversa deslizando, folha de anexar subindo, mensagem enviada entrando), respeitando "reduzir movimento" | Testes de interface atualizados; nenhuma função perdida |

Cada entrega deve trazer o teste automático do caminho corrigido e a documentação atualizada. Nada vira "testado no celular" sem ter sido rodado num celular de verdade, com versão do APK, commit e aparelho anotados.

---

## 9. Testes obrigatórios antes do próximo APK

**Privacidade e criptografia (novos):**
- S1: servidor de teste troca a chave de um membro. O aviso precisa aparecer **na conversa**, continuar depois de reiniciar e pausar o envio para contato verificado.
- S2: APK de depuração tocando, gravando e comprimindo vídeo de 90 MB. Listar a pasta de blobs do WebView antes e depois; nenhum arquivo com conteúdo em claro.
- S3: servidor de teste inclui um membro no círculo. Precisa aparecer o aviso e a recusa da lista não assinada.
- S5: digitar no app e conferir que o teclado não sugere essas palavras fora dele.
- S6: tocar no ver uma vez e soltar na hora; cortar a rede no meio do download.
- Procurar originais, EXIF, legendas, nomes e chaves em claro nos arquivos do app e nos logs.
- Prazo (seção 3.6): mídia com prazo curto vencida sai do R2 e do Durable Object, e abrir devolve "expirada" (S13). Celular de verdade: foto com prazo de 12 h some nos dois aparelhos depois de vencer.
- S12: depois da mudança, apagar o objeto do R2 deixa a parte S restaurada do histórico inútil.

**Conversas e exclusão:** abrir o contato repetidas vezes, com toque duplo, os dois criando ao mesmo tempo e resposta perdida, e deve existir uma conversa só. Excluir conversa vazia e com conteúdo, depois reiniciar, sincronizar, trancar e atualizar: nada volta, e o outro continua vendo tudo. Excluir grupo só depois de sair. Abrir conversa nova depois de desfazer vínculo dá id novo. Apagar mídia para todos e tentar abrir pela referência antiga. Revogação no desfazer vínculo e na remoção.

**Fotos e ver uma vez:**
- Seleções de 1 a 5 fotos e a tentativa de uma sexta.
- As 62 combinações de modo.
- Editar, alternar, remover, substituir, adicionar e reordenar, conferindo que cada edição fica com a foto certa.
- Abrir uma foto de ver uma vez não gasta as outras.
- Não reabre, nem com abertura simultânea, voltando à conversa ou reiniciando.
- Quem enviou não reabre e não existe miniatura recebida.
- Falha no preparo, no 1º upload, no 3º envio e depois do aceite, retomando só o que falta.
- Trancar e trocar de conversa durante o envio e a abertura.
- Arquivos enormes, formatos recusados e permissão negada.

**Estado e armazenamento:**
- Edição sem rede, fora de ordem e de outra conversa.
- Escrita durante a troca de chave do banco e queda em cada etapa.
- Contadores com mensagens repetidas, vencidas, apagadas e de mídia.
- PDF longo, áudio com falha e permissão tardia.
- Memória e soltura de câmera e microfone.
- Proteção de tela, bloqueio, cifra e prazos depois de atualizar.

**Aparelhos:** pelo menos dois Androids de fabricantes diferentes (um simples) e o iPhone (PWA), incluindo S4 e S11. Rodar as suítes de protocolo, cliente, servidor, cripto e interface.

---

## 10. Referências

- WhatsApp: [edição de fotos e vídeos](https://faq.whatsapp.com/812276063311533), [visualização única](https://faq.whatsapp.com/1077018839582332), [anúncio da visualização única (Meta, 2021)](https://about.fb.com/news/2021/08/view-once-photos-and-videos-on-whatsapp/).
- Comportamento do WhatsApp citado por fontes secundárias, a conferir no app: [apagar mensagens e limites](https://en.androidayuda.com/cancel-messages-sent-on-whatsapp/), [limpar × excluir conversa](https://www.guidingtech.com/what-happens-when-you-clear-chat-on-whatsapp/), [Tom's Guide sobre ver uma vez](https://www.tomsguide.com/how-to/how-to-send-disappearing-photos-and-videos-in-whatsapp).
- Chromium, armazenamento de blobs (limites de memória e disco no Android, S2): [storage/browser/blob](https://chromium.googlesource.com/chromium/src/+/HEAD/storage/browser/blob).
- Android: [Photo Picker](https://developer.android.com/training/data-storage/shared/photo-picker), [activity-alias](https://developer.android.com/guide/topics/manifest/activity-alias-element), [IME_FLAG_NO_PERSONALIZED_LEARNING](https://developer.android.com/reference/android/view/inputmethod/EditorInfo#IME_FLAG_NO_PERSONALIZED_LEARNING).
- Avisos de segurança de crates Rust (vodozemac): [RustSec](https://rustsec.org).
- Internos: especificação v7 (V6-022, V7-006, V7-008, V7-014, V7-022, §6, §25), ADRs 0002, 0005, 0010, 0012, 0014, `RISCOS_PENDENTES.md`, `TESTE_EM_CELULAR.md`.

As referências guiam a experiência. O limite de 5 fotos, os modos mistos, os prazos obrigatórios e as regras de privacidade deste documento são requisitos do Pacto Talk.
