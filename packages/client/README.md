# @mp/client · núcleo do cliente

A parte do app que não depende de interface: identidade do aparelho, sessões
Olm por pessoa (fan-out), envio, sincronização, mídia cifrada em segmentos e as
regras de exibição. A interface (PWA/Capacitor) só chama estas funções.

| Garantia | Onde |
|---|---|
| Estado do ratchet salvo antes de transmitir ou confirmar | `sendInner`, `sync` |
| Remetente declarado = remetente autenticado pelo servidor; senão descarta | `sync` |
| Troca de chave de alguém vira aviso e invalida a sessão antiga | `refreshDirectory` |
| Chave do destinatário precisa bater com a do diretório | `sessionFor`, `decryptFrom` |
| Tombstones aplicados antes de qualquer mensagem | `sync` |
| Nada aparece sem tempo do servidor; vencidas destruídas antes | `view` |
| Mídia: AES-256-GCM por segmento, ordem e fim autenticados | `media-crypto.js` |
| Chave da mídia só dentro do envelope Olm de cada destinatário | `sendMedia` |

```sh
(cd ../../server && npm ci)
npm test   # sobe o servidor local e simula Ana, Bia e Caio
```

## Ainda não coberto aqui
- Assinatura dos eventos de política pelo aparelho (verificação ponta a ponta).
- Verificação de identidade por QR (comparar chaves pessoalmente, §5).
- Gate online do texto (ADR 0009, bloqueado até revisão).
