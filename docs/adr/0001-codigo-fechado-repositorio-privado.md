# ADR 0001 · Código fechado em repositório privado

**Estado:** Aceito (V7-001)

## Contexto
O proprietário decidiu código fechado. A segurança vem da criptografia auditada,
não do sigilo do código. O apêndice D (D-075) recomendava repositório público
porque, no plano grátis do GitHub, o repositório privado perde regras de
proteção de branch, varredura de segredos e atestados de build.

## Decisão
Repositório privado no GitHub. As proteções que o plano grátis não dá são
compensadas no próprio repositório:

| Falta no privado grátis | Compensação |
|---|---|
| Varredura de segredos | `gitleaks` no CI e em hook local de pre-commit (`.githooks/`) |
| Proteção de branch | Deploy só pelo CI a partir de `main`; push direto em `main` evitado por disciplina; revisão do diff antes de publicar |
| Alertas de dependência | `osv-scanner` e `cargo audit` no CI; Dependabot de versões |
| Atestado de build | Hash SHA-256 de cada artefato publicado no repositório e conferido pelo CI (build reproduzível) |

## Consequências
- Membros não conseguem recompilar e conferir o hash por conta própria, o que
  enfraquece a verificação independente prevista em V7-017. Mitigação: o hash
  de cada versão é publicado fora da Cloudflare (no GitHub) e mostrado no app.
- Uma revisão por IA **não** conta como segunda aprovação (V7-017).

## Reversível?
Sim. Abrir o código é sempre possível depois; fechar de novo não apaga cópias.

## Testes
CI falha se `gitleaks` achar segredo ou se o hash do WASM não bater com o build.
