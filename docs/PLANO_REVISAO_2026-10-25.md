# Pacto Talk — plano consolidado e revisão preventiva
Data: 25/10/2026  
Repositório: [Fomes1574/Private](https://github.com/Fomes1574/Private)  
Branch consultada: `ccr-de59a90b-gr4vug`  
Commit analisado: `03fa5d0588a0f92721e971d6f83111bc43d91f63`  
Estado: planejamento. Nenhuma alteração de código, deploy ou APK.

> **Segunda revisão (Claude, 25/10/2026):** cada achado foi conferido no
> código do mesmo commit. Veja a seção 10 (o que confirmei, corrigi ou
> rebaixei), a seção 11 (bugs novos), a seção 12 (lista de conversas e busca)
> e a seção 13 (decisões e ordem revisada). O texto original foi mantido;
> trechos alterados estão marcados com **[revisado]**.

## 1. Objetivo e alcance

Melhorar conversas, exclusão, prévias, contadores e anexos com uma interface familiar para quem usa WhatsApp, mantendo criptografia, expiração, bloqueio e minimização de dados como requisitos de aceite.

A revisão examinou os caminhos relevantes de interface, cliente, protocolo, armazenamento local e servidor. Distingue comportamentos verificados no código, reproduções isoladas e riscos que precisam de teste integrado. Não é uma auditoria criptográfica independente nem uma garantia de ausência de outros problemas. A versão instalada no celular ainda precisa ser relacionada ao commit e testada em aparelhos reais.

Foram executados os 33 testes existentes de protocolo: 33 passaram. Foram feitas seis reproduções adicionais em uma cópia temporária do código, com rede, DOM ou hardware simulados. As seis reproduções confirmaram os comportamentos indicados na seção 5. Não foram executadas nesta revisão as suítes completas do APK, servidor, criptografia ou navegador.

## 2. Envio de uma a cinco fotos

### 2.1 Fluxo proposto

1. Tocar em anexar e escolher Câmera, Galeria ou Documento.
2. Na galeria, selecionar de uma a cinco fotos. Pela câmera, tirar uma foto e poder adicionar outra até completar cinco.
3. Abrir a tela de preparação com foto principal e faixa de miniaturas numeradas.
4. Tocar em cada miniatura para editar aquela foto e escolher seu modo de envio.
5. Poder remover, substituir, adicionar e reordenar fotos, respeitando o máximo de cinco.
6. Tocar em “Enviar 5 fotos”, ou na quantidade efetivamente selecionada. Nenhum upload começa antes desse toque.

Cada foto terá um identificador estável durante a preparação. Remover a foto 2 não poderá transferir a edição, legenda ou visualização única dela para a foto seguinte. A interface mostrará a quantidade selecionada, como “3/5”. Um sexto arquivo não será enviado nem descartado silenciosamente: o app informará o limite e permitirá ajustar a seleção.

O limite de cinco vale para a seleção desta entrega. Vídeos continuam disponíveis pelo menu simplificado; envio múltiplo de vídeos não faz parte deste pedido.

### 2.2 Edição individual

Cada foto terá seu próprio estado de recorte, rotação, desenho, texto, desfazer e legenda, quando permitida. Voltar para uma miniatura preservará a edição. Editar a foto 3 não modificará as demais.

A tela adotará padrões familiares de preparação de mídia do WhatsApp, como edição antes de enviar e seleção da imagem atual. A combinação de modos em um único lote é uma especificação própria do Pacto Talk; não se presume que o WhatsApp tenha exatamente esse comportamento.

O editor atual zera desenhos ao mudar a geometria. Para a nova experiência, isso precisa ser resolvido por transformação das coordenadas ou, quando inevitável, por uma ação explícita com possibilidade de desfazer. Não apagar trabalho silenciosamente.

### 2.3 Visualização única por foto

O “1” dentro de um círculo pontilhado controla exclusivamente a foto selecionada. Quando ligado, deve ter contraste, estado acessível e descrição “Visualização única ativada”.

| Foto | Edição | Visualização única | Resultado |
|---|---|---|---|
| 1 | Recorte próprio | Desligada | Foto comum, respeitando o prazo |
| 2 | Texto próprio | Ligada | Abre uma vez por destinatário |
| 3 | Desenho próprio | Ligada | Abre uma vez, independentemente da foto 2 |
| 4 | Rotação própria | Desligada | Foto comum |
| 5 | Sem alteração | Ligada | Abre uma vez, independentemente das demais |

Serão permitidas todas as combinações: nenhuma, uma, duas, três, quatro ou cinco fotos de visualização única. O modo começa desligado em uma nova seleção e não herda a escolha do envio anterior. Atalhos “Todas de visualização única” e “Todas comuns” podem existir, com estado misto visível e sem substituir o controle individual.

Preservar a regra atual: mídia de visualização única não leva legenda visível fora da abertura. Ao ativar o modo em uma foto que já tem legenda, a interface deve explicar a incompatibilidade e permitir cancelar a mudança; não apagar nem enviar o texto silenciosamente. Texto escrito sobre a imagem no editor continua parte da imagem protegida.

### 2.4 Recebimento

Cada foto mantém chave, autorização, prazo, exclusão e consumo próprios. Abrir a foto 2 não consome a 3. Consumir uma mídia não remove as demais.

Uma composição visual pode agrupar fotos comuns. Fotos de visualização única aparecem como itens protegidos, sem miniatura legível, inclusive se estiverem no mesmo lote de fotos comuns. Deslizar por fotos comuns não abre nem consome automaticamente uma foto protegida.

O contador de não lidas conta mensagens: cinco fotos recebidas equivalem a cinco novas mensagens, mesmo que sejam apresentadas como um conjunto. Ver a mensagem protegida na conversa remove sua condição de não lida, mas não consome a abertura da imagem. Consumo e leitura local são estados diferentes e não geram recibo ao remetente.

### 2.5 Segurança e desempenho do lote

- Recodificar cada foto no aparelho; transmitir somente a versão final editada e cifrada. Remover EXIF, GPS e miniaturas embutidas.
- Usar chaves independentes. Nunca usar uma única chave para o conjunto inteiro.
- Colocar eventuais informações de agrupamento e ordem dentro do conteúdo cifrado. Não acrescentar nomes, legendas ou prévias legíveis ao servidor.
- Preparar imagens de forma controlada, evitando cinco decodificações completas simultâneas. Aplicar limites de pixels, memória, tamanho e tempo; dimensionar o orçamento total com medições em aparelhos modestos.
- Guardar somente miniaturas de preparação em memória enquanto necessário. A opção de retomada, se implementada, exige armazenamento cifrado e política explícita; não criar rascunhos de mídia em claro.
- Apagar buffers controlados pelo app e revogar URLs de objetos ao remover uma foto, cancelar ou encerrar a sessão. Não prometer zerar todas as cópias internas do navegador.
- Manter a câmera interna no modo máximo. A galeria continua dependente da preferência atual.
- No Android, avaliar Photo Picker nativo com acesso apenas aos arquivos selecionados, sem permissão ampla de armazenamento e sem introduzir dependência de serviços do Google. Usar alternativa compatível quando necessário.
- Validar o limite de cinco dentro do app: a documentação do Android informa que o seletor alternativo pode ignorar o máximo configurado.
- Ao usar galeria, esclarecer que o original preexistente e eventuais cópias do provedor de fotos não são apagados nem protegidos retroativamente pelo Pacto Talk.

### 2.6 Envio parcial, repetição e cancelamento

O lote é um conjunto de envios individuais, com estados por foto: preparada, aguardando, enviando, confirmada, falhou ou cancelada. A ordem selecionada deve ser preservada. O envio congela a seleção para evitar mudança do modo após o início.

Se três de cinco fotos forem confirmadas e a conexão cair, mostrar “3 enviadas; 2 pendentes”. Tentar novamente apenas as pendentes. Cancelar não significa apagar as já confirmadas; isso usa a ação separada “Apagar para todos”.

Persistir o estado necessário cifrado antes da transmissão. Reutilizar identificador e envelope em tentativas da mesma mensagem; não criar outro envio porque a resposta HTTP se perdeu. Consultar o estado quando o resultado for incerto. A chave de uma foto única pendente precisa de ciclo de vida explícito: conservar somente o necessário cifrado para concluir/reconciliar o envio e eliminar após confirmação, sem permitir reabertura pelo remetente.

Não basta executar cinco chamadas atuais em paralelo. Coordenar os envios e a persistência das sessões criptográficas por destinatário, incluindo texto e eventos de controle concorrentes. Qualquer upload concluído sem publicação deve ser revogado ou recolhido por uma limpeza confiável e idempotente.

## 3. Plano anterior incorporado

### Conversas sem duplicação

Abrir a conversa ativa existente pelo identificador da pessoa, não pelo apelido. Bloquear toques repetidos e deduplicar também no servidor, incluindo criação simultânea pelos dois participantes e respostas perdidas. Uma nova conversa depois do encerramento terá outro identificador.

Ao reutilizar uma conversa criada pelo amigo, preservar a liderança e a confirmação de membros existentes. A implementação atual de criação se considera líder; ela não pode ser reaproveitada sem ajuste para esse caso. Validar os participantes e manter as verificações de confiança.

Não fundir automaticamente históricos de salas diferentes. Oferecer exclusão local das duplicadas, sem apagar sessões criptográficas compartilhadas por pessoa que outras conversas ainda usam.

### Limpar, excluir, arquivar e encerrar

| Ação | Comportamento |
|---|---|
| Limpar mensagens | Remove mensagens locais e mantém a conversa |
| Excluir conversa | Remove da lista e limpa conteúdo e dados locais de apresentação |
| Arquivar | Mantém o conteúdo na seção de arquivadas |
| Encerrar vínculo / sair | Altera a participação e os direitos conforme o protocolo |

A exclusão deve remover rascunho, prévia, contador, nome de grupo e referências visuais locais, com rotação do banco também quando não houver mensagens. Uma marca técnica mínima cifrada pode impedir reconstrução por sincronizações antigas; não guardar nome nem conteúdo nessa marca.

Proposta de comportamento: conversa ativa excluída reaparece com uma mensagem realmente nova ou abertura deliberada. Evento de membros/perfil, repetição de sincronização ou anúncio antigo não a restaura. Conversa encerrada excluída permanece removida. A definição do que é novo precisa de marca de sequência/identificador, evitando depender apenas do relógio do aparelho.

Excluir localmente não apaga a cópia dos demais e não significa sair do grupo. Preservar apenas o estado criptográfico estritamente necessário para a participação ativa; não confundir limpeza de apresentação com destruição indiscriminada de chaves.

### Última mensagem, remetente e contador

Mostrar apelido, remetente e trecho da última mensagem válida, ou rótulo genérico de mídia. Usar “Você:” para envios próprios. Não abrir mídia, criar miniatura recebida ou buscar prévias de links para preencher a listagem.

Contar apenas mensagens recebidas, válidas e ainda não vistas localmente. Não contar reações, edições e eventos internos. Marcar como lidas quando efetivamente exibidas na conversa em primeiro plano; posição de rolagem importa. Não limpar o contador inteiro se a pessoa está lendo uma parte antiga do histórico.

Persistir o estado cifrado, com identificação de mensagens e tratamento de empates, repetição, exclusão e vencimento. Atualizar também quando o prazo termina sem chegar outro evento. Não criar recibos de leitura, online ou digitando.

As prévias aparecem só após desbloqueio e reconciliação de validade. Preservar ausência de notificações externas no APK, contador no ícone e conteúdo nos recentes. Com o app fechado, o contador reflete as mensagens após nova sincronização; não prometer recebimento em segundo plano.

### Nome do grupo e aparência do aplicativo

O código já envia o perfil do grupo cifrado e usa banco local cifrado. A permanência do nome após limpar mensagens é uma lacuna de exclusão de metadados de apresentação; não é evidência de nome armazenado em claro.

Eliminar o nome local e impedir restauração por anúncio antigo na exclusão. Tratar separadamente encerramento para todos e remoção local. Não prometer apagar o nome do aparelho dos outros por uma ação local.

Permitir perfis preparados de nome/ícone no Android por aliases de atividade, com prévia, restauração e desbloqueio preservado. Testar atualização e diferentes launchers para evitar atalhos duplicados ou ausentes. Essa aparência não oculta a existência do pacote nas configurações do sistema.

## 4. Classificação dos achados

“Reproduzido” significa comportamento observado nos testes isolados desta revisão, com as dependências indicadas simuladas. “Verificado no código” significa caminho identificado por leitura, sem reprodução integrada no APK. “Risco a validar” é uma hipótese técnica com mecanismo concreto, que exige teste adicional.

A prioridade descreve a ordem recomendada de correção neste projeto; não é uma classificação formal de vulnerabilidade.

## 5. Achados e correções propostas

| ID | Prioridade e evidência | Problema | Tratativa planejada |
|---|---|---|---|
| F01 | Alta — verificado no código | Abrir contato sempre cria outra sala, e o servidor gera novo ID por pedido | Abrir/criar atomicamente uma única conversa ativa por dupla, com repetição segura |
| F02 | Alta — verificado no código | “Apagar conversa” remove mensagens, mas mantém a sala na lista | Separar limpar e excluir, com marca local persistente |
| F03 | Alta — verificado no código | Nome, foto e fundo do grupo permanecem no perfil local após limpeza | Limpar apresentação na exclusão e bloquear anúncios antigos |
| F04 | Média — verificado no código **[revisado]** | A tela de chat **chama** a revogação da mídia antes de apagar para todos (`chat.js:245`), mas a chamada engole qualquer falha (`.catch(() => {})`) e a mensagem some mesmo assim; o servidor não vincula exclusão e revogação | Fazer o servidor revogar a mídia da mensagem na própria exclusão (ou recusar a exclusão se a revogação falhar); nunca falhar em silêncio |
| F05 | Alta — verificado no código | Encerrar vínculo fecha a sala, mas o caminho não revoga os direitos pendentes de mídia como ocorre na saída/remoção de membro | Formalizar e executar a revogação prevista no encerramento, preservando o que o protocolo permite ler até vencer |
| F06 | Alta — reproduzido com DOM simulado, R05 | Download iniciado antes da perda de foco pode terminar depois e abrir o visualizador | Cancelar operações e exigir sessão, foco, conversa e validade atuais antes de exibir |
| F07 | Alta — verificado no código | Visualizador aberto não acompanha diretamente expiração/exclusão; remover a mensagem da lista não fecha seu conteúdo aberto | Vincular visualizador ao ID, prazo e revogação; fechar e limpar também durante exibição |
| F08 | Média — reproduzido, R02 | Edição é salva localmente antes do envio e permanece mesmo quando o envio falha | Estado explícito de edição pendente, confirmação e recuperação coerente, sem falso sucesso |
| F09 | Média **[revisado]** — reproduzido para edição, R01; reação verificada no código | Edição já exige o mesmo autor (`applyEdit`), mas não a mesma conversa; reação não confere conversa nem se quem reage é membro. Exige conhecer o id aleatório da mensagem, que só circula entre membros | Validar alvo, sala, tipo, autor/permissão e prazo antes de aplicar |
| F10 | Alta para o lote — reproduzido com transporte simulado, R03 | Repetir envio após resposta perdida gera outro ID e pode duplicar mensagem | Fila cifrada e identificadores/envelopes reutilizados; reconciliar resultado incerto |
| F11 | Média — reproduzido com upload simulado, R04 | Upload concluído permanece quando publicar o envelope falha | Estado de upload pendente e revogação/limpeza com repetição segura |
| F12 | **Crítica [revisado]** — reproduzido com gravador simulado, R06; saída verificada no código. Ao sair da conversa ou o app trancar ao minimizar (padrão), a gravação **não é cancelada**: o microfone pode continuar ligado | Se criar o gravador falha após obter o microfone, as faixas não são encerradas; a limpeza da tela de chat também não cancela uma gravação em andamento | Limpeza garantida em exceções; cancelar na saída e no bloqueio, inclusive em início tardio |
| F13 | Média — verificado no código | Atualizações do menu chamam a tela de chat diretamente e descartam a nova função de limpeza | Passar pelo roteador ou atualizar a tela existente; garantir um único timer e observador |
| F14 | Alta — risco a validar | Operações assíncronas do worker de banco não têm fila explícita; escrita pode concorrer com cópia/troca durante rotação | Serialização, barreira de troca e testes de escrita/exclusão/sync durante rotação e queda |
| F15 | Média — risco de memória/performance | Cinco originais grandes e PDF com muitas páginas podem manter buffers/canvases excessivos | Orçamento de pixels/memória, processamento controlado e renderização de PDF sob demanda |
| F16 | Alta — verificado no código | Documento é disponibilizado antes de aplicar a cota em chamada separada; falha nessa chamada deixa a publicação incompleta | Tornar aplicação da cota parte da publicação autorizada, com limpeza retomável |
| F17 | **Alta [revisado]** — verificado no código, confirmar no aparelho | Abrir o seletor do sistema esconde o app; com bloqueio imediato (padrão) o app tranca e o arquivo escolhido volta para um app trancado. **Envio de documento (sempre pelo seletor) e de galeria podem não funcionar no APK** | Fluxo nativo com retorno autenticado, sem desativar o bloqueio global nem manter imagens expostas |
| F18 | Média — verificado no código | Sincronizar redesenha mensagens, mas não atualiza necessariamente os membros, liderança e encerramento usados pela tela/listagem em cache | Invalidar/atualizar o estado da sala e remover controles de envio quando necessário |

### Observações sobre os achados de privacidade

F04: o endpoint de exclusão da mensagem produz tombstones e libera cota documental, mas não vincula essa ação à revogação do MediaBox. Assim, sumir da interface não equivale a revogar o objeto enquanto seu direito e prazo continuam válidos. A correção deve ser conferida com teste de API usando a referência anterior, além do teste visual. Não é evidência de acesso público ou de quebra da criptografia.

F05: encerrar conversa deve cumprir a regra já declarada de revogar pendências. Decidir precisamente o tratamento de mídia comum já entregue versus mídia única ainda não aberta; não apagar indiscriminadamente conteúdo que a especificação mantém em leitura até vencer.

F06/F07: a nova proteção precisa alcançar foto, vídeo, áudio, documento, editor e preparação do lote. Limpar elementos da tela não substitui interromper trabalho pendente, parar microfone, liberar decodificadores e rejeitar resultados de uma sessão anterior.

F09: a reprodução usou evento de edição de um autor válido em outra sala para alterar um alvo local. Isso demonstra ausência de isolamento no caminho aplicado; não demonstra que qualquer pessoa desconhecida possa editar mensagens.

F12: a falha foi simulada no construtor do gravador. A leitura da função de limpeza da tela de chat também mostra que ela remove timers/observadores e salva rascunho, mas não chama o cancelamento do gravador. Não foi constatada gravação indevida em um aparelho real; foram constatadas essas lacunas de encerramento. Testar ainda voltar à lista, bloquear, sair do app e obter a permissão do microfone depois de uma saída.

F14: uma operação assíncrona do worker pode ceder execução para outra. A integridade da rotação precisa ser comprovada sob concorrência; os testes atuais do protocolo não validam esse caminho.

## 6. Evidência no repositório

Todos os links abaixo apontam para o commit analisado.

- [Criação de conversas e perfil local](https://github.com/Fomes1574/Private/blob/03fa5d0588a0f92721e971d6f83111bc43d91f63/app/src/session.js#L469): F01/F03/F18.
- [Menu e limpeza de conversa](https://github.com/Fomes1574/Private/blob/03fa5d0588a0f92721e971d6f83111bc43d91f63/app/src/screens/room-menu.js#L51): F02/F03.
- [Envio, edição e mídia no cliente](https://github.com/Fomes1574/Private/blob/03fa5d0588a0f92721e971d6f83111bc43d91f63/packages/client/src/client.js#L185): F08/F10/F11/F16.
- [Aplicação de edição e reação](https://github.com/Fomes1574/Private/blob/03fa5d0588a0f92721e971d6f83111bc43d91f63/packages/client/src/client.js#L415): F09.
- [Exclusão de mensagem no servidor](https://github.com/Fomes1574/Private/blob/03fa5d0588a0f92721e971d6f83111bc43d91f63/server/src/index.js#L206): F04.
- [Eventos de sala e revogação por saída/remoção](https://github.com/Fomes1574/Private/blob/03fa5d0588a0f92721e971d6f83111bc43d91f63/server/src/index.js#L186): F05.
- [Direitos de abertura de mídia](https://github.com/Fomes1574/Private/blob/03fa5d0588a0f92721e971d6f83111bc43d91f63/server/src/media.js#L58): F04/F05.
- [Visualizadores e abertura assíncrona](https://github.com/Fomes1574/Private/blob/03fa5d0588a0f92721e971d6f83111bc43d91f63/app/src/screens/viewer.js#L41): F06/F07.
- [Microfone e criação do gravador](https://github.com/Fomes1574/Private/blob/03fa5d0588a0f92721e971d6f83111bc43d91f63/app/src/audio.js#L12): F12.
- [Reconstrução da tela de chat pelo menu](https://github.com/Fomes1574/Private/blob/03fa5d0588a0f92721e971d6f83111bc43d91f63/app/src/screens/chat.js#L203): F13/F18.
- [Reconstrução do banco](https://github.com/Fomes1574/Private/blob/03fa5d0588a0f92721e971d6f83111bc43d91f63/app/src/db/db-worker.js#L223): F14.
- [Preparação de foto](https://github.com/Fomes1574/Private/blob/03fa5d0588a0f92721e971d6f83111bc43d91f63/app/src/media.js) e [PDF](https://github.com/Fomes1574/Private/blob/03fa5d0588a0f92721e971d6f83111bc43d91f63/app/src/screens/viewer.js#L116): F15.
- [Publicação documental e cota](https://github.com/Fomes1574/Private/blob/03fa5d0588a0f92721e971d6f83111bc43d91f63/server/src/index.js#L408): F16.
- [Bloqueio por visibilidade](https://github.com/Fomes1574/Private/blob/03fa5d0588a0f92721e971d6f83111bc43d91f63/app/src/main.js#L48): F17.

## 7. Testes obrigatórios antes de distribuir outro APK

### Conversas e exclusão

- Abrir o contato repetidamente, com toque duplo, pedidos simultâneos dos dois amigos e resposta de criação perdida.
- Garantir uma única sala ativa, liderança correta e confirmação de membros preservada.
- Excluir sala vazia e sala com conteúdo, reiniciar, sincronizar, bloquear/desbloquear e atualizar o app.
- Confirmar que nome do grupo, rascunho e imagem não ressurgem por eventos antigos.
- Abrir nova conversa depois de encerrar e confirmar novo ID, sem reaproveitar a sala encerrada.
- Apagar mídia para todos e testar tanto a interface quanto o direito de abertura pela referência antiga.
- Revogar direito pendente no encerramento/remoção conforme a política.

### Fotos e visualização única

- Seleções de 1, 2, 3, 4 e 5 fotos; tentativa de sexta.
- Todas as combinações de modo: são 62 configurações para lotes de 1 a 5 fotos, incluindo as 32 combinações possíveis de um lote de cinco.
- Editar cada foto, alternar miniatura, remover, substituir, adicionar e reordenar.
- Confirmar que recorte/texto/desenho/modo acompanham o ID correto da foto.
- Abrir uma foto única e confirmar que as outras continuam pendentes.
- Impedir reabertura, inclusive com abertura concorrente, retorno ao chat e reinício.
- Confirmar que o remetente não reabre e que não existem miniaturas recebidas de mídia única.
- Falha/cancelamento no preparo, no primeiro upload, no terceiro envio e depois da aceitação pelo servidor.
- Retomar somente o que falta, sem duplicar e sem mudar ordem ou modo.
- Fechar o app, bloquear tela, trocar de conversa e revogar acesso durante upload/abertura.
- Testar arquivos grandes, dimensões exageradas, formatos não suportados e permissões negadas.

### Estado e armazenamento

- Edição sem rede, edição fora de ordem e evento destinado a outra conversa.
- Escrita e sincronização durante rotação do banco; interrupção em cada etapa de troca.
- Conferir ausência de originais, EXIF, legendas, nomes e chaves em claro nos arquivos controlados pelo app e logs.
- Contadores com mensagens repetidas, vencidas, apagadas e de mídia; posição antiga no histórico.
- PDF com muitas páginas, áudio com falha de inicialização e permissões tardias.
- Verificar uso de memória, tempo de preparação e liberação de câmera/microfone.
- Manter a proteção de tela, bloqueio, cifragem e expiração após atualização.

### Compatibilidade e validação real

Rodar suítes relevantes de protocolo, cliente, servidor, cripto e interface na implementação. Registrar a versão exata do APK, commit e aparelho. Testar em pelo menos dois Androids, preferencialmente de fabricantes diferentes, inclusive aparelho com memória modesta. Se a base web compartilhada mudar, testar também navegador e iPhone/PWA suportados.

## 8. Ordem de implementação recomendada

| Entrega | Conteúdo | Condição para avançar |
|---|---|---|
| A — correções de privacidade e integridade | Revogação de mídia, bloqueio/abertura tardia, expiração durante visualização, isolamento de eventos, microfone, publicação documental e concorrência crítica | Testes de regressão e de falha cobrindo os caminhos corrigidos |
| B — conversas | Duplicação, exclusão real, limpeza de nomes, invalidar estado e corrigir ciclo de vida da tela | Não ressurgir após sincronizar/reiniciar; liderança preservada |
| C — anexos | Menu simples, lote de até cinco, edição individual, modos mistos, repetição segura e limite de memória | 62 combinações de modo e falhas parciais cobertas |
| D — lista e aparência | Prévia, remetente, não lidas e aliases de nome/ícone | Nenhum vazamento fora da sessão; atualização e launchers validados |

A documentação do repositório deve acompanhar o comportamento final, incluindo alterações de especificação necessárias. Não descrever como “testado no celular” algo validado apenas por testes simulados. Não distribuir com promessa de segurança absoluta; preservar os limites já definidos para destinatário malicioso, aparelho comprometido e fotografia externa.

## 9. Referências oficiais de experiência e plataforma

- [WhatsApp — edição de fotos e vídeos](https://faq.whatsapp.com/812276063311533): referência de interação para preparar e editar a imagem antes do envio.
- [WhatsApp — visualização única](https://faq.whatsapp.com/1077018839582332): referência de seleção explícita do modo a cada novo envio.
- [Android — Photo Picker](https://developer.android.com/training/data-storage/shared/photo-picker): acesso aos itens selecionados, seleção múltipla e limites do seletor alternativo.
- [Android — activity-alias](https://developer.android.com/guide/topics/manifest/activity-alias-element): nomes e ícones preparados para a tela inicial.

As referências guiam a experiência. O limite de cinco, os modos mistos e as regras de privacidade deste documento são requisitos do Pacto Talk.



## 10. Segunda revisão: conferência dos achados (Claude, 25/10/2026)

Conferido por leitura do código no commit `03fa5d0`. Nenhum código foi
alterado. "Confirmado" = o caminho existe como descrito.

| ID | Resultado | Gravidade revisada | Nota |
|---|---|---|---|
| F01 | Confirmado | Alta | `startDirect` sempre chama `POST /v1/rooms`, que sempre gera id novo (`index.js:177`). Cada toque na busca cria outra conversa com a mesma pessoa |
| F02 | Confirmado | Alta | "Apagar conversa (só para mim)" chama `clearRoomForMe`; a sala fica na lista |
| F03 | Confirmado | Média | `S.rooms[roomId]` (nome, foto, fundo) não é limpo |
| F04 | **Parcial** | Média | Ver linha revisada na seção 5: a revogação existe no cliente, mas é melhor-esforço e silenciosa |
| F05 | Confirmado | Alta | V7-008 manda "revoga pendências" ao desfazer vínculo; o servidor só revoga em `leave`/`remove_member` (`index.js:193`) |
| F06 | Confirmado e **maior** | Alta | `openPhoto` mostra o que chegar depois de `await load()` sem conferir foco/sessão; o mesmo vale para `playAudio`, `openText` e `openPdf`. Um áudio pode começar a tocar com o app já trancado |
| F07 | Confirmado | Média | Visualizador não acompanha vencimento/exclusão |
| F08 | Confirmado | Média | `edit()` grava local antes de enviar |
| F09 | Confirmado | Média (era Alta) | Ver linha revisada |
| F10 | Confirmado | Média | Não há repetição automática; o problema aparece quando a pessoa reenvia |
| F11 | Confirmado | Média | Objeto órfão até a regra de 16 dias e a cota |
| F12 | Confirmado e **maior** | Crítica | Ver linha revisada. Primeira correção a fazer |
| F13 | Confirmado | Média | "refresh" do menu chama `chatScreen` direto: timer de 30 s e observador acumulam a cada uso |
| F14 | Plausível | Alta | `onmessage` do worker é assíncrono e sem fila; operações intercalam nos `await`. Correção simples: fila única no worker |
| F15 | Plausível | Média | — |
| F16 | Confirmado | Média | `docs/publish` roda depois do envio; se falhar, o documento fica fora da cota de 3 |
| F17 | Confirmado no código | Alta | Ver linha revisada; testar no aparelho já |
| F18 | Plausível | Baixa | Composer continua visível se a conversa foi encerrada pelo outro lado; o envio falha no servidor |

**Avaliação geral do plano do GPT:** bom e cuidadoso. Achados corretos na
grande maioria; dois com gravidade a ajustar (F04, F09) e dois subestimados
(F12, F17). O plano de anexos (seção 2) é sólido, mas é uma funcionalidade
grande: deve vir depois das correções da entrega A.

## 11. Bugs novos encontrados nesta revisão

| ID | Gravidade | Problema | Correção proposta |
|---|---|---|---|
| N1 | Alta | A conversa é redesenhada inteira a cada 30 s e a cada sincronização e **sempre rola para o fim** (`chat.js:300-312`). Quem lê mensagens antigas é puxado para baixo; o áudio tocando perde os controles; quem está **segurando uma foto de ver uma vez** pode ter o botão trocado no meio, o que fecha a foto e gasta a única visualização | Atualizar só o que mudou (por id), rolar para o fim apenas se a pessoa já estava no fim, e nunca trocar um botão de ver uma vez enquanto está segurado |
| N2 | Baixa | Pessoas removidas do círculo continuam na busca (`S.nicknames` nunca é podado); tocar nelas dá erro do servidor | Filtrar pela lista de membros ativos |
| N3 | Baixa | Recuperação da administradora: se a pessoa cancelar a pergunta "O círculo já existe…" e tentar de novo na mesma tela, o banco local é aberto de novo com outro nome sem fechar o anterior | Voltar à tela inicial ao cancelar (recomeça limpo) |

## 12. Lista de conversas e busca (perguntas do proprietário)

**A conversa que recebe mensagem sobe para o topo?** Sim, já é assim, para
grupos e conversas individuais: a lista é ordenada pela hora da última
mensagem (fixadas primeiro, arquivadas à parte) e se atualiza a cada
sincronização (`chats.js:37`). Ressalvas:
- conversa sem mensagens fica no fim;
- por causa do F01, a mesma pessoa pode aparecer duas vezes (a conversa nova
  em cima, a antiga embaixo); corrigir o F01 resolve;
- a lista mostra só "Mensagem"/"Mídia" (sem prévia nem contador; ver
  decisão D2).

**A busca encontra "aquele_cara" e "Kara" ao digitar "ara"?** Hoje **não**.
A busca é só pelo **começo** do apelido (`searchByPrefix`, regra V7-006
"busca local por prefixo"): "aq" acha "aquele_cara", "ka" acha "Kara", "ara"
não acha nenhum dos dois. Também não busca grupos pelo nome.

**Proposta (D1):** busca por **qualquer trecho**, ignorando acento e
maiúsculas, com ordem de relevância:
1. começa com o termo ("ara" → "Ara", "Araújo");
2. começo de palavra depois de espaço, `_`, `.` ou `-` ("cara" →
   "aquele_cara");
3. em qualquer posição ("ara" → "Kara", "aquele_cara", "Clara").

Continua 100% no aparelho (o termo nunca vai ao servidor) e passa a buscar
também grupos pelo nome. Num círculo de até 10 pessoas não há custo. Exige
mudar o texto da V7-006 para "busca local por trecho".

## 13. Decisões do proprietário e ordem revisada

| ID | Decisão | Recomendação |
|---|---|---|
| D1 | Busca por trecho (seção 12) | Sim |
| D2 | Prévia do texto e contador de não lidas na lista. A especificação não proíbe dentro do app (V6-021 é sobre notificação; V6-022 sobre recibos visíveis aos outros), mas o código atual evita de propósito ("sem contagem") | Contador: sim (só local, sem recibo). Prévia: ligada com opção "Mostrar prévia na lista" em Ajustes; nunca para mídia de ver uma vez |
| D3 | "Apagar conversa" remove da lista (F02) ou só limpa mensagens | Separar em "Limpar mensagens" e "Excluir conversa", como no plano |
| D4 | Lote de até 5 fotos com modos mistos (seção 2) | Sim, mas depois da entrega A |
| D5 | Nome e ícone disfarçados (aliases) | Adiar: a especificação deixou nome/logo para depois |

**Ordem revisada:**

| Entrega | Conteúdo |
|---|---|
| A1 — urgente, pequena | F12 (microfone), F06 (abrir/tocar depois de trancar), N1 (redesenho e ver uma vez), F17 (seletor × bloqueio, testar no aparelho), F14 (fila no worker), F01 (conversa duplicada) |
| A2 | F04, F05, F16, F07, F09, F13, F18, N2, N3 |
| B | Conversas: D3, limpeza de nomes (F03), D1 busca, D2 prévia/contador |
| C | Anexos: lote de 5 (seção 2), F10, F11, F15 |
| D | Aparência (D5), se aprovado |

Cada entrega com teste automático do caminho corrigido e, para A1, teste no
aparelho (F12 e F17 dependem do Android de verdade).
