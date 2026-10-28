# ADR 0019 — Galeria sem PIN na volta rápida, sem notificações e recuperação sem guardião

Data: 28/10/2026. Estado: aprovado pelo proprietário (decisões D12–D16 em `PLANO_REVISAO_2026-10-25.md`, seção 1.3); implementado na entrega E1.

## Galeria (D12)

O botão Galeria abria o seletor de documentos do Android (`ACTION_OPEN_DOCUMENT`), que mostra a tela de Arquivos. Agora fotos e vídeos vêm do **seletor de fotos do sistema** (`MediaStore.ACTION_PICK_IMAGES`): grade só com fotos e vídeos, até 5, sem permissão de armazenamento e sem biblioteca do Google. Ele existe no Android 13+ e no 11/12 com a atualização de sistema que o traz; nos demais, o seletor de documentos continua como reserva. Documentos seguem pelo seletor de documentos. Nada é copiado para arquivo ou cache; a URI continua transitória e a leitura continua em blocos pelo plugin.

O que vem da galeria vai sempre como foto ou vídeo: as fotos juntas para a tela de preparar (editar, ①, HD, legenda) e cada vídeo com a escolha "normal" ou "ver uma vez". Provedores que não informam o tamanho na consulta (fotos na nuvem) passam a ser medidos pelo descritor do arquivo; sem tamanho, a recusa é clara.

## Volta rápida sem PIN (D13)

Antes (F17), o app trancava antes de abrir o seletor, e a seleção só era lida depois do PIN, a partir de um cartão na lista. Agora, quando é o **próprio app** que abre o seletor, existe uma janela de 2 minutos: voltando dentro dela, o app continua aberto e a seleção é lida na hora, na conversa. A capa de privacidade e o bloqueio de print continuam durante a ida. Se a janela vencer, o app tranca sozinho (ainda em segundo plano, quando o sistema deixa o temporizador rodar; senão, ao voltar). Sair do app por qualquer outro motivo tranca como antes. Se trancou no caminho, o PIN leva direto de volta à conversa com a seleção (sem passar pela lista).

O plugin nativo mantém as travas: só lê com a janela do app em foco, com o token da seleção, até 5 minutos após escolher, e depois de o JS liberar (`authorize`), o que só acontece com o app aberto.

**Risco aceito pelo proprietário:** quem pegar o celular nesses 2 minutos, com o seletor aberto, volta ao app sem PIN.

## Prévia obrigatória (D14) e sem notificações (D15)

A prévia da última mensagem na lista deixa de ser opcional. Ver uma vez continua sem prévia. A seção de notificações sai dos Ajustes. Quem tinha ligado é desligado no próximo desbloqueio: o servidor esquece o destino e o aparelho apaga o token ou a assinatura. Com isso, o iPhone também deixa de avisar com o app fechado, e a Apple deixa de ver quando houve aviso (R-04).

## Recuperação sem guardião (D16, primeira parte)

Ao revisar, o guardião que não era a administradora não tinha botão para autorizar; a recuperação só funcionava quando a própria administradora era o guardião. O guardião sai: a administradora autoriza sozinha (confirmando que falou com a pessoa), começa a espera de 24 horas com aviso a todos, e o aparelho antigo ainda pode cancelar. Depois disso, a administradora emite o convite de recuperação. A rota `/v1/me/guardian` foi removida; as colunas antigas ficam no banco, sem uso.

Fica para depois, aguardando decisão do proprietário sobre a espera de 24 horas: a pessoa digitar o próprio PIN no celular novo e a administradora aprovar lendo um código da tela. Isso exige um verificador do PIN no servidor, separado do cofre do aparelho e com limite de tentativas, e terá revisão própria.
