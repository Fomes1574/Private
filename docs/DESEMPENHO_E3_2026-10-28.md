# Desempenho do desbloqueio (E3) — 28/10/2026

Pedido do proprietário: "ao desbloquear ele está demorando um pouco para carregar o app". Regra: melhorar sem enfraquecer a segurança nem estragar funções. Os parâmetros do Argon2id (64 MiB, 3 passadas) e todas as conferências continuam iguais.

## Como foi medido

`app/test/perf.test.mjs` usa o app de verdade (Chromium) contra a API local. Ana tem 6 conversas com 250 mensagens guardadas cada. Bia (cliente fora do navegador) manda 40 mensagens enquanto o app da Ana está trancado. Cada pedido à API espera 120 ms, para simular rede de celular. As marcas de tempo (`performance.mark`, só nome da etapa, nenhum dado) contam a partir do toque em "Desbloquear".

Os números são de um computador. No celular, cada etapa tende a ser 2 a 4 vezes mais lenta; a proporção do ganho é o que importa. **Falta medir num celular de verdade.**

## Antes e depois

| Etapa | Antes | Depois |
|---|---|---|
| Senha (Argon2id) + parte do servidor | 0,76 s | 0,54–0,73 s (igual: o custo é proposital) |
| Abrir o banco do aparelho | 0,14 s | 0,005 s (aberto enquanto o PIN é digitado) |
| Login no servidor | 0,28 s | 0,28 s |
| Diretório + sincronizar 40 mensagens | 0,85 s **antes** da lista | depois da lista, sem travar a tela |
| Montar a lista | 0,42 s | 0,02 s (lista guardada) |
| **Do PIN até a lista** | **2,5 s** | **1,3–1,5 s** |
| Mensagens novas aparecendo | 2,5 s | 2,2 s |
| Limpeza de vencidas a cada sincronização | decifrava o banco inteiro | ~15 ms (decifra só o novo) |

## O que mudou

1. **Banco e cripto prontos durante o PIN.** A tela de desbloqueio carrega a biblioteca de cripto e abre o arquivo do banco, ainda cifrado. A chave só existe depois do PIN; nada legível é aberto antes.
2. **Lista antes da sincronização.** Depois do login, a lista aparece com o que está no aparelho. Diretório e sincronização seguem por trás, na mesma ordem de antes (o cliente serializa: o diretório é relido antes de decifrar qualquer mensagem), e a tela se atualiza sozinha. Todo envio continua conferindo as chaves antes de cifrar.
3. **Lista guardada.** A última lista de conversas fica no banco cifrado do aparelho e desenha a tela na hora; a lista atual do servidor chega logo depois e substitui. Um desenho mais antigo nunca cobre um mais novo. Excluir conversa também a tira dessa lista.
4. **Decifrar em paralelo.** Mensagens de uma conversa e conversas da lista são abertas juntas, não uma por vez.
5. **Prazo das mensagens na memória do worker.** Para achar vencidas, o app decifrava todas as mensagens a cada sincronização (cada mensagem recebida e a cada 30 s), porque o prazo fica dentro da cifra de propósito. Agora o worker do banco lembra o prazo das mensagens que já abriu, só na memória e só com o app destrancado; trancar, trocar a chave do banco ou apagar tudo esquece. No arquivo o prazo continua cifrado. Uma mensagem regravada atualiza o prazo lembrado.
6. **"Abrindo…"** no botão enquanto o desbloqueio acontece.

## O que não foi feito (e por quê)

- **Baixar o custo do Argon2id:** é o que impede testar PINs em massa. Fica igual.
- **Guardar o id do aparelho fora da cifra para adiantar o login:** deixaria um identificador em claro no aparelho (vai contra a perícia testada em `app.test.mjs`).
- **Carregar telas sob demanda:** o código do app tem ~250 KB e já vem de dentro do APK; o ganho seria pequeno perto do risco.
- **Login e liberação do cofre num pedido só:** exige mudar o servidor e o protocolo; fica como ideia se, no celular, a rede pesar mais que o processamento.

## Testes

`perf.test.mjs` também confere que a limpeza com o prazo lembrado não apaga antes da hora, apaga a vencida e respeita o prazo novo de uma mensagem regravada.
