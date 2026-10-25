import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operationQueue } from '../src/db/operation-queue.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('worker serializa operações que aguardam criptografia',async()=>{
  const gate=deferred(), order=[];
  const send=operationQueue({async put(n){order.push(`start${n}`);if(n===1)await gate.promise;order.push(`end${n}`);}},()=>{});
  const a=send({id:1,op:'put',arg:1}),b=send({id:2,op:'put',arg:2});
  await Promise.resolve();assert.deepEqual(order,['start1']);gate.resolve();await Promise.all([a,b]);
  assert.deepEqual(order,['start1','end1','start2','end2']);
});
test('escrita entre cópia e troca só executa no banco novo',async()=>{
  let active='old';const writes=[],responses=[];
  const send=operationQueue({rebuild(){},put(v){writes.push([active,v]);},switchTo(){active='new';}},r=>responses.push(r));
  await send({id:1,op:'rebuild'});await send({id:2,op:'put',arg:'message'});
  assert.deepEqual(writes,[]);assert.equal(responses.some(r=>r.id===2),false);
  await send({id:3,op:'switchTo'});assert.deepEqual(writes,[['new','message']]);
});
test('falha ao salvar cofre aborta cópia e preserva escritas no banco anterior',async()=>{
  const writes=[];const send=operationQueue({rebuild(){},abortRebuild(){},put(v){writes.push(v);}},()=>{});
  await send({id:1,op:'rebuild'});await send({id:2,op:'put',arg:42});await send({id:3,op:'abortRebuild'});
  assert.deepEqual(writes,[42]);
});
test('bloqueio cancela operações adiadas sem recriar dados',async()=>{
  const writes=[],responses=[];const send=operationQueue({rebuild(){},abortRebuild(){},lock(){},put(v){writes.push(v);}},r=>responses.push(r));
  await send({id:1,op:'rebuild'});await send({id:2,op:'put',arg:'secret'});await send({id:3,op:'lock'});
  assert.deepEqual(writes,[]);assert.equal(responses.find(r=>r.id===2).ok,false);
});
test('uma falha não paralisa a fila e métodos herdados não são executados',async()=>{
  const responses=[];const send=operationQueue({bad(){throw Error('disk');},good(){return 3;}},r=>responses.push(r));
  await send({id:1,op:'bad'});await send({id:2,op:'good'});await send({id:3,op:'toString'});
  assert.deepEqual(responses.map(r=>r.ok),[false,true,false]);assert.equal(responses[1].result,3);
});
