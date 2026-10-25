import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setSensitiveSession, cancelSensitiveOperations, sensitiveScope } from '../src/sensitive-scope.js';
import { startRecording } from '../src/audio.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
let stops=0;
const stream=()=>({getTracks:()=>[{stop(){stops++;}}]});
function setup(getUserMedia, Recorder) {
  stops=0;setSensitiveSession(true);
  Object.defineProperty(globalThis,'navigator',{value:{mediaDevices:{getUserMedia}},configurable:true});
  globalThis.MediaRecorder=Recorder;
}
class Recorder {
  static isTypeSupported(){return true;}
  constructor(){this.state='inactive';this.mimeType='audio/webm;codecs=opus';}
  start(){this.state='recording';}
  stop(){this.state='inactive';queueMicrotask(()=>this.onstop?.());}
}
afterEach(()=>{cancelSensitiveOperations();setSensitiveSession(false);delete globalThis.MediaRecorder;});
test('exceção ao construir gravador solta microfone',async()=>{
  class Broken extends Recorder {constructor(){throw Error('recorder failed');}}
  setup(async()=>stream(),Broken);await assert.rejects(startRecording(),/recorder failed/);assert.ok(stops>0);
});
test('permissão tardia depois do bloqueio não inicia gravação',async()=>{
  const gate=deferred();let starts=0;
  class Counted extends Recorder {start(){starts++;super.start();}}
  setup(()=>gate.promise,Counted);const request=startRecording();
  setSensitiveSession(false);gate.resolve(stream());await assert.rejects(request,{name:'AbortError'});
  assert.equal(starts,0);assert.ok(stops>0);
});
test('abortar cancela e resolve stop sem áudio e sem microfone',async()=>{
  setup(async()=>stream(),Recorder);const ctl=new AbortController();const r=await startRecording({signal:ctl.signal});
  ctl.abort();assert.ok(stops>0);assert.equal(await r.stop(),null);
});
test('sair da tela cancela mesmo sem bloquear a conta',async()=>{
  setup(async()=>stream(),Recorder);const r=await startRecording();cancelSensitiveOperations();
  assert.ok(stops>0);assert.equal(await r.stop(),null);
});
test('erro no start também solta as faixas',async()=>{
  class Broken extends Recorder {start(){throw Error('start failed');}}
  setup(async()=>stream(),Broken);await assert.rejects(startRecording(),/start failed/);assert.ok(stops>0);
});
test('sessão nova não torna uma operação cancelada válida outra vez',()=>{
  setSensitiveSession(true);const s=sensitiveScope();assert.equal(s.valid(),true);
  setSensitiveSession(false);setSensitiveSession(true);assert.equal(s.valid(),false);
});
