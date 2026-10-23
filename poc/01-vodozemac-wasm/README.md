# Prova 1 · vodozemac em WASM

Duas pessoas (Alice e Bob) na mesma página trocam mensagens com Olm 1:1
(Double Ratchet da vodozemac), salvam o estado cifrado no IndexedDB e
continuam a conversa depois de fechar e reabrir o app.

## Estrutura

- `crate/` wrapper Rust mínimo sobre `vodozemac =0.11.1` (só Olm, sem Megolm).
- `web/` página de teste estática; `web/pkg/` é o WASM já compilado.
- `test/` os mesmos casos rodando em Node.

## Comandos

```sh
./build.sh          # recompila o WASM (precisa de Rust + wasm-bindgen-cli 0.2.129)
npm test            # testes em Node sobre o WASM compilado
npm run serve       # http://localhost:8080
node make-icons.mjs # regenera os ícones provisórios
```

O passo a passo do teste no aparelho fica na própria página, em “Como testar”.
