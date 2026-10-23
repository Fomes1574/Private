# ADR 0010 · Banco local cifrado

**Estado:** Aceito como direção (P-04). Depende da Prova 3.

## Decisão
- SQLite em WASM (build oficial) com VFS `opfs-sahpool`, dentro de um Dedicated
  Worker. Uma conexão só, o que combina com a trava de instância única (V7-013).
- Cifra **por registro**: cada valor sensível é cifrado com AES-256-GCM sob a DEK
  (ADR 0005) antes de ir ao SQLite; colunas de busca guardam só valores opacos
  (HMAC) ou nada. Sem índice de texto completo persistente (V7-021).
- Apagar mensagem = apagar a linha **e** a chave por mensagem quando houver
  (crypto-shredding). OPFS/IndexedDB não garantem apagar bytes.
- Alternativa avaliada: SQLite3 Multiple Ciphers em WASM (cifra o arquivo
  inteiro). Fica como opção se a cifra por registro pesar demais.

## Por que não confiar só no armazenamento do navegador
O navegador pode apagar dados; `persist()` ajuda mas não garante. Perder o banco
é perder o histórico (sem backup no servidor, por desenho).
