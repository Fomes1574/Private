# ADR 0005 · Desbloqueio por passkey PRF + PIN com chave-envelope

**Estado:** Aceito como direção (V7-019). Depende da Prova 2 em iPhone real.

## Contexto
A biometria precisa **liberar uma chave**, não responder sim/não. Em out/2026:
- PRF funciona com passkeys do iCloud no Safari recente, com lacunas no fluxo
  entre aparelhos (QR) e relatos de saídas diferentes entre aparelhos
  sincronizados.
- Um coeditor da WebAuthn nível 3 desaconselha usar a saída PRF **diretamente**
  como chave de dados: apagar a passkey apaga o acesso aos dados.

## Decisão
1. A chave do banco (DEK) é **aleatória** (32 bytes) e nunca derivada de PIN ou PRF.
2. A DEK é guardada **embrulhada** (AES-256-GCM) por uma chave KEK:
   `KEK = HKDF-SHA256(ikm = PRF(salt_app) ‖ Argon2id(PIN, salt_pin), info = "mp/kek/v1")`.
   Precisa dos **dois**: Face ID (PRF) **e** PIN.
3. Argon2id em WASM, parâmetros iniciais m=64 MiB, t=3, p=1, ajustados após
   medir no iPhone mais fraco do grupo.
4. **Limite de tentativas do PIN:** 5 erros seguidos apagam a cópia local da DEK
   embrulhada (crypto-shredding). Limite local é defesa de cliente honesto; a
   barreira real contra força bruta offline é que, sem o Face ID, não há PRF e
   o PIN sozinho não reconstrói a KEK.
5. **Sem PRF disponível** (aparelho antigo, Android sem suporte): frase-senha
   longa com Argon2id (D-071). PIN curto sozinho nunca protege a DEK.
6. A passkey é criada com `residentKey: required`, `userVerification: required`
   e um `user.id` aleatório, sem nome real.
7. **Perda da passkey ou dos dados locais** = perda do histórico, recuperação
   pelo fluxo V7-012 (guardião + administradora + 24 h). Sem backdoor.

## Riscos aceitos
- A passkey sincroniza pelo iCloud: quem domina a conta Apple obtém o PRF, mas
  ainda precisa do PIN **e** da DEK embrulhada que só existe neste aparelho.
- PRF não protege contra código malicioso rodando depois do desbloqueio
  (ADR 0006 trata a cadeia de código).
