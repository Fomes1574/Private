# ADR 0018 — Admissão de troca, limites de entrada e publicação verificada

Data: 27/10/2026. Estado: implementação autorizada pelo proprietário, validação e publicação acompanhadas no GitHub.

O proprietário tornou o repositório público em 27/10 para usar executores padrão gratuitos do Actions. O projeto permanece na branch `ccr-de59a90b-gr4vug`, sem nova branch, force-push, plano pago ou aumento de orçamento. Esta decisão substitui temporariamente o código fechado de V7-001; a visibilidade será reavaliada após acompanhamento, sem promessa de recolher material já público.

## Admissão antes de reservar uma troca (E02)

Um limite global de 21 pedidos anônimos permitia ocupar a fila sem conta. Aumentar o limite, retirar a expiração ou depender apenas de IP não resolve a disputa por vagas. Agora o aparelho ativo gera uma autorização aleatória de 144 bits, de uso único, válida por cinco minutos. O servidor guarda somente seu hash, uma autorização por identidade. A emissão exige sessão ativa; dispositivos pendentes não a emitem.

O novo aparelho informa a autorização em POST; ela nunca entra em URL, log ou armazenamento do navegador em texto claro. Sem autorização válida, nenhum pedido ou cofre é criado. O início é serializado no Durable Object; a autorização é consumida antes de criar o pedido. Uma nova tentativa substitui somente a tentativa daquela identidade, sem remover as de outras pessoas. Só o dono da autorização pode aprovar. A troca continua em duas fases: o antigo permanece ativo até o novo guardar as chaves e confirmar.

**Compatibilidade:** atualize primeiro o aplicativo no aparelho antigo, por cima da instalação, antes de iniciar uma troca. A versão antiga não tem a emissão da autorização e não pode iniciar novas trocas após esse deploy. Pedidos já iniciados antes do deploy ainda podem ser aprovados; recibos novos vinculam pedido e aparelho. Uma aprovação anterior ao deploy, cujo servidor antigo não deixou recibo, pode ser retomada pelo cliente atualizado mediante assinatura ECDSA P-256 com a chave privada já guardada. Conhecer somente a chave pública não revela identidade ou deviceId (E04).

O APK de debug legado que usa outra chave/pacote não pode ser atualizado por cima. Seu roteiro anterior de migração deve ser concluído antes desse deploy; depois, para a administradora, usar a recuperação existente com o código de instalação (mesma identidade, sem transferir histórico). Para outros membros legados, usar a recuperação já prevista com administradora/guardião. Não desinstalar nem limpar o aparelho antigo como tentativa de resolver uma troca. Esse limite não se aplica à atualização normal do APK de distribuição assinado com a chave permanente.

## Limite de JSON antes de acumular dados (E03)

O leitor conta bytes recebidos, independentemente de Content-Length, e cancela o fluxo no primeiro excesso (413). UTF-8 é decodificado incrementalmente; caracteres multibyte não furam a cota. Há prazo total de 15 segundos (408) para o corpo, cancelamento sem aguardar um remetente que não fecha e recusa de JSON inválido/não objeto (400). Upload binário continua usando os limites próprios de mídia. Isso reduz consumo de memória por pedido; não promete imunidade a DDoS ou indisponibilidade do provedor.

## Cadeia de publicação

- Actions externos fixados em SHAs completos obtidos nos repositórios oficiais, preservando as versões utilizadas.
- Publicações somente da branch autorizada, após sucesso do CI no mesmo SHA. APK exige também sucesso do teste Android nesse SHA.
- Tokens da Cloudflare deixam de estar disponíveis durante instalação/testes. Instalações de publicação usam `npm ci --ignore-scripts`. O processo de deploy ainda precisa confiar na ferramenta Wrangler e no código revisado que executa: escopo por etapa não equivale a isolamento completo entre máquinas.
- A assinatura permanente e a conferência do certificado do APK são preservadas. Não se gera uma nova chave para substituir a do app instalado.
- Limites de duração dos jobs, cancelamento de Android obsoleto e retenção de um dia para APK de diagnóstico reduzem desperdício. Publicações permanecem manuais; nenhum agendamento publica automaticamente.
- `undici` fixado em `7.30.1` nas quatro ferramentas afetadas. Os três avisos conhecidos não ficam mais ocultos por exceções. Antecipamos a espera de duas semanas anotada no arquivo anterior por ser correção de segurança; o diff dos lockfiles muda somente esse pacote, com integridade obtida do registro oficial. OSV atualizado não encontrou avisos no conjunto examinado.

## Validação

### Inspeção do APK publicado e correção complementar

A inspeção binária da release 1.0.104 encontrou `devBuild: true`, também presente nas releases 1.0.102/103. Isso mantinha o console JavaScript de diagnóstico ativo no APK, contrariando o comentário de produção em `main.js`. Não é um gancho de teste (`testHooks` estava falso), mas é uma falha de configuração de privacidade.

O empacotamento nativo de produção passa a informar `MP_NATIVE_RELEASE=1`: não precisa da chave Ed25519 da PWA, pois a integridade do APK usa a assinatura nativa permanente. Exige modo plain, CSP no HTML e hooks desligados; configura `devBuild: false` e desliga o console pelo guard já existente. O build comum de desenvolvimento continua marcado. Os workflows extraem `config.js` do APK efetivamente assinado e o validam antes de publicar ou testar no emulador. Há regressões de configuração válida, diagnóstico indevido e combinações inseguras. A próxima release substitui 1.0.104; API e PWA não mudam de comportamento por essa correção exclusiva do empacotamento Android.

Regressões com SQLite real, fluxo limitado/cancelado, Unicode, timeout, autorização única/expirada, concorrência de replay, isolamento entre pessoas, recibo após reinício, revogação e prova da chave privada. Os testes de API, cliente e interface foram atualizados para exercitar a autorização real. CI e Android da implementação devem passar antes da publicação; resultados atuais em Actions. Os cenários de aparelho físico continuam pendentes até execução registrada.

Referências: [OWASP DoS](https://cheatsheetseries.owasp.org/cheatsheets/Denial_of_Service_Cheat_Sheet.html), [OWASP REST](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html), [GitHub Actions seguro](https://docs.github.com/en/actions/reference/security/secure-use), [aviso undici](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c).
