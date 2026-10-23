# Cloudflare + GitHub: passo a passo completo

Três publicações, nesta ordem: **provas** (testes no celular), **API** e
**app**. Tudo sai pelo GitHub Actions; ninguém (nem eu) vê token ou senha.

## 0. Qual conta da Cloudflare
**Recomendado: uma conta nova, só para o Mensageiro, sem cartão.**
- Se um dia a conta do Quiz Gomes (ou o token dela) vazar, o Mensageiro não
  vai junto; e o servidor é a ameaça nº 1 da especificação (V7-014).
- Sem cartão, a conta não consegue cobrar: no limite grátis ela **para**, não
  cobra (§48). O Mensageiro não usa R2 por padrão (`BLOB_BACKEND = "do"`).
Se mesmo assim usar a conta do Quiz, os passos são os mesmos; só crie um
token separado (passo 4) e não reaproveite o do Quiz.

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
2. **deploy-api** → digite `PUBLICAR-API`. Cria o banco D1, aplica as
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
- Não ativar R2 nem domínio para o Mensageiro agora.
- Não mandar token, chaves ou códigos para ninguém (nem para mim).
- Não rodar os workflows de outra branch.
