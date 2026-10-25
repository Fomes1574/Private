# Pacto Talk — plano consolidado e revisão de privacidade (v3)

Data: 25/10/2026  
Repositório: [Fomes1574/Private](https://github.com/Fomes1574/Private), branch `ccr-de59a90b-gr4vug`  
Código analisado: commit `03fa5d0` (o código é idêntico em `9965770`; só a documentação mudou)  
Estado: **planejamento**. Nenhum código, deploy ou APK foi alterado por este documento.

| Versão | Autor | O que trouxe |
|---|---|---|
| v1 | GPT | Plano de envio de 1 a 5 fotos, achados F01–F18, testes e ordem de entrega |
| v2 | Claude | Conferência de F01–F18 no código, bugs novos N1–N3, respostas sobre lista e busca, decisões D1–D5 |
| v3 | Claude | Decisões do proprietário, regra "igual ao WhatsApp", **pesquisa de privacidade e criptografia** (S1–S11), plano e ordem consolidados |

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
5. **Próximo passo:** a entrega A1 (seção 8). Ela só começa quando o proprietário liberar a implementação.

---

## 1. Decisões do proprietário

### 1.1 Aprovadas em 25/10/2026 ("siga suas recomendações")

| ID | Decisão |
|---|---|
| D1 | Busca por **qualquer trecho** do nome, sem diferenciar acento nem maiúscula, com ordem de relevância (seção 7.3). "ara" acha "Kara" e "aquele_cara" |
| D2 | **Contador de não lidas** (só no aparelho, sem recibo para ninguém) e **prévia da última mensagem** na lista, com opção "Mostrar prévia na lista" em Ajustes. Mídia de ver uma vez nunca aparece em prévia |
| D3 | Separar **"Limpar conversa"** de **"Excluir conversa"**. As duas valem **só no aparelho de quem faz**: a outra pessoa continua com tudo até vencer (regra do proprietário, igual ao WhatsApp) |
| D4 | Envio de **1 a 5 fotos** de uma vez, com ver uma vez por foto. Vem **depois** das correções A1/A2 |
| D5 | Nome e ícone disfarçados (aliases): **adiado** |

### 1.2 Novas decisões (recomendação; valem como decididas se o proprietário não mudar)

| ID | Pergunta | Recomendação |
|---|---|---|
| D6 | Ver uma vez: "segurar para ver" (hoje) ou "tocar para abrir", como no WhatsApp? | **Tocar para abrir, como no WhatsApp.** Fica aberta até fechar (X ou voltar) e fecha sozinha se o app sair da tela. Segurar não impede print no iPhone e causa o bug S6 |
| D7 | Editar mensagem: sem limite (hoje) ou só nos primeiros 15 min, como no WhatsApp? | **15 minutos, como no WhatsApp** |
| D8 | Avisar quem envia que, no iPhone, print não é bloqueado? | **Sim**: um aviso fixo ao escolher "ver uma vez" ("No iPhone o app não consegue bloquear print"). Não revela quem usa iPhone |
| D9 | Fixar conversas: sem limite (hoje) ou até 3, como no WhatsApp? | **Até 3, como no WhatsApp** |
| D10 | "Marcar como não lida" na lista, como no WhatsApp? | **Sim**, só local |
| D11 | Teclado anônimo no Android (o teclado não aprende nem guarda o que é digitado no app)? | **Sim**, ligado por padrão (S5) |

---

## 2. Regra "igual ao WhatsApp"

**Princípio:** onde não há conflito com privacidade, o app copia o comportamento do WhatsApp: nomes dos botões, ordem, onde fica cada ação e o que acontece. Onde o Pacto Talk é diferente **de propósito**, a diferença está listada abaixo com o motivo e é mantida.

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
| S10 | Baixa | Comportamento do sistema | Texto copiado vai para a área de transferência do sistema (histórico, sincronização de alguns teclados). O WhatsApp faz igual | Manter; explicar em Ajustes → Privacidade |
| S11 | Baixa (a validar) | Plataforma | No iPhone, a cobertura de privacidade é aplicada quando o app sai da tela. É preciso confirmar que a miniatura do seletor de apps não captura a conversa antes disso | Incluir no roteiro de teste do iPhone |

**Conferido e sem problema:** as chaves de uso único do Olm não são assinadas, mas um servidor que troque essas chaves só quebra a conversa, sem conseguir ler (o acordo também usa a chave de identidade). Para o PIN de coação, o código de emergência e a recuperação da administradora, confirmei que a recuperação aparece para os outros como troca de chave. Esse aviso depende de S1.

### 3.4 O app faz o que promete?

| Promessa | Situação |
|---|---|
| O servidor não lê mensagens, fotos, vídeos, áudios e documentos | **Sim** |
| Nenhuma troca de chave passa em silêncio | **Parcial**: S1 |
| Ver uma vez abre uma única vez | **Sim** no servidor; na tela: N1 e S6 |
| Quem enviou não reabre o ver uma vez | **Sim** |
| Print bloqueado | **Android: sim** (exceto celular com root ou outra câmera filmando a tela). **iPhone: não** (limite do sistema, S4) |
| Os dados morrem (somem no prazo e não sobram) | **Sim**, com a ressalva S2 a confirmar |
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
| **A1 — urgente** | F12 (microfone), F06 (nada abre depois de trancar), N1 + S6 + D6 (redesenho e ver uma vez por toque), F17 (seletor × bloqueio), F14 (fila do banco), F01 (conversa duplicada), **teste de S2** no APK de depuração | Testes automáticos de cada caminho + **teste no celular** de F12, F17 e S2 |
| **A2 — privacidade** | S1 + S8 (aviso de chave na conversa, verificado, QR), S3 (círculo assinado), F04, F05, F16, F07, F09, S2 (correção, se confirmado), S5 (teclado anônimo), F13, F18, N2, N3 | Teste de servidor malicioso trocando chave e incluindo membro (V7-022) |
| **B — conversas** | D3 (limpar/excluir/sair/excluir grupo), F03, D1 (busca), D2 + D10 (prévia, contador, não lida), D7 (editar 15 min), D9 (fixar 3), D8 (aviso iPhone) | Nada ressurge depois de sincronizar ou reiniciar; liderança mantida |
| **C — anexos** | D4 (lote de 5), F10, F11, F15, S7 (tamanho arredondado) | 62 combinações de modo e falhas parciais testadas |
| **D** | D5 (aliases), se for aprovado um dia | — |

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
