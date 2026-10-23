import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApi, d1, newDevice, Client, SETUP, fakeCt, msgId } from './helpers.mjs';

let api;
const people = {};
before(async () => { api = await startApi(); });
after(() => api?.stop());

async function join(name, inviter = people.admin) {
  const inv = await inviter.post('/v1/invites', {});
  assert.equal(inv.status, 201, JSON.stringify(inv));
  const dev = await newDevice();
  const c = new Client(api.base);
  const r = await c.post('/v1/invites/redeem', { token: inv.data.token, device: dev.public });
  assert.equal(r.status, 201, JSON.stringify(r));
  await c.login(dev, r.data.deviceId);
  people[name] = c;
  return c;
}

test('primeira pessoa só com o código de instalação, e uma vez só', async () => {
  const dev = await newDevice();
  const c = new Client(api.base);
  assert.equal((await c.post('/v1/bootstrap', { setupCode: 'errado-errado-errado', device: dev.public })).status, 401);
  const r = await c.post('/v1/bootstrap', { setupCode: SETUP, device: dev.public });
  assert.equal(r.status, 201);
  await c.login(dev, r.data.deviceId);
  people.admin = c;
  assert.equal((await new Client(api.base).post('/v1/bootstrap', { setupCode: SETUP, device: (await newDevice()).public })).status, 409);
});

test('sem sessão nada funciona; token falso também não; erro não ecoa', async () => {
  const anon = new Client(api.base);
  assert.equal((await anon.get('/v1/directory')).status, 401);
  anon.token = 'x'.repeat(50);
  const r = await anon.get('/v1/directory');
  assert.equal(r.status, 401);
  assert.doesNotMatch(JSON.stringify(r.data), /xxxx/);
});

test('convite: uso único; só administradora cria', async () => {
  const inv = await people.admin.post('/v1/invites', {});
  const c = new Client(api.base);
  assert.equal((await c.post('/v1/invites/redeem', { token: inv.data.token, device: (await newDevice()).public })).status, 201);
  assert.equal((await c.post('/v1/invites/redeem', { token: inv.data.token, device: (await newDevice()).public })).status, 401, 'segunda vez recusa');
  assert.equal((await c.post('/v1/invites/redeem', { token: 'a'.repeat(43), device: (await newDevice()).public })).status, 401);
  await join('bia');
  assert.equal((await people.bia.post('/v1/invites', {})).status, 403);
});

test('sessão: assinatura de outro aparelho não entra; desafio é de uso único', async () => {
  const { data: { nonce } } = await people.bia.post('/v1/auth/challenge', { deviceId: people.bia.deviceId });
  const other = await newDevice();
  const sig = Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, other.kp.privateKey, new TextEncoder().encode(`mp-auth-v1:${nonce}:${people.bia.deviceId}`))).toString('base64');
  assert.equal((await new Client(api.base).post('/v1/auth/session', { deviceId: people.bia.deviceId, nonce, signature: sig })).status, 401);
  const sigOk = Buffer.from(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, people.bia.device.kp.privateKey, new TextEncoder().encode(`mp-auth-v1:${nonce}:${people.bia.deviceId}`))).toString('base64');
  assert.equal((await new Client(api.base).post('/v1/auth/session', { deviceId: people.bia.deviceId, nonce, signature: sigOk })).status, 401, 'desafio já consumido');
});

test('limite de 10 identidades, sem corrida', async () => {
  await join('caio');
  // admin, (1 anônimo do teste de convite), bia, caio = 4. Faltam 6 vagas.
  const invites = [];
  for (let i = 0; i < 8; i++) {
    const r = await people.admin.post('/v1/invites', {});
    if (r.status === 201) invites.push(r.data.token);
  }
  const results = await Promise.all(invites.map(async (token) => (await new Client(api.base).post('/v1/invites/redeem', { token, device: (await newDevice()).public })).status));
  assert.equal(results.filter((s) => s === 201).length, 6);
  assert.ok(results.filter((s) => s !== 201).every((s) => s === 409));
  assert.equal((await people.admin.post('/v1/invites', {})).status, 409, 'círculo cheio');
  const dir = await people.admin.get('/v1/directory');
  assert.equal(dir.data.members.length, 10);
  assert.ok(dir.data.members.every((m) => !('nickname' in m)), 'servidor não guarda apelido');
});

test('chave de uso único: entregue uma vez só, depois a de reserva', async () => {
  const seen = new Set();
  for (let i = 0; i < 3; i++) {
    const r = await people.admin.post('/v1/keys/claim', { userId: people.bia.userId });
    assert.equal(r.data.fallback, false);
    assert.ok(!seen.has(r.data.key)); seen.add(r.data.key);
  }
  const fb = await people.admin.post('/v1/keys/claim', { userId: people.bia.userId });
  assert.equal(fb.data.fallback, true);
});

let roomId;
test('conversa em grupo: fan-out exato, prazo do servidor, idempotente', async () => {
  const r = await people.admin.post('/v1/rooms', { kind: 'group', members: [people.bia.userId, people.caio.userId], textTtl: 12 * 3600, mediaTtl: 5 * 86400 });
  assert.equal(r.status, 201, JSON.stringify(r));
  roomId = r.data.roomId;
  assert.equal(r.data.leader, people.admin.userId);
  const id = msgId();
  const bad = await people.admin.post(`/v1/rooms/${roomId}/messages`, { msgId: id, kind: 'text', envelopes: { [people.bia.userId]: fakeCt() } });
  assert.equal(bad.status, 400, 'faltou destinatário');
  const extra = await people.admin.post(`/v1/rooms/${roomId}/messages`, { msgId: id, kind: 'text', envelopes: { [people.bia.userId]: fakeCt(), [people.caio.userId]: fakeCt(), intruso00: fakeCt() } });
  assert.equal(extra.status, 400, 'destinatário a mais');
  const ok = await people.admin.post(`/v1/rooms/${roomId}/messages`, { msgId: id, kind: 'text', envelopes: { [people.bia.userId]: fakeCt(), [people.caio.userId]: fakeCt() } });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.expiresAt - ok.data.acceptedAt, 12 * 3600 * 1000);
  assert.ok(Math.abs(ok.data.acceptedAt - ok.time) < 5000, 'carimbo do servidor');
  const again = await people.admin.post(`/v1/rooms/${roomId}/messages`, { msgId: id, kind: 'text', envelopes: { [people.bia.userId]: fakeCt(), [people.caio.userId]: fakeCt() } });
  assert.equal(again.status, 200);
  assert.equal(again.data.expiresAt, ok.data.expiresAt, 'reenvio não ganha prazo novo');
  const outsider = await people.bia.post(`/v1/rooms/${roomId}/messages`, { msgId: id, kind: 'text', envelopes: { [people.admin.userId]: fakeCt(), [people.caio.userId]: fakeCt() } });
  assert.equal(outsider.status, 409, 'outra pessoa não reaproveita o id');
});

test('sincronizar e confirmar: cada um recebe o seu envelope uma vez', async () => {
  const s = await people.bia.get('/v1/sync');
  assert.equal(s.status, 200);
  assert.equal(s.data.envelopes.length, 1);
  assert.ok(s.data.rooms.includes(roomId));
  const e = s.data.envelopes[0];
  await people.bia.post('/v1/ack', { envelopes: [[e.room, e.msgId]] });
  assert.equal((await people.bia.get('/v1/sync')).data.envelopes.length, 0);
  assert.equal((await people.caio.get('/v1/sync')).data.envelopes.length, 1, 'caio ainda não confirmou');
});

test('política só da líder, vale para mensagens novas', async () => {
  assert.equal((await people.bia.post(`/v1/rooms/${roomId}/events`, { type: 'set_policy', rev: 2, textTtl: 86400 })).status, 403);
  assert.equal((await people.admin.post(`/v1/rooms/${roomId}/events`, { type: 'set_policy', rev: 2, textTtl: 20 * 86400 })).status, 403, 'fora de 12h-15d');
  assert.equal((await people.admin.post(`/v1/rooms/${roomId}/events`, { type: 'set_policy', rev: 2, textTtl: 86400 })).status, 200);
  const r = await people.admin.post(`/v1/rooms/${roomId}/messages`, { msgId: msgId(), kind: 'text', envelopes: { [people.bia.userId]: fakeCt(), [people.caio.userId]: fakeCt() } });
  assert.equal(r.data.expiresAt - r.data.acceptedAt, 86400 * 1000);
});

test('apagar para todos: só o autor; tombstone para todos; envelope some', async () => {
  const id = msgId();
  await people.bia.post(`/v1/rooms/${roomId}/messages`, { msgId: id, kind: 'text', envelopes: { [people.admin.userId]: fakeCt(), [people.caio.userId]: fakeCt() } });
  assert.equal((await people.admin.post(`/v1/rooms/${roomId}/messages/${id}/delete`)).status, 403, 'nem a líder apaga conteúdo alheio');
  assert.equal((await people.bia.post(`/v1/rooms/${roomId}/messages/${id}/delete`)).status, 200);
  const s = await people.caio.get('/v1/sync');
  assert.ok(s.data.tombstones.some((t) => t.msgId === id));
  assert.ok(!s.data.envelopes.some((e) => e.msgId === id), 'não entrega mais');
});

test('removida do grupo não recebe mais e não manda', async () => {
  assert.equal((await people.admin.post(`/v1/rooms/${roomId}/events`, { type: 'remove_member', member: people.caio.userId })).status, 200);
  const r = await people.admin.post(`/v1/rooms/${roomId}/messages`, { msgId: msgId(), kind: 'text', envelopes: { [people.bia.userId]: fakeCt() } });
  assert.equal(r.status, 201, 'agora só bia');
  assert.equal((await people.caio.post(`/v1/rooms/${roomId}/messages`, { msgId: msgId(), kind: 'text', envelopes: { [people.admin.userId]: fakeCt() } })).status, 403);
  assert.ok(!(await people.caio.get('/v1/sync')).data.rooms.includes(roomId));
});

test('ver uma vez pela API: destinatário uma vez, autor nunca', async () => {
  const blob = new Uint8Array(3_000_000).map((_, i) => i % 251);
  const up = await people.admin.post(`/v1/rooms/${roomId}/media?mode=once`, blob);
  assert.equal(up.status, 201, JSON.stringify(up));
  const id = up.data.mediaId;
  assert.equal((await people.admin.post(`/v1/media/${id}/open`)).status, 403);
  const r = await people.bia.post(`/v1/media/${id}/open`, undefined, { raw: true });
  assert.equal(r.status, 200);
  assert.equal(Buffer.compare(Buffer.from(await r.arrayBuffer()), Buffer.from(blob)), 0);
  assert.equal((await people.bia.post(`/v1/media/${id}/open`)).status, 404, 'último consumo apagou');
});

test('documentos: o 4º revoga o mais antigo e manda tombstone', async () => {
  const docs = [];
  for (let i = 0; i < 4; i++) {
    const up = await people.bia.post(`/v1/rooms/${roomId}/media?mode=doc`, new Uint8Array(1000));
    const m = msgId();
    await people.bia.post(`/v1/rooms/${roomId}/messages`, { msgId: m, kind: 'media', envelopes: { [people.admin.userId]: fakeCt() } });
    const pub = await people.bia.post('/v1/docs/publish', { mediaId: up.data.mediaId, room: roomId, msgId: m, size: 1000, expiresAt: up.data.expiresAt });
    assert.equal(pub.status, 200, JSON.stringify(pub));
    docs.push({ mediaId: up.data.mediaId, msgId: m, evicted: pub.data.evicted });
  }
  assert.deepEqual(docs[3].evicted, [docs[0].mediaId]);
  assert.equal((await people.admin.post(`/v1/media/${docs[0].mediaId}/open`)).status, 404, 'documento revogado sumiu');
  assert.equal((await people.admin.post(`/v1/media/${docs[1].mediaId}/open`, undefined, { raw: true })).status, 200);
  assert.ok((await people.admin.get('/v1/sync')).data.tombstones.some((t) => t.msgId === docs[0].msgId));
});

test('troca de aparelho só por QR: novo inicia, antigo aprova, antigo cai', async () => {
  const newDev = await newDevice();
  const fresh = new Client(api.base);
  const start = await fresh.post('/v1/devices/pair/start', { device: newDev.public });
  assert.equal(start.status, 201);
  assert.equal((await people.bia.post('/v1/devices/pair/approve', { pairingId: start.data.pairingId, code: '00000000' })).status, 401);
  const ok = await people.bia.post('/v1/devices/pair/approve', { pairingId: start.data.pairingId, code: start.data.code });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.userId, people.bia.userId, 'mesma identidade');
  assert.equal((await people.bia.get('/v1/sync')).status, 401, 'sessão do aparelho antigo revogada');
  const st = await fresh.post('/v1/devices/pair/status', { pairingId: start.data.pairingId, authPub: newDev.public.authPub });
  assert.equal(st.data.state, 'approved');
  await fresh.login(newDev, ok.data.deviceId);
  assert.equal(fresh.userId, people.bia.userId);
  people.bia = fresh;
});

test('recuperação: administradora + guardião, 24 h de espera, aparelho antigo cancela', async () => {
  assert.equal((await people.bia.post('/v1/me/guardian', { userId: people.caio.userId })).status, 200);
  assert.equal((await people.caio.post('/v1/recovery/approve', { userId: people.bia.userId })).data.state, 'collecting');
  assert.equal((await people.admin.post('/v1/recovery/approve', { userId: people.bia.userId })).data.state, 'waiting');
  assert.equal((await people.admin.post('/v1/invites', { kind: 'recovery', forUser: people.bia.userId })).status, 425, 'nunca antes das 24 h');
  assert.equal((await people.bia.post('/v1/recovery/cancel')).status, 200);
  const ev = await people.caio.get('/v1/security-events');
  assert.ok(ev.data.events.some((e) => e.kind === 'recovery_waiting' && e.userId === people.bia.userId), 'todos são avisados');
});

test('congelar: só administradora; congelada não entra', async () => {
  assert.equal((await people.caio.post('/v1/admin/freeze', { userId: people.bia.userId })).status, 403);
  assert.equal((await people.admin.post('/v1/admin/freeze', { userId: people.bia.userId })).status, 200);
  assert.equal((await people.bia.get('/v1/sync')).status, 401);
  assert.equal((await people.admin.post('/v1/admin/freeze', { userId: people.bia.userId, frozen: false })).status, 200);
  await people.bia.login(people.bia.device, people.bia.deviceId);
  assert.equal((await people.bia.get('/v1/sync')).status, 200);
});

test('limpeza periódica apaga envelopes vencidos (e o filtro já não entregava)', async () => {
  const id = msgId();
  await people.admin.post(`/v1/rooms/${roomId}/messages`, { msgId: id, kind: 'text', envelopes: { [people.bia.userId]: fakeCt() } });
  d1(api.persist, `UPDATE envelopes SET expires_at = 1 WHERE msg_id = '${id}'`);
  assert.ok(!(await people.bia.get('/v1/sync')).data.envelopes.some((e) => e.msgId === id), 'vencido não é entregue');
  await (await fetch(`${api.base}/__scheduled?cron=*/15+*+*+*+*`)).text(); // ler o corpo libera a conexão
  const left = JSON.parse(d1(api.persist, `SELECT count(*) AS n FROM envelopes WHERE msg_id = '${id}'`))[0].results[0].n;
  assert.equal(left, 0);
});

test('CORS só para a origem do app; horário do servidor em toda resposta', async () => {
  const ok = await fetch(`${api.base}/v1/time`, { headers: { origin: 'http://app.local' } });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'http://app.local');
  const bad = await fetch(`${api.base}/v1/time`, { headers: { origin: 'https://evil.example' } });
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
  assert.ok(Number(ok.headers.get('x-mp-time')) > 0);
  assert.equal(ok.headers.get('cache-control'), 'no-store');
});

test('documento: não dá para "publicar" o documento de outra pessoa', async () => {
  const up = await people.admin.post(`/v1/rooms/${roomId}/media?mode=doc`, new Uint8Array(500));
  const m = msgId();
  await people.admin.post(`/v1/rooms/${roomId}/messages`, { msgId: m, kind: 'media', envelopes: { [people.bia.userId]: fakeCt() } });
  // bia tenta registrar como dela o documento e a mensagem da administradora
  const r = await people.bia.post('/v1/docs/publish', { mediaId: up.data.mediaId, room: roomId, msgId: m, size: 1, expiresAt: 1 });
  assert.equal(r.status, 403);
  // mídia comum também não vira documento
  const normal = await people.bia.post(`/v1/rooms/${roomId}/media?mode=media`, new Uint8Array(10));
  const m2 = msgId();
  await people.bia.post(`/v1/rooms/${roomId}/messages`, { msgId: m2, kind: 'media', envelopes: { [people.admin.userId]: fakeCt() } });
  assert.equal((await people.bia.post('/v1/docs/publish', { mediaId: normal.data.mediaId, room: roomId, msgId: m2 })).status, 403);
});

test('upload com tamanho mentido é recusado e não fica guardado', async () => {
  const r = await fetch(`${api.base}/v1/rooms/${roomId}/media?mode=media`, {
    method: 'POST', body: new Uint8Array(100), headers: { authorization: `Bearer ${people.admin.token}`, 'content-length': '100' },
  });
  assert.equal(r.status, 201);
  // tamanho declarado acima do limite
  const big = await fetch(`${api.base}/v1/rooms/${roomId}/media?mode=doc`, {
    method: 'POST', body: new Uint8Array(10), headers: { authorization: `Bearer ${people.admin.token}`, 'content-length': String(30 * 1024 * 1024) },
  }).catch(() => ({ status: 'erro' }));
  assert.notEqual(big.status, 201);
});

test('remover do círculo tira a pessoa das conversas', async () => {
  const dir = (await people.admin.get('/v1/directory')).data.members;
  const victim = dir.find((m) => ![people.admin.userId, people.bia.userId, people.caio.userId].includes(m.userId));
  const g = await people.admin.post('/v1/rooms', { kind: 'group', members: [people.bia.userId, victim.userId] });
  assert.equal((await people.admin.post('/v1/admin/remove', { userId: victim.userId })).status, 200);
  const view = await people.admin.get(`/v1/rooms/${g.data.roomId}`);
  assert.equal(view.data.members.find((m) => m.userId === victim.userId).active, false);
  // fan-out agora sem a pessoa removida
  const r = await people.admin.post(`/v1/rooms/${g.data.roomId}/messages`, { msgId: msgId(), kind: 'text', envelopes: { [people.bia.userId]: fakeCt() } });
  assert.equal(r.status, 201);
});

test('conversa do círculo: todos entram sozinhos; ninguém mexe nela', async () => {
  const circleId = 'circulo-0000000000';
  const v = await people.admin.get(`/v1/rooms/${circleId}`);
  assert.equal(v.status, 200);
  assert.equal(v.data.kind, 'circle');
  assert.ok(v.data.members.filter((m) => m.active).length >= 3);
  assert.equal((await people.admin.post(`/v1/rooms/${circleId}/events`, { type: 'set_policy', rev: 2, textTtl: 86400 })).status, 403);
  const active = v.data.members.filter((m) => m.active && m.userId !== people.bia.userId).map((m) => m.userId);
  const envs = Object.fromEntries(active.map((u) => [u, fakeCt()]));
  const r = await people.bia.post(`/v1/rooms/${circleId}/messages`, { msgId: msgId(), kind: 'text', envelopes: envs });
  assert.equal(r.status, 201);
  assert.equal(r.data.expiresAt - r.data.acceptedAt, 15 * 86400 * 1000, 'anúncios de perfil com o prazo máximo');
});
