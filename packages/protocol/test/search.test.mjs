import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchRank, searchByText } from '../src/search.js';

const people = ['Kara', 'aquele_cara', 'Araújo', 'Clara', 'Bia', 'Ana Ara'].map((label) => ({ label }));

test('D1: "ara" acha por qualquer trecho, sem acento nem maiúscula', () => {
  const r = searchByText(people, 'ara').map((x) => x.label);
  assert.deepEqual(r, ['Araújo', 'Ana Ara', 'aquele_cara', 'Clara', 'Kara']);
});

test('D1: ordem começa > começo de palavra > qualquer posição', () => {
  assert.equal(matchRank('Araújo', 'ARA'), 0);
  assert.equal(matchRank('aquele_cara', 'cara'), 1);
  assert.equal(matchRank('Clara', 'ara'), 2);
  assert.equal(matchRank('Bia', 'ara'), -1);
  assert.equal(matchRank('José', 'jose'), 0, 'sem acento');
  assert.equal(matchRank('qualquer', ''), -1, 'termo vazio não acha nada');
});
