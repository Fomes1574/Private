# O que só o proprietário pode fazer

Coisas físicas, de conta ou de dinheiro. Tudo o mais está automatizado no
repositório. Marque aqui conforme for fazendo.

## Agora (antes de qualquer deploy)

- [ ] **Conta grátis na Cloudflare** com e-mail que só você usa.
- [ ] **2FA forte na Cloudflare e no GitHub.** O ideal da especificação (V7-017) é
      **chave física** (ex.: duas YubiKey, uma reserva guardada em outro lugar).
      Custa dinheiro. Sem chave física, use **passkey** no celular como 2FA e
      códigos de recuperação impressos e guardados fora do computador.
      Nunca SMS.
- [ ] **Não cadastre cartão** na Cloudflare ainda. Ver "Decisões" abaixo.
- [ ] Me passar, quando eu pedir no momento do deploy, só o **Account ID** da
      Cloudflare (não é segredo). O token de API **você** cria e cola nos
      *Secrets* do GitHub; eu nunca vejo senha nem token.

## Testes nos aparelhos (cada prova tem "Como testar" na própria página)

- [ ] iPhone com iOS atualizado (anote a versão exata) e Face ID configurado.
- [ ] Um Android (anote marca, modelo e versão).
- [ ] Para cada prova: abrir o link, seguir o roteiro, tocar em "Copiar
      relatório" e me colar o texto.
- [ ] Prova 2 no iPhone: testar também com o iCloud Keychain desligado e ligado.
- [ ] Prova 6: ter um vídeo 4K de uns 30 s gravado no próprio iPhone.

## Decisões que são suas (não consigo decidir por você)

| # | Decisão | Por que importa | Minha recomendação |
|---|---|---|---|
| 1 | ~~R2 com cartão~~ **Decidido:** usar R2 (Arquitetura A); conta com cartão | Mídia no R2, com regra de 16 dias no bucket | Feito no código: `BLOB_BACKEND = "r2"` |
| 2 | **Revisão criptográfica independente** antes do uso real | A especificação exige (§26-B, V7-011); custa dinheiro | Decidir antes de convidar as 10 pessoas, não agora |
| 3 | **Endereço fixo do app** (`*.workers.dev` grátis ou domínio próprio) | Trocar depois exige migrar dados de todos (P-07) | `workers.dev` para as provas; decidir antes do primeiro membro real |
| 4 | **Versão mínima do iOS** | Trusted Types só no Safari 26; PRF estável no 18.4+ | iOS 26 como mínimo (D-070 sugere 26.4) |
| 5 | **Framework da interface** (D-074 sugere Svelte 5) | Só afeta tamanho e velocidade, não a segurança | Decidir depois das provas |
| 6 | Aceitar por escrito o **risco pós-quântico** da vodozemac | Exigido pela própria especificação (D-054) | Aceitar e manter o plano de migração do ADR 0003 |
| 7 | **Prazo padrão das stories** (§22) | A especificação deixou 24 h como candidato | Manter 24 h (já implementado; dá para escolher de 12 h a 15 d em cada story) |
| 8 | **Formatos de documento além de texto** (P-12) | PDF, Word etc. precisam de visualizador seguro; abrir fora do app quebra "sem exportação" | Ficar só com texto por enquanto; PDF depois, com visualizador próprio isolado |
| 9 | **Levar o histórico na troca de celular?** | Hoje o celular novo começa do zero (mais seguro) | Manter do zero; mensagens já somem em até 15 dias |

## Amanhã, ao configurar a Cloudflare

Não precisa de mais nada além do item "Agora". Se o painel pedir cartão para o
R2, **pare** e me avise: a decisão 1 entra aí.
