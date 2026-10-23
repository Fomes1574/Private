# Cloudflare: passo a passo para publicar as provas

Tempo estimado: 20 minutos. Nada aqui pede cartão. **Se aparecer pedido de
cartão, pare e me avise** (decisão 1 em `ACOES_DO_PROPRIETARIO.md`).

## 1. Conta e segurança
1. Crie a conta em `dash.cloudflare.com` com um e-mail só seu.
2. Ative 2FA (**My Profile → Authentication**). Prefira chave física ou passkey;
   guarde os códigos de recuperação impressos, fora do computador.

## 2. Subdomínio workers.dev
1. Menu **Workers & Pages**. Na primeira vez, a Cloudflare pede para escolher
   um subdomínio `*.workers.dev`. Escolha algo neutro (sem seu nome, sem
   "mensageiro"). Ex.: `ipe-azul-37`.
2. O endereço das provas vai ser `https://mp-provas.<subdominio>.workers.dev`.

## 3. Token de API só para este deploy
1. **My Profile → API Tokens → Create Token → Create Custom Token**.
2. Nome: `deploy-provas-github`.
3. Permissões: **Account → Workers Scripts → Edit**. Só isso.
4. Account Resources: **Include → (sua conta)**.
5. TTL: coloque uma data de validade (ex.: 30 dias). Renove quando vencer.
6. Copie o token. Ele aparece uma vez só.
7. Copie também o **Account ID** (aparece na lateral direita de Workers & Pages).

## 4. Segredos no GitHub (o token nunca passa por mim)
No repositório: **Settings → Secrets and variables → Actions → New repository secret**.

| Nome | Valor |
|---|---|
| `CLOUDFLARE_API_TOKEN` | o token do passo 3 |
| `CLOUDFLARE_ACCOUNT_ID` | o Account ID |
| `PROVA_TOKEN_SECRET` | 40+ caracteres aleatórios (use um gerador de senhas) |
| `PROVA_ACCESS_CODE` | um código que você digita na Prova 5 (ex.: 4 palavras) |

## 5. Publicar
1. **Actions → deploy-provas → Run workflow**, digite `PUBLICAR`.
2. Ao terminar, abra `https://mp-provas.<subdominio>.workers.dev/` no iPhone.
3. Me mande o endereço e o hash que aparece no último passo do log.

## O que o token permite e o que não permite
Ele publica Workers na sua conta. Não lê DNS, não mexe em cobrança, não cria
R2. Se vazar: apague em **API Tokens** e crie outro.
