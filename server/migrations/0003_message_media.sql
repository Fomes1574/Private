-- F04/F16: liga a mensagem à mídia dela (id opaco). Assim "apagar para
-- todos" revoga a mídia no servidor na mesma operação, e o documento entra
-- na cota no próprio envio. Nada de conteúdo, nome ou tipo aqui.
ALTER TABLE messages ADD COLUMN media_id TEXT;
