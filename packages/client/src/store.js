// Armazenamento local do cliente. O app usa o banco cifrado (Prova 3); os
// testes usam esta versão em memória com a mesma interface.
export class MemoryStore {
  constructor() { this.kv = new Map(); this.msgs = new Map(); }
  async get(k) { return this.kv.get(k); }
  async put(k, v) { this.kv.set(k, v); }
  async putMessage(m) { this.msgs.set(m.msgId, m); }
  async getMessage(id) { return this.msgs.get(id); }
  async deleteMessages(ids) { for (const id of ids) this.msgs.delete(id); }
  async roomMessages(room) { return [...this.msgs.values()].filter((m) => m.room === room).sort((a, b) => a.acceptedAt - b.acceptedAt || (a.msgId < b.msgId ? -1 : 1)); }
}
