// Exercita as classes de produção com SQLite real e falhas nos serviços
// externos. Não substitui meta()/setMeta(): a revogação tem que ser durável.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import * as http from '../src/http.js';
import * as rules from '../../packages/protocol/src/room.js';
import * as ttl from '../../packages/protocol/src/ttl.js';

class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }
const load = async (name, bindings = {}) => {
  const source = (await readFile(new URL(`../src/${name}.js`, import.meta.url), 'utf8')).replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');
  return new Function(...Object.keys(bindings), `${source}; return ${name === 'media' ? 'MediaBox' : name === 'circle' ? 'Circle' : 'Room'};`)(...Object.values(bindings));
};
const MediaBox = await load('media', { DurableObject });
const Circle = await load('circle', { DurableObject, FCM_TOKEN_RE: /^.+$/, randomId: http.randomId, sha256b64: http.sha256b64, unb64: http.unb64 });
const Room = await load('room', { DurableObject, ...rules, ...ttl });
function context() {
  const db = new DatabaseSync(':memory:');
  const sql = { exec(query, ...args) {
    let rows = [];
    if (/^\s*(SELECT|PRAGMA)/i.test(query)) rows = db.prepare(query).all(...args);
    else if (args.length) db.prepare(query).run(...args);
    else db.exec(query);
    return { toArray: () => rows, one: () => { assert.equal(rows.length, 1); return rows[0]; }, [Symbol.iterator]: () => rows[Symbol.iterator]() };
  } };
  const ctx = { storage: { sql, alarm: null, async setAlarm(t) { this.alarm = t; }, async deleteAlarm() { this.alarm = null; }, async deleteAll() { for (const r of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) db.exec(`DROP TABLE ${r.name}`); } }, blockConcurrencyWhile: (fn) => fn(), waitUntil: () => {} };
  return ctx;
}
function r2() {
  const objects = new Map();
  return { objects, failDelete: false, async put(k, bytes) { objects.set(k, new Uint8Array(bytes)); }, async get(k) { const b = objects.get(k); return b ? { arrayBuffer: async () => b.slice().buffer } : null; }, async delete(keys) { if (this.failDelete) throw new Error('R2 indisponível'); for (const k of Array.isArray(keys) ? keys : [keys]) objects.delete(k); } };
}

test('R13: fechar com R2 indisponível revoga antes do await; novo objeto continua negando; alarme limpa', async () => {
  const ctx = context(), MEDIA = r2(), env = { MEDIA };
  let box = new MediaBox(ctx, env);
  await box.create({ mediaId: 'media-test', mode: 'once', room: 'room-test', sender: 'sender-test', recipients: ['recipient-test'], expiresAt: Date.now() + 60_000, backend: 'r2' });
  box.seal({ count: 0, size: 100 });
  await MEDIA.put('m/media-test', new Uint8Array(100)); MEDIA.failDelete = true;
  await box.closeRoom();
  assert.equal((await box.open('recipient-test')).error, 'gone');
  assert.ok(ctx.storage.alarm); assert.equal(MEDIA.objects.size, 1);
  box = new MediaBox(ctx, env);
  assert.equal(box.describe().error, 'gone');
  MEDIA.failDelete = false; await box.alarm();
  assert.equal(MEDIA.objects.size, 0); assert.equal(ctx.storage.alarm, null);
});

test('R13: intenção de revogação da conversa sobrevive a RPC indisponível', async () => {
  const ctx = context(); let failed = true, calls = 0;
  const env = { MEDIA_BOX: { idFromName: (n) => n, get: () => ({ closeRoom: async () => { calls++; if (failed) throw new Error('DO indisponível'); return { ok: true }; } }) } };
  const room = new Room(ctx, env);
  ctx.storage.sql.exec('INSERT INTO media(media_id, expires_at) VALUES (?, ?)', 'media-test', Date.now() + 60_000);
  await room.scheduleRevocations({ closed: true });
  await room.flushRevocations();
  assert.equal(ctx.storage.sql.exec('SELECT count(*) AS n FROM media_revocations').one().n, 1);
  assert.ok(ctx.storage.alarm);
  failed = false; await room.alarm();
  assert.equal(ctx.storage.sql.exec('SELECT count(*) AS n FROM media_revocations').one().n, 0);
  assert.equal(calls, 2);
});

test('R01: S nova, preparação idempotente, commit repetível e chave morta com retry durável', async () => {
  const ctx = context(), MEDIA = r2(), env = { MEDIA, TEST_HOOKS: '1' };
  const circle = new Circle(ctx, env), actor = { userId: 'user-test', deviceId: 'device-test' };
  const verifier = Buffer.alloc(32, 5).toString('base64');
  const reg = await circle.vaultRegister(actor, { verifier, deadDays: 0 });
  await circle.testLegacyVault(reg.vaultId);
  const oldSnapshot = circle.one('SELECT * FROM vaults WHERE vault_id = ?', reg.vaultId);
  assert.equal(oldSnapshot.share, reg.share, 'limite histórico explícito: snapshot legado já possui S');
  const next = await circle.vaultMigratePrepare(actor, { vaultId: reg.vaultId });
  assert.notEqual(next.share, reg.share); assert.notEqual(next.vaultId, reg.vaultId);
  assert.deepEqual(await circle.vaultMigratePrepare(actor, { vaultId: reg.vaultId }), next);
  assert.equal((await circle.vaultRelease({ vaultId: reg.vaultId, verifier })).share, reg.share, 'queda antes do commit ainda abre cofre anterior');
  const newSnapshot = circle.one('SELECT * FROM vaults WHERE vault_id = ?', next.vaultId);
  assert.equal(newSnapshot.protection, 1); assert.ok(newSnapshot.share.startsWith('e1:'));
  MEDIA.failDelete = true;
  assert.equal((await circle.vaultMigrateCommit(actor, { previous: reg.vaultId, vaultId: next.vaultId })).pending, true);
  assert.ok(ctx.storage.alarm);
  assert.equal(circle.one('SELECT * FROM vaults WHERE vault_id = ?', reg.vaultId), null);
  MEDIA.failDelete = false; await circle.alarm();
  assert.equal((await circle.vaultMigrateCommit(actor, { previous: reg.vaultId, vaultId: next.vaultId })).pending, false);
  assert.equal((await circle.readShare(newSnapshot)).share, next.share);
  circle.dropVaults('vault_id = ?', next.vaultId); await circle.flushDeadKeys();
  assert.equal((await circle.readShare(newSnapshot)).error, 'gone', 'snapshot novo não abre sem chave externa');
  assert.equal((await circle.readShare(oldSnapshot)).share, reg.share, 'não prometemos destruir cópias legadas retroativamente');
});

test('R09: lease, colisão e retry ativo não sobrescrevem outra tentativa; limpeza alcança chaves antigas', async () => {
  const ctx = context(), MEDIA = r2(), box = new MediaBox(ctx, { MEDIA });
  const args = { mediaId: 'media-test', mode: 'media', room: 'room-test', sender: 'sender-test', recipients: ['recipient-test'], expiresAt: Date.now() + 60_000, backend: 'r2', retry: true, size: 100 };
  const a = await box.create(args);
  await MEDIA.put(a.key, new Uint8Array(100));
  assert.equal((await box.create(args)).error, 'upload_busy');
  assert.equal((await box.create({ ...args, sender: 'other-sender' })).error, 'exists');
  assert.equal((await box.create({ ...args, size: 99 })).error, 'exists');
  box.setMeta({ uploadAt: Date.now() - 120_001 });
  const b = await box.create(args);
  assert.notEqual(a.lease, b.lease); assert.notEqual(a.key, b.key);
  assert.equal(box.putChunk(0, new Uint8Array(100), a.lease).error, 'bad_state');
  assert.equal(box.seal({ count: 1, size: 100, lease: a.lease }).error, 'bad_state');
  await MEDIA.put(b.key, new Uint8Array(100));
  assert.equal(box.seal({ count: 0, size: 100, lease: b.lease }).ok, true);
  assert.equal((await box.create(args)).active, true);
  const first = box.purge(), second = box.purge();
  assert.equal(first, second, 'revogações simultâneas compartilham limpeza');
  await Promise.all([first, second]); assert.equal(MEDIA.objects.size, 0);
});
