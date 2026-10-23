# Segurança

## Ordem do modelo de ameaça (V7-014)
1. Servidor ou conta de hospedagem comprometidos.
2. Celular roubado ou apreendido.
3. Membro malicioso.
4. Metadados.

Quando segurança e disponibilidade colidem, o app **falha fechado**.

## Regras que valem para todo código deste repositório
- Nenhum segredo no repositório: chaves, tokens, senhas, `.dev.vars`, `.env`.
  O CI roda `gitleaks` e o hook local (`.githooks/pre-commit`) também.
- Nenhum protocolo criptográfico próprio. Só vodozemac (Olm), WebCrypto
  (AES-GCM, HKDF, Ed25519) e Argon2id de implementação conhecida.
- Nada de analytics, rastreador, CDN, fonte externa ou SDK de coleta.
- Mensagem nunca vira HTML. Só `textContent`.
- Segredos nunca em `localStorage`, URL, log, cache do service worker ou push.
- Todo formato cifrado tem versão e algoritmo; versão desconhecida é recusada.
- Antes de mostrar qualquer conteúdo: validar online prazo, revogações e
  tombstones (§25.6). Nunca renderizar primeiro e corrigir depois.
- Sem marca d'água, nome, ID, data ou hora sobre mídia (§2.1). Não reintroduzir.
- Dependências com versão travada. Atualizar só com motivo e revisão do diff.

## O que este projeto **não** promete
- Bloquear print no iPhone.
- Apagamento forense de dados já copiados ou de backups do provedor.
- Esconder todos os metadados (IP, horários, volume).
- Impedir que um destinatário legítimo guarde o que viu.
- Proteção pós-quântica (vodozemac não tem; risco aceito, ADR 0002).

## Como relatar um problema
Membro do círculo: avise a administradora por um canal fora do app. Não abra
issue com detalhes de exploração; descreva só o suficiente para reproduzir.

## Estado das revisões
Nenhuma revisão criptográfica independente foi feita ainda. A especificação
exige uma antes de uso real (§26-B, V7-011). Esse custo colide com R$ 0 e
depende de decisão do proprietário.
