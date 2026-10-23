import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as p from '../src/index.js';

const H = 3600, D = 86400;

test('1:1: quem inicia é líder; não aceita terceira pessoa', () => {
  const s = p.createRoom({ roomId: 'r', kind: 'direct', creator: 'ana', members: ['bia'] });
  assert.equal(s.leader, 'ana');
  assert.throws(() => p.createRoom({ roomId: 'r', kind: 'direct', creator: 'ana', members: ['bia', 'caio'] }), /duas pessoas/);
  assert.throws(() => p.apply(s, { type: 'add_member', actor: 'ana', member: 'caio' }), /1:1/);
});

test('política: só a líder, revisão em ordem, prazos separados, só futuro', () => {
  let s = p.createRoom({ roomId: 'r', kind: 'group', creator: 'ana', members: ['bia', 'caio'] });
  assert.throws(() => p.apply(s, { type: 'set_policy', actor: 'bia', rev: 2, textTtl: D }), /líder/);
  assert.throws(() => p.apply(s, { type: 'set_policy', actor: 'ana', rev: 3, textTtl: D }), /ordem/);
  assert.throws(() => p.apply(s, { type: 'set_policy', actor: 'ana', rev: 2, textTtl: 20 * D }), /12 h/);
  s = p.apply(s, { type: 'set_policy', actor: 'ana', rev: 2, textTtl: 12 * H, mediaTtl: 15 * D });
  assert.equal(p.ttlFor(s, 'text'), 12 * H);
  assert.equal(p.ttlFor(s, 'media'), 15 * D);
  assert.throws(() => p.apply(s, { type: 'set_policy', actor: 'ana', rev: 2, textTtl: D }), /ordem/, 'repetir revisão é recusado');
});

test('ceder liderança é irreversível', () => {
  let s = p.createRoom({ roomId: 'r', kind: 'direct', creator: 'ana', members: ['bia'] });
  s = p.apply(s, { type: 'transfer_leader', actor: 'ana', to: 'bia' });
  assert.equal(s.leader, 'bia');
  assert.throws(() => p.apply(s, { type: 'transfer_leader', actor: 'ana', to: 'ana' }), /líder/);
});

test('sucessão: membro ativo mais antigo; reingresso perde prioridade', () => {
  let s = p.createRoom({ roomId: 'r', kind: 'group', creator: 'ana', members: ['bia', 'caio', 'davi'] });
  s = p.apply(s, { type: 'leave', actor: 'bia' });
  s = p.apply(s, { type: 'add_member', actor: 'ana', member: 'bia' }); // volta com ordem nova
  s = p.apply(s, { type: 'leave', actor: 'ana' });
  assert.equal(s.leader, 'caio', 'caio entrou antes do reingresso da bia');
  s = p.apply(s, { type: 'remove_member', actor: 'caio', member: 'davi' });
  s = p.apply(s, { type: 'leave', actor: 'caio' });
  assert.equal(s.leader, 'bia');
  s = p.apply(s, { type: 'leave', actor: 'bia' });
  assert.equal(s.closed, true, 'ninguém sobrou');
});

test('quem não é membro não age; conversa encerrada não muda', () => {
  let s = p.createRoom({ roomId: 'r', kind: 'group', creator: 'ana', members: ['bia'] });
  assert.throws(() => p.apply(s, { type: 'leave', actor: 'zed' }), /membro/);
  s = p.apply(s, { type: 'close', actor: 'ana' });
  assert.throws(() => p.apply(s, { type: 'set_policy', actor: 'ana', rev: 2, textTtl: D }), /encerrada/);
  assert.throws(() => p.ttlFor(s, 'text'), /encerrada/);
});

test('desfazer vínculo no 1:1 encerra a conversa (V7-008)', () => {
  let s = p.createRoom({ roomId: 'r', kind: 'direct', creator: 'ana', members: ['bia'] });
  s = p.apply(s, { type: 'unlink', actor: 'bia' });
  assert.equal(s.closed, true);
  assert.throws(() => p.apply(s, { type: 'unlink', actor: 'ana' }), /encerrada/);
});

test('grupo: no máximo 10 pessoas', () => {
  const ten = Array.from({ length: 9 }, (_, i) => `m${i}`);
  let s = p.createRoom({ roomId: 'r', kind: 'group', creator: 'ana', members: ten });
  assert.throws(() => p.apply(s, { type: 'add_member', actor: 'ana', member: 'extra' }), /cheio/);
  assert.throws(() => p.createRoom({ roomId: 'r', kind: 'group', creator: 'ana', members: [...ten, 'x'] }), /10/);
});

test('estado anterior não é alterado (eventos puros)', () => {
  const s = p.createRoom({ roomId: 'r', kind: 'group', creator: 'ana', members: ['bia'] });
  p.apply(s, { type: 'leave', actor: 'bia' });
  assert.equal(p.isMember(s, 'bia'), true);
});

test('conversa do círculo: prazo máximo, ninguém mexe, servidor põe e tira gente', () => {
  let s = p.createRoom({ roomId: p.CIRCLE_ROOM_ID, kind: 'circle', creator: 'ana', members: [] });
  assert.equal(s.textTtl, 15 * 86400);
  s = p.systemJoin(s, 'bia');
  s = p.systemJoin(s, 'bia');
  assert.equal([...s.members.values()].filter((m) => m.active).length, 2);
  assert.throws(() => p.apply(s, { type: 'set_policy', actor: 'ana', rev: 2, textTtl: 86400 }), /servidor/);
  assert.throws(() => p.apply(s, { type: 'leave', actor: 'bia' }), /servidor/);
  s = p.systemLeave(s, 'ana');
  assert.equal(s.leader, 'bia');
  assert.throws(() => p.systemJoin(p.createRoom({ roomId: 'r', kind: 'group', creator: 'a', members: ['b'] }), 'c'), /círculo/);
});
