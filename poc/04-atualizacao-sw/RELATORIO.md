# Relatório · Prova 4 · Atualização com versão travada

**Pergunta:** dá para a PWA no iPhone só trocar de versão com aceite, recusar
versão adulterada, assinada por outra chave ou mais antiga, e atualizar sem
perder identidade e banco?

**Resposta até agora:** sim no Chromium (automatizado). **Falta o iPhone
instalado na Tela de Início**, onde o ciclo de vida do service worker é o que
mais pesa.

## O que foi construído
- Manifesto de release com `app`, `version` (inteiro crescente) e SHA-256 de
  cada arquivo, assinado com Ed25519. Assinatura conferida sobre os **bytes
  recebidos**, não sobre JSON re-serializado.
- Código curto = 8 primeiros hex do SHA-256 do manifesto, mostrado na oferta e
  em "Esta instalação"; os códigos ficam em [`RELEASES.md`](RELEASES.md), no
  GitHub, fora da Cloudflare.
- `highest` (maior versão já aceita) guardado no IndexedDB do SW: anti-downgrade
  sobrevive mesmo se o cache for apagado.
- Nenhum `skipWaiting()`. Versão nova fica em cache separado até o aceite; troca
  do ponteiro só depois de copiar e conferir.
- Falha fechada: o que não está na versão fixada não é buscado na rede.

## Resultados automatizados

| Teste | Resultado |
|---|---|
| Primeira visita instala v1 conferida | ok |
| Canal com arquivo trocado após assinar | recusado (`hash não confere: app.js`) |
| Canal assinado com outra chave | recusado (`assinatura inválida`) |
| Canal com v0 assinada (downgrade) | recusado |
| Mesma versão de novo | recusado |
| Servidor passa a servir outro `app.js`: app continua na versão fixada | ok |
| Nada muda antes do aceite | ok |
| Após aceitar v2: mesma identidade, chave privada utilizável, esquema migrado | ok |
| Depois da v2, a v1 vira downgrade | recusado |
| Abre sem internet na versão fixada | ok |
| Build não contém chave privada; SW não tem `skipWaiting` | ok |

## Aparelhos reais

| Ambiente | Instala v1 | 4 recusas | Atualiza para v2 com mesma identidade | Abre em modo avião |
|---|---|---|---|---|
| iPhone · Tela de Início | | | | |
| Android · Chrome | | | | |

## O limite que esta prova não resolve
O navegador busca o próprio `sw.js` no servidor. Quem controla a origem pode
publicar um `sw.js` malicioso; ele entra quando todas as abas fecharem. Isto é
**mitigação, não garantia** (§50.3). O que reduz o risco:
- deploy só pelo CI com token curto e conta com 2FA forte (V7-017);
- código curto visível no app, comparável com o `RELEASES.md` no GitHub;
- no Android o código vai dentro do APK assinado (ADR 0007).

## Para o app real
- A chave privada de release precisa existir **fora** da Cloudflare. Opções, em
  ordem de segurança: chave no computador do proprietário, assinando
  manualmente cada release; ou segredo do GitHub Actions (aí a conta do GitHub
  vira a raiz de confiança). Decisão do proprietário.
- Trocar a chave pública exige release assinada pela chave antiga.
