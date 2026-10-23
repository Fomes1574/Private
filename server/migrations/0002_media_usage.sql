-- Cota interna de armazenamento (§24): reserva atômica antes de cada upload.
-- Uma linha por objeto guardado (mídia, documento, foto de perfil/grupo).
-- expires_at NULL = foto de perfil/grupo/fundo (sem prazo até trocar).
-- Linha vencida não conta, mesmo que a limpeza ainda não tenha rodado.
CREATE TABLE media_usage (
  media_id TEXT PRIMARY KEY,
  bytes INTEGER NOT NULL,
  expires_at INTEGER
) WITHOUT ROWID;
CREATE INDEX media_usage_exp ON media_usage(expires_at);
