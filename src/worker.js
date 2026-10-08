// Cloudflare Worker entry + Durable Object (one object per table, keyed by its 4-letter code).
// Static files in /public are served by Workers Static Assets (see wrangler.toml).
import { RoomLogic } from './room.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O
const newCode = () => Array.from({ length: 4 }, () => CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]).join('');

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/new') {
      return Response.json({ code: newCode() }, { headers: { 'cache-control': 'no-store' } });
    }
    const m = url.pathname.match(/^\/ws\/([A-Za-z]{4})$/);
    if (m) {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });
      const id = env.ROOMS.idFromName(m[1].toUpperCase());
      return env.ROOMS.get(id).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },
};

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx; this.env = env; this.logic = null;
  }
  async load() {
    if (this.logic) return this.logic;
    const saved = await this.ctx.storage.get('s');
    this.logic = new RoomLogic(saved || null, { now: () => Date.now() });
    // rebuild connections after hibernation
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() || {};
      const id = att.id || crypto.randomUUID();
      this.logic.connect(id, (m) => ws.send(JSON.stringify(m)));
      if (att.token) this.logic.conns.get(id).token = att.token;
      ws.serializeAttachment({ id, token: att.token || null });
    }
    return this.logic;
  }
  async save() {
    const l = this.logic;
    if (l.s.expired) { await this.ctx.storage.deleteAll(); await this.ctx.storage.deleteAlarm(); l.s.expired = false; return; }
    await this.ctx.storage.put('s', l.serialize());
    const next = l.nextAlarm();
    if (next) await this.ctx.storage.setAlarm(next); else await this.ctx.storage.deleteAlarm();
  }
  async fetch(request) {
    await this.load();
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const id = crypto.randomUUID();
    server.serializeAttachment({ id, token: null });
    this.logic.connect(id, (m) => server.send(JSON.stringify(m)));
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws, data) {
    const l = await this.load();
    const att = ws.deserializeAttachment() || {};
    if (typeof data !== 'string' || data.length > 2000) return;
    let msg; try { msg = JSON.parse(data); } catch { return; }
    l.message(att.id, msg);
    const c = l.conns.get(att.id);
    if (c && c.token !== att.token) ws.serializeAttachment({ id: att.id, token: c.token });
    await this.save();
  }
  async webSocketClose(ws) { await this.dropped(ws); }
  async webSocketError(ws) { await this.dropped(ws); }
  async dropped(ws) {
    const l = await this.load();
    const att = ws.deserializeAttachment() || {};
    l.disconnect(att.id);
    await this.save();
  }
  async alarm() {
    const l = await this.load();
    l.alarm();
    await this.save();
  }
}
