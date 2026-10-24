# Trocar credenciais sem derrubar contas

Use quando uma credencial **pode ter sido exposta**: colada em conversa,
aparecendo em print, em log, num computador que não é seu, ou com alguém que
saiu da administração. Na dúvida, troque. Nenhum item abaixo apaga contas,
conversas ou chaves dos membros, a menos que esteja escrito.

Ordem sugerida: primeiro o que dá acesso a **mudar o sistema** (Cloudflare e
GitHub), depois o resto.

| # | Credencial | Onde está | Quem a tem consegue | Como trocar | Efeito para os membros |
|---|---|---|---|---|---|
| 1 | Login do GitHub e da Cloudflare (senha, 2FA) | Você | Tudo: mudar código, segredos, servidor | Troque as senhas; ative 2FA por app ou chave física; Cloudflare → Members e GitHub → Sessions: encerre sessões e chaves que não reconhece | Nenhum |
| 2 | `CLOUDFLARE_API_TOKEN` | GitHub Secret | Publicar outro servidor, ler o D1/R2 (só cifras e metadados) | Cloudflare → My Profile → API Tokens: crie um novo **só** com as permissões do `CLOUDFLARE_PASSO_A_PASSO.md`; atualize o segredo; **apague o antigo** (Roll/Delete) | Nenhum |
| 3 | `MP_SETUP_CODE` | GitHub Secret + Worker | Desde 24/10/2026, **recupera a conta de administradora** num aparelho novo (o aparelho dela cai). Antes de existir o círculo, cria a administradora | Gere outro com `tools/gerar-chave-de-assinatura.html` (parte 3), atualize o segredo e rode `deploy-api` | Nenhum |
| 4 | `FCM_SERVICE_ACCOUNT` | GitHub Secret + Worker | Mandar aviso **vazio** para tokens que já conheça. Não lê nada | Google Cloud → IAM → Contas de serviço → `avisos-fcm` → Chaves: crie uma nova, **apague a antiga**; atualize o segredo; `deploy-api` | Nenhum |
| 5 | Chave VAPID do Web Push | Só no Worker (o workflow gera sozinho) | O mesmo que a do FCM, para o iPhone | `npx wrangler secret delete VAPID_PRIVATE_JWK` (e `VAPID_PUBLIC`) e rode `deploy-api`, que gera outra | Quem usa iPhone precisa **ativar as notificações de novo** em Ajustes. Conta e conversas ficam |
| 6 | `GOOGLE_SERVICES_JSON` | GitHub Secret | Nada sozinho (identifica o projeto) | Não precisa trocar. Se quiser, apague o app Android no Firebase e crie outro, com novo `APK` | Reativar notificações no Android |
| 7 | `MP_RELEASE_KEY` (assinatura das versões do PWA) | GitHub Secret | Assinar uma versão do PWA. Para entregar, ainda precisaria publicar na origem do app (Cloudflare) | **Hoje não há troca suave**: o app instalado só aceita a chave antiga. Trocar significa que iPhones instalados não atualizam mais e precisam instalar de novo pela Tela de Início, migrando a conta pelo "Já uso em outro celular". Melhor: trocar 1 e 2 (sem Cloudflare, a chave sozinha não entrega nada) e marcar como pendente uma "versão de passagem" (assinada pela antiga, trazendo a nova) | Ver coluna anterior |
| 8 | `ANDROID_SIGNING_KEY` (APK) | GitHub Secret + sua cópia offline | Assinar um APK que **atualiza por cima** do app de todos | O Android aceita troca de chave com prova da antiga (APK Signature Scheme v3, `apksigner rotate`). Gere a nova pela página; crie a linhagem antiga→nova com `apksigner rotate --out linhagem --old-signer --key antiga.der --cert antiga.pem --new-signer --key nova.der --cert nova.pem`; assine o próximo APK com a linhagem. Atualize segredos e `ANDROID_CERT_SHA256`. Este caminho **ainda não está no workflow**: pendente, e precisa de teste no aparelho | Com a linhagem: nenhum. Sem ela: ninguém atualiza; seria outro pacote e migração de todos |
| 9 | `PROVA_*` | GitHub Secret | Só as provas de conceito | Gere outros e atualize | Nenhum |
| 10 | Código de emergência de alguém | Com a pessoa | Destruir os aparelhos da conta (não lê nada) | Ajustes → Código de emergência → criar novo (o antigo deixa de valer) | Nenhum |
| 11 | PIN de alguém | Com a pessoa | Com o celular na mão + biometria: abrir o app | Por enquanto: trocar de aparelho pelo "Já uso em outro celular" com PIN novo | Histórico local não passa |

## Depois de trocar

- Rode `deploy-api` (itens 2–5) e confira que terminou verde, inclusive a verificação de CORS.
- Mande mensagens de teste entre dois membros. Se o item 5 foi trocado, ative de novo as notificações no iPhone.
- Anote a data e o que foi trocado (sem o valor) em `ACOES_DO_PROPRIETARIO.md`.

## O que não muda nunca

As chaves de conversa (Olm) e as chaves dos bancos ficam **só nos
aparelhos**. Nenhuma credencial do servidor dá acesso ao conteúdo das
mensagens. Por isso, trocar credenciais do servidor não exige refazer contas.
