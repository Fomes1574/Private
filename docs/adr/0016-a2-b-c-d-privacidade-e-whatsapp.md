# ADR 0016 — Entregas A2, B, C e D: privacidade própria, funções como no WhatsApp

Data: 25/10/2026. Estado: **Aceito pelo proprietário** (plano final de 25/10/2026, "siga suas recomendações", "funcionalidades do WhatsApp, segurança nossa"); **liberação pendente** de CI, deploy da API e testes em celular de verdade.

## Contexto

O plano final (`PLANO_REVISAO_2026-10-25.md`) listou lacunas de privacidade (S1–S13), bugs (F04–F18, N2, N3) e funções do WhatsApp a copiar (D1–D11, b.1–b.21). A1 foi entregue antes (ADR 0015). Esta decisão cobre o resto.

## Decisões

**Segurança (nossa, pelos 50 passos):**
- **S1/S8:** avisos de segurança guardados no banco cifrado (30 dias), mostrados na própria conversa. Número de segurança da dupla (metade de cada chave, ordem fixa) e QR com as duas chaves públicas. Contato "verificado" que troca de chave **pausa o envio de mídia** (texto continua) até conferir de novo ou aceitar a chave nova. A conferência acontece antes de qualquer upload.
- **S3:** a administradora é a primeira identidade do círculo, fixada no aparelho na primeira vez (TOFU). Ela confirma, por anúncio cifrado, quem está no círculo. Quem não foi confirmado recebe um envelope de enchimento (o servidor exige um por membro e não distingue) e não recebe apelido, foto nem stories. Sem lista confirmada (círculos antigos), vale o comportamento anterior até a administradora confirmar.
- **S12:** a parte S do cofre fica cifrada (AES-GCM) por uma chave própria de cada cofre, guardada no R2 (`k/<vaultId>`, sem regra de vencimento). Destruir o cofre apaga essa chave; o histórico de 30 dias do SQLite do Durable Object passa a ter só S cifrada por uma chave que não existe mais. A chave a apagar é marcada (`dead_keys`) antes, para repetir se o R2 falhar. Cofres antigos passam a ser cifrados na próxima abertura, sem trocar S.
- **S7:** mídia (não documento) vai no formato 2: tamanho real cifrado na frente e zeros até um degrau (múltiplo de max(64 KiB, 1/8 da potência de 2 abaixo)), no máximo ~12,5% a mais. O formato 1 continua abrindo.
- **S5:** WebView do Android pede ao teclado `IME_FLAG_NO_PERSONALIZED_LEARNING` (teclado anônimo), trocando o layout do Capacitor por `IncognitoWebView`.
- **F04/F16:** a mensagem leva o id da mídia ao servidor (coluna `messages.media_id`, migração 0003). "Apagar para todos" revoga a mídia **antes** de apagar a mensagem; se a revogação falhar, nada é apagado. Documento entra na cota no próprio envio; se a cota falhar, mensagem e mídia são retiradas.
- **F05:** desfazer vínculo ou encerrar grupo revoga o ver uma vez pendente; mídia comum fica para leitura até vencer.
- **F09/D7:** edição só da mesma conversa, só texto, só do autor e só nos primeiros 15 minutos (quem recebe aceita 5 minutos de folga de rede). Reação, voto e fixar só de membro confirmado.
- **F10/F11:** fila de envio no banco cifrado: o envelope cifrado é guardado antes de sair; sem resposta, a fila reenvia o mesmo id e o mesmo envelope (o servidor reconhece), sozinha a cada sincronização. Recusa definitiva tira da fila e revoga a mídia já enviada.
- **S13:** gancho de teste local (`TEST_HOOKS=1`, só endereço local, nunca no deploy) para provar que o alarme de vencimento apaga a mídia do R2.

**Funções (como no WhatsApp):** busca por qualquer trecho (pessoas, grupos e mensagens, só no aparelho); prévia e contador de não lidas na lista (prévia desligável, nunca para ver uma vez); fixar até 3 conversas; marcar como não lida; limpar × excluir só neste aparelho (excluída volta com mensagem nova; grupo só se exclui depois de sair); segurar a mensagem para reações e menu; deslizar para responder; selecionar várias; separadores de dia e faixa de não lidas; ✓ de enviada (sem ✓✓ nem lida); formatação (\*negrito\* etc.); @menção; áudio com cadeado, pausa, onda e ouvir antes de enviar; áudio de ver uma vez; lote de até 5 fotos com edição, ver uma vez e legenda por foto; foto HD; vídeo redondo; enquete; fixar mensagem (até 3, nunca além do prazo); favoritas (só no aparelho, vencem junto); mídia e favoritas da conversa (sem miniaturas); responder em particular; descrição do grupo; papel de parede local; anotações só no aparelho.

**Ficam de fora (passos 22, 24–29, 34, 36, 40, 41, 47, 48):** encaminhar, salvar, exportar, backup, computador, leitura/online/digitando, GIFs externos, localização, chamadas.

## Compatibilidade

Mídia formato 2, áudio de ver uma vez, enquete, voto, fixar, vídeo redondo e foto HD **não abrem em versões antigas do app** (a mensagem é recusada com aviso, nada vaza). Todos os membros devem atualizar juntos: deploy da API (migração 0003), novo APK e nova versão da PWA. A rota `/v1/docs/publish` continua para APKs antigos.

## Testes

Protocolo, cliente (`a2.test.mjs`, `c.test.mjs`), servidor (`a2.test.mjs`) e interface (`app.test.mjs`). Resultados em `ENTREGA_A2_B_C_D_2026-10-25.md`. Nada foi testado em celular de verdade.
