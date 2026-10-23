// Cota de documentos por pessoa no app inteiro (§16): um DO por autor.
// A transição lógica (4º ativo, mais antigo revogado) é atômica aqui; a
// limpeza física (mídia e tombstone) é feita em seguida pelo Worker.
import { DurableObject } from 'cloudflare:workers';
import { publish } from '../../packages/protocol/src/documents.js';

export class DocQuota extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS docs (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL)');
  }
  load() { const r = this.sql.exec('SELECT json FROM docs').toArray()[0]; return r ? JSON.parse(r.json) : []; }

  // Quantos documentos desta pessoa ainda estão ativos (para avisar antes
  // de o quarto envio revogar o mais antigo).
  active() {
    const now = Date.now();
    return this.load().filter((d) => d.state === 'active' && d.expiresAt > now).length;
  }

  // Apagado para todos (pela mensagem ou pela mídia): libera a vaga na hora.
  release(id) {
    const all = this.load();
    const keep = all.filter((d) => d.docId !== id && d.msgId !== id);
    if (keep.length !== all.length) this.sql.exec('INSERT OR REPLACE INTO docs(id, json) VALUES (1, ?)', JSON.stringify(keep));
    return { released: all.length - keep.length };
  }

  publish(owner, doc) {
    const now = Date.now();
    let res;
    try { res = publish(this.load(), { ...doc, owner }, now); } catch (e) { return { error: 'too_large', detail: e.message }; }
    // Guarda só o que ainda importa (ativos); vencidos e revogados saem.
    const keep = res.docs.filter((d) => d.state === 'active' && d.expiresAt > now);
    this.sql.exec('INSERT OR REPLACE INTO docs(id, json) VALUES (1, ?)', JSON.stringify(keep));
    const evicted = res.docs.filter((d) => res.evicted.includes(d.docId)).map((d) => ({ docId: d.docId, room: d.room, msgId: d.msgId }));
    return { ok: true, evicted, active: keep.length };
  }
}
