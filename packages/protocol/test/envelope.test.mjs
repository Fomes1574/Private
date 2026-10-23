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

test('anúncio de membros: líder precisa estar na lista; no máximo 10', () => {
  const ok = { members: ['user_000001', 'user_000002'], leader: 'user_000001' };
  assert.ok(p.encodeInner({ ...base, kind: 'membership', body: ok }));
  assert.throws(() => p.encodeInner({ ...base, kind: 'membership', body: { ...ok, leader: 'user_000009' } }), /membros/);
  assert.throws(() => p.encodeInner({ ...base, kind: 'membership', body: { members: Array.from({ length: 11 }, (_, i) => `user_00000${i}x`), leader: 'user_000001' } }), /membros/);
});

test('mídia: só formatos que o app gera (V7-016); ver uma vez só foto/vídeo', () => {
  const media = (body) => ({ ...base, kind: 'media', body: { mediaId: 'media_0000001', key: 'k', mode: 'media', ...body } });
  for (const mime of ['image/jpeg', 'image/webp', 'video/mp4', 'audio/webm;codecs=opus', 'audio/mp4', 'audio/aac', 'audio/ogg; codecs="opus"']) {
    assert.ok(p.encodeInner(media({ mime })), mime);
  }
  for (const mime of ['image/svg+xml', 'text/html', 'image/png', 'video/quicktime', 'application/pdf', '', undefined, 'video/mp4\nx']) {
    assert.throws(() => p.encodeInner(media({ mime })), /tipo de mídia/, String(mime));
  }
  assert.throws(() => p.encodeInner(media({ mime: 'audio/mp4', mode: 'once' })), /ver uma vez/);
  assert.ok(p.encodeInner(media({ mime: 'video/mp4', mode: 'once', duration: 300000 })));
  assert.throws(() => p.encodeInner(media({ mime: 'audio/mp4', duration: 4e6 })), /duração/);
  assert.throws(() => p.encodeInner(media({ mime: 'audio/mp4', duration: -1 })), /duração/);
  assert.ok(p.encodeInner(media({ mime: 'text/plain;charset=utf-8', mode: 'doc', name: 'lista de compras.txt' })));
  for (const mime of ['application/pdf', 'text/html', 'image/svg+xml', 'text/plain']) {
    assert.throws(() => p.encodeInner(media({ mime, mode: 'doc' })), /tipo de mídia/, `documento ${mime} fora da lista positiva`);
  }
  for (const name of ['../../etc/passwd', 'a\u0000b', '', 'x'.repeat(101), 42]) {
    assert.throws(() => p.encodeInner(media({ mime: 'text/plain;charset=utf-8', mode: 'doc', name })), /nome/);
  }
  assert.throws(() => p.encodeInner(media({ mime: 'image/jpeg', name: 'foto.jpg' })), /nome/, 'nome só em documento');
});

test('foto de perfil, foto e fundo de grupo: referência cifrada bem formada ou nada', () => {
  const ref = { mediaId: 'media_0000001', key: 'A'.repeat(43) + '=' };
  assert.ok(p.encodeInner({ ...base, kind: 'nickname_change', body: { nickname: 'Ana', photo: ref } }));
  assert.ok(p.encodeInner({ ...base, kind: 'nickname_change', body: { nickname: 'Ana', photo: null } }));
  assert.ok(p.encodeInner({ ...base, kind: 'room_profile', body: { title: 'Família', photo: ref, background: null } }));
  for (const bad of [{ mediaId: 'x', key: ref.key }, { mediaId: ref.mediaId, key: 'curta' }, { ...ref, url: 'https://x' }, 'texto', 1]) {
    assert.throws(() => p.encodeInner({ ...base, kind: 'nickname_change', body: { nickname: 'Ana', photo: bad } }), /foto/);
    assert.throws(() => p.encodeInner({ ...base, kind: 'room_profile', body: { title: 'x', background: bad } }), /fundo/);
  }
});
