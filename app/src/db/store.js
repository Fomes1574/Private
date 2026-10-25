// Adaptador do banco cifrado para a interface de armazenamento do núcleo
// do cliente (MemoryStore). A chave de autenticação do aparelho, que é uma
// CryptoKey não extraível, fica no IndexedDB; o resto, cifrado no SQLite.
import { scriptURL } from '../tt.js';
import { idbGet, idbPut } from '../idb.js';

export class EncryptedStore {
  constructor() {
    this.worker = new Worker(scriptURL('./db/db-worker.js'), { type: 'module' });
    this.seq = 0;
    this.pending = new Map();
    this.worker.onmessage = ({ data }) => {
      const p = this.pending.get(data.id);
      if (!p) return;
      this.pending.delete(data.id);
      data.ok ? p.resolve(data.result) : p.reject(new Error(data.error));
    };
  }
  call(op, arg) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, op, arg });
    });
  }
  open(name) { return this.call('open', { name }); }
  unlock(dek) { return this.call('setKey', dek); }
  rebuild(newKey, newName, now) { return this.call('rebuild', { newKey, newName, now }); }
  switchTo(name) { return this.call('switchTo', { name }); }
  abortRebuild() { return this.call('abortRebuild'); }
  cleanup(keep) { return this.call('cleanup', { keep }); }
  lock() { return this.call('lock'); }
  wipe() { return this.call('wipe'); }
  purgeExpired(now) { return this.call('purgeExpired', now); }

  async get(k) {
    const v = await this.call('kvGet', k);
    if (k === 'device' && v) v.authKey = await idbGet('authKey');
    return v;
  }
  async put(k, v) {
    if (k === 'device' && v) {
      await idbPut('authKey', v.authKey);
      const { authKey, ...rest } = v;
      return this.call('kvPut', { k, v: rest });
    }
    return this.call('kvPut', { k, v });
  }
  putMessage(m) { return this.call('putMessage', m); }
  getMessage(id) { return this.call('getMessage', id); }
  deleteMessages(ids) { return this.call('deleteMessages', ids); }
  roomMessages(room) { return this.call('roomMessages', room); }
}
