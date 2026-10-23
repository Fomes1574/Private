# Relatório · Prova 2 · Face ID (passkey PRF) + PIN

**Pergunta:** o iPhone libera, depois do Face ID, um segredo (PRF) que, junto
com o PIN, desembrulha a chave do banco, e isso sobrevive a fechar e reabrir o
app instalado?

**Resposta até agora:** sim no Chromium com autenticador virtual. **Falta o
iPhone real**, que é o que decide.

## O que foi construído
- DEK aleatória de 32 bytes, guardada só embrulhada (AES-256-GCM) e usada como
  `CryptoKey` **não extraível**.
- `KEK = HKDF-SHA256(PRF ‖ Argon2id(PIN))`, `info = "mp/kek/v1"`, AAD do
  embrulho amarra versão, modo e ID da passkey (trocar o registro não abre).
- Argon2id m=64 MiB, t=3, p=1 em WASM (39 KB).
- PIN de 6 a 12 números, sem sequência nem repetição. Sem PRF, só frase-senha
  de 4 palavras ou 16 caracteres.
- 5 erros seguidos destroem a DEK embrulhada. O erro é contado **antes** da
  tentativa: fechar o app no meio não zera o contador.
- Sair do app (`visibilitychange`/`pagehide`) bloqueia na hora.

## Resultados automatizados

| Teste | Resultado |
|---|---|
| Vetor oficial Argon2id (`password`/`somesalt`, m=64 MiB, t=2) | ok |
| PRF certo + PIN certo abre; PIN errado ou PRF errado não | ok |
| DEK não pode ser exportada | ok |
| 5 erros destroem a chave; depois nem o PIN certo abre | ok |
| Contador sobrevive a app fechado no meio da tentativa | ok |
| Modo frase-senha sem PRF | ok |
| Registro adulterado (outra credencial) não abre | ok |
| Página: PIN fraco recusado antes de criar passkey | ok (Chromium) |
| Página: nada aparece antes do desbloqueio, após recarregar | ok (Chromium) |
| Página: autenticador sem PRF mostra erro claro | ok (Chromium) |

Argon2id com os parâmetros reais levou ~290 ms no desktop.

## Aparelhos reais

| Ambiente | PRF na criação | PRF no get | Argon2id ms | Desbloqueio após fechar | 5 erros destroem | Bloqueia ao sair |
|---|---|---|---|---|---|---|
| iPhone · Safari (aba) | | | | | | |
| iPhone · Tela de Início | | | | | | |
| Android · Chrome | | | | | | |

## O que a pesquisa mudou
- Um coeditor da WebAuthn nível 3 desaconselha usar a saída PRF **direto** como
  chave de dados. Por isso a DEK é aleatória e só embrulhada; trocar de passkey
  no futuro é reembrulhar, não recifrar o banco.
- Há relatos de PRF diferente para a mesma passkey em aparelhos sincronizados
  pelo iCloud e de PRF ausente no fluxo entre aparelhos (QR). Para este projeto
  isso não atrapalha: o cofre vale para **um** aparelho (V6-002), e a troca de
  aparelho é por QR com transferência própria (V7-015), não pela passkey.

## Limites conhecidos
- O limite de 5 tentativas é do cliente honesto. Quem copia o IndexedDB pode
  tentar PINs à vontade, **mas** precisa do PRF, que exige o Face ID neste
  aparelho (ou na conta Apple da pessoa, se a passkey sincronizar).
- PRF não protege contra código malicioso rodando depois do desbloqueio.
- A `CryptoKey` não extraível ainda pode ser **usada** por qualquer script da
  página enquanto desbloqueado (CSP e cadeia de atualização tratam disso).
