# Firebase: só o mínimo para a notificação do Android

O APK Android usa o Firebase Cloud Messaging (FCM) **só** para acordar o
celular. O iPhone continua com Web Push. Os membros do círculo **não** fazem
login no Google e **não** precisam de conta Google para isso.

## O que sai do servidor para o Google

Exatamente isto, e nada mais (teste: `server/test/fcm.test.mjs`):

```json
{ "message": { "token": "<token do aparelho>", "data": { "v": "1" },
  "android": { "priority": "HIGH", "ttl": "86400s", "collapse_key": "mp" } } }
```

- Não vai texto, nome de conversa ou grupo, remetente, id de mensagem, contagem ou cifra.
- O texto "novas mensagens" é escrito **pelo próprio app**, no celular. Não passa pelo Google.
- O Google vê só que o app recebeu um aviso, e quando. Isso é inevitável em qualquer push.
- Conversa silenciada ou app aberto: nada é enviado. No máximo 1 aviso por minuto por pessoa.

## O que você faz (uma vez, uns 10 minutos)

1. Acesse https://console.firebase.google.com com a **sua** conta Google. Ela é só da administração; ninguém do círculo usa.
2. **Adicionar projeto**, com um nome qualquer (ex.: `pacto-avisos`).
   - Quando perguntar por **Google Analytics**, **desative**. Isso é importante.
3. No projeto: ícone do Android → **Adicionar app**.
   - Nome do pacote: **`com.pactotalk.app`**, exatamente assim.
   - Apelido: qualquer um. **Não** preencha o SHA-1, que não é necessário.
   - Baixe o `google-services.json`. Pule os passos de "adicionar SDK"; o projeto já faz isso.
4. No GitHub → Settings → Secrets and variables → Actions → **New repository secret**:
   - Nome **`GOOGLE_SERVICES_JSON`**, valor: o conteúdo inteiro do `google-services.json`.
   - Esse arquivo identifica o projeto. Não é uma senha, mas fica fora do repositório mesmo assim.
5. Conta de serviço **só para enviar avisos**. Não use a conta "firebase-adminsdk", que tem poder demais:
   1. Engrenagem → Configurações do projeto → Contas de serviço → link "Gerenciar permissões da conta de serviço" (abre o Google Cloud).
   2. **Criar conta de serviço**, com nome `avisos-fcm`.
   3. Papel: **Firebase Cloud Messaging API Admin** (`roles/firebasecloudmessaging.admin`). Só esse.
   4. Na conta criada: Chaves → Adicionar chave → JSON. Baixa um arquivo.
   5. No GitHub, segredo **`FCM_SERVICE_ACCOUNT`** com o conteúdo inteiro desse JSON.
   6. **Apague o arquivo baixado** do computador (e da lixeira).
6. Confira em Google Cloud → APIs que a **Firebase Cloud Messaging API (V1)** está ativada. Normalmente já vem ativa.
7. Rode o workflow **deploy-api** (ele passa a chave ao Worker) e depois o **android-release** (o APK passa a ter notificações).

Não ative Crashlytics, Analytics, Remote Config, In-App Messaging, AdMob nem
nada além disso.

## O que o app faz no Android

| Situação | Comportamento |
|---|---|
| A pessoa toca em Ajustes → Notificações → Ativar | O Android pergunta a permissão |
| A tela mostra o estado | aguardando permissão / ativadas / recusadas / erro (nunca fica calada) |
| Antes de ativar | Nenhum token é criado: o token automático está desligado no manifesto |
| Ao desativar ou apagar tudo | O servidor esquece o token, e o token é apagado do Firebase no aparelho |
| Permissão retirada nas configurações do Android | No próximo desbloqueio o servidor esquece o token, e a tela diz "Recusadas" |
| Troca de celular ou aparelho revogado | O token do aparelho antigo é apagado no servidor |
| Token que o Google diz não valer mais | O servidor apaga sozinho |

Manifesto: Analytics desativado, id de publicidade removido, métricas de
entrega desligadas, token automático desligado.

## Trocar a chave do FCM (se vazar)

1. No Google Cloud, crie uma chave nova na conta `avisos-fcm` e **apague a antiga**.
2. Atualize o segredo `FCM_SERVICE_ACCOUNT` e rode o `deploy-api`.

Quem tiver a chave vazada só conseguiria mandar avisos vazios para tokens
que já conheça. Não lê nada.
