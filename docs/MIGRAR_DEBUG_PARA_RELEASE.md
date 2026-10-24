# Migrar a administradora do APK de debug para o APK de distribuição

## Por que não dá para "atualizar por cima"

O APK de debug instalado (pacote `com.mensageiro.privado`) foi assinado pelo
GitHub Actions com uma **chave de debug descartável**. O projeto não tinha
`signingConfig`, e cada execução do CI cria uma chave nova. O Android só aceita
atualizar um app com a **mesma** chave. Por isso nenhum APK novo substitui esse
debug: nem um debug novo, nem o de distribuição.

Usar o mesmo pacote no APK novo faria o Android pedir para **desinstalar** o
antigo. Desinstalar apaga as chaves da administradora (Keystore, banco
cifrado, identidade). **Não desinstale o debug antes do fim deste roteiro.**

## O que foi feito

| Decisão | Motivo |
|---|---|
| APK de distribuição com pacote novo `com.pactotalk.app` | Instala **ao lado** do debug, sem tocar nele. |
| Debug futuro com `com.pactotalk.app.debug` | Debug nunca mais ocupa o lugar do APK de verdade. |
| Origem do app continua `https://localhost` | O CORS do servidor não muda (`CORRECAO_CORS_ANDROID.md`). |
| Conta passa pelo "Já uso em outro celular" | Mesma conta e mesma função de administradora, com chaves novas no app novo. |
| Troca **durável** (detalhe abaixo) | O app novo guarda tudo antes de mostrar o código, e o servidor só derruba o antigo quando o novo confirma. |

**Sobre o "não alterar `applicationId`" do `CORRECAO_CORS_ANDROID.md`.** Esse
alerta vale para mudar o id **do app instalado**: os dados ficariam presos ao
pacote antigo. Aqui o pacote antigo continua instalado e intacto, e o novo é
outro app. Quem leva a conta de um para o outro é a troca de aparelho do
próprio Pacto Talk. A origem `https://localhost` não muda, então o CORS continua
certo.

### Troca durável (por que é seguro mesmo com o debug antigo)

O debug instalado tem o código de **antes**: ao aprovar, ele **se apaga na
hora**. O código dele não dá para mudar, porque está dentro do APK. Por isso a
segurança precisa estar no app novo e no servidor:

1. Ao pedir a troca, o app novo registra o cofre no servidor e guarda tudo
   cifrado no aparelho **antes** de mostrar o código: chaves, conta Olm e o
   próprio pedido.
2. A aprovação deixa o aparelho novo **pendente**. O antigo não cai.
3. O novo entra, confirma, e só então o servidor derruba o antigo.
4. Se o app novo fechar em qualquer momento, ao abrir com o PIN ele continua
   de onde parou. Depois da aprovação, ele tem até 7 dias para confirmar.

Teste automático: `app/test/pairing.test.mjs`. Ele simula o debug antigo
aprovando e se apagando na hora, com o app novo fechado antes da aprovação, e
confere que a conta e a função de administradora chegam ao app novo. Este
teste roda no Chromium. **Repita no celular antes de confiar**
(`docs/TESTE_EM_CELULAR.md`, cenário 1).

## O que passa e o que não passa

| Passa para o app novo | Não passa |
|---|---|
| A conta (mesmo id) | O histórico de mensagens do debug (dura no máximo 15 dias) |
| A função de administradora | Rascunhos e preferências locais |
| O lugar no círculo e nas conversas | O PIN de coação e o prazo do "homem morto": são do aparelho |
| O guardião | |
| O código de emergência (é da conta) | |

O histórico não passa de propósito (V7-015): a troca começa do zero e nada de
histórico atravessa o servidor. Se algo importa, leia antes.

Os contatos veem o aviso "a chave de segurança de Ana mudou". Isso é o
esperado: confira o número de segurança pessoalmente.

## Passo a passo (os dois apps no MESMO celular)

1. **Antes de tudo:**
   - Publique a API nova (`deploy-api`). Sem ela, o app novo recusa começar a troca ("servidor sem troca durável") e nada acontece.
   - Gere o APK de distribuição (`docs/APK_RELEASE.md`).
2. Baixe o APK da Release do GitHub. Confira o SHA-256 e o certificado (as notas da Release mostram os dois).
3. Instale. Aparece um segundo "Pacto Talk". O debug continua lá, intacto.
4. No **novo**, toque em "Já uso em outro celular" e crie o PIN. Ele mostra **Pedido**, **Código** e **Impressão digital**. A partir daqui o pedido já está guardado.
5. Anote o Pedido e o Código num papel. O código vale **5 minutos**.
6. Abra o **debug**. Vá em Ajustes → Trocar de celular, digite o Pedido e o Código e aprove.
   - **O debug vai se apagar logo em seguida.** É o código antigo dele, e não tem problema: o novo já guardou tudo.
7. Volte ao **novo**, pelos recentes ou abrindo de novo e digitando o PIN. Em segundos ele confirma e abre as conversas.
8. No app novo, confira:
   - Ajustes mostra a parte da administradora.
   - Dá para criar um convite (pode descartar).
   - Configure de novo o PIN de coação e o prazo do "homem morto".
9. Só depois de tudo conferido, desinstale o debug pelo Android.

## Se der errado

| Situação | O que acontece | O que fazer |
|---|---|---|
| Código errado 3 vezes ou passou de 5 min sem aprovar | O pedido some e o debug segue valendo | O app novo volta à tela inicial; comece de novo no passo 4 |
| App novo fechou antes ou depois da aprovação | Tudo já estava guardado | Abra o novo e digite o PIN; ele continua |
| Esqueceu o PIN do app novo | Com o debug ainda inteiro: nada se perdeu | Apague o app novo e comece de novo |
| Esqueceu o PIN do app novo **e** o debug já aprovou (e se apagou) | A conta ficou só no app novo | **Hoje não há recuperação para a administradora**: a recuperação exige a administradora + o guardião, e ela não aprova a si mesma (risco R-01 em `RISCOS_PENDENTES.md`). Por isso: **anote o PIN novo, guardado com segurança, antes do passo 6** |
| App novo ficou 7 dias sem confirmar | A vaga pendente some | Se o debug se apagou, é o caso de cima |

Uma aprovação nova substitui um pendente anterior: dá para repetir sem
acumular aparelhos.
