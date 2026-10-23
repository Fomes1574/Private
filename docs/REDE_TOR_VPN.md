# Rede: Tor, VPN e Retransmissão Privada

## O que cada um esconde (e o que não esconde)

| | Esconde seu IP da Cloudflare | Esconde da operadora que você usa o app | Muda algo no conteúdo | Velocidade |
|---|---|---|---|---|
| Sem nada | não | não (ela vê que você fala com `*.workers.dev`) | — o conteúdo já é cifrado de ponta a ponta | a melhor |
| **VPN sem registros** (ex.: Mullvad, Proton VPN) | sim (a VPN vê) | sim | não precisa | quase igual |
| **Retransmissão Privada do iCloud** (iCloud+) | sim, no Safari; no app da Tela de Início não há garantia | parcial | não precisa | quase igual |
| **Tor com Orbot** (Android e iPhone) | sim, e ninguém sozinho liga você ao app | sim | não precisa | mais lenta (ver medição) |

O que **nenhum** deles muda: o servidor continua sabendo qual identidade
está em qual conversa e quando chegam mensagens (é o mínimo para entregar;
nunca o conteúdo). O Tor esconde **de onde** você está, não **quem** você é
dentro do app.

## Medição (núcleo do app, `scripts/medir-rede.mjs`)
Rede simulada: cada pedido paga a ida e volta e a transmissão na banda.
Perfis: 4G (60 ms, 20 Mb/s), VPN boa (140 ms, 15 Mb/s), Tor (800 ms, 2 Mb/s).

| Rede | Enviar texto | Receber texto | Enviar foto 400 KB | Abrir foto 400 KB |
|---|---|---|---|---|
| 4G direto | 164 ms | 190 ms | 465 ms | 243 ms |
| VPN boa | 319 ms | 390 ms | 719 ms | 372 ms |
| Tor (Orbot) | 1,6 s | 2,0 s | 4,1 s | 2,4 s |

Otimizações feitas para isso (sem tirar nenhuma conferência de segurança):
- conferência de segurança e busca da conversa saem **juntas** ao enviar,
  e conferência + caixa de entrada saem juntas ao receber (antes, uma
  depois da outra);
- o app só consulta os membros do círculo quando alguém entra ou troca de
  aparelho (antes, a cada sincronização);
- a mensagem que você envia aparece **na hora** ("enviando…"); a rede
  termina em segundo plano. Se falhar, o texto volta para a caixa.

Vídeo pelo Tor: um vídeo de 5 minutos comprimido tem até ~95 MB; a 2 Mb/s
leva vários minutos para subir ou baixar. Com Tor, prefira vídeos curtos.

## Como usar

### Android — Orbot
1. Instale o **Orbot** (Google Play ou F-Droid, do The Tor Project).
2. Abra o Orbot → **Apps com Tor** (ou "Tor-Enabled Apps") → marque **só o
   Mensageiro**. Assim só ele passa pelo Tor e o resto do celular continua
   rápido.
3. Toque em **Iniciar** / **Connect**. Aceite o pedido de VPN do Android.
4. Abra o Mensageiro normalmente.

### iPhone — Orbot (Tor) ou VPN
- **Orbot para iOS** (App Store, The Tor Project): funciona como VPN do
  aparelho inteiro, então o app da Tela de Início também passa pelo Tor.
  Abra o Orbot → **Start**. No iPhone não dá para escolher só um app.
- **VPN sem registros** (Mullvad ou Proton VPN): mais rápida que o Tor;
  esconde o IP da Cloudflare, mas a empresa da VPN vê o IP.
- **Retransmissão Privada** (Ajustes → seu nome → iCloud → Retransmissão
  Privada): útil, mas a Apple não garante que valha para apps da Tela de
  Início; não conte só com ela.

## Primeiro teste com Tor (falta fazer no aparelho)
A Cloudflare às vezes desafia endereços de saída do Tor. Com o Orbot ligado:
abra o app, mande uma mensagem, uma foto, e receba uma. Se aparecer erro,
me mande a mensagem exata (não tem segredo nela).
