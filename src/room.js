// Room logic for one Hotpot table. Platform independent: the Durable Object wraps it,
// and the tests drive it with fake connections and a fake clock.
import { createGame, doTake, doDiscard, autoPlay, viewFor, DIFFS } from './rules.js';

export const LOBBY_MS = 90_000;
export const TURN_MS = 45_000;
const NPC_NAMES = ['Jina', 'Zeki', 'Eshe'];
const MAX_HUMANS = 4;
const IDLE_EXPIRE_MS = 2 * 60 * 60 * 1000;

const cleanName = (s) => String(s ?? '').replace(/[^\p{L}\p{N} _.'-]/gu, '').trim().slice(0, 16) || 'Guest';

export class RoomLogic {
  /**
   * @param {object} saved  previously serialized state, or null
   * @param {{now:()=>number, rnd?:()=>number}} env
   */
  constructor(saved, env) {
    this.env = env;
    this.s = saved || {
      phase: 'lobby',          // lobby | playing | over
      humans: [],              // [{token, name}] in join order; index = seat while playing
      diff: 'standard',
      lobbyEndsAt: null,
      game: null,
      timers: [],              // [{at, kind}]
    };
    this.conns = new Map();    // connId -> {send, token}
    this.dirty = false;
  }
  serialize() { return this.s; }

  /* ---- helpers ---- */
  now() { return this.env.now(); }
  rnd(a, b) { return a + (this.env.rnd ? this.env.rnd() : Math.random()) * (b - a); }
  seatOfToken(token) { return this.s.humans.findIndex((h) => h.token === token); }
  hostToken() { return this.s.humans[0]?.token ?? null; }
  addTimer(kind, ms) { this.s.timers = this.s.timers.filter((t) => t.kind !== kind); this.s.timers.push({ at: this.now() + ms, kind }); }
  clearTimer(kind) { this.s.timers = this.s.timers.filter((t) => t.kind !== kind); }
  nextAlarm() { return this.s.timers.length ? Math.min(...this.s.timers.map((t) => t.at)) : null; }
  isConnected(token) { for (const c of this.conns.values()) if (c.token === token) return true; return false; }
  humanSeatPresent(seat) { const h = this.s.humans[seat]; return !!h && this.isConnected(h.token); }

  /* ---- outgoing ---- */
  lobbyView(token) {
    return {
      t: 'lobby', phase: this.s.phase, diff: this.s.diff,
      seats: this.s.humans.map((h) => ({ name: h.name, connected: this.isConnected(h.token), you: h.token === token })),
      host: token === this.hostToken(), msLeft: this.s.lobbyEndsAt ? Math.max(0, this.s.lobbyEndsAt - this.now()) : null,
      max: MAX_HUMANS,
    };
  }
  stateView(token) {
    const seat = this.seatOfToken(token);
    const g = this.s.game;
    const turnTimer = this.s.timers.find((t) => t.kind === 'humanTimeout');
    return {
      t: 'state', you: seat, host: token === this.hostToken(), diff: this.s.diff,
      msLeft: turnTimer ? Math.max(0, turnTimer.at - this.now()) : null,
      ...viewFor(g, seat),
    };
  }
  broadcast() {
    for (const [id, c] of this.conns) this.sendTo(id, c);
  }
  sendTo(id, c) {
    if (!c.token || this.seatOfToken(c.token) < 0) return;
    const msg = this.s.phase === 'lobby' ? this.lobbyView(c.token) : this.stateView(c.token);
    try { c.send(msg); } catch (e) { /* closed */ }
  }
  err(c, error) { try { c.send({ t: 'error', error }); } catch (e) { /* closed */ } }

  /* ---- incoming ---- */
  connect(id, send) { this.conns.set(id, { send, token: null }); }
  disconnect(id) {
    const c = this.conns.get(id); this.conns.delete(id);
    if (!c || !c.token) return;
    if (this.s.phase === 'lobby') {
      // leaving the lobby frees the seat unless you were host with others waiting
      const i = this.seatOfToken(c.token);
      if (i >= 0 && !this.isConnected(c.token)) this.s.humans.splice(i, 1);
      if (!this.s.humans.length) this.s.lobbyEndsAt = null, this.clearTimer('lobbyStart');
    } else if (this.s.game && !this.s.game.over) {
      const seat = this.seatOfToken(c.token);
      if (seat >= 0 && !this.isConnected(c.token)) this.s.game.players[seat].connected = false;
      this.schedule();
    }
    this.addTimer('expire', IDLE_EXPIRE_MS);
    this.broadcast();
  }
  message(id, msg) {
    const c = this.conns.get(id); if (!c || !msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'join': return this.join(id, c, msg);
      case 'ping': return c.send({ t: 'pong' });
    }
    if (!c.token || this.seatOfToken(c.token) < 0) return this.err(c, 'Join the table first');
    const seat = this.seatOfToken(c.token);
    switch (msg.t) {
      case 'diff': if (this.s.phase === 'lobby' && c.token === this.hostToken() && DIFFS[msg.diff]) { this.s.diff = msg.diff; this.broadcast(); } return;
      case 'start': if (c.token !== this.hostToken()) return this.err(c, 'Only the host can start'); if (this.s.phase === 'lobby') this.startGame(); return;
      case 'again': if (c.token !== this.hostToken()) return this.err(c, 'Only the host can start'); if (this.s.phase === 'over') this.startGame(); return;
      case 'take': return this.humanMove(c, seat, () => doTake(this.s.game, seat, msg.src === 'pile' ? 'pile' : Number.isInteger(msg.src) ? (msg.src + seat) % 4 : -1));
      case 'discard': return this.humanMove(c, seat, () => doDiscard(this.s.game, seat, msg.id));
    }
  }
  join(id, c, msg) {
    const token = String(msg.token ?? '').slice(0, 64);
    if (token.length < 8) return this.err(c, 'Bad token');
    let seat = this.seatOfToken(token);
    if (seat < 0) {
      if (this.s.phase !== 'lobby') return this.err(c, 'That game already started. Ask the host to start a new one.');
      if (this.s.humans.length >= MAX_HUMANS) return this.err(c, 'This table is full');
      this.s.humans.push({ token, name: cleanName(msg.name) });
      seat = this.s.humans.length - 1;
      if (this.s.humans.length === 1) { this.s.lobbyEndsAt = this.now() + LOBBY_MS; this.addTimer('lobbyStart', LOBBY_MS); }
    } else if (msg.name) this.s.humans[seat].name = cleanName(msg.name);
    c.token = token;
    if (this.s.game && !this.s.game.over) { this.s.game.players[seat].connected = true; this.schedule(); }
    this.clearTimer('expire');
    this.broadcast();
  }
  humanMove(c, seat, fn) {
    if (this.s.phase !== 'playing') return this.err(c, 'No game in progress');
    const r = fn(); if (!r.ok) return this.err(c, r.error);
    this.afterMove();
  }

  /* ---- game flow ---- */
  startGame() {
    const seats = [];
    this.s.humans.forEach((h) => seats.push({ name: h.name, kind: 'human', connected: this.isConnected(h.token) }));
    for (let i = 0; seats.length < 4; i++) seats.push({ name: NPC_NAMES[i % 3], kind: 'npc' });
    this.s.game = createGame(seats, this.env.rnd);
    this.s.phase = 'playing'; this.s.lobbyEndsAt = null;
    this.clearTimer('lobbyStart');
    this.schedule(); this.broadcast();
  }
  afterMove() {
    const g = this.s.game;
    if (g.over) { this.s.phase = 'over'; this.clearTimer('npc'); this.clearTimer('humanTimeout'); this.addTimer('expire', IDLE_EXPIRE_MS); }
    else this.schedule();
    this.broadcast();
  }
  /** Decide who acts next and set the matching timer. */
  schedule() {
    const g = this.s.game; if (!g || g.over) return;
    const seat = g.turn, p = g.players[seat];
    this.clearTimer('npc');
    const humanActive = p.kind === 'human' && this.humanSeatPresent(seat);
    if (humanActive) {
      // one 45s clock per turn (draw and discard share it)
      const key = `${g.round}.${seat}`;
      if (this.s.turnKey !== key || !this.s.timers.some((t) => t.kind === 'humanTimeout')) { this.s.turnKey = key; this.addTimer('humanTimeout', TURN_MS); }
    } else {
      this.clearTimer('humanTimeout'); this.s.turnKey = null;
      this.addTimer('npc', g.phase === 'draw' ? this.rnd(900, 1500) : this.rnd(800, 1300));
    }
  }
  /** Called when the alarm fires. */
  alarm() {
    const now = this.now();
    const due = this.s.timers.filter((t) => t.at <= now);
    this.s.timers = this.s.timers.filter((t) => t.at > now);
    for (const t of due) this.runTimer(t.kind);
    return this.nextAlarm();
  }
  runTimer(kind) {
    const g = this.s.game;
    if (kind === 'expire') { this.s = { phase: 'lobby', humans: [], diff: 'standard', lobbyEndsAt: null, game: null, timers: [], expired: true }; return; }
    if (kind === 'lobbyStart') { if (this.s.phase === 'lobby' && this.s.humans.length) this.startGame(); return; }
    if (!g || g.over) return;
    const seat = g.turn;
    if (kind === 'npc') {
      // one half-move at a time so the table can show the draw before the discard
      if (g.phase === 'draw') {
        const r = autoPlayDrawOnly(g, seat, this.s.diff);
        if (r && r.won) return this.afterMove();
      } else autoPlayDiscardOnly(g, seat, this.s.diff);
      return this.afterMove();
    }
    if (kind === 'humanTimeout') {
      // time ran out: play the rest of this turn automatically
      autoPlay(g, seat, 'standard');
      return this.afterMove();
    }
  }
}

// Half-move helpers so NPC turns animate in two steps (draw, then discard).
import { aiChooseSource, pickDiscard } from './rules.js';
function autoPlayDrawOnly(g, seat, diffName) {
  const d = DIFFS[diffName] || DIFFS.standard;
  let src = aiChooseSource(g, seat, d);
  if (Math.random() < d.rand) src = 'pile';
  return doTake(g, seat, src);
}
function autoPlayDiscardOnly(g, seat, diffName) {
  const d = DIFFS[diffName] || DIFFS.standard, p = g.players[seat];
  let pick = pickDiscard(g, p, p.hand, d.noise).card;
  if (Math.random() < d.rand) pick = p.hand[(Math.random() * p.hand.length) | 0];
  return doDiscard(g, seat, pick.id);
}
