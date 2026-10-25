import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join,extname} from 'node:path';
import {chromium} from '../../e2e/node_modules/playwright/index.mjs';
import { execFileSync } from 'node:child_process';
let server,browser,base;
const root=new URL('../dist/',import.meta.url).pathname;
const types={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.wasm':'application/wasm','.png':'image/png'};
before(async()=>{
 execFileSync(process.execPath,['build.mjs'],{cwd:new URL('..',import.meta.url).pathname,env:{...process.env,MP_MODE:'plain',MP_TEST_HOOKS:'1'},stdio:'ignore'});
 server=createServer(async(req,res)=>{try{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/harness'){res.writeHead(200,{'content-type':'text/html'});res.end('<!doctype html><link rel="stylesheet" href="/styles.css"><div id="root"></div><div id="toast" hidden></div>');return;}
  const data=await readFile(join(root,path));res.writeHead(200,{'content-type':types[extname(path)]||'application/octet-stream'});res.end(data);
 }catch{res.writeHead(404);res.end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://localhost:${server.address().port}`;browser=await chromium.launch({headless:true});
});
after(async()=>{await browser?.close();await new Promise(r=>server?.close(r));});
async function page(){const p=await browser.newPage();await p.goto(base+'/harness');await p.evaluate(async()=>{
 window.sess=await import('/session.js');const {MemoryStore}=await import('/packages/client/src/store.js');
 const {MessengerClient}=await import('/packages/client/src/client.js');window.clockNow=100000;
 const store=new MemoryStore(),client=new MessengerClient({api:{clock:{now:()=>clockNow}},store,pickleKey:new Uint8Array(32)});client.userId='selftest123';
 Object.assign(sess.S,{store,client,unlocked:true,clock:{now:()=>clockNow},rooms:{},prefs:{},nicknames:{}});
 (await import('/sensitive-scope.js')).setSensitiveSession(true);
 });return p;}
test('revisão: anotação vencida deve sair do banco e da tela aberta',async()=>{
 const p=await page();try{
 const result=await p.evaluate(async()=>{
  await sess.addNote('SYNTHETIC_EXPIRED_NOTE',43200);const {notesScreen}=await import('/screens/notes.js');await notesScreen(()=>{});
  clockNow+=43200*1000+1;
  const listed=(await sess.notes()).length;await new Promise(r=>setTimeout(r,0));
  return {listed,stored:(await sess.S.store.get('notes')).length,visible:document.body.textContent.includes('SYNTHETIC_EXPIRED_NOTE')};
 });assert.deepEqual(result,{listed:0,stored:0,visible:false});
 }finally{await p.close();}
});
test('revisão: excluir conversa deve retirar o papel de parede local do banco',async()=>{
 const p=await page();try{
 const retained=await p.evaluate(async()=>{await sess.setWallpaper('roomtest123',new Uint8Array([1,2,3,4]));await sess.deleteRoomForMe('roomtest123');return Object.hasOwn(await sess.S.store.get('wallpapers'),'roomtest123');});
 assert.equal(retained,false);
 }finally{await p.close();}
});
test('revisão: verificar deve conferir a chave mostrada, não uma chave trocada enquanto a folha está aberta',async()=>{
 const p=await page();try{
 await p.evaluate(async()=>{
  const key=n=>btoa(String.fromCharCode(...new Uint8Array(32).fill(n)));
  window.oldKey=key(2);window.newKey=key(3);sess.S.client.account={curve25519Key:key(1)};
  sess.S.client.known.peertest123={curve:oldKey};sess.S.nicknames.peertest123={nickname:'Pessoa sintética'};
  const {verifySheet}=await import('/screens/verify.js');await verifySheet('peertest123');
 });
 const displayed=await p.locator('.safety').textContent();
 await p.evaluate(()=>{sess.S.client.known.peertest123.curve=newKey;});
 await p.getByRole('button',{name:'Os números batem: marcar como verificado',exact:true}).click();
 const result=await p.evaluate(()=>({verified:sess.S.client.verified.peertest123===newKey,closed:!document.querySelector('.safety')}));
 assert.ok(displayed);assert.equal(result.closed,true);assert.equal(result.verified,false);
 }finally{await p.close();}
});
test('revisão: girar a foto deve preservar o desenho ou pedir confirmação',async()=>{
 const p=await page();try{
 await p.evaluate(async()=>{
  const c=document.createElement('canvas');c.width=100;c.height=100;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,100,100);
  const blob=await new Promise(r=>c.toBlob(r));const {editPhoto}=await import('/editor.js');window.editResult=editPhoto(new Uint8Array(await blob.arrayBuffer()),'image/png');
 });
 await p.locator('.editor-canvas').waitFor();
 const c=p.locator('.editor-canvas'),box=await c.boundingBox();
 await p.mouse.move(box.x+box.width*.3,box.y+box.height*.3);await p.mouse.down();await p.mouse.move(box.x+box.width*.7,box.y+box.height*.7,{steps:5});await p.mouse.up();
 const red=()=>p.evaluate(()=>{const c=document.querySelector('.editor-canvas');const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<d.length;i+=4)if(d[i]>230&&d[i+1]<130&&d[i+2]<130)n++;return n;});
 const before=await red();assert.ok(before>0);
 await p.getByRole('button',{name:'Girar',exact:true}).click();
 const after=await red(),prompt=await p.locator('.sheet').count();
 assert.ok(after>0||prompt>0);
 for(let i=0;i<3;i++)await p.getByRole('button',{name:'Girar',exact:true}).click();
 assert.equal(await red(),before,'quatro giros preservam os pixels dos traços');
 }finally{await p.close();}
});

test('R04: cancelar QR antes da permissão impede câmera tardia de ficar ligada', async () => {
 const p=await page();try{
 await p.evaluate(async()=>{
  const key=n=>btoa(String.fromCharCode(...new Uint8Array(32).fill(n)));
  sess.S.client.account={curve25519Key:key(1)};sess.S.client.known.peertest123={curve:key(2)};
  window.BarcodeDetector=class{};window.stops=0;
  navigator.mediaDevices.getUserMedia=()=>new Promise(r=>window.releaseCamera=r);
  await (await import('/screens/verify.js')).verifySheet('peertest123');
 });
 await p.getByRole('button',{name:'Ler o QR da outra pessoa',exact:true}).click();
 await p.locator('.camera button').click();
 await p.evaluate(()=>releaseCamera({getTracks:()=>[{stop(){stops++;}}]}));
 await p.waitForFunction(()=>stops===1);
 assert.equal(await p.locator('.camera').count(),0);
 }finally{await p.close();}
});

test('R09/R11: todas as 62 combinações de 1–5 fotos mantêm o modo individual e a ordem', async () => {
 const p=await page();try{
 const result=await p.evaluate(async()=>{
  const {prepareBatch}=await import('/screens/batch.js');
  const c=new OffscreenCanvas(20,30);c.getContext('2d').fillRect(0,0,20,30);
  const original=new Uint8Array(await (await c.convertToBlob({type:'image/jpeg'})).arrayBuffer());
  let cases=0;
  for(let n=1;n<=5;n++)for(let mask=0;mask<(1<<n);mask++){
   const promise=prepareBatch(Array.from({length:n},()=>({bytes:original.slice(),mime:'image/jpeg'})));
   for(let i=0;i<n;i++){
    document.querySelectorAll('.batch .thumb')[i].click();
    if(mask&(1<<i))document.querySelector('.batch .once-toggle').click();
   }
   document.querySelector('.batch .send-batch').click();
   const out=await promise;
   if(out.length!==n||out.some((v,i)=>v.once!==!!(mask&(1<<i))||v.bytes.length!==original.length))throw Error(`modo/ordem incorretos ${n}/${mask}`);
   for(const v of out)v.bytes.fill(0);cases++;
  }
  return cases;
 });assert.equal(result,62);
 }finally{await p.close();}
});

test('R09: resultado de recodificação que chega depois de cancelar é zerado',async()=>{
 const p=await page();try{
 const result=await p.evaluate(async()=>{
  const {prepareBatch}=await import('/screens/batch.js');
  const c=new OffscreenCanvas(20,30);c.getContext('2d').fillRect(0,0,20,30);const bytes=new Uint8Array(await (await c.convertToBlob({type:'image/jpeg'})).arrayBuffer());
  let release;const original=createImageBitmap;
  globalThis.createImageBitmap=(...args)=>new Promise(r=>{release=async()=>r(await original(...args));});
  const pending=prepareBatch([{bytes,mime:'image/jpeg'}]);
  [...document.querySelectorAll('.batch button')].find(b=>b.textContent==='Editar').click();
  document.querySelector('.batch button').click();
  await release();await new Promise(r=>setTimeout(r,0));
  globalThis.createImageBitmap=original;
  return {out:await pending,zero:bytes.every(v=>v===0),dialogs:document.querySelectorAll('.editor').length};
 });assert.deepEqual(result,{out:null,zero:true,dialogs:0});
 }finally{await p.close();}
});

test('R01: migração troca DEK, mantém cofre antigo até o commit e falha com S antiga no novo', async()=>{
 const p=await page();try{
 const result=await p.evaluate(async()=>{
  const cryptoModule=await import('/packages/crypto/index.js');await cryptoModule.loadCrypto(new Uint8Array(await (await fetch('/packages/crypto/pkg/mp_crypto_bg.wasm')).arrayBuffer()));
  const vault=await import('/vault/vault.js');
  const secret='senha sintética para migração';
  const pending=await vault.startVault({mode:'passphrase',secret,argon:{m:8192,t:1,p:1}});
  const oldShare=vault.b64(vault.random(32)),newShare=vault.b64(vault.random(32));
  const {record}=await pending.finish({vaultId:'old-vault-test-123',share:oldShare});
  const store={load:async()=>record,save:async()=>{throw Error('migrate não deve gravar cofre sozinho');}};
  const opened=await vault.openVault(store,{secret,release:async()=>({share:oldShare,needsMigration:true})});
  const migrated=await opened.migrate(async()=>({vaultId:'new-vault-test-123',share:newShare}));
  const iv=vault.random(12),plain=new Uint8Array([7,8,9]);
  const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},migrated.dek,plain);
  let oldDecrypts=true;try{await crypto.subtle.decrypt({name:'AES-GCM',iv},opened.dek,ct);}catch{oldDecrypts=false;}
  const reopened=await vault.openVault({load:async()=>migrated.record},{secret,release:async()=>({share:newShare})});
  let oldShareOpens=true;try{await vault.openVault({load:async()=>migrated.record},{secret,release:async()=>({share:oldShare})});}catch{oldShareOpens=false;}
  return {oldDecrypts,oldShareOpens,sameOldRecord:record.vaultId==='old-vault-test-123',newData:Array.from(new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv},reopened.dek,ct)))};
 });assert.deepEqual(result,{oldDecrypts:false,oldShareOpens:false,sameOldRecord:true,newData:[7,8,9]});
 }finally{await p.close();}
});
