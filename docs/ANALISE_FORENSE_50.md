# Os 50 métodos de perícia e invasão × o Mensageiro

Legenda: 🟢 protegido pelo app · 🟡 protegido em parte (depende de algo de
fora do app ou do comportamento da pessoa) · 🔴 nenhum app consegue impedir;
só reduzir o estrago.

## O que torna o app difícil de periciar (resumo)
1. **O app tem a própria tranca.** Abrir o celular não abre o app. Para abri-lo
   é preciso Face ID/digital (passkey PRF) + PIN + uma **parte guardada no
   servidor** (ADR 0014).
2. **Quem conta os erros de PIN é o servidor.** Uma cópia do celular não deixa
   testar PINs fora do servidor: 5 erros seguidos e a parte do servidor é
   destruída. A partir daí, o banco do celular vira ruído **para sempre**,
   inclusive em cópias feitas antes.
3. **PIN de coação.** Se alguém obrigar a pessoa a abrir o app, ela digita o PIN
   de coação: o app abre como novo, vazio, e tudo é destruído sem aviso.
4. **Interruptor do homem morto.** Celular apreendido e guardado na gaveta: se
   ficar X dias sem abrir o app (padrão 15; dá para escolher 1, 3, 7 ou 30), o
   servidor destrói a parte dele.
5. **Código de emergência.** Anotado no papel ou com o guardião. De qualquer
   aparelho, "Perdi meu celular" + código: o celular perdido morre na hora.
6. **Banco local sem metadado em claro.** Id de mensagem e de conversa viram
   HMAC; data, tamanho e tipo ficam dentro da cifra; cada registro é
   preenchido até 256 bytes. Testado: uma cópia crua dos arquivos não contém
   nenhum id, texto ou nome.
7. **Os dados morrem de verdade.** Ao apagar, ao trancar e a cada 24 h, o banco
   é refeito num arquivo novo, com chave nova e chave de índice nova. O
   arquivo antigo é removido, e o SQLite roda com `secure_delete`, journal
   apagado e temporários só em memória.
8. **Tranca na hora.** Saiu do app, as chaves saem da memória (padrão; dá
   para escolher 1 ou 5 minutos).
9. **Tudo vence em até 15 dias**, também no aparelho do destinatário. "Ver uma
   vez" não deixa nem a chave para trás.
10. **Câmera e microfone dentro do app.** Nada vai para a galeria, a nuvem ou
    pasta temporária.
11. **Servidor sem conteúdo**: só ciphertext com prazo; push diz só "novas
    mensagens"; sem logs.

## A lista

| # | Método | Situação | Por quê / o que fazer |
|---|---|---|---|
| 1 | Acesso ao aparelho desbloqueado | 🟢 | O app tem tranca própria e tranca na hora em que sai da tela. Com o app aberto na mão de alguém, ele vê o que está na tela: nenhum app impede isso. |
| 2 | Desbloqueio por senha/PIN/biometria | 🟡 | O PIN do celular não abre o app. Sob coação, use o **PIN de coação**. Biometria forçada: no iPhone, apertar 5× o botão lateral desliga o Face ID até a senha. |
| 3 | Exploit do sistema | 🟡 | Com o app trancado, quem explora o sistema acha só ciphertext e precisa do servidor (limite de 5) e do PIN. Com o app aberto, um exploit vê o que o app vê. Reduz: iOS sempre atualizado, Modo de Bloqueio (ver nota), trancar na hora. |
| 4 | Exploit de kernel | 🟡 | Igual ao 3. |
| 5 | Falha em autenticação | 🟢 | Três fatores independentes (biometria→PRF, PIN, parte do servidor). Burlar a biometria do celular não basta. |
| 6 | Força bruta de senha | 🟢 | Fora do servidor não dá para testar PIN (falta a parte S). No servidor, 5 erros destroem. Força bruta só seria possível com cópia do celular **e** do servidor **e** da passkey ao mesmo tempo. |
| 7 | Escalada de privilégio | 🟡 | Igual ao 3. |
| 8 | Extração lógica | 🟢 | Apps web não entram no backup lógico como apps nativos; mesmo se entrarem, sai só ciphertext sem metadado. |
| 9 | Extração completa (FFS) | 🟢 | O arquivo do banco é ruído sem a parte do servidor. Sem nomes, ids nem datas em claro (testado). |
| 10 | Extração física do chip | 🟢 | iPhone/Android modernos cifram o chip inteiro; por cima, a nossa cifra. Restos de arquivos antigos estão sob chaves destruídas. |
| 11 | Memória RAM | 🟡 | Chaves só ficam na memória com o app aberto; trancar apaga as referências às chaves (DEK, KEK, chave de índice). JavaScript não garante zerar toda cópia; por isso, trancar na hora é o padrão. |
| 12 | Dados e chaves após o 1º desbloqueio (AFU) | 🟢 | A chave do app **não** fica disponível em AFU: depende do app ser aberto com Face ID + PIN + servidor. O interruptor do homem morto mata a chave mesmo que a perícia segure o celular em AFU (como o GrayKey diz fazer). |
| 13 | Firmware/Secure Enclave | 🟡 | Mesmo burlando o Secure Enclave (e a passkey), faltam o PIN e a parte do servidor. |
| 14 | Cellebrite, GrayKey, XRY | 🟢 | Eles extraem; o que sai é ruído. Não existe parser pronto para este app, e mesmo que existisse não há o que ler sem servidor + PIN. |
| 15 | IPED, Magnet AXIOM | 🟢 | Analisam o que foi extraído: blocos opacos sem metadado. |
| 16 | Intrusão remota (spyware) | 🔴 | Spyware no celular vê o que a pessoa vê enquanto o app está aberto. Reduz: prazos curtos, ver uma vez, trancar na hora, iOS atualizado, Modo de Bloqueio/GrapheneOS. |
| 17 | Registros apagados do SQLite | 🟢 | `secure_delete` zera; cada registro é cifrado; o arquivo inteiro é trocado por um novo com chave nova depois de apagar. |
| 18 | WAL e journals | 🟢 | Sem WAL (`journal_mode=DELETE`); o journal só tem páginas cifradas e é removido. |
| 19 | File carving | 🟢 | Pedaços recuperados são ciphertext de chaves destruídas. |
| 20 | Arquivos temporários | 🟢 | Temporários do SQLite só em memória; câmera do app sem arquivo; no modo máximo nada passa pelo seletor de arquivos. |
| 21 | Cache do app | 🟢 | O service worker guarda só o código do app (assinado), nunca mensagem ou mídia. Mídia é decifrada só na memória. |
| 22 | Miniaturas e prévias | 🟢 | O app não cria miniatura. A capa de privacidade esconde a tela no seletor de apps. No Android, FLAG_SECURE impede a foto da tela. |
| 23 | Logs do sistema | 🟢 | A release não escreve nada no console; no Android, log do Capacitor desligado e depuração do WebView desligada. Avisos de segurança não levam id nem remetente. |
| 24 | Metadados de mensagens | 🟡 | No aparelho: nenhum em claro (testado). No servidor: quem está em qual conversa e quando chegou (o mínimo para entregar), apagados no prazo. |
| 25 | Histórico de notificações | 🟢 | Toda notificação é exatamente "novas mensagens"; sem nome, grupo, contagem ou prévia. |
| 26 | Backups locais antigos | 🟢 | Android: backup desligado. iPhone: mesmo que um backup inclua os dados do app, é ciphertext que depende da parte do servidor, que morre (erros, coação, emergência ou prazo). |
| 27 | Backups na nuvem | 🟢 | Igual ao 26. O app não manda nada para iCloud/Google Drive. |
| 28 | Dados sincronizados entre aparelhos | 🟡 | Mensagens não sincronizam (um aparelho por pessoa). A passkey sincroniza pelo iCloud Keychain: mesmo assim, sozinha não abre nada (faltam PIN e servidor). |
| 29 | Computadores/tablets vinculados | 🟢 | Não existe versão de computador nem vínculo; troca de aparelho só por código, e o antigo cai. |
| 30 | Mensagens no aparelho do destinatário | 🟡 | Valem as mesmas proteções do lado dele, e tudo vence em até 15 dias. "Apagar para todos" e "ver uma vez" valem lá também. Se o celular dele for aberto à força, o PIN de coação dele protege. |
| 31 | Participante entrega as mensagens | 🔴 | Ninguém impede alguém da conversa de mostrar ou fotografar a tela. Reduz: grupo pequeno de confiança, prazos curtos, ver uma vez, FLAG_SECURE no Android. |
| 32 | Arquivos e mídias trocados | 🟢 | Só ciphertext no servidor; no aparelho, mídia decifrada só na memória, sem salvar; foto e vídeo recodificados, sem metadados. |
| 33 | Capturas de tela | 🟡 | Android: bloqueadas. iPhone: o sistema não deixa bloquear; o app avisa e oferece "segurar para ver". |
| 34 | Correlação de horários | 🟡 | O servidor vê quando chegou algo e para quem (não o quê). Tor/VPN tiram o IP. Os horários somem com a mensagem (até 15 dias). |
| 35 | Pedido judicial ao provedor | 🟡 | A Cloudflare só tem ciphertext com prazo, sem logs. Ela tem o "histórico" de 30 dias do D1 e do Durable Object: dá para restaurar ciphertext e metadados de até 30 dias, mas nunca o conteúdo. |
| 36 | Metadados de conexão | 🟡 | IP visível para a Cloudflare; com Orbot/VPN, não (ver REDE_TOR_VPN.md). |
| 37 | Interceptação judicial | 🟢 | TLS + cifra de ponta a ponta (Olm). Quem intercepta ou controla o servidor não lê. Troca de chave vira aviso de segurança, e membro fantasma é recusado. |
| 38 | Monitoramento de grupo por participante | 🟡 | Ninguém entra escondido: a líder confirma de ponta a ponta quem está, e entrada de membro é visível. Um participante legítimo vê o que o grupo vê. |
| 39 | Artefatos residuais | 🟢 | Rotação de arquivo + chave, OPFS apagado por inteiro em "apagar tudo"/coação/emergência; sem localStorage. |
| 40 | Cópias em sistemas externos | 🟢 | Não há cópia fora: sem backup, sem nuvem, sem encaminhar/exportar. No R2, regra apaga mídia com mais de 16 dias. |
| 41 | Correlação entre fontes | 🟡 | Quanto menos fontes, menos correlação: sem telefone, e-mail, nome real ou localização. O IP fica com a Cloudflare (Tor resolve). |
| 42 | Dados antes da cifra / depois de decifrar | 🟡 | Só existem na memória com o app aberto; tranca na hora; ver uma vez some ao soltar. Spyware ativo nesse momento vê (ver 16). |
| 43 | Interfaces de depuração | 🟢 | Android: depuração do WebView desligada. iPhone: o Web Inspector precisa do celular desbloqueado, de um Mac e de uma chave nos Ajustes; mesmo assim, o app trancado não tem chave na memória. |
| 44 | Armazenamento removível | 🟢 | O app nunca grava em cartão de memória. |
| 45 | Versões antigas de arquivos/bancos | 🟢 | Cada versão antiga do banco tinha chave própria, já destruída. |
| 46 | Registros de sincronização/transferência | 🟢 | Não há sincronização nem transferência para fora. |
| 47 | Compartilhamento entre apps | 🟢 | Sem "compartilhar", sem copiar mensagem recebida, sem abrir em outro app. Câmera interna. |
| 48 | Sessões web/desktop | 🟢 | Não existe versão web aberta nem desktop. Cada aparelho tem sessão própria, e a troca derruba o antigo. |
| 49 | Reconstrução por várias fontes | 🟡 | Igual a 34 e 41. Nada do conteúdo existe fora dos aparelhos, e só até o prazo. |
| 50 | Chaves acessíveis na perícia | 🟢 | Em repouso não há chave utilizável: a KEK precisa de passkey + PIN + servidor. O servidor apaga a parte dele com erro, coação, emergência ou prazo. |

**Placar:** 32 🟢 · 16 🟡 · 2 🔴 (16 e 31: spyware no celular aberto e um
participante que entrega a conversa, que nenhum aplicativo do mundo impede
sozinho).

## O que a pessoa pode fazer (o app não faz por ela)
- **Antes de situações de risco:** desligar o celular (BFU) ou usar "Apagar tudo" ou o código de emergência.
- **iPhone:**
  - iOS sempre atualizado, senha do aparelho longa (alfanumérica);
  - Proteção de Aparelho Roubado ligada;
  - no iOS 18+ o aparelho reinicia sozinho depois de 72 h sem uso.
- **Biometria forçada:** apertar 5× o botão lateral obriga a usar a senha.
- **Android:** GrapheneOS (PIN de coação do sistema, reinício automático, USB desligado travado), ou pelo menos bloqueio forte e sem depuração USB.
- **Rede:** Orbot (Tor) ou VPN sem registros.
- **Teclado:** usar o teclado do sistema; teclado de terceiros pode registrar o que é digitado.
- **Modo de Bloqueio do iPhone:** ele desliga o WebAssembly, e o app depende disso para a criptografia. Há relatos (WebKit bug 273824) de que nem a exceção por site resolve. **Testar no aparelho**; se travar, o app não abre com o Modo de Bloqueio ligado.

## Limites honestos
- **Histórico de 30 dias da Cloudflare:** o D1 e o SQLite do Durable Object guardam histórico para restauração. Quem controla a conta (ou a Cloudflare, por ordem judicial) poderia restaurar uma parte S já destruída. Mesmo assim, ainda faltariam o PIN e a passkey (Face ID) da pessoa.
- **Abrir o app exige internet**, por desenho (a especificação já aceitou isso).
- **Memória:** JavaScript não garante apagar todas as cópias de um dado na memória; por isso o padrão é trancar na hora.
