import { test } from 'node:test';
import assert from 'node:assert/strict';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import * as core from '../web/db-core.js';

const sqlite3 = await sqlite3InitModule();
const newDb = () => new sqlite3.oo1.DB(':memory:');
const newKey = () => crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
const H = 3600_000;

test('migra até a versão atual e não faz downgrade', () => {
  const db = newDb();
  assert.equal(core.migrate(db), core.SCHEMA_VERSION);
  assert.equal(core.migrate(db), core.SCHEMA_VERSION, 'idempotente');
  assert.throws(() => core.migrate(db, { target: 1 }), /downgrade/);
});

test('migração que falha no meio deixa a versão anterior íntegra', async () => {
  const db = newDb();
  core.migrate(db, { target: 1 });
  db.exec("INSERT INTO messages(id, room, expires_at, iv, ct) VALUES ('x', 'r', 1, x'00', x'00')");
  assert.throws(() => core.migrate(db, { failAt: 2 }), /falha simulada/);
  assert.equal(core.schemaVersion(db), 1);
  const cols = db.selectValues("SELECT name FROM pragma_table_info('messages')");
  assert.ok(!cols.includes('accepted_at'), 'coluna nova desfeita');
  assert.equal(core.count(db), 1, 'dados preservados');
  assert.equal(core.migrate(db), 2, 'nova tentativa funciona');
});

test('grava cifrado e lê de volta', async () => {
  const db = newDb(); core.migrate(db);
  const key = await newKey();
  const now = Date.now();
  await core.putMessages(db, key, [
    { id: 'm1', room: 'r1', expiresAt: now + H, text: 'olá', acceptedAt: 1 },
    { id: 'm2', room: 'r1', expiresAt: now + H, text: 'tudo bem?', acceptedAt: 2 },
    { id: 'm3', room: 'r2', expiresAt: now + H, text: 'outra conversa', acceptedAt: 3 },
  ]);
  const { messages } = await core.listRoom(db, key, 'r1', { nowMs: now });
  assert.deepEqual(messages.map((m) => m.text), ['tudo bem?', 'olá']);
  const raw = db.selectValues('SELECT ct FROM messages').map((b) => new TextDecoder().decode(b)).join('|');
  assert.ok(!raw.includes('olá') && !raw.includes('tudo bem'), 'texto não aparece em claro no arquivo');
});

test('vencidas são apagadas antes de ler', async () => {
  const db = newDb(); core.migrate(db);
  const key = await newKey();
  const now = Date.now();
  await core.putMessages(db, key, [
    { id: 'velha', room: 'r', expiresAt: now - 1, text: 'vencida' },
    { id: 'nova', room: 'r', expiresAt: now + H, text: 'válida' },
  ]);
  const { purged, messages } = await core.listRoom(db, key, 'r', { nowMs: now });
  assert.equal(purged, 1);
  assert.deepEqual(messages.map((m) => m.text), ['válida']);
  assert.equal(core.count(db), 1, 'linha vencida saiu do arquivo');
});

test('mudar o prazo no arquivo invalida a mensagem', async () => {
  const db = newDb(); core.migrate(db);
  const key = await newKey();
  const now = Date.now();
  await core.putMessages(db, key, [{ id: 'm', room: 'r', expiresAt: now + H, text: 'prazo curto' }]);
  db.exec({ sql: 'UPDATE messages SET expires_at = ?', bind: [now + 1000 * H] });
  const { messages } = await core.listRoom(db, key, 'r', { nowMs: now });
  assert.equal(messages[0].text, null);
  assert.equal(messages[0].error, 'integridade');
});

test('outra chave não lê (crypto-shredding)', async () => {
  const db = newDb(); core.migrate(db);
  const now = Date.now();
  await core.putMessages(db, await newKey(), [{ id: 'm', room: 'r', expiresAt: now + H, text: 'segredo' }]);
  const { messages } = await core.listRoom(db, await newKey(), 'r', { nowMs: now });
  assert.equal(messages[0].text, null);
});

test('10 mil mensagens: gravar e ler as 50 mais novas', async () => {
  const db = newDb(); core.migrate(db);
  const key = await newKey();
  const now = Date.now();
  const msgs = Array.from({ length: 10_000 }, (_, i) => ({ id: `m${i}`, room: `r${i % 10}`, expiresAt: now + H, text: `mensagem ${i} `.repeat(5), acceptedAt: i }));
  const t0 = performance.now();
  await core.putMessages(db, key, msgs);
  const t1 = performance.now();
  const { messages } = await core.listRoom(db, key, 'r3', { nowMs: now });
  const t2 = performance.now();
  assert.equal(messages.length, 50);
  assert.match(messages[0].text, /^mensagem 9993 /);
  console.log(`10k gravações: ${(t1 - t0).toFixed(0)} ms; ler 50: ${(t2 - t1).toFixed(1)} ms`);
});
