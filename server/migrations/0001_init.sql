-- D1: só o que o servidor precisa para entregar e expirar (§9, V6-007).
-- Sem texto legível, sem nomes, sem apelidos.

-- Metadados mínimos por mensagem: autor (para "apagar para todos" só pelo autor),
-- prazo e idempotência por (room, msg_id).
CREATE TABLE messages (
  room TEXT NOT NULL,
  msg_id TEXT NOT NULL,
  sender TEXT NOT NULL,
  accepted_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (room, msg_id)
) WITHOUT ROWID;
CREATE INDEX messages_exp ON messages(expires_at);

-- Um envelope cifrado por destinatário (fan-out). Apagado ao ser confirmado
-- pelo aparelho, ao vencer ou ao ser apagado para todos.
CREATE TABLE envelopes (
  recipient TEXT NOT NULL,
  room TEXT NOT NULL,
  msg_id TEXT NOT NULL,
  accepted_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ct BLOB NOT NULL,
  PRIMARY KEY (recipient, room, msg_id)
) WITHOUT ROWID;
CREATE INDEX envelopes_inbox ON envelopes(recipient, accepted_at);
CREATE INDEX envelopes_exp ON envelopes(expires_at);

-- "Apagar para todos": cada destinatário recebe a marca antes de qualquer
-- renderização (§12). Guardada até o prazo da mensagem original.
CREATE TABLE tombstones (
  recipient TEXT NOT NULL,
  room TEXT NOT NULL,
  msg_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (recipient, room, msg_id)
) WITHOUT ROWID;
CREATE INDEX tombstones_exp ON tombstones(expires_at);

-- Quem está em qual conversa (necessário para rotear; IDs opacos, sem nomes).
CREATE TABLE room_members (
  user_id TEXT NOT NULL,
  room TEXT NOT NULL,
  PRIMARY KEY (user_id, room)
) WITHOUT ROWID;
