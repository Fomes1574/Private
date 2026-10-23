# ADR 0012 · Os dados morrem: apagar de verdade, em cada camada

**Estado:** Aceito (pedido expresso do proprietário; §7 crypto-erasure, §12, §28).

## Objetivo
Depois de apagada (para mim, para todos ou por prazo), uma mensagem deve ser
**irrecuperável** com o máximo que a técnica permite, inclusive para quem
apreender o aparelho e conseguir o PIN e o Face ID da pessoa depois.

## O que é feito em cada camada

| Camada | O que acontece ao apagar | Por que fica irrecuperável |
|---|---|---|
| Transporte | Olm (Double Ratchet) apaga a chave de cada mensagem depois de usada | Sigilo futuro: o estado atual não decifra mensagens antigas |
| Servidor, texto | Envelope apagado do D1 ao ser confirmado, ao vencer ou ao apagar para todos | O D1 só teve texto cifrado; a chave nunca esteve lá |
| Servidor, mídia | `deleteAll` do Durable Object (ou objeto do R2) no último consumo, no prazo ou ao apagar | A chave da mídia (CEK) só existiu nos aparelhos |
| Aparelho, banco | Linha apagada com `secure_delete`; em seguida o banco **inteiro é refeito num arquivo novo com chave nova** e o arquivo antigo é removido | Restos no arquivo velho estão cifrados com uma DEK que não existe mais; no iPhone o arquivo removido ainda perde a chave própria do sistema |
| Aparelho, marcas | Ids de mensagens apagadas guardados só 16 dias (prazo máximo + 1) | Nem o identificador sobra |
| Aparelho, memória | Bytes de mídia zerados após exibir; URLs `blob:` revogadas; DEK e KEK descartadas ao trancar | — |
| Aparelho, chave mestra | 5 PINs errados destroem a DEK embrulhada; "Apagar tudo" remove bancos, cofre e (no Android) a chave do Keystore | Sem DEK, todo o banco vira ruído |

## Rotação do banco (passo a passo, seguro contra queda)
1. Depois de qualquer exclusão (e no mínimo a cada 24 h), espera 15 s e roda;
   ao trancar o app, roda antes se estiver pendente.
2. Copia para um diretório novo do OPFS **só o que ainda vale** (vencidas não
   são copiadas), cifrado com uma DEK nova e aleatória.
3. Grava numa única transação do IndexedDB o cofre novo (DEK nova embrulhada
   pela KEK) e o ponteiro para o banco novo.
4. Remove o diretório inteiro do banco antigo.
Se o app morrer entre 2 e 3, o banco antigo segue valendo e o novo é apagado na
próxima abertura; entre 3 e 4, o antigo é apagado na próxima abertura.

## Limites honestos (não prometer além disto)
- Quem **recebeu** pode ter copiado, fotografado a tela ou usado cliente
  alterado. Nenhuma técnica desfaz isso.
- Aparelho desligado só apaga quando voltar a ligar o app.
- Memória do navegador (texto já mostrado) não é zerada com garantia; o
  navegador decide quando liberar.
- Memória flash pode guardar blocos antigos; a proteção é que eles estão
  cifrados com chaves já destruídas, não que os bytes sumiram.
- Backups internos da Cloudflare (Time Travel do D1 por 30 dias) só têm texto
  cifrado sem chave.
