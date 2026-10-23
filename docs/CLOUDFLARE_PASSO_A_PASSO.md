# Cloudflare + GitHub: passo a passo completo

Três publicações, nesta ordem: **provas** (testes no celular), **API** e
**app**. Tudo sai pelo GitHub Actions; ninguém (nem eu) vê token ou senha.

## Onde fica cada coisa (Arquitetura A, §8 — detalhes no ADR 0013)
- **D1** (banco `mp-db`): mensagens cifradas, prazos, "apagar para todos",
  membros das conversas e a cota de espaço.
- **R2** (bucket `mp-media`): fotos, vídeos, áudios, documentos e fotos de
  perfil/grupo, só cifrados. Regra do bucket apaga mídia com mais de 16 dias.
- **Durable Objects**: "ver uma vez", conversas, identidades/convites,
  cota de documentos, tempo real.
- **Workers**: a API (`mp-api`), o app (`mp-app`) e as provas (`mp-provas`).
Tudo isso é criado pelos workflows; você não cria nada à mão.

## 0. Qual conta da Cloudflare
A mídia cifrada (fotos, vídeos, áudios, documentos) fica no **R2**, como na
Arquitetura A (V6-006/V6-007). O R2 só funciona em conta **com cartão**.
**Recomendado: uma conta nova, só para o Mensageiro, com cartão cadastrado.**
- Se a conta ou um token do Quiz Gomes vazar, o Mensageiro não vai junto (o
  servidor é a ameaça nº 1, V7-014), e os custos ficam separados.
- Franquia grátis do R2: 10 GB-mês, 1 milhão de gravações e 10 milhões de
  leituras por mês, saída grátis. Acima disso, cerca de US$ 0,015 por GB-mês.
- Em **Notifications** da Cloudflare, crie um alerta de cobrança por uso
  ("Usage Based Billing"), se aparecer na sua conta, para saber antes.
Se usar a conta do Quiz, os passos são os mesmos; só crie um token novo
(passo 4) e não reaproveite o do Quiz.

## 1. Conta e verificação em duas etapas
1. `dash.cloudflare.com` → Sign up com um e-mail só seu → confirmar e-mail.
2. Plano **Free**. Não adicionar site/domínio.
3. Ícone de pessoa → **My Profile → Authentication** → ativar 2FA (chave
   física, passkey ou app autenticador; nunca SMS). Guardar os códigos de
   recuperação impressos, fora do computador.
4. No GitHub: **Settings → Password and authentication** → 2FA também.

## 2. Subdomínio workers.dev
1. Menu **Workers & Pages** (ou **Compute (Workers)**).
2. Escolher um subdomínio neutro (sem seu nome e sem "mensageiro"), ex.:
   `ipe-azul-37`. Ele define os três endereços:
   - provas: `https://mp-provas.SUB.workers.dev`
   - API: `https://mp-api.SUB.workers.dev`
   - app: `https://mp-app.SUB.workers.dev`

## 3. Account ID
Em **Workers & Pages**, coluna da direita: **Account ID**. Copiar.

## 4. Token de API (só para o GitHub publicar)
1. **My Profile → API Tokens → Create Token → Create Custom Token**.
2. Nome: `deploy-github`.
3. Permissões:
   - `Account` · `Workers Scripts` · `Edit`
   - `Account` · `D1` · `Edit`
   - `Account` · `Workers R2 Storage` · `Edit`
4. Account Resources: `Include` · a conta do Mensageiro.
5. TTL: data de fim (ex.: 90 dias). Renovar quando vencer.
6. Create Token → **copiar** (aparece uma vez só).
Se um deploy falhar com "Authentication error [code: 10000]", edite o token e
acrescente `Account` · `Account Settings` · `Read`.

## 5. Chave de assinatura das versões do app
1. Baixe o repositório (GitHub → Code → Download ZIP) ou só o arquivo
   `tools/gerar-chave-de-assinatura.html`.
2. Abra o arquivo **direto do computador** (duplo clique) no Chrome, Edge,
   Firefox ou Safari atualizados. Funciona sem internet.
3. Toque em **Gerar chave**. Copie a **chave privada** inteira (com as linhas
   BEGIN/END) e guarde também no gerenciador de senhas. Anote a **chave
   pública** (pode mostrar).

## 6. Segredos no GitHub
Repositório → **Settings → Secrets and variables → Actions → aba Secrets →
New repository secret**:

| Nome | Valor |
|---|---|
| `CLOUDFLARE_API_TOKEN` | token do passo 4 |
| `CLOUDFLARE_ACCOUNT_ID` | Account ID do passo 3 |
| `PROVA_TOKEN_SECRET` | 40+ caracteres aleatórios (gerador de senhas) |
| `PROVA_ACCESS_CODE` | código que você digita na Prova 5 (ex.: 4 palavras) |
| `MP_SETUP_CODE` | 20+ caracteres aleatórios; usado **uma vez** para criar a administradora |
| `MP_RELEASE_KEY` | chave privada do passo 5 (texto inteiro) |

Guarde `PROVA_ACCESS_CODE` e `MP_SETUP_CODE` no gerenciador de senhas.

## 7. Variáveis no GitHub (não são segredo)
Mesma tela → aba **Variables → New repository variable**:

| Nome | Valor |
|---|---|
| `MP_API_ORIGIN` | `https://mp-api.SUB.workers.dev` |
| `MP_APP_ORIGIN` | `https://mp-app.SUB.workers.dev` |

(troque `SUB` pelo subdomínio do passo 2; sem barra no final)

## 8. Publicar (Actions → nome do workflow → Run workflow → branch `ccr-de59a90b-gr4vug`)
1. **deploy-provas** → digite `PUBLICAR`.
2. **deploy-api** → digite `PUBLICAR-API`. Cria o banco D1 e o bucket R2
   `mp-media` (com a regra que apaga tudo com mais de 16 dias), aplica as
   migrações, publica e grava os segredos (as chaves de notificação são
   geradas lá dentro e ninguém vê a privada).
3. **deploy-app** → digite `PUBLICAR-APP`. No resumo da execução aparece
   versão, código e **chave pública**: confira se é a mesma do passo 5.
Se algum ficar vermelho, o primeiro passo ("Conferir segredos…") diz o que
falta, sem mostrar valores.

## 9. Primeiro uso (você = administradora)
1. No iPhone, Safari: abra `https://mp-app.SUB.workers.dev/#instalar`.
2. Compartilhar → **Adicionar à Tela de Início**. Abra pelo ícone.
3. **Instalar a primeira pessoa** → crie o bloqueio (Face ID + PIN) →
   digite o `MP_SETUP_CODE` → escolha seu apelido.
4. Ajustes → **Criar convite** para cada pessoa (convite de uso único).
5. Ajustes → confira que a "Versão do app" bate com o código do passo 8.3.

## O que não fazer
- **Não usar "Import a repository" / Workers Builds** (a tela que pede "Project name", "Build command", "Deploy command"). Ela dá à Cloudflare acesso de leitura ao código e publica sem a release assinada. A publicação é só pelo GitHub Actions.
- Não criar o bucket R2 à mão nem mexer nas regras dele (o deploy-api faz).
- Não adicionar domínio agora.
- Não mandar token, chaves ou códigos para ninguém (nem para mim).
- Não rodar os workflows de outra branch.
