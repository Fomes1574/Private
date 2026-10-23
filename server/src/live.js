// Um DO por pessoa: WebSocket hibernável que só diz "sincronize" e push sem
// conteúdo quando não há conexão aberta. Nunca leva conteúdo, remetente ou
// contagem (V6-021, V6-022).
import { DurableObject } from 'cloudflare:workers';
import { sendPush } from './push.js';

const PUSH_MIN_INTERVAL = 60_000; // no máximo um push por minuto por pessoa

export class Live extends DurableObject {
  async fetch(request) {
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0], headers: { 'sec-websocket-protocol': 'mp-v1' } });
  }

  webSocketMessage(ws, msg) { if (msg === 'ping') ws.send('pong'); }
  webSocketClose(ws, code) { try { ws.close(code, ''); } catch {} }

  async nudge(endpoints = []) {
    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) { try { ws.send('{"t":"sync"}'); } catch {} }
    if (sockets.length || !endpoints.length) return { sockets: sockets.length, pushed: 0 };
    const last = (await this.ctx.storage.get('lastPush')) ?? 0;
    if (Date.now() - last < PUSH_MIN_INTERVAL) return { sockets: 0, pushed: 0 };
    await this.ctx.storage.put('lastPush', Date.now());
    let pushed = 0;
    const gone = [];
    for (const ep of endpoints) {
      const r = await sendPush(this.env, ep).catch(() => null);
      if (r?.ok) pushed++;
      else if (r && [404, 410].includes(r.status)) gone.push(ep);
    }
    return { sockets: 0, pushed, gone };
  }
}
