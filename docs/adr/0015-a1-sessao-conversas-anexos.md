# ADR 0015 — A1: sessão, conversa individual e retorno de anexos

Data: 25/10/2026. Estado: **Aceito pelo proprietário** no plano final e na autorização de implementação desta data; **liberação pendente dos testes de A1**.

## Contexto

Operações de mídia podiam terminar depois da saída da tela/bloqueio; o microfone sobrevivia à tela. A lista era redesenhada durante a leitura, a abertura por pressão podia ser perdida ao soltar e a criação de conversa não era idempotente. O seletor externo conflita com o bloqueio imediato. O worker do banco permitia intercalar operações assíncronas com a rotação.

## Decisão

- Operações sensíveis pertencem à sessão/tela e recebem cancelamento. Bloqueio cobre o conteúdo e cancela os recursos antes de esperar armazenamento. Resultados de uma sessão anterior não podem reabrir a interface.
- D6 substitui a interface de pressão de V6-017/§15: tocar abre, X/voltar fecha; perder foco fecha. O consumo no servidor continua atômico. Não há transação entre rede e exibição: falha ou cancelamento pode perder a visualização, sem tentativa automática.
- O banco executa uma operação por vez e pausa operações comuns entre rebuild e switchTo; falha no salvamento do cofre retoma no banco anterior. Não criar criptografia nova.
- O DO do círculo coordena a criação de uma sala individual ativa por dupla. IDs continuam aleatórios. Após encerrar, nova sala recebe novo ID. Para compatibilidade, somente clientes que solicitam `reuse: true` recebem uma resposta reutilizada e preservam liderança/anúncios.
- O seletor Android retorna um token transitório. URI e arquivo não são persistidos pelo plugin. Bloqueio ocorre antes de abrir o seletor; leitura em blocos somente depois de novo desbloqueio e confirmação. Sem permissões amplas, FileProvider ou serviços do Google.

## Alternativas descartadas

Desativar o bloqueio ao abrir o seletor enfraqueceria o padrão de privacidade. Ignorar o resultado tardio sem liberar recursos deixaria mídia/microfone ativos. Somente bloquear toques não resolveria concorrência entre participantes. Reutilizar ID determinístico após encerrar contrariaria V7-008. Juntar histórias de salas antigas poderia alterar confiança e conteúdo sem escolha do usuário.

## Consequências e migração

Não muda os formatos Olm/AES, políticas de prazo ou identidade dos aparelhos. A nova tabela no Circle é criada de forma aditiva. Clientes antigos continuam criando no formato anterior; atualizar API e app é necessário para a deduplicação. Duplicadas antigas permanecem até a exclusão local da entrega B. O token transitório mantém apenas o contexto necessário ao retorno autenticado e expira em cinco minutos.

A perda de foco cancela editor/câmera e visualizadores. Stories retomadas pelo seletor pedem nova revisão da audiência/legenda. A inspeção S2 não foi concluída em aparelho: Blobs/codec continuam os existentes, sem alegação de ausência de cópias em disco.

## Reversibilidade e testes

A mudança da interface não transforma uma mídia já consumida em reabrível. A tabela de deduplicação é compatível com rollback do cliente, mas desativar o novo caminho pode voltar a permitir duplicadas. Não reutilizar sala encerrada ou restaurar chaves apagadas.

Testes de regressão e resultados em `../ENTREGA_A1_2026-10-25.md`. A1 exige CI/compilação e Android físico para microfone, seletor e S2. Este ADR não libera deploy nem implementa A2/B/C/D.
