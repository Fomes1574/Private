# Publicação e acompanhamento do Pacto Talk — 27/10/2026

O proprietário autorizou manter o repositório público para publicar atualizações e acompanhá-las por meses. Branch única: `ccr-de59a90b-gr4vug`. Custo permitido: R$ 0. Não mudar planos, orçamento, chave permanente, banco de produção ou visibilidade automaticamente.

## Ponto de partida confirmado

Antes desta entrega, API e APK de distribuição estavam no commit `bbe5965`; a release Android disponível era `1.0.103`. A PWA publicada correspondia ao commit `4aec89a`, versão `1-8d767387`, com 59 recursos conferidos por SHA-256. As correções `0148888` e `b59e7d7` não tinham sido publicadas.

Após a abertura, o CI antes bloqueado (`40236767765`, tentativa 2, commit `b59e7d7`) passou integralmente. Isso confirma a volta dos executores; não publica nem aprova automaticamente as correções novas.

## Conteúdo desta entrega

- Todas as melhorias anteriores de A1/A2/B/C/D e da revisão de cofre, mídia e fila durável continuam no histórico.
- Correções E02/E03/E04: autorização antes de reservar troca; limite de JSON durante a leitura; status ligado ao pedido/aparelho e prova de chave para retomada legada.
- Fortalecimento de Actions/publicação e atualização de `undici`, conforme ADR 0018.
- Abertura para testes pelo proprietário não significa auditoria criptográfica independente concluída, nem testes físicos já realizados.

## Ordem para chegar ao aplicativo instalado

1. Aguardar CI e Android verdes para o **mesmo SHA desta entrega**. Não usar o sucesso de um commit anterior como aprovação do novo.
2. Antes de publicar API, não deixar nenhuma troca de aparelho em andamento. Atualização normal do APK de distribuição é feita por cima; não desinstalar.
3. Executar `deploy-api`, branch autorizada, confirmação `PUBLICAR-API`. Ele aplica migrações D1, publica a API e verifica CORS de PWA/Android. Conferir sucesso e GET público `/v1/time`; `/v1/capabilities` deve ser reconhecido e negar acesso anônimo com 401.
4. Executar `deploy-app`, mesma branch/SHA, confirmação `PUBLICAR-APP`. Guardar o código da release assinada mostrado no resumo. PWA instalada exige aceitar a atualização pelo fluxo de Ajustes e conferir esse código.
5. Executar `android-release`, mesma branch/SHA, confirmação `PUBLICAR-APK`. Conferir certificado permanente e SHA-256. Baixar o APK da nova GitHub Release e instalar **por cima**, primeiro em um aparelho de teste, sem apagar dados. Todos os membros precisam atualizar para usar os novos formatos.
6. Conferir as versões e executar `TESTE_EM_CELULAR.md` em dois aparelhos. Atualizar o aplicativo no celular antigo antes de usar a nova troca autorizada. Atenção à exceção do debug legado, descrita no ADR 0018 e no roteiro de migração.

Cada publicação continua sujeita ao sucesso real do respectivo workflow e às credenciais já configuradas. Um commit/push, um APK de debug ou um teste com chave descartável não substitui a distribuição.

## Acompanhamento por três meses

Foi criado um acompanhamento semanal somente de leitura, por 12 semanas, começando em 28/10/2026 pela manhã, horário de Brasília. Ele consulta CI, publicações e pendências registradas e envia um resumo ao proprietário. Não dispara testes/deploys nem altera o repositório. Uma consulta semanal não mede disponibilidade continuamente e não usa um celular real.

Os testes automáticos completos continuam em cada alteração de código. Não executar testes pesados repetidamente sem mudança ou falha que justifique. Manter limite pago de US$ 0, executores padrão e atenção também ao armazenamento; a gratuidade de minutos públicos não torna ilimitados os demais recursos. Antes de voltar a privado, conferir saldo dos 2.000 minutos e reservar 500 minutos para manutenção.

Durante o uso real, registrar data, versão do app, modelo e Android/iOS, passos e resultado dos cenários: atualização preservando dados; cinco fotos com edição/visto único individual; fila offline; prévias/não lidas; conversas duplicadas/exclusão; mídia após bloqueio; microfone após interrupção; prazos/revogação; troca e recuperação. Usar dados sintéticos; não anexar conversas, fotos pessoais, códigos de instalação, autorizações ou chaves em issues/logs.

## Para reavaliar a volta a privado

- CI e Android verdes no commit efetivamente publicado; API/PWA/APK identificados e sem divergência pendente.
- Cenários físicos marcados com evidência pelos testadores, incluindo celular Android de outro fabricante e PWA no iPhone.
- Nenhuma falha grave de privacidade/segurança aberta; dependências consultadas novamente no momento da decisão.
- Revisar registros antigos do Actions e os binários de distribuição ainda não inspecionados. A auditoria anterior não conseguiu recuperar todos esses logs; tornar público não elimina essa pendência.
- Confirmar colaboradores, 2FA, permissões de publicação e escopo das credenciais pelo painel. Não presumir que o CI valida configurações administrativas.
- Decisão explícita do proprietário. Não existe prazo de observação que prove segurança de 100%, nem recuperação garantida de material publicado.

## Registro de execução

No commit que introduz este documento, as regressões locais de segurança/publicação passaram (15 testes), actionlint passou e OSV não encontrou vulnerabilidades conhecidas no conjunto examinado. O dry-run da API montou o Worker. A execução integrada local não pôde validar os cenários: o ambiente bloqueia a enumeração de interfaces de rede usada pelo Wrangler (`uv_interface_addresses`, EPERM). Esses cenários devem ser aprovados pelo CI real, sem retirar verificações nem chamar tentativas locais de sucesso.

Este registro descreve preparação e critérios. O resultado de publicação e os links da versão distribuída devem ser conferidos nos workflows/releases e no relatório final entregue ao proprietário; não se afirma aqui que já houve deploy.
