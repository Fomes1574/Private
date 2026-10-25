import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadCrypto } from '../../crypto/index.js';
import { MessengerClient, MemoryStore, Api } from '../src/index.js';
import { TrustedClock } from '../../protocol/src/time.js';
import { startApi, SETUP } from '../../../server/test/helpers.mjs';
await loadCrypto(await readFile(new URL('../../crypto/pkg/mp_crypto_bg.wasm',import.meta.url)));
let api,a,b;
const person=()=>new MessengerClient({api:new Api(api.base,new TrustedClock()),store:new MemoryStore(),pickleKey:crypto.getRandomValues(new Uint8Array(32))});
before(async()=>{
  api=await startApi(8806);a=person();b=person();
  await a.bootstrap(SETUP);await a.login();const inv=await a.api.post('/v1/invites',{});await b.redeem(inv.token);await b.login();
  await a.refreshDirectory();await b.refreshDirectory();
});
after(()=>api?.stop());
let view;
test('reúso mantém anúncio cifrado e liderança mesmo com abertura simultânea',async()=>{
  const [x,y]=await Promise.all([a.createRoom('direct',[b.userId]),b.createRoom('direct',[a.userId])]);
  assert.equal(x.roomId,y.roomId);assert.equal(x.leader,y.leader);view=x;
  await a.sync();await b.sync();
  for(const c of [a,b])assert.equal(c.trusted[x.roomId].leader,x.leader);
  const follower=x.leader===a.userId?b:a,leader=follower===a?b:a;
  const again=await follower.createRoom('direct',[leader.userId]);
  assert.equal(again.leader,x.leader);assert.equal(follower.trusted[x.roomId].leader,x.leader);
  const m=await follower.sendText(x.roomId,'reúso com confiança preservada');await leader.sync();
  assert.equal((await leader.store.getMessage(m.msgId)).text,'reúso com confiança preservada');
});
test('criadora recupera anúncio perdido sem criar outra sala',async()=>{
  await a.roomEvent(view.roomId,{type:'unlink'});
  const reserved=await a.api.post('/v1/rooms',{kind:'direct',members:[b.userId],reuse:true});
  assert.equal(reserved.created,true);assert.equal(a.trusted[reserved.roomId],undefined);
  const retry=await a.createRoom('direct',[b.userId]);assert.equal(retry.roomId,reserved.roomId);
  await b.sync();assert.equal(b.trusted[retry.roomId].leader,a.userId);
  const m=await b.sendText(retry.roomId,'anúncio recuperado');await a.sync();assert.ok(await a.store.getMessage(m.msgId));
});

test('servidor não pode mudar os destinatários escolhidos na criação',async()=>{
  const post=a.api.post.bind(a.api);const before=JSON.stringify(a.trusted);
  a.api.post=async(path,...args)=>path==='/v1/rooms'?{roomId:'injectedroom',kind:'direct',leader:a.userId,created:true,closed:false,members:[{userId:a.userId,active:true},{userId:'intruder0',active:true}]}:post(path,...args);
  try{await assert.rejects(a.createRoom('direct',[b.userId]),/diferentes dos escolhidos/);assert.equal(JSON.stringify(a.trusted),before);}
  finally{a.api.post=post;}
});
