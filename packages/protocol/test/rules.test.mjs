import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as p from '../src/index.js';

const D = 86_400_000;

test('apelido: sem acento, minúsculas, único, busca por prefixo local', () => {
  assert.equal(p.normalize('  Lúa   Cheia '), 'lua cheia');
  const dir = [{ userId: 'u1', nickname: 'Lua' }, { userId: 'u2', nickname: 'Luana' }, { userId: 'u3', nickname: 'Éclipse' }];
  assert.equal(p.isAvailable(dir, 'LÚA'), false);
  assert.equal(p.isAvailable(dir, 'lua', 'u1'), true, 'o próprio pode manter');
  assert.deepEqual(p.searchByPrefix(dir, 'lu').map((d) => d.userId), ['u1', 'u2']);
  assert.deepEqual(p.searchByPrefix(dir, 'ecl').map((d) => d.userId), ['u3']);
  assert.deepEqual(p.searchByPrefix(dir, 'lu', { self: 'u1' }).map((d) => d.userId), ['u2']);
  assert.ok(p.validNickname('a'));
  assert.ok(p.validNickname('<script>'));
  assert.equal(p.validNickname('Fantasma'), null);
  assert.equal(p.renameNotice('Fantasma', 'Eclipse'), 'Fantasma alterou seu nome para Eclipse');
});

test('documentos: quarto concluído revoga o mais antigo, em qualquer conversa', () => {
  const now = 1_000 * D;
  let docs = [];
  for (const [i, room] of [[1, 'a'], [2, 'b'], [3, 'c']]) docs = p.publish(docs, { docId: `d${i}`, owner: 'ana', room, size: 1000, expiresAt: now + 5 * D, publishedAt: now + i }, now).docs;
  docs = p.publish(docs, { docId: 'x1', owner: 'bia', size: 1000, expiresAt: now + 5 * D, publishedAt: now }, now).docs;
  const r = p.publish(docs, { docId: 'd4', owner: 'ana', room: 'z', size: 1000, expiresAt: now + 5 * D, publishedAt: now + 4 }, now);
  assert.deepEqual(r.evicted, ['d1']);
  assert.deepEqual(p.activeOf(r.docs, 'ana', now).map((d) => d.docId), ['d2', 'd3', 'd4']);
  assert.equal(p.activeOf(r.docs, 'bia', now).length, 1, 'outra pessoa não é afetada');
  assert.deepEqual(p.publish(r.docs, { docId: 'd4', owner: 'ana', size: 1, expiresAt: now + D }, now).evicted, [], 'repetir é idempotente');
});

test('documentos: vencido libera vaga; 20 MB; apagar para todos só o autor', () => {
  const now = 1_000 * D;
  let docs = [];
  docs = p.publish(docs, { docId: 'old', owner: 'ana', size: 1, expiresAt: now + 1, publishedAt: now - 10 }, now - 10).docs;
  docs = p.publish(docs, { docId: 'a', owner: 'ana', size: 1, expiresAt: now + D, publishedAt: now - 9 }, now - 9).docs;
  docs = p.publish(docs, { docId: 'b', owner: 'ana', size: 1, expiresAt: now + D, publishedAt: now - 8 }, now - 8).docs;
  const later = now + 2;
  const r = p.publish(docs, { docId: 'c', owner: 'ana', size: 1, expiresAt: later + D }, later);
  assert.deepEqual(r.evicted, [], 'o vencido abriu a vaga');
  assert.throws(() => p.publish([], { docId: 'g', owner: 'ana', size: 20 * 1024 * 1024 + 1, expiresAt: now + D }, now), /20 MB/);
  assert.throws(() => p.deleteForAll(r.docs, 'a', 'bia'), /autor/);
  assert.equal(p.deleteForAll(r.docs, 'a', 'ana').find((d) => d.docId === 'a').state, 'deleted_for_all');
});

test('reconciliação: sem tempo confiável nada aparece', () => {
  const r = p.reconcile({ messages: [{ msgId: 'a', expiresAt: 9e15 }], tombstones: new Set(), hiddenForMe: new Set(), trustedNow: null });
  assert.deepEqual(r, { render: [], destroy: [], blocked: true });
});

test('reconciliação: vencidas e apagadas-para-todos são destruídas antes de exibir', () => {
  const now = 1000;
  const msgs = [{ msgId: 'ok', expiresAt: 2000 }, { msgId: 'venceu', expiresAt: 1000 }, { msgId: 'apagada', expiresAt: 5000 }, { msgId: 'sóparamim', expiresAt: 5000 }];
  const r = p.reconcile({ messages: msgs, tombstones: new Set(['apagada']), hiddenForMe: new Set(['sóparamim']), trustedNow: now });
  assert.deepEqual(r.render.map((m) => m.msgId), ['ok']);
  assert.deepEqual(r.destroy.sort(), ['apagada', 'venceu']);
  assert.ok(!r.destroy.includes('sóparamim'), 'apagar para mim não destrói o que os outros ainda têm direito');
});

test('edição: só o autor, versão crescente, prazo original, marca "editado"', () => {
  const orig = { msgId: 'msg_00000001', sender: 'ana', text: 'oi', expiresAt: 5000 };
  const e1 = { sender: 'ana', body: { target: 'msg_00000001', text: 'olá', version: 1 } };
  const ed = p.applyEdit(orig, e1);
  assert.deepEqual([ed.text, ed.edited, ed.expiresAt], ['olá', true, 5000]);
  assert.equal(p.applyEdit(ed, { ...e1, body: { ...e1.body, text: 'velha', version: 1 } }).text, 'olá', 'repetida não volta');
  assert.throws(() => p.applyEdit(orig, { ...e1, sender: 'bia' }), /autor/);
  assert.equal(p.canDeleteForAll(orig, 'ana'), true);
  assert.equal(p.canDeleteForAll(orig, 'bia'), false, 'nem a líder apaga conteúdo alheio');
});

test('notificação: exatamente "novas mensagens", payload sempre igual', () => {
  assert.equal(p.NOTIFICATION_TEXT, 'novas mensagens');
  assert.equal(p.pushPayload(), p.pushPayload());
  assert.doesNotMatch(p.pushPayload(), /ana|grupo|\d+ mensagens/);
});
