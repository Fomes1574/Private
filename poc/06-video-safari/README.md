# Prova 6 · Comprimir vídeo no aparelho

Recodifica no próprio aparelho, antes de cifrar: até 5 minutos, no máximo
1080p a 30 fps, H.264 em MP4, sem metadados (GPS, câmera, data). Usa WebCodecs
pela biblioteca [mediabunny](https://github.com/Vanilagy/mediabunny) 1.61.3,
copiada sem modificação para `web/vendor/` com `SHA256SUMS`.

```sh
npm ci && npm run vendor   # atualizar a cópia (confere hash)
npm test                   # regras de tamanho (Node)
```

O teste de navegador fica em `../../e2e/poc6.test.mjs`.

**Licença da mediabunny: MPL-2.0.** Pode ser usada num app de código fechado
desde que os arquivos dela não sejam alterados e o código-fonte **desses
arquivos** continue disponível a quem recebe o app (ele já vai legível no
bundle, e o `LICENSE-mediabunny.txt` acompanha).
