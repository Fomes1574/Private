import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, webcrypto } from 'node:crypto';
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
  assert.deepEqual((await people.bia.get('/v1/docs/mine')).data, { active: 0, max: 3 });
  for (let i = 0; i < 4; i++) {
    const up = await people.bia.post(`/v1/rooms/${roomId}/media?mode=doc`, new Uint8Array(1000));
    const m = msgId();
    await people.bia.post(`/v1/rooms/${roomId}/messages`, { msgId: m, kind: 'media', envelopes: { [people.admin.userId]: fakeCt() } });
    const pub = await people.bia.post('/v1/docs/publish', { mediaId: up.data.mediaId, room: roomId, msgId: m, size: 1000, expiresAt: up.data.expiresAt });
    assert.equal(pub.status, 200, JSON.stringify(pub));
    docs.push({ mediaId: up.data.mediaId, msgId: m, evicted: pub.data.evicted });
  }
  assert.deepEqual(docs[3].evicted, [docs[0].mediaId]);
  assert.equal((await people.bia.get('/v1/docs/mine')).data.active, 3, 'contagem só da própria pessoa, nunca passa de 3');
  assert.equal((await people.admin.get('/v1/docs/mine')).data.active, 0);
  // Apagar para todos libera a vaga na hora (pela mensagem ou pela mídia).
  assert.equal((await people.bia.post(`/v1/rooms/${roomId}/messages/${docs[1].msgId}/delete`)).status, 200);
  assert.equal((await people.bia.get('/v1/docs/mine')).data.active, 2);
  assert.equal((await people.bia.post(`/v1/media/${docs[2].mediaId}/revoke`)).status, 200);
  assert.equal((await people.bia.get('/v1/docs/mine')).data.active, 1);
  assert.equal((await people.admin.post(`/v1/media/${docs[3].mediaId}/revoke`)).status !== 200, true, 'só o autor revoga');
  assert.equal((await people.bia.get('/v1/docs/mine')).data.active, 1, 'tentativa de outra pessoa não mexe na cota');
  assert.equal((await people.admin.post(`/v1/media/${docs[0].mediaId}/open`)).status, 404, 'documento revogado sumiu');
  assert.equal((await people.admin.post(`/v1/media/${docs[1].mediaId}/open`, undefined, { raw: true })).status, 200);
  assert.ok((await people.admin.get('/v1/sync')).data.tombstones.some((t) => t.msgId === docs[0].msgId));
});

test('troca de aparelho em duas fases: antigo aprova, novo guarda as chaves e confirma, só então o antigo cai', async () => {
  const newDev = await newDevice();
  const fresh = new Client(api.base);
  const start = await fresh.post('/v1/devices/pair/start', { device: newDev.public });
  assert.equal(start.status, 201);
  assert.equal((await people.bia.post('/v1/devices/pair/approve', { pairingId: start.data.pairingId, code: '00000000' })).status, 401);
  const ok = await people.bia.post('/v1/devices/pair/approve', { pairingId: start.data.pairingId, code: start.data.code });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.userId, people.bia.userId, 'mesma identidade');
  assert.equal(ok.data.pending, true);
  // O celular novo ainda não confirmou: o antigo continua valendo (se o novo
  // travar agora, ninguém perde a conta).
  assert.equal((await people.bia.get('/v1/sync')).status, 200, 'antigo ainda ativo antes da confirmação');
  const st = await fresh.post('/v1/devices/pair/status', { pairingId: start.data.pairingId, authPub: newDev.public.authPub });
  assert.equal(st.data.state, 'approved');
  await fresh.login(newDev, ok.data.deviceId);
  assert.equal(fresh.userId, people.bia.userId);
  // Pendente: só cofre e confirmação.
  assert.equal((await fresh.get('/v1/me')).data.pending, true);
  assert.equal((await fresh.get('/v1/sync')).status, 403, 'pendente não lê mensagens');
  assert.equal((await fresh.get('/v1/directory')).status, 403);
  assert.ok(!(await people.admin.get('/v1/directory')).data.members.some((m) => m.deviceId === ok.data.deviceId), 'pendente fora do diretório');
  assert.equal((await fresh.post('/v1/devices/pair/commit')).status, 409, 'confirmar exige cofre guardado');
  assert.equal((await fresh.post('/v1/vault/register', { verifier: Buffer.from(randomBytes(32)).toString('base64'), deadDays: 15 })).status, 201);
  assert.equal((await fresh.post('/v1/devices/pair/commit')).status, 200);
  assert.equal((await fresh.post('/v1/devices/pair/commit')).status, 200, 'confirmar de novo não quebra');
  assert.equal((await people.bia.get('/v1/sync')).status, 401, 'só agora a sessão do aparelho antigo cai');
  assert.equal((await fresh.get('/v1/me')).data.pending, false);
  assert.equal((await fresh.get('/v1/sync')).status, 200);
  people.bia = fresh;
});

test('troca durável: cofre registrado já no pedido; aprovado, vale para o aparelho novo sem novo registro', async () => {
  const dev = await newDevice();
  const fresh = new Client(api.base);
  const verifier = Buffer.from(randomBytes(32)).toString('base64');
  const start = await fresh.post('/v1/devices/pair/start', { device: dev.public, vault: { verifier, deadDays: 15 } });
  assert.equal(start.status, 201);
  assert.ok(start.data.vault.vaultId && start.data.vault.share, 'cofre já existe antes da aprovação');
  // O app fechou e abriu de novo antes da aprovação: o cofre abre com o PIN certo.
  const rel = await fresh.post('/v1/vault/release', { vaultId: start.data.vault.vaultId, verifier });
  assert.equal(rel.data.share, start.data.vault.share);
  const ok = await people.bia.post('/v1/devices/pair/approve', { pairingId: start.data.pairingId, code: start.data.code });
  assert.equal(ok.status, 200);
  await fresh.login(dev, ok.data.deviceId);
  assert.equal((await fresh.post('/v1/devices/pair/commit')).status, 200, 'cofre do pedido passou para o aparelho novo');
  assert.equal((await people.bia.get('/v1/sync')).status, 401);
  assert.equal((await fresh.post('/v1/vault/release', { vaultId: start.data.vault.vaultId, verifier })).data.share, start.data.vault.share, 'cofre segue valendo depois da troca');
  people.bia = fresh;
});

test('troca de aparelho: novo que some no meio não derruba ninguém; aprovar de novo substitui o pendente', async () => {
  const lost = await newDevice();
  const a = new Client(api.base);
  const s1 = await a.post('/v1/devices/pair/start', { device: lost.public });
  const ok1 = await people.caio.post('/v1/devices/pair/approve', { pairingId: s1.data.pairingId, code: s1.data.code });
  assert.equal(ok1.status, 200);
  // O celular novo "morreu" aqui. Caio tenta de novo com outro.
  const again = await newDevice();
  const b = new Client(api.base);
  const s2 = await b.post('/v1/devices/pair/start', { device: again.public });
  const ok2 = await people.caio.post('/v1/devices/pair/approve', { pairingId: s2.data.pairingId, code: s2.data.code });
  assert.equal(ok2.status, 200);
  assert.equal((await people.caio.get('/v1/sync')).status, 200, 'antigo segue funcionando');
  // O primeiro pendente perdeu a vaga.
  const { data: { nonce } } = await a.post('/v1/auth/challenge', { deviceId: ok1.data.deviceId });
  const sig = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, lost.kp.privateKey, new TextEncoder().encode(`mp-auth-v1:${nonce}:${ok1.data.deviceId}`));
  assert.equal((await a.post('/v1/auth/session', { deviceId: ok1.data.deviceId, nonce, signature: Buffer.from(sig).toString('base64') })).status, 401);
  // Desiste do segundo também: Caio continua no aparelho antigo.
  assert.equal((await people.caio.get('/v1/sync')).status, 200);
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
  assert.equal(ok.headers.get('access-control-expose-headers'), 'x-mp-time', 'o app lê o horário do servidor');
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

test('foto de perfil e de grupo: só a versão atual existe; só quem pode vê; sem prazo', async () => {
  const blob = (n, v) => new Uint8Array(n).fill(v);
  const up = (c, path, b) => c.post(`/v1/visual/${path}`, b);
  const get = async (c, id) => { const r = await c.get(`/v1/visual/${id}`, { raw: true }); return { status: r.status, bytes: r.ok ? new Uint8Array(await r.arrayBuffer()) : null }; };

  assert.equal((await up(people.bia, `user/${people.bia.userId}/profile`, blob(2 * 1024 * 1024 + 1, 1))).status, 413);
  assert.equal((await up(people.bia, `user/${people.admin.userId}/profile`, blob(10, 1))).status, 403, 'só a própria foto');
  assert.equal((await up(people.bia, `user/${people.bia.userId}/background`, blob(10, 1))).status, 400, 'pessoa não tem fundo');
  const v1 = await up(people.bia, `user/${people.bia.userId}/profile`, blob(2_000_000, 7)); // dois pedaços no DO
  assert.equal(v1.status, 201, JSON.stringify(v1));
  const g1 = await get(people.caio, v1.data.mediaId);
  assert.equal(g1.status, 200);
  assert.equal(g1.bytes.length, 2_000_000);
  assert.ok(g1.bytes.every((x) => x === 7));
  // A rota de mídia comum não abre nem apaga a foto (sem prazo ≠ vencida).
  assert.notEqual((await people.caio.post(`/v1/media/${v1.data.mediaId}/open`)).status, 200);
  assert.equal((await get(people.caio, v1.data.mediaId)).status, 200, 'continua lá');

  const v2 = await up(people.bia, `user/${people.bia.userId}/profile`, blob(100, 9));
  assert.equal((await get(people.admin, v1.data.mediaId)).status, 404, 'versão anterior não é mais entregue');
  assert.equal((await get(people.admin, v2.data.mediaId)).status, 200);
  assert.equal((await people.bia.post(`/v1/visual/user/${people.bia.userId}/profile?remove=1`)).status, 200);
  assert.equal((await get(people.admin, v2.data.mediaId)).status, 404, 'removida some');

  // Grupo: só a líder troca; só membros ativos veem; encerrar apaga.
  const g = (await people.admin.post('/v1/rooms', { kind: 'group', members: [people.bia.userId] })).data.roomId;
  assert.equal((await up(people.bia, `room/${g}/photo`, blob(10, 1))).status, 403, 'quem não é líder não troca');
  assert.equal((await up(people.admin, `room/${g}/profile`, blob(10, 1))).status, 400);
  const photo = await up(people.admin, `room/${g}/photo`, blob(500, 3));
  const bg = await up(people.admin, `room/${g}/background`, blob(500, 4));
  assert.equal((await get(people.bia, photo.data.mediaId)).status, 200);
  assert.equal((await get(people.bia, bg.data.mediaId)).bytes[0], 4);
  assert.equal((await get(people.caio, photo.data.mediaId)).status, 403, 'quem não está no grupo não vê');
  await people.admin.post(`/v1/rooms/${g}/events`, { type: 'remove_member', member: people.bia.userId });
  assert.equal((await get(people.bia, photo.data.mediaId)).status, 403, 'removida perde o acesso');
  await people.admin.post(`/v1/rooms/${g}/events`, { type: 'close' });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await get(people.admin, photo.data.mediaId)).status, 404, 'grupo encerrado: foto apagada');
  assert.equal((await get(people.admin, bg.data.mediaId)).status, 404);
});

test('silenciar: só membro ativo, só para si; reativar; valor inválido recusado', async () => {
  const g = (await people.admin.post('/v1/rooms', { kind: 'group', members: [people.bia.userId] })).data.roomId;
  const until = Date.now() + 3600_000;
  const r = await people.bia.post(`/v1/rooms/${g}/mute`, { until });
  assert.equal(r.status, 200);
  assert.equal(r.data.until, until);
  assert.equal((await people.caio.post(`/v1/rooms/${g}/mute`, { until })).status, 403, 'quem não está no grupo não mexe');
  assert.equal((await people.bia.post(`/v1/rooms/${g}/mute`, { until: -5 })).status, 400);
  assert.equal((await people.bia.post(`/v1/rooms/${g}/mute`, { until: 'x' })).status, 400);
  // Envio continua normal e a resposta não revela quem silenciou.
  const m = await people.admin.post(`/v1/rooms/${g}/messages`, { msgId: msgId(), kind: 'text', envelopes: { [people.bia.userId]: fakeCt() } });
  assert.equal(m.status, 201);
  assert.deepEqual(Object.keys(m.data).sort(), ['acceptedAt', 'expiresAt']);
  assert.equal((await people.bia.post(`/v1/rooms/${g}/mute`, { until: 0 })).data.until, 0);
});

test('stories: audiência escolhida dentro do círculo, prazo próprio, mídia só para a audiência', async () => {
  const C = 'circulo-0000000000';
  const aud = [people.caio.userId];
  // Mídia da story: só a audiência tem direito.
  const up = await people.bia.post(`/v1/rooms/${C}/media?mode=media&story=1&audience=${aud.join(',')}&ttl=${24 * 3600}`, new Uint8Array(500));
  assert.equal(up.status, 201, JSON.stringify(up));
  assert.ok(Math.abs(up.data.expiresAt - Date.now() - 24 * 3600_000) < 10_000, 'prazo de 24 h');
  assert.equal((await people.caio.post(`/v1/media/${up.data.mediaId}/open`, undefined, { raw: true })).status, 200);
  assert.equal((await people.admin.post(`/v1/media/${up.data.mediaId}/open`)).status, 403, 'fora da audiência não abre');
  // Audiência fora do círculo, vazia, ou prazo fora da faixa: recusado.
  assert.equal((await people.bia.post(`/v1/rooms/${C}/media?mode=media&story=1&audience=intruso0000`, new Uint8Array(10))).status, 400);
  assert.equal((await people.bia.post(`/v1/rooms/${C}/media?mode=media&story=1&audience=`, new Uint8Array(10))).status, 400);
  assert.equal((await people.bia.post(`/v1/rooms/${C}/media?mode=media&story=1&audience=${aud}&ttl=60`, new Uint8Array(10))).status, 400);
  assert.equal((await people.bia.post(`/v1/rooms/${C}/media?mode=once&story=1&audience=${aud}`, new Uint8Array(10))).status, 400);
  // Envelope da story: exatamente a audiência.
  const id = msgId();
  const r = await people.bia.post(`/v1/rooms/${C}/messages`, { msgId: id, kind: 'story', envelopes: { [people.caio.userId]: fakeCt() } });
  assert.equal(r.status, 201, JSON.stringify(r));
  assert.equal(r.data.expiresAt - r.data.acceptedAt, 24 * 3600_000, 'padrão de 24 h');
  assert.ok((await people.caio.get('/v1/sync')).data.envelopes.some((e) => e.msgId === id));
  assert.ok(!(await people.admin.get('/v1/sync')).data.envelopes.some((e) => e.msgId === id), 'quem não está na audiência nem recebe o envelope');
  assert.equal((await people.bia.post(`/v1/rooms/${C}/messages`, { msgId: msgId(), kind: 'story', envelopes: { intruso0000: fakeCt() } })).status, 400);
  // Story só existe na conversa do círculo.
  const g = (await people.admin.post('/v1/rooms', { kind: 'group', members: [people.bia.userId] })).data.roomId;
  assert.equal((await people.admin.post(`/v1/rooms/${g}/messages`, { msgId: msgId(), kind: 'story', envelopes: { [people.bia.userId]: fakeCt() } })).status, 400);
  // Apagar antes de vencer: tombstone para a audiência.
  assert.equal((await people.bia.post(`/v1/rooms/${C}/messages/${id}/delete`)).status, 200);
  assert.ok((await people.caio.get('/v1/sync')).data.tombstones.some((t) => t.msgId === id));
});

test('administradora perdeu o aparelho: recupera com o código de instalação, mesma conta, aparelho antigo cai', async () => {
  const dev = await newDevice();
  const fresh = new Client(api.base);
  const vault = { verifier: Buffer.from(randomBytes(32)).toString('base64'), deadDays: 15 };
  assert.equal((await fresh.post('/v1/admin/recover', { setupCode: 'x'.repeat(24), device: dev.public, vault })).status, 401, 'código errado');
  assert.equal((await fresh.post('/v1/admin/recover', { setupCode: SETUP, device: dev.public })).status, 400, 'sem cofre');
  // Instalar de novo continua recusado: o círculo já existe.
  assert.equal((await fresh.post('/v1/bootstrap', { setupCode: SETUP, device: dev.public })).status, 409);
  const before = (await people.bia.get('/v1/sync')).status;
  const r = await fresh.post('/v1/admin/recover', { setupCode: SETUP, device: dev.public, vault });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.data.userId, people.admin.userId, 'mesma conta');
  assert.ok(r.data.vault.vaultId && r.data.vault.share, 'cofre do aparelho novo já registrado');
  assert.equal((await people.admin.get('/v1/sync')).status, 401, 'aparelho antigo caiu');
  await fresh.login(dev, r.data.deviceId);
  const me = (await fresh.get('/v1/me')).data;
  assert.equal(me.isAdmin, true, 'continua administradora');
  assert.equal(me.pending, false);
  assert.equal((await fresh.post('/v1/vault/release', { vaultId: r.data.vault.vaultId, verifier: vault.verifier })).data.share, r.data.vault.share);
  // Contatos veem a troca de chave e o aparelho novo no diretório.
  const dir = (await people.bia.get('/v1/directory')).data.members;
  assert.equal(dir.find((m) => m.userId === people.admin.userId).deviceId, r.data.deviceId);
  assert.ok((await people.bia.get('/v1/security-events')).data.events.some((e) => e.kind === 'recovered' && e.userId === people.admin.userId), 'aviso de segurança para o círculo');
  assert.equal(before, 200);
  // Pode criar convites (é administradora de verdade).
  assert.equal((await fresh.post('/v1/invites', {})).status, 201);
  people.admin = fresh;
});
