# Pacto Talk — correções da revisão independente

Data: 25/10/2026. Base examinada: `0148888cd2c6ea72abd2877ec163ca9990dfc939`. Trabalho feito diretamente em `ccr-de59a90b-gr4vug`, conforme autorização do proprietário. Não foi criada branch de entrega.

## Resultado e limites

Foram implementadas correções para os 13 achados da revisão. A revisão anterior não aprovava a entrega; os testes antigos passavam, mas não cobriam esses casos. Este documento registra o comportamento novo e a evidência adicionada. **Distribuição ainda depende do Actions e da validação em aparelhos.** Não houve deploy, alteração de cobrança, assinatura com a chave permanente nem publicação de APK.

A correção de S12 protege o **estado migrado**, com S e DEK novas. Ela não consegue apagar retroativamente uma S em claro de snapshots legados nem inutilizar cópias antigas do aparelho já capturadas com os segredos necessários. Essa limitação foi mantida nos testes e no ADR 0017. Não é correto afirmar que todo o histórico de 30 dias passou a ser irrecuperável.

## Rastreabilidade das correções

| Achado | Comportamento implementado | Evidência principal |
|---|---|---|
| R01 — S12 legado | Migração em duas fases, S/KEK/DEK novas, reconstrução do banco e troca atômica do registro; marcador para retomar commit; exclusão de chaves com retry durável | `server/test/review-storage.test.mjs`, `app/test/review-ui.test.mjs`, `app/test/vault-migration.test.mjs`, migração histórica |
| R02 — círculo sem lista | Bloqueio por padrão; apresentação do próprio perfil somente à administradora fixada; confirmação explícita; revisão crescente e chave da administradora vinculada à confiança | Testes Olm/API em `packages/client/test/review.test.mjs`, `a2.test.mjs`; ingresso pela interface |
| R03 — chave trocada durante conferência | Confirmação condicionada às duas chaves mostradas; recusa se mudaram | Teste de interface e teste do núcleo |
| R04 — câmera tardia do QR | Encerra todas as tracks recebidas depois de cancelar/trancar | Teste do fluxo real no Chromium com permissão adiada |
| R05 — concorrência | Fila serial para as operações de Olm/sync/envio; atualização serial e sem sobrescrever a fila | Trinta enfileiramentos concorrentes; envios/sync concorrentes com Olm real |
| R06 — recusa temporária | 429/503 e demais falhas transitórias conservam o envio; backoff e `Retry-After`; falha terminal visível, removível e com retry explícito | Testes de status HTTP, expiração e falha de disco; CORS expõe `Retry-After` |
| R07 — anotações vencidas | Remove do KV, pede rotação e limpa a tela no prazo; verifica também na sincronização/desbloqueio | Banco e DOM conferidos com relógio controlado |
| R08 — papel de parede retido | Excluir conversa elimina o wallpaper local; a tela encerra seus object URLs ao sair | Teste de armazenamento e cancelamentos dos visualizadores |
| R09 — lote interrompido | Lote cifrado e durável antes de transmitir; blocos de 192 KiB; manifesto e ids estáveis; upload repetível; sync não transmite durante a preparação; confirmação já recebida não vira falsa falha | Cinco fotos com modos mistos, queda/reinício, resposta de upload perdida, múltiplos blocos, cancelamento, expiração e concorrência; teste completo pela interface |
| R10 — marcas apagadas | Desenhos/textos usam coordenadas da imagem original e recebem a transformação de giro/recorte junto dela | Contagem de pixels antes/depois de quatro giros; edição no fluxo completo |
| R11 — anexos repetidos | Câmera, Galeria e Documento; foto única e lote usam a mesma preparação, com “1” individual e HD; modos da câmera ficam dentro dela; enquete no menu da conversa | Todas as 62 combinações de 1–5 fotos no componente; fluxos principais no app |
| R12 — retorno nativo errado | Ação `wallpaper` retoma `setWallpaper`, sem usar o visual compartilhado do grupo | Bridge nativa simulada: desbloqueio, leitura em blocos e gravação local; zero requisições ao visual de grupo |
| R13 — revogação com R2 indisponível | Revoga direitos antes da limpeza; persiste intenção e alarme no MediaBox e na conversa; abertura de mídia única confere encerramento/participação | SQLite real com R2/RPC falhando, reinicialização da classe e alarme; API nos dois backends |

O envio único continua recusando reabertura pelo remetente após confirmação. A chave de uma mídia **ainda pendente** fica no cofre cifrado para terminar o envio; sai quando confirma ou cancela. Limpar/excluir conversa cancela os pendentes. Um item cuja preparação foi interrompida não transmite conteúdo incompleto.

A API nova precisa ser publicada primeiro: o cliente verifica `mediaUploadIds` antes de enviar bytes. A API anterior ignorava esse identificador e poderia criar outro objeto a cada tentativa. Falha por incompatibilidade permanece na fila para tentar depois da atualização ou remover.

Também foi corrigido o aborto de `idbPutMany`: uma exceção síncrona em uma escrita intermediária não pode deixar escritas anteriores confirmarem sozinhas. No Android, o flag do teclado usa `EditorInfoCompat`, e as permissões foram ordenadas antes da aplicação no manifesto. Não foram removidos recursos que o Capacitor carrega dinamicamente apenas porque o lint os considera sem referência.

## Validação

| Verificação | Resultado |
|---|---|
| Protocolo | 36/36; repetido em `Asia/Tokyo`, 36/36 |
| Criptografia/WASM | 5/5 |
| Cliente com servidor e Olm reais | 47/47 |
| Servidor, mídia R2 | 60/60 |
| Servidor, mídia no Durable Object | 59/59 aplicáveis; 1 teste exclusivo de R2 ignorado como previsto |
| Interface, todos os arquivos | 67/67, incluindo migração histórica e falhas de migração |
| Combinações do lote | 62 combinações no componente; lote real de cinco fotos com três únicas e falha no quarto upload |
| Worker | `wrangler deploy --dry-run` passou |
| Scanner de blobs Android, autotestes | 3/3 |
| Android | `assembleRelease test lintRelease lintDebug` passou; zero erros de lint |
| APK de teste | Assinatura v2/v3, certificado esperado, pacote, versão, permissões, ausência de backup/cleartext e arquivos sensíveis: aprovado |
| Conteúdo do APK | Todos os arquivos web empacotados conferidos byte a byte com o build final |
| Segredos na árvore atual | Gitleaks 8.30.1: nenhum segredo detectado na exportação de 448 arquivos do repositório |
| Dependências | OSV Scanner 2.6.0: nenhuma ocorrência fora das exceções vigentes do projeto |

A compilação Android usou JDK 21, SDK 36 e as versões de Gradle/AGP do projeto. Downloads das ferramentas e JDK foram conferidos pelos checksums publicados; arquivos extraídos do JDK também tiveram seus tamanhos conferidos. A assinatura foi feita com chave descartável, depois eliminada. Origem `https://api.invalid`: este APK serve somente para validar compilação e empacotamento, não para instalação de uso. As duas variantes executaram o teste unitário Android já existente; isso não é instrumentação de aparelho.

O lint ficou com 16 avisos em debug e 17 em release: recursos/ícones do template, pasta de versão redundante e uma sugestão de versão mais nova de AppCompat. Nenhum é erro bloqueante. Não foi feita atualização de dependências apenas por haver uma versão nova. O Gitleaks verificou a árvore atual, não substitui o exame do histórico completo no CI. O OSV manteve as três exceções preexistentes de undici nas ferramentas de desenvolvimento (`GHSA-xjj6-f33q-929c`, `GHSA-4qv8-2p9j-2685`, `GHSA-f72v-6w45-q472`, 12 ocorrências nos lockfiles), com vencimento em 30/10/2026. Não foram acrescentadas exceções nem relaxados os scanners. Isso não significa ausência de vulnerabilidades conhecidas nessas ferramentas; elas não integram o APK/PWA/Worker de produção. Os builds Rust reproduzíveis e `cargo audit` do CI não foram repetidos localmente: a toolchain Rust não está instalada; os módulos WASM e seus testes foram conferidos e executados.

Os testes usam API/workerd, D1, R2 local, Durable Objects, WASM Olm e SQLite/OPFS reais quando indicado. Testes de falhas isoladas usam SQLite real e serviços externos instrumentados, sem substituir a implementação de metadados. Testes de câmera/bridge usam recursos simulados no Chromium: isso não equivale a testar a câmera/galeria do celular.

O snapshot histórico `3fa1985c7b6686629c02e239e520bb00eda9aa76` foi recuperado pela API do GitHub: **366 blobs conferidos pelo SHA Git**, sem inventar histórico ou criar branch. O teste de migração aceita `MP_MIGRATION_OLD_DIR` para esse snapshot; no CI continua usando o worktree destacado do commit histórico.

O ambiente necessita de um adaptador externo de loopback para o Wrangler, porque a enumeração de interfaces é bloqueada. Esse adaptador não foi incluído no projeto. Testes que reconstroem `app/dist` foram executados em sequência. As portas da suíte principal podem ser configuradas para evitar processos antigos do ambiente, sem mudar assertivas.

Foi identificada uma armadilha no teste: nesta versão de Playwright, `waitForFunction` considera a Promise da função assíncrona como truthy antes da condição resolver. `waitForPage` aguarda cada avaliação no Node e possui teste contra falsa aprovação e timeout. A espera vazia antiga foi retirada. O teste das cinco fotos passou a aguardar a conclusão real da tentativa de envio.

## Investigação do GitHub Actions

### Evidência da conta/repositório

Foram consultados os **134 runs** existentes no recorte de 23–25/10 e seus **968 jobs**. Destes, 810 tiveram executor; 158 não tiveram. Na última execução da base analisada:

- CI: [40222930584](https://github.com/Fomes1574/Private/actions/runs/40222930584), criado às 18:47:38 UTC e finalizado às 18:47:41 UTC (15h47 em Brasília), sem executor/steps nos jobs bloqueados.
- Android: [40222930556](https://github.com/Fomes1574/Private/actions/runs/40222930556), mesmo padrão; job `121258220440`, `runner_id: 0`, steps vazios.
- Primeira falha inteiramente sem executor: [40197466994](https://github.com/Fomes1574/Private/actions/runs/40197466994), às **13:24:31 UTC / 10:24:31 de Brasília em 25/10**, commit `9965770`.
- Último CI bem-sucedido observado: [40103517148](https://github.com/Fomes1574/Private/actions/runs/40103517148), em 24/10, commit `03fa5d0`.
- O conteúdo de `ci.yml` nessa execução bem-sucedida é idêntico ao da falha atual: blob `b8aaa9a1a40a252ab08cc27b6a02418684fc9b94`.

Portanto, essas falhas ocorrem **antes de checkout, compilação e testes**. Não constituem evidência de erro do código do APK ou de um passo do workflow. Não existe log de compilação desses jobs, porque ele nunca começou.

### Estimativa e conclusão

Excluindo nove runs internos do Dependabot, restam **801 jobs com executor**, com aproximadamente **1.551,42 minutos decorridos**. Arredondando cada job para o minuto seguinte, conforme o cálculo documentado pelo GitHub, a estimativa é **2.037 minutos**. Esses jobs já tinham terminado antes da primeira falha sem executor. Não foram somados custos de outros repositórios nem tentativas anteriores de reexecução não retornadas na coleta.

O plano GitHub Free inclui 2.000 minutos; quota esgotada sem forma de pagamento válida bloqueia o uso, e contas com pagamento também podem ser limitadas por orçamento. **Esgotamento da franquia/bloqueio de cobrança é a hipótese principal, fortemente compatível com o momento e o padrão.** A estimativa não é uma fatura oficial: plano, franquia efetiva, orçamento e a annotation exata da conta não foram acessíveis pela conexão disponível.

O endpoint legado de timing retornou zero inclusive para execuções que tiveram runners e passos bem-sucedidos. Ele está em descontinuação; esse zero não prova uso zero. O status público do GitHub consultado não indicava incidente ativo em Actions, o que também não elimina um problema específico da conta.

A tentativa autorizada de consultar a conta pelo navegador não concluiu: o GitHub informou falha ao validar a resposta do provedor de login social. Não houve nova tentativa automática de contornar esse bloqueio. Nenhuma credencial foi colocada em código, relatório, commit ou log do projeto.

### Como fechar o diagnóstico e desbloquear

1. Na execução, abrir **Annotations**, e na conta proprietária abrir **Settings → Billing and licensing → Usage** e **Budgets and alerts**. A interface pode mostrar o uso como valor monetário. Conferir Actions, armazenamento compartilhado com Packages, franquia e eventuais pagamentos pendentes.
2. Se a causa for minutos: o proprietário pode aguardar a renovação do ciclo ou escolher uma forma de pagamento/plano e orçamento que autorize uso adicional. Apenas limpar artefatos não devolve minutos já consumidos. Nenhuma dessas decisões financeiras foi executada nesta revisão.
3. Com GitHub CLI autenticado na própria máquina, o diagnóstico somente leitura permite obter a annotation exata:

   ```sh
   node scripts/diagnosticar-actions.mjs Fomes1574/Private 40222930584
   ```

   O script consulta run/jobs/checks/annotations. Não imprime token, não baixa logs, não reexecuta jobs e não altera a conta. Seu parser e suas recusas de argumentos são testados em `server/test/actions-diagnostic.test.mjs`. A leitura autenticada das annotations privadas não pôde ser executada neste ambiente.
4. Depois de desbloquear, exigir CI verde e gerar a distribuição com a chave permanente. Não tornar o repositório público, retirar verificações ou trocar o runner por uma máquina desconhecida como solução.

Diminuir recompilações repetidas de ferramentas Rust/Go por meio de caches de versões fixadas é uma melhoria futura de custo. Não resolve uma franquia já esgotada e não substitui os testes. Os workflows existentes foram mantidos nesta correção.

## Antes de distribuir

- Publicar API e aplicar migrações D1 pendentes; depois atualizar os clientes juntos. Conferir aprovação do círculo e números de segurança.
- Validar os cenários 11–16 de `TESTE_EM_CELULAR.md`, incluindo o scanner S2 de temporários WebView com vídeo grande. O autoteste do scanner passa; a inspeção de um aparelho real não foi realizada.
- Validar Android com teclado real, cancelamento de permissões, seleção de cinco fotos, bloqueio durante edição/envio e retomada offline; validar o iPhone/Safari real. O pedido de teclado anônimo depende do IME e pode ser ignorado.
- Confirmar CI verde e assinatura permanente antes de liberar. Um APK local de teste não atualiza a distribuição existente.

## Referências primárias consultadas

- [GitHub: cálculo do tempo de cada job](https://docs.github.com/en/actions/how-tos/monitor-workflows/view-job-execution-time)
- [GitHub: franquias, bloqueio, orçamento e cobrança](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [GitHub: investigação de falhas de workflows](https://docs.github.com/en/actions/how-tos/troubleshoot-workflows)
- [GitHub: endpoint legado de runs/timing](https://docs.github.com/en/rest/actions/workflow-runs#get-workflow-run-usage)
- [Status oficial](https://www.githubstatus.com/api/v2/summary.json)
- [Cloudflare: alarmes e repetição de limpeza](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [Cloudflare: SQLite e recuperação histórica](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [RFC 9110: idempotência e Retry-After](https://www.rfc-editor.org/rfc/rfc9110.html)
- [OWASP: gestão e substituição de chaves](https://cheatsheetseries.owasp.org/cheatsheets/Key_Management_Cheat_Sheet.html)
- [IndexedDB: transações e durabilidade](https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/transaction)
- [MediaStreamTrack.stop](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/stop)
- [Android: flag compatível de teclado](https://developer.android.com/reference/androidx/core/view/inputmethod/EditorInfoCompat)
- [WhatsApp: mídia de visualização única](https://faq.whatsapp.com/1077018839582332)
