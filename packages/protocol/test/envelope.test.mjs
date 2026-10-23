import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as p from '../src/index.js';

const base = { v: 1, msgId: 'msg_00000001', room: 'room_0000001', sender: 'user_000001', policyRev: 1 };

test('preenchimento esconde o tamanho real dentro do degrau', () => {
  const a = p.encodeInner({ ...base, kind: 'text', body: { text: 'oi' } });
  const b = p.encodeInner({ ...base, kind: 'text', body: { text: 'x'.repeat(100) } });
  assert.equal(a.byteLength, 256);
  assert.equal(b.byteLength, 256);
  assert.equal(p.encodeInner({ ...base, kind: 'text', body: { text: 'x'.repeat(2000) } }).byteLength, 4096);
});

test('ida e volta', () => {
  const m = { ...base, kind: 'reaction', body: { target: 'msg_00000002', emoji: '👍' } };
  assert.deepEqual(p.decodeInner(p.encodeInner(m)), m);
});

test('preenchimento adulterado ou tamanho fora da escada é recusado', () => {
  const e = p.encodeInner({ ...base, kind: 'text', body: { text: 'oi' } });
  const t = e.slice(); t[255] = 1;
  assert.throws(() => p.decodeInner(t), /adulterado/);
  assert.throws(() => p.decodeInner(e.subarray(0, 200)), /escada/);
  const big = e.slice(); new DataView(big.buffer).setUint32(0, 9999);
  assert.throws(() => p.decodeInner(big), /comprimento/);
});

test('versão, tipo e campos são validados', () => {
  assert.throws(() => p.encodeInner({ ...base, v: 2, kind: 'text', body: { text: 'a' } }), /versão/);
  assert.throws(() => p.encodeInner({ ...base, kind: 'html', body: {} }), /tipo/);
  assert.throws(() => p.encodeInner({ ...base, kind: 'text', body: { text: '' } }), /vazio/);
  assert.throws(() => p.encodeInner({ ...base, sender: 'x', kind: 'text', body: { text: 'a' } }), /sender/);
  assert.throws(() => p.encodeInner({ ...base, kind: 'edit', body: { target: 'msg_00000002', text: 'a', version: 0 } }), /edição/);
});

test('conteúdo acima do maior degrau é recusado', () => {
  assert.throws(() => p.encodeInner({ ...base, kind: 'text', body: { text: 'x'.repeat(70000) } }), /grande/);
});

test('apelido, nome de grupo e mídia têm formato conferido', () => {
  assert.throws(() => p.encodeInner({ ...base, kind: 'nickname_change', body: { nickname: 'x' } }), /apelido/);
  assert.ok(p.encodeInner({ ...base, kind: 'nickname_change', body: { nickname: 'Lua' } }));
  assert.throws(() => p.encodeInner({ ...base, kind: 'room_profile', body: { title: 'x'.repeat(61) } }), /grupo/);
  assert.throws(() => p.encodeInner({ ...base, kind: 'media', body: { mediaId: 'curto', key: 'k', mode: 'once' } }), /mídia/);
  assert.throws(() => p.encodeInner({ ...base, kind: 'media', body: { mediaId: 'abcdefghij', key: 'k', mode: 'html' } }), /mídia/);
});
