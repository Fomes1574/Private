import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApi, newDevice, Client, SETUP } from './helpers.mjs';
let api, a, b;
before(async () => {
  api = await startApi(8798);
  a = new Client(api.base); b = new Client(api.base);
  const da = await newDevice(), db = await newDevice();
  const first = await a.post('/v1/bootstrap', { setupCode: SETUP, device: da.public });
  await a.login(da, first.data.deviceId);
  const invitation = await a.post('/v1/invites', {});
  const second = await b.post('/v1/invites/redeem', { token: invitation.data.token, device: db.public });
  await b.login(db, second.data.deviceId);
});
after(() => api?.stop());
const open = (client, peer, extra = {}) => client.post('/v1/rooms', { kind: 'direct', members: [peer.userId], reuse: true, ...extra });
let room;
test('dupla criando ao mesmo tempo recebe uma única conversa e mantém liderança', async () => {
  const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => i % 2 ? open(a,b) : open(b,a)));
  for (const r of responses) assert.ok([200,201].includes(r.status), JSON.stringify(r));
  assert.equal(new Set(responses.map(r=>r.data.roomId)).size,1);
  assert.equal(responses.filter(r=>r.data.created).length,1);
  assert.equal(new Set(responses.map(r=>r.data.leader)).size,1);
  room = responses[0].data;
  for (const c of [a,b]) assert.equal((await c.get('/v1/rooms')).data.rooms.filter(id=>id===room.roomId).length,1);
});
test('repetição após resposta perdida preserva ID, líder e prazos', async () => {
  const r=await open(a,b,{textTtl:43200});
  assert.equal(r.data.roomId,room.roomId);assert.equal(r.data.leader,room.leader);
  assert.equal(r.data.textTtl,room.textTtl);assert.equal(r.data.created,false);
});
test('desfazer vínculo permite nova conversa com outro ID e nova líder', async () => {
  assert.equal((await a.post(`/v1/rooms/${room.roomId}/events`,{type:'unlink'})).status,200);
  const r=await open(b,a);assert.equal(r.status,201);
  assert.notEqual(r.data.roomId,room.roomId);assert.equal(r.data.leader,b.userId);
});
test('migração adota sala antiga sem trocar a liderança', async () => {
  const dev=await newDevice(), c=new Client(api.base);
  const inv=await a.post('/v1/invites',{});
  const joined=await c.post('/v1/invites/redeem',{token:inv.data.token,device:dev.public});
  await c.login(dev,joined.data.deviceId);
  const legacy=await c.post('/v1/rooms',{kind:'direct',members:[a.userId]});
  assert.equal(legacy.status,201);assert.equal(legacy.data.created,undefined);
  const adopted=await open(a,c);
  assert.equal(adopted.data.roomId,legacy.data.roomId);assert.equal(adopted.data.leader,c.userId);assert.equal(adopted.data.created,false);
});
test('membros inválidos e uma terceira pessoa são recusados', async()=>{
  assert.equal((await open(a,a)).status,400);
  assert.equal((await open(a,b,{members:[b.userId,'unknown0']})).status,400);
});
