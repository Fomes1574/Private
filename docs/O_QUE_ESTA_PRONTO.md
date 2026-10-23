# Mensageiro Privado — tudo o que está pronto no GitHub

Repositório **Fomes1574/Private**, branch **`ccr-de59a90b-gr4vug`** (branch padrão).
Situação em 23/10/2026. Fonte da verdade: a especificação v7 em
`docs/especificacao/`, que prevalece em caso de conflito (§2.2).

Resumo: o app inteiro decidido na especificação está programado e com teste
automático. O CI está verde e o APK do Android compila. Falta só o que
depende de você: a conta da Cloudflare, a publicação e o teste nos aparelhos
reais (ver `docs/CLOUDFLARE_PASSO_A_PASSO.md` e `docs/ACOES_DO_PROPRIETARIO.md`).

---

## 1. Como o repositório está organizado

| Pasta | O que é |
|---|---|
| `docs/especificacao/` | Especificação v7 (normativa) |
| `docs/adr/` | 13 decisões de arquitetura registradas (ADR 0001–0013) |
| `docs/` | Guias e controle: Cloudflare passo a passo, ações do proprietário, pendências, critérios de aceite, este documento |
| `poc/01` a `poc/06` | As 6 provas de conceito, cada uma com README e RELATORIO |
| `packages/protocol` | Regras decididas: prazos, horário de Brasília, formato das mensagens, conversas, apelidos, documentos, notificação |
| `packages/crypto` | Criptografia: vodozemac (Olm) compilado para WASM, build reproduzível |
| `packages/client` | Núcleo do cliente: sessões cifradas por pessoa, envio para cada destinatário, mídia cifrada em segmentos, sincronização |
| `server` | Servidor na Cloudflare: Workers, Durable Objects, D1 e R2 |
| `app` | O app (PWA para iPhone e base do APK do Android) |
| `android-app` | Projeto Android (Capacitor) com proteção de tela |
| `deploy/provas` | Worker que publica as 6 provas para testar no celular |
| `e2e` | Testes das provas num navegador de verdade |
| `tools` | Página local que gera a chave de assinatura e os códigos secretos |
| `.github/workflows` | CI e os 3 botões de publicação |
| `SECURITY.md` | Regras de segurança e o que o projeto não promete |

---

## 2. As 6 provas de conceito (`poc/`)

| # | Prova | Resultado no navegador | Falta |
|---|---|---|---|
| 1 | vodozemac em WASM: troca cifrada, estado salvo, fechar e reabrir, segunda aba barrada | ok | iPhone/Android real |
| 2 | Face ID (passkey PRF) + PIN liberando a chave do banco; sem PRF falha de forma clara | ok (autenticador virtual) | iPhone real |
| 3 | Banco SQLite cifrado no OPFS: persiste, vence e some com a chave | ok | iPhone real |
| 4 | Service worker com versão travada, release assinada, anti-downgrade e atualização só com aceite | ok | iPhone real |
| 5 | Ver uma vez com consumo atômico no Durable Object (20 pedidos simultâneos abrem 1 vez só) | ok no Worker local, modos DO e R2 | Cloudflare + iPhone |
| 6 | Vídeo comprimido no aparelho: 4K vira 1080p, sem metadados, limite de 5 min | ok (VP9 no Chromium) | H.264 só no aparelho |

Cada pasta tem o roteiro "Como testar" para você seguir no celular e um botão
"Copiar relatório".

---

## 3. Arquitetura (Arquitetura A, §8) — onde fica cada dado (ADR 0013)

| Dado | Onde |
|---|---|
| Mensagens cifradas (um envelope por destinatário), prazos, "apagar para todos", quem está em cada conversa, cota de espaço | **D1** (banco `mp-db`) |
| Fotos, vídeos, áudios, documentos (prefixo `m/`) | **R2** (bucket `mp-media`), só ciphertext |
| Foto de perfil, foto de grupo, fundo (prefixo `v/`) | **R2**, só ciphertext, só a versão atual |
| Direito de abrir / ver uma vez / prazo de cada mídia | Durable Object `MediaBox` |
| Membros, liderança e prazos de cada conversa | Durable Object `Room` |
| Identidades, aparelhos, convites, sessões, chaves públicas, guardião, avisos de segurança | Durable Object `Circle` (atômico: limite de 10, convite de uso único) |
| 3 documentos ativos por pessoa | Durable Object `DocQuota` |
| Aviso "sincronize" (WebSocket) e push sem conteúdo | Durable Object `Live` |

Garantias de que os dados morrem:
- Mídia no R2 é apagada no vencimento, no último "ver uma vez", no "apagar para todos" e no 4º documento.
- O bucket tem uma regra que apaga qualquer mídia com mais de 16 dias, mesmo se a limpeza do app falhar.
- O D1 só entrega o que está no prazo; um cron a cada 15 minutos apaga o que venceu.
- Cota interna: reserva de espaço antes de cada upload, limite de 9 GB (abaixo dos 10 GB grátis do R2); acima disso o envio é recusado sem guardar nada.
- Limite de tráfego: até 300 escritas por minuto por pessoa.

---

## 4. Criptografia e segurança

- **E2EE com vodozemac (Olm)**: sessão por pessoa e envio separado para cada destinatário, também em grupo (sem Megolm, V7-002).
- **Envelope versionado** (`v`, `alg`) desde a primeira mensagem, com plano pós-quântico registrado (ADR 0003).
- **Preenchimento em degraus** (256 B, 1 KB, 4 KB, 16 KB, 64 KB): o servidor não sabe o tamanho real.
- **Anti-falsificação**: o remetente, a conversa e o id dentro da mensagem cifrada precisam bater com o que o servidor autenticou.
- **Mídia cifrada em segmentos** de 64 KiB (AES-GCM), com proteção contra cortar, reordenar ou emendar.
- **Servidor malicioso não estica o prazo**: o prazo vai dentro da mensagem cifrada; o aparelho usa o menor valor e nunca mais de 15 dias.
- **Replay recusado** pela criptografia.
- **Troca de chave de alguém** vira aviso de segurança; nada é cifrado para chave antiga.
- **Membro fantasma**: só a líder confirma, de ponta a ponta, quem está no grupo. Se o servidor incluir alguém, o envio é recusado.
- **Mensagem que falha na verificação** não é aberta e vira aviso visível em Ajustes.
- **Desbloqueio**: passkey com PRF + PIN (ou frase-senha), Argon2id. 5 erros destroem a chave do cofre.
- **Android**: segredo do Keystore liberado pela biometria.
- **Banco local cifrado** (SQLite no OPFS, cada registro com AES-GCM).
- **Rotação do banco (ADR 0012)**: depois de qualquer exclusão, ao bloquear e a cada 24 h, o banco é refeito com chave nova e o arquivo antigo é apagado. O que foi apagado não pode ser recuperado nem com a chave antiga.
- **`secure_delete`** ligado no SQLite.
- **Ao bloquear**, a memória da página é limpa: chaves, apelidos, conversas e imagens decifradas.
- **Atualização do app**:
  - release assinada (Ed25519) e versão travada;
  - só atualiza com o aceite da pessoa, mostrando o código curto;
  - anti-downgrade;
  - se algo não bate, falha fechado.
- **Proteção da página**: CSP rígida, Trusted Types, COOP/COEP, HSTS, sem `localStorage` para segredos.
- **Sem telemetria**, logs de requisição desligados (ADR 0008).
- **Notificação** com texto exatamente "novas mensagens", sem conteúdo.
- **Formatos aceitos**: só os que o próprio app gera (JPEG/WebP, MP4, Opus/AAC; documento só texto UTF-8). Tudo é recodificado no envio, sem EXIF/GPS.
- **CI de segurança**: gitleaks no histórico inteiro, osv-scanner e cargo audit nas dependências, builds reproduzíveis conferidos e dependências com versão travada.

---

## 5. O app — funções prontas (todas com teste pela interface)

**Entrada e conta**
- Instalar a primeira pessoa (administradora) com o código de instalação.
- Convite de uso único; limite de 10 pessoas; sem telefone, e-mail ou conta Apple/Google.
- Apelido único no círculo; busca local por prefixo, sem acento.
- Troca de celular só por código e aprovação no celular antigo (sem link).
- Recuperação: administradora + guardião, com 24 h de espera e aviso a todos.
- Congelar e remover pessoa (administradora).
- Uma instância por aparelho (segunda aba bloqueada).
- Capa de privacidade ao sair do app; bloqueio depois de 1 minuto fora.

**Conversas**
- 1:1 e grupo (até 10); quem inicia é a líder; ceder liderança; sucessão para o membro mais antigo.
- Prazos de 12 h a 15 dias (padrão 5 dias), separados para texto e mídia, valendo só para o futuro.
- Horário sempre de Brasília; nada de visto, entregue, online ou digitando.
- Responder, reagir, editar ("*editado", mesmo prazo), emojis.
- Apagar para mim; apagar para todos (só o autor).
- Desfazer vínculo (1:1) e encerrar grupo.
- Rascunho por conversa, cifrado, que some ao enviar.
- Menu ⋮:
  - buscar (só no que ainda vale, sem índice salvo);
  - silenciar (1 h, 8 h, 24 h, 7 dias ou até reativar);
  - fixar e arquivar;
  - apagar conversa só para mim;
  - participantes e números de segurança;
  - e, para a líder: prazos, nome, foto e fundo do grupo, adicionar e remover pessoas.

**Mídia**
- **Câmera e microfone dentro do app.** Foto e vídeo nascem na memória e só saem cifrados: nada vai para a galeria, para a nuvem ou para pasta temporária. A câmera desliga na hora se o app sai da tela.
- **Modo máximo, ligado por padrão:** foto e vídeo só pela câmera do app, inclusive em stories e fotos de perfil/grupo. Desligar em Ajustes traz a galeria de volta.
- Foto com editor no aparelho: girar, recortar (original, quadrado, 4:5, 16:9), desenhar, escrever, desfazer.
- Vídeo até 5 min, recodificado no aparelho (1080p); cai para qualidade econômica se ficar grande.
- Áudio até 1 h, com velocidades 1×, 1,5× e 2×.
- Ver uma vez para foto e vídeo: segurar para ver, soltar esconde, uma vez por destinatário; quem envia não reabre.
- Legenda cifrada (não em ver uma vez).
- Documento de texto até 20 MB:
  - 3 ativos por pessoa no app inteiro;
  - o 4º apaga o mais antigo para todos, com aviso antes;
  - abre como texto puro.
- Nada de baixar, encaminhar, picture-in-picture ou transmitir para outra tela; nenhuma marca d'água ou nome sobre a mídia.

**Perfil e grupo**
- Foto de perfil e recado (só o círculo vê, cifrados).
- Foto e fundo do grupo (só a líder troca).
- Ao trocar, a versão anterior é apagada do servidor na hora.

**Stories**
- Foto ou vídeo com legenda, cifrados.
- Você escolhe quem vê; prazo de 24 h por padrão (escolhível de 12 h a 15 d).
- Ninguém vê quem visualizou; apagar antes de vencer remove para todos.

**Ajustes**
- Número de segurança para comparar pessoalmente; avisos de segurança.
- Atualização do app com aceite e código da versão.
- Notificações; guardião; trocar de celular; seção da administradora.
- "O que este app não promete".
- Apagar tudo deste aparelho.

---

## 5.1 Rede lenta (Tor/VPN)
- Medido com rede simulada (`scripts/medir-rede.mjs`): no Tor, enviar texto ~1,6 s e receber ~2,0 s; em VPN, abaixo de 0,4 s.
- Otimizações sem tirar segurança: pedidos que saíam um depois do outro agora saem juntos, e o app parou de consultar o círculo a cada sincronização.
- A mensagem enviada aparece na hora ("enviando…").
- Guia: `docs/REDE_TOR_VPN.md` (Orbot no Android e no iPhone, VPN, Retransmissão Privada; o que cada um esconde).

## 5.2 Contra perícia e invasão (ADR 0014, `docs/ANALISE_FORENSE_50.md`)
- **Parte do servidor na chave:** o app só abre com Face ID + PIN + um segredo do servidor, e quem conta os erros é o servidor. Uma cópia do celular não deixa testar PINs; 5 erros destroem a chave para sempre.
- **PIN de coação:** abre o app "novo", vazio, e destrói tudo sem aviso.
- **Interruptor do homem morto:** celular sem abrir o app por X dias (padrão 15) perde a chave no servidor.
- **Código de emergência:** de qualquer aparelho, "Perdi meu celular" + código mata o celular perdido.
- **Banco do celular sem metadado em claro:** ids, conversas, datas e tamanhos escondidos (testado lendo os arquivos crus); chave de índice trocada a cada rotação; temporários só em memória.
- **Tranca na hora** ao sair do app (padrão); release sem nada no console.
- Os 50 métodos de perícia analisados: 32 protegidos, 16 em parte, 2 que nenhum app impede (spyware com o app aberto e um participante que entrega a conversa).

## 6. Android (`android-app/`)
- Capacitor com `appId` `com.mensageiro.privado`.
- `FLAG_SECURE` em todas as telas e sem miniatura no seletor de apps; WebView endurecido.
- Biometria forte (`BIOMETRIC_STRONG`) liberando o segredo do Keystore.
- Sem backup, sem tráfego sem HTTPS, sem FileProvider.
- APK compila no CI a cada envio; dependência vulnerável (uuid) corrigida.

---

## 7. Testes automáticos (todos passando)

| Suíte | Testes |
|---|---|
| Protocolo (`packages/protocol`) | 33 — rodados também em outro fuso horário |
| Criptografia (`packages/crypto`) | 5 |
| Cliente (`packages/client`) | 17 — três pessoas contra o servidor local, inclusive "servidor malicioso" |
| Servidor (`server`) | 30 com R2 e 29 com a alternativa DO — API inteira, cota, limite de tráfego, WebSocket e push |
| App (`app`) | 19 — duas pessoas usando o app pela interface, no Chromium, mais o teste da release assinada sem internet |
| Provas no navegador (`e2e`) | 7 |
| Provas (testes de cada pasta) | Provas 1–6 |

Exemplos do que é verificado:
- o servidor nunca vê texto em claro;
- ver uma vez não abre duas vezes nem com pedidos simultâneos;
- apagado não volta depois de sincronizar ou desbloquear;
- o arquivo do banco local é trocado depois de apagar;
- documento com HTML não vira página;
- convite não é reutilizável e a 11ª pessoa não entra.

Erros reais achados pelos testes e corrigidos:
- aviso de mensagem perdido por até 30 s;
- documento apagado continuava ocupando vaga;
- servidor podia esticar o prazo;
- mensagem adulterada descartada em silêncio;
- chave de "ver uma vez" ficava no aparelho;
- apelido apagava a foto;
- fechar o áudio abria o menu;
- Ajustes puxavam a pessoa de volta à tela.

---

## 8. CI e publicação (`.github/workflows/`)

| Workflow | Quando roda | O que faz |
|---|---|---|
| `ci.yml` | A cada envio | 14 jobs: segredos, dependências, provas, protocolo, cripto, cliente, servidor (R2 e DO), app, navegador |
| `android.yml` | A cada envio | Compila o APK |
| `deploy-provas.yml` | Só à mão, palavra `PUBLICAR` | Publica as 6 provas |
| `deploy-api.yml` | Só à mão, palavra `PUBLICAR-API` | Testa, cria D1, bucket R2 e regra de 16 dias, publica a API e grava os segredos (chaves de push geradas lá dentro) |
| `deploy-app.yml` | Só à mão, palavra `PUBLICAR-APP` | Monta e assina a release, versão sempre crescente, publica e mostra a chave pública para conferência |

Todos os deploys só pelo GitHub Actions; nenhum segredo no repositório; o
token da Cloudflare fica só nos Secrets do GitHub.

---

## 9. Documentos para você
- `docs/CLOUDFLARE_PASSO_A_PASSO.md` — todos os passos, campo por campo.
- `docs/ACOES_DO_PROPRIETARIO.md` — o que só você pode fazer e as decisões pendentes.
- `docs/PENDENCIAS.md` — estado de cada pendência P-xx.
- `docs/CRITERIOS.md` — cada critério de aceite (§26) e onde está testado.
- `docs/adr/` — por que cada decisão foi tomada.
- `docs/ANALISE_FORENSE_50.md` — os 50 métodos de perícia e invasão, um por um, e o que fazer.
- `docs/REDE_TOR_VPN.md` — Tor, VPN e Retransmissão Privada: o que escondem e como ligar.
- `tools/gerar-chave-de-assinatura.html` — gera, no seu computador, a chave de assinatura e os códigos secretos.

---

## 10. O que ainda NÃO está feito (e por quê)

| Item | Motivo |
|---|---|
| Publicação na Cloudflare | Precisa da sua conta e dos segredos (guia pronto) |
| Teste em iPhone e Android reais | Precisa dos aparelhos (roteiros prontos em cada prova) |
| Gate online criptográfico de texto (P-24, ADR 0009) | Bloqueado pela especificação até revisão criptográfica independente |
| Revisão independente de segurança | Custa dinheiro; decisão sua |
| Documentos além de texto (PDF etc.) | Precisa de visualizador seguro (P-12); decisão sua |
| Levar o histórico na troca de celular | Hoje começa do zero (mais seguro); decisão sua |
| Domínio próprio, versão mínima do iOS, aceite do risco pós-quântico, prazo padrão das stories | Decisões suas, com recomendação em `ACOES_DO_PROPRIETARIO.md` |
