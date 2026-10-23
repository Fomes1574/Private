# Relatório · Prova 6 · Comprimir vídeo no aparelho

**Pergunta:** o Safari do iPhone, como PWA, consegue transformar um vídeo 4K de
até 5 minutos em H.264 1080p sem travar, sem estourar memória e sem mandar o
original para ninguém?

**Resposta até agora:** o fluxo funciona no Chromium com VP9. **H.264 só dá para
testar no iPhone e no Android**: o Chromium de teste não traz codecs
proprietários. Este é o ponto mais incerto do documento e continua aberto até
o teste no aparelho.

## O que foi construído
- Recusa na hora, antes de processar: vídeo acima de 5 minutos (V6-018),
  arquivo sem vídeo, aparelho sem H.264 ou sem codificador de áudio.
- Sem fallback: se não der para recodificar, **nada é enviado** (§14).
- Sempre recodifica (`copy: false`): nenhum pedaço do original passa direto
  (V7-016). Metadados zerados (`tags: {}`), rotação aplicada nos pixels.
- Tamanho final cabe em 1920×1080 (ou 1080×1920), sem aumentar, lados pares.
- Áudio AAC quando o aparelho codifica; senão Opus (no MP4).
- Cancelar a qualquer momento.

## Resultados automatizados (Chromium, VP9 por parâmetro de teste)

| Teste | Resultado |
|---|---|
| 4K 3 s → 1920×1080 | ok |
| Metadados do original (título, comentário com coordenadas) | removidos |
| Duração preservada | ok |
| Vídeo de 5 min 1 s | recusado antes de processar |
| Sem H.264 no navegador | recusado, nada enviado |
| Regras de tamanho (4K paisagem/retrato, pequeno, ímpar, proporção estranha) | ok |

Velocidade no Chromium com VP9 em software: ~0,7× tempo real para 4K→1080p.
No iPhone a expectativa é bem maior (H.264 por hardware), mas **não medido**.

## Aparelhos reais

| Ambiente | H.264 disponível | 4K 30 s: tempo / tamanho | 1 min: tempo / tamanho | >5 min recusado | Sair do app no meio | `tagKeys` vazio |
|---|---|---|---|---|---|---|
| iPhone · Tela de Início | | | | | | |
| Android · Chrome | | | | | | |

## Riscos que o teste no iPhone precisa responder
- **Memória:** o resultado inteiro fica em memória (`BufferTarget`). Um vídeo de
  5 min a 2,5 Mbit/s dá ~95 MB. Se o iPhone matar a página, o próximo passo é
  gravar em pedaços cifrados direto no OPFS (Prova 3) em vez de memória.
- **Sair do app no meio:** o iOS suspende a página; a compressão pode falhar ou
  continuar ao voltar. O relatório conta quantas vezes o app saiu.
- **Bitrate e tamanho final (P-13):** os presets são pontos de partida. A escolha
  final depende do tempo e do tamanho medidos aqui e da cota do R2/DO (P-14).

## Trusted Types
A mediabunny cria Workers a partir de `blob:`. Como os arquivos dela não podem
ser alterados (MPL + hash conferido), `web/tt.js` cria a política `default`
que aceita **só** `blob:` da própria origem. Criar esse blob já exige executar
código na origem, então não abre caminho novo para injeção; qualquer outra URL
de script, HTML em texto ou script em texto continua bloqueado.
