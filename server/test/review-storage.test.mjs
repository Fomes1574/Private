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

const fakeDevice = () => ({ authPub: Buffer.concat([Buffer.from([4]), crypto.getRandomValues(new Uint8Array(64))]).toString('base64'), curve: Buffer.alloc(32, 1).toString('base64'), ed: Buffer.alloc(32, 2).toString('base64') });
const pairingFixture = () => {
  const ctx = context(), env = { MEDIA: r2() }, circle = new Circle(ctx, env);
  const actor = circle.createIdentity(fakeDevice());
  return { ctx, env, circle, actor };
};

test('E02: pedidos anônimos não ocupam fila nem cofre; autorização é única e vinculada à pessoa', async () => {
  const { circle, actor } = pairingFixture(), device = fakeDevice();
  for (let i = 0; i < 40; i++) assert.equal((await circle.pairStart({ device })).error, 'unauthorized');
  assert.equal(circle.one('SELECT count(*) AS n FROM pairings').n, 0);
  assert.equal(circle.one('SELECT count(*) AS n FROM vaults').n, 0);
  const permit = (await circle.pairPermit(actor)).token;
  const starts = await Promise.all([circle.pairStart({ device, permit }), circle.pairStart({ device, permit })]);
  assert.equal(starts.filter((r) => r.pairingId).length, 1);
  assert.equal(starts.filter((r) => r.error === 'unauthorized').length, 1);
  const start = starts.find((r) => r.pairingId);
  const other = circle.createIdentity(fakeDevice());
  assert.equal((await circle.pairApprove(other, start)).error, 'forbidden');
  assert.equal((await circle.pairApprove(actor, start)).pending, true);
});

test('E02: nova autorização invalida a anterior; reinício, vencimento e substituição preservam os outros', async () => {
  let { ctx, env, circle, actor } = pairingFixture();
  const other = circle.createIdentity(fakeDevice());
  const ownToken = (await circle.pairPermit(actor)).token;
  const own = await circle.pairStart({ device: fakeDevice(), permit: ownToken });
  const otherToken = (await circle.pairPermit(other)).token;
  const otherStart = await circle.pairStart({ device: fakeDevice(), permit: otherToken });
  const invalid = (await circle.pairPermit(actor)).token;
  const replacement = (await circle.pairPermit(actor)).token;
  assert.equal((await circle.pairStart({ device: fakeDevice(), permit: invalid })).error, 'unauthorized');
  circle = new Circle(ctx, env);
  const next = await circle.pairStart({ device: fakeDevice(), permit: replacement });
  assert.ok(next.pairingId);
  assert.equal((await circle.pairStatus(own.pairingId, '')).state, 'expired');
  assert.ok(circle.one('SELECT 1 FROM pairings WHERE pairing_id = ?', otherStart.pairingId));
  assert.equal(circle.one('SELECT count(*) AS n FROM pairings').n, 2);
  const expires = (await circle.pairPermit(actor)).token;
  circle.now = () => Date.now() + 300_001;
  assert.equal((await circle.pairStart({ device: fakeDevice(), permit: expires })).error, 'unauthorized');
});

test('E04: chave pública alheia + pedido inventado não revelam identidade; recibo correto sobrevive a reinício', async () => {
  let { ctx, env, circle, actor } = pairingFixture();
  const device = fakeDevice(), permit = (await circle.pairPermit(actor)).token;
  const start = await circle.pairStart({ device, permit });
  assert.equal((await circle.pairStatus(start.pairingId, fakeDevice().authPub)).state, 'expired');
  const approved = await circle.pairApprove(actor, start);
  assert.deepEqual(await circle.pairStatus('unknown-pairing', device.authPub), { state: 'expired' });
  circle = new Circle(ctx, env);
  assert.deepEqual(await circle.pairStatus(start.pairingId, device.authPub), { state: 'approved', deviceId: approved.deviceId, userId: actor.userId });
  circle.sql.exec("UPDATE devices SET state = 'revoked' WHERE device_id = ?", approved.deviceId);
  assert.deepEqual(await circle.pairStatus(start.pairingId, device.authPub), { state: 'expired' });
});

test('E04: aprovação legada só é retomada com prova da chave privada, nunca apenas com a chave pública', async () => {
  const { circle, actor } = pairingFixture();
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const authPub = Buffer.from(await crypto.subtle.exportKey('raw', kp.publicKey)).toString('base64');
  const deviceId = circle.addDevice(actor.userId, { ...fakeDevice(), authPub }, 'pending');
  const id = 'legacy-pairing';
  assert.deepEqual(await circle.pairStatus(id, authPub), { state: 'expired' });
  const proof = Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, new TextEncoder().encode(`mp-pair-status-v1:${id}`))).toString('base64');
  assert.deepEqual(await circle.pairStatus(id, authPub, proof), { state: 'approved', deviceId, userId: actor.userId });
  assert.deepEqual(await circle.pairStatus('another-pairing', authPub, proof), { state: 'expired' });
});
