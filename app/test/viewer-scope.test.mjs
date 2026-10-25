import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { chromium } from '../../e2e/node_modules/playwright/index.mjs';
let server,browser,page,base;
const root=new URL('../src/',import.meta.url).pathname;
before(async()=>{
  server=createServer(async(req,res)=>{
    if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><div id="root"></div><div id="toast"></div><div id="host"></div>');return;}
    const p=resolve(root,'.'+req.url.split('?')[0]);
    if(!p.startsWith(root)){res.writeHead(403).end();return;}
    try{const b=await readFile(p);res.setHeader('Content-Type',extname(p)==='.js'?'text/javascript':'application/octet-stream');res.end(b);}catch{res.writeHead(404).end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({headless:true});page=await browser.newPage();
});
after(async()=>{await browser?.close();await new Promise(r=>server?.close(r));});
async function reset(){
  await page.goto(base);await page.evaluate(async()=>{
    window.scopes=await import('/sensitive-scope.js');window.viewer=await import('/screens/viewer.js');scopes.setSensitiveSession(true);
  });
}
for(const kind of ['photo','video','audio','text','pdf']){
  test(`${kind}: resultado que termina depois de trancar não aparece nem toca`,async()=>{
    await reset();
    const result=await page.evaluate(async(kind)=>{
      let release;const waiting=new Promise(r=>{release=r;});
      const bytes=new Uint8Array([37,80,68,70,45,49]);const load=()=>waiting;
      const task=kind==='photo'?viewer.openMedia(load,'image/jpeg'):kind==='video'?viewer.openMedia(load,'video/mp4'):kind==='audio'?viewer.playAudio(load,'audio/webm',document.querySelector('#host')):kind==='text'?viewer.openText(load,'texto'):viewer.openPdf(load,'pdf');
      scopes.setSensitiveSession(false);scopes.setSensitiveSession(true);release(bytes);await task;
      return {count:document.querySelectorAll('.viewer,.audio-box').length,zero:bytes.every(b=>b===0)};
    },kind);
    assert.deepEqual(result,{count:0,zero:true});
  });
}
test('blur cancela abertura pendente mesmo sem bloqueio de sessão',async()=>{
  await reset();assert.equal(await page.evaluate(async()=>{
    let release;const p=new Promise(r=>release=r);const t=viewer.openMedia(()=>p,'image/jpeg');
    window.dispatchEvent(new Event('blur'));release(new Uint8Array([1]));await t;return document.querySelectorAll('.viewer').length;
  }),0);
});
test('ver uma vez: toque duplo faz uma abertura; soltar mantém; Escape fecha',async()=>{
  await reset();await page.evaluate(()=>{
    window.loads=0;window.release=null;
    const waiting=new Promise(r=>window.release=r);
    document.body.append(viewer.onceButton('Abrir uma vez',()=>{loads++;return waiting;},'image/jpeg',()=>{}));
  });
  await page.click('.once-open');await page.evaluate(()=>document.querySelector('.once-open').click());
  assert.equal(await page.evaluate(()=>loads),1);
  await page.evaluate(()=>release(new Uint8Array([1,2,3])));await page.waitForSelector('.viewer img');
  await page.mouse.up();assert.equal(await page.locator('.viewer').count(),1);
  await page.keyboard.press('Escape');assert.equal(await page.locator('.viewer').count(),0);
});
test('fechar áudio também remove o player e libera seu endereço',async()=>{
  await reset();await page.evaluate(async()=>{await viewer.playAudio(async()=>new Uint8Array([1]),'audio/webm',document.querySelector('#host'));});
  assert.equal(await page.locator('.audio-box').count(),1);await page.click('.audio-box button:text-is("Fechar")');assert.equal(await page.locator('.audio-box').count(),0);
});
test('seletor: leitura de conteúdo exige sessão atual e é cancelada entre blocos',async()=>{
  await reset();const result=await page.evaluate(async()=>{
    const calls=[];let active=false;
    window.Capacitor={isNativePlatform:()=>true,Plugins:{AttachmentPicker:{describe:async()=>{calls.push('describe');return {name:'foto.jpg',mime:'image/jpeg',size:2};},read:async()=>{calls.push('read');active=false;return {data:btoa('ab')};},clear:async()=>calls.push('clear')}}};
    const {readNativeAttachment}=await import('/attachment-picker.js');const ctl=new AbortController();const selection={token:'chosen',pick:{}};
    try{await readNativeAttachment(selection,{signal:ctl.signal,allowed:()=>active});}catch{}
    const first=[...calls];active=true;
    let aborted=false;try{await readNativeAttachment(selection,{signal:ctl.signal,allowed:()=>active});}catch(e){aborted=e.name==='AbortError';}
    return {first,calls,aborted};
  });
  assert.deepEqual(result.first,['clear']);assert.equal(result.aborted,true);assert.deepEqual(result.calls,['clear','describe','read','clear']);
});
