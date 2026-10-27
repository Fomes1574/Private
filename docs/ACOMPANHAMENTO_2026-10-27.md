# Publicação e acompanhamento do Pacto Talk — 27/10/2026

**Estado atualizado: API e PWA publicadas; APK de distribuição 1.0.105 publicado e verificado. Testes físicos e acompanhamento de uso continuam pendentes.**

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

## Resultado confirmado da publicação de 27/10/2026

- **API:** commit `b193fcc7fd0f4680b433193cf56ae14c840ae2f4`, [deploy aprovado](https://github.com/Fomes1574/Private/actions/runs/40549947844), versão Cloudflare `c3757985-827a-4dd0-88e8-35ba53cccb90`. Migrações e verificação de CORS passaram. GET `/v1/time` respondeu 200 e `/v1/capabilities` respondeu 401 sem autenticação, como esperado. Não foram enviados pedidos abusivos à produção.
- **PWA:** [deploy aprovado](https://github.com/Fomes1574/Private/actions/runs/40550672217), release **v2**, `versionCode 2-7f0adfd6`, código de confirmação **473a 72a5**. Os 80 arquivos publicados (5.003.646 bytes) conferem com o manifesto, a assinatura Ed25519 é válida e a chave pública é a mesma da PWA anterior. A reconstrução local com a API real e chave descartável produziu manifesto idêntico; a assinatura de produção não foi substituída. Limite: conferir uma chave entregue pela mesma origem não certifica a integridade dessa origem. No iPhone/PWA instalado: Ajustes → Atualização → Procurar atualização → conferir código → Aceitar e atualizar.
- **Android:** [Pacto Talk 1.0.105](https://github.com/Fomes1574/Private/releases/tag/android-1.0.105), versionCode 105, commit `7042febadb12636fa9423f4d7399f6f315a96683`, [assinatura/publicação aprovada](https://github.com/Fomes1574/Private/actions/runs/40554766650). SHA-256 do APK: `2e31a19bab8ea7f23e7a33c4fc4ef4ede6a85619fb7d9b95e9893eebea146f52`. Certificado permanente: `8ff069c6458f4101138f89dd857a736e796f19c76ddf84d7bf63d2d13a619665`. O download foi conferido; `devBuild`, `testHooks` e `serviceWorker` estão falsos. Esta versão substitui a 1.0.104.
- **Commit final do código:** `7042febadb12636fa9423f4d7399f6f315a96683`. O complemento altera empacotamento nativo e a barreira de publicação, sem mudar o comportamento da API ou os 80 arquivos da PWA. [CI final](https://github.com/Fomes1574/Private/actions/runs/40552419333) e [Android/emulador](https://github.com/Fomes1574/Private/actions/runs/40552419290): aprovados integralmente, tentativa 2. O registro de documentação posterior não modifica o app e usa `[skip ci]` para evitar reconstruções sem mudança de código.

### Verificações e revisão concluídas

- 17 regressões locais novas/selecionadas passaram (JSON limitado/Unicode/timeout, troca autorizada, status de pareamento, publicação e empacotamento nativo). `actionlint`, conferência do diff, Gitleaks de código/histórico e OSV passaram. A consulta OSV foi executada sem as três exceções antigas e não encontrou vulnerabilidades conhecidas no conjunto examinado. Isso não elimina vulnerabilidades desconhecidas.
- No CI funcional: protocolo 36/36, criptografia 5/5, cliente 47/47, servidor com R2 69/69; com mídia no Durable Object, 68 aprovados e um cenário exclusivo do R2 não aplicável. Interface: 69/69. O emulador Android aprovou a configuração de release, bloqueio de captura, depuração, backup e permissões conferidos pelo roteiro automatizado. Nenhum desses resultados substitui celular físico.
- A antiga pendência de acesso aos logs foi resolvida: **810 jobs históricos** recuperados, total 30.223.629 bytes. Gitleaks apontou 38 ocorrências, todas em linhas de encerramento de servidores **locais de teste** com `TOKEN_SECRET` aleatório/descartável; não são credenciais da API de produção. Os nove jobs antigos de publicação/assinatura não tiveram alertas. Não foram publicados valores desses tokens. O scanner é heurístico, não prova ausência universal de informações sensíveis.
- As releases Android 1.0.102, 1.0.103 e 1.0.104 foram baixadas, tiveram hashes e integridade ZIP conferidos e passaram na verificação independente com Google Android `apksig 8.13.0`, esquemas v2/v3, usando o mesmo certificado permanente. O scan dos binários extraídos não encontrou credenciais reconhecidas. Essa inspeção revelou `devBuild: true`; a release de distribuição final corrige a configuração, conforme ADR 0018. A release final 1.0.105 passou na mesma verificação independente v2/v3, preservou o certificado, passou na conferência de configuração extraída do APK e no scan sem credenciais reconhecidas.
- Os registros desta entrega também foram consultados. O job de assinatura/publicação da 1.0.105 passou no scan sem achados. Na análise ampliada dos arquivos de publicação, houve um token descartável de servidor local de teste e falsos positivos dos hashes públicos de arquivos nos manifestos, sem credencial de produção identificada nesses alertas. O aviso de ausência de FCM no deploy da API é esperado: não foi adicionado Firebase ao APK.

Não foi instalado SDK/Gradle no computador do trabalho nem foi alterado plano, limite pago, chave permanente ou branch. Os executores utilizados são padrão Ubuntu em repositório público. O orçamento pago deve continuar em zero; gratuidade de minutos não significa armazenamento ilimitado.

### Uso real ainda necessário

Instalar a versão final do APK **por cima do APK de distribuição**, sem desinstalar ou limpar dados. Em aparelho que ainda usa debug legado de outra chave/pacote, seguir a ressalva de recuperação/migração do ADR 0018, não tentar trocar a assinatura. Atualizar todos os membros antes de usar os novos formatos; para trocar de celular, atualizar primeiro o aparelho antigo e gerar a autorização nele.

Os cenários físicos de `TESTE_EM_CELULAR.md` permanecem sem aprovação até serem executados e registrados, inclusive cinco fotos com edição e visto único individual, câmera/microfone, bloqueio, expiração, recuperação e inspeção de resíduos de vídeo no Android. Revisão criptográfica independente, 2FA/colaboradores, permissões administrativas e escopo real dos tokens ainda não foram certificados por esta entrega.

O acompanhamento semanal de leitura por 12 semanas está ativo, sem disparar Actions/deploys ou mudar visibilidade. A observação ao longo de meses deve incluir os testes reais e correções conforme os relatos; não significa que meses de testes já aconteceram nem promete segurança de 100%. A volta a privado continua sendo uma decisão futura explícita do proprietário.
