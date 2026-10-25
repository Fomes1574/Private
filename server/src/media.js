// Mídia cifrada (Prova 5 generalizada). Um Durable Object por objeto.
// mode "once": ver uma vez por destinatário (§15); "media": foto, vídeo e
// áudio até vencer; "doc": documento (cota global em docs.js); "visual": foto
// de perfil/grupo ou fundo, sem prazo, só a versão atual (rota própria).
// O servidor nunca recebe a chave do conteúdo.
import { DurableObject } from 'cloudflare:workers';

export const CHUNK = 1_900_000; // abaixo do limite de 2 MB por linha do SQLite do DO

export class MediaBox extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.ensure();
  }

  ensure() {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS rights (member TEXT PRIMARY KEY, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chunks (i INTEGER PRIMARY KEY, data BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS retired_keys (key TEXT PRIMARY KEY);`);
  }
  meta() {
    this.ensure();
    const out = {};
    for (const r of this.sql.exec('SELECT k, v FROM meta')) out[r.k] = JSON.parse(r.v);
    return out;
  }
  setMeta(obj) {
    for (const [k, v] of Object.entries(obj)) this.sql.exec('INSERT INTO meta(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, JSON.stringify(v));
  }
  pending() { return this.sql.exec("SELECT count(*) AS n FROM rights WHERE state = 'pending'").one().n; }

  async create({ mediaId, mode, room, sender, recipients, expiresAt, backend, slot = null, key = null, size = null, retry = false }) {
    const old = this.meta();
    if (old.state) {
      if (!retry || old.sender !== sender || old.room !== room || old.mode !== mode || old.expectedSize !== size) return { error: 'exists' };
      if (old.state === 'active') return { ok: true, active: true, expiresAt: old.expiresAt };
      if (old.state !== 'uploading' || Date.now() - old.uploadAt < 120_000) return { error: 'upload_busy' };
      // A lease vencida não pode escrever no objeto da tentativa seguinte.
      if (old.backend === 'r2') this.sql.exec('INSERT OR IGNORE INTO retired_keys(key) VALUES (?)', old.key);
    }
    const lease = crypto.randomUUID();
    this.setMeta({ state: 'uploading', mediaId, mode, room, sender, expiresAt, backend, slot, expectedSize: size, lease, uploadAt: Date.now(), key: retry ? `m/${mediaId}/${lease}` : key ?? `m/${mediaId}` });
    this.sql.exec('DELETE FROM rights');
    this.sql.exec('DELETE FROM chunks');
    for (const m of recipients) this.sql.exec("INSERT OR IGNORE INTO rights(member, state) VALUES(?, 'pending')", m);
    if (expiresAt) await this.ctx.storage.setAlarm(expiresAt);
    return { ok: true, lease, key: this.meta().key };
  }

  putChunk(i, data, lease = null) {
    if (this.meta().state !== 'uploading' || lease && lease !== this.meta().lease) return { error: 'bad_state' };
    this.setMeta({ uploadAt: Date.now() });
    this.sql.exec('INSERT OR REPLACE INTO chunks(i, data) VALUES(?, ?)', i, data);
    return { ok: true };
  }

  seal({ count, size, lease = null }) {
    if (this.meta().state !== 'uploading' || lease && lease !== this.meta().lease) return { error: 'bad_state' };
    this.setMeta({ state: 'active', count, size });
    return { ok: true };
  }

  // Sem await entre ler e gravar o direito: uma chamada por vez no DO.
  async open(member) {
    const meta = this.meta();
    if (!meta.state) return { error: 'gone' };
    if (meta.state === 'revoked') return { error: 'gone' };
    if (meta.state !== 'active') return { error: 'not_ready' };
    if (meta.mode === 'visual') return { error: 'forbidden' }; // só pela rota de visuais (confere a versão atual)
    if (Date.now() >= meta.expiresAt) { await this.purge(); return { error: 'expired' }; }
    const info = { backend: meta.backend, count: meta.count, size: meta.size, mediaId: meta.mediaId, key: meta.key ?? `m/${meta.mediaId}` };
    if (meta.mode !== 'once') {
      // Mídia comum: autor e destinatários baixam até vencer.
      if (member === meta.sender) return { ok: true, ...info, last: false };
      const row = this.sql.exec('SELECT state FROM rights WHERE member = ?', member).toArray()[0];
      if (!row || row.state === 'revoked') return { error: 'forbidden' };
      return { ok: true, ...info, last: false };
    }
    if (member === meta.sender) return { error: 'forbidden' }; // remetente não reabre (§15.6)
    const row = this.sql.exec('SELECT state FROM rights WHERE member = ?', member).toArray()[0];
    if (!row) return { error: 'forbidden' };
    if (row.state !== 'pending') return { error: row.state === 'consumed' ? 'used' : 'revoked' };
    this.sql.exec("UPDATE rights SET state = 'consumed' WHERE member = ?", member);
    return { ok: true, ...info, last: this.pending() === 0 };
  }

  // Para a cota de documentos: o servidor usa o que ELE registrou, nunca o
  // que o cliente diz sobre dono, conversa, tamanho ou prazo.
  describe() {
    const m = this.meta();
    if (!m.state || m.state === 'revoked') return { error: 'gone' };
    return { mode: m.mode, room: m.room, sender: m.sender, size: m.size ?? 0, expiresAt: m.expiresAt, state: m.state, slot: m.slot, count: m.count, backend: m.backend, key: m.key ?? `m/${m.mediaId}` };
  }

  readChunk(i) { return this.sql.exec('SELECT data FROM chunks WHERE i = ?', i).one().data; }

  async abortUpload(lease) {
    if (this.meta().state === 'uploading' && this.meta().lease === lease) await this.purge();
    return { ok: true };
  }

  async purgeIfDone() {
    if (this.meta().mode === 'once' && this.pending() === 0) await this.purge();
    return { ok: true };
  }

  // Apagar para todos (autor) ou revogação do 4º documento (sistema).
  async revokeAll(member, { system = false } = {}) {
    const meta = this.meta();
    if (!meta.state) return { error: 'gone' };
    if (!system && member !== meta.sender) return { error: 'forbidden' };
    await this.purge();
    return { ok: true };
  }

  // Conversa encerrada (desfazer vínculo, encerrar grupo, V7-008): ver uma
  // vez ainda não aberto deixa de existir para todos. Mídia comum continua
  // só para leitura até vencer, como as mensagens.
  async closeRoom() {
    const meta = this.meta();
    if (!meta.state) return { error: 'gone' };
    if (meta.mode === 'once') await this.purge();
    return { ok: true };
  }

  // Membro removido perde o direito e não segura a limpeza (§15.7).
  async revokeMember(target) {
    const meta = this.meta();
    if (!meta.state) return { error: 'gone' };
    this.sql.exec("UPDATE rights SET state = 'revoked' WHERE member = ?", target);
    if (meta.mode === 'once' && this.pending() === 0) await this.purge();
    return { ok: true };
  }

  purge() {
    // Vários pedidos de revogação podem chegar enquanto o R2 é aguardado.
    // Uma limpeza antiga não pode apagar uma nova tentativa com o mesmo id.
    return this.purging ??= this.purgeStored().finally(() => { this.purging = null; });
  }
  async purgeStored() {
    const meta = this.meta();
    if (!meta.state) return true;
    // Revogação lógica vem antes de qualquer await externo. Uma falha no R2
    // não deixa o direito vivo; o alarme repete a limpeza até concluir.
    this.setMeta({ state: 'revoked' });
    this.sql.exec("UPDATE rights SET state = 'revoked'");
    await this.ctx.storage.setAlarm(Date.now() + 60_000);
    try {
      if (meta.backend === 'r2' && this.env.MEDIA) await this.env.MEDIA.delete(meta.key ?? `m/${meta.mediaId}`);
      if (this.env.MEDIA) for (const r of this.sql.exec('SELECT key FROM retired_keys').toArray()) await this.env.MEDIA.delete(r.key);
      if (meta.mediaId && this.env.DB) await this.env.DB.prepare('DELETE FROM media_usage WHERE media_id = ?').bind(meta.mediaId).run();
    } catch { return false; }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    return true;
  }

  async alarm() { await this.purge(); }
  // Só pelo gancho de teste local (S13): o mesmo efeito do alarme.
  async expireNow() { await this.purge(); return { ok: true }; }
}
