import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomLogic, LOBBY_MS, TURN_MS } from '../src/room.js';
import { createGame, doTake, doDiscard, autoPlay, bestSets, canWin, viewFor, scoreGame } from '../src/rules.js';

const mkEnv = () => ({ t: 1_000_000, now() { return this.t; } });
function client(room, env, name) {
  const inbox = [], id = name + Math.random();
  room.connect(id, (m) => inbox.push(m));
  const token = 'tok-' + name + '-12345678';
  return { id, token, inbox, name,
    send: (m) => room.message(id, m),
    join() { this.send({ t: 'join', name, token }); },
    last() { return inbox.at(-1); } };
}
function run(room, env, until, maxSteps = 5000) {
  for (let i = 0; i < maxSteps && !until(); i++) {
    const at = room.nextAlarm(); if (at == null) break;
    env.t = Math.max(env.t, at); room.alarm();
  }
}

test('rules: sets and win detection', () => {
  const c = (...t) => t.map((x, i) => ({ id: i, t: x }));
  assert.equal(bestSets(c(0, 0, 0)).pts, 120);
  assert.equal(bestSets(c(0, 1, 2)).pts, 60);
  assert.equal(bestSets(c(0, 0, 1)).pts, 0);
  assert.ok(canWin(c(0, 0, 0, 3, 4, 5, 21, 22, 23)));
  assert.ok(!canWin(c(0, 0, 0, 3, 4, 5, 21, 22, 22)));
  assert.ok(!canWin(c(0, 0, 0, 3, 4, 5, 21, 22))); // only 8 cards: never a win before the 9th is drawn
});

test('engine: turn rules are enforced', () => {
  const g = createGame([{ name: 'A', kind: 'human' }, { name: 'B', kind: 'npc' }, { name: 'C', kind: 'npc' }, { name: 'D', kind: 'npc' }]);
  assert.equal(g.draw.length, 64);
  g.players.forEach((p) => assert.equal(p.hand.length, 8));
  assert.ok(!doTake(g, 1, 'pile').ok, 'not your turn');
  assert.ok(!doTake(g, 0, 0).ok, 'cannot take own pile');
  assert.ok(!doDiscard(g, 0, g.players[0].hand[0].id).ok, 'must draw first');
  assert.ok(doTake(g, 0, 'pile').ok);
  assert.ok(!doTake(g, 0, 'pile').ok, 'cannot draw twice');
  assert.ok(!doDiscard(g, 0, 99999).ok);
  const id = g.players[0].hand[0].id;
  assert.ok(doDiscard(g, 0, id).ok);
  assert.equal(g.players[0].hand.length, 8);
  assert.equal(g.turn, 1);
  assert.ok(!doTake(g, 2, 0).ok, 'pile empty / wrong seat');
  assert.ok(doTake(g, 1, 0).ok, 'take top of seat 0 discard');
});

test('views hide other hands until the game is over', () => {
  const g = createGame([{ name: 'A', kind: 'human' }, { name: 'B', kind: 'human' }, { name: 'C', kind: 'npc' }, { name: 'D', kind: 'npc' }]);
  const v = viewFor(g, 2);
  assert.equal(v.players[0].name, 'C');
  assert.ok(v.players[0].hand);
  assert.equal(v.players[1].hand, undefined);
  assert.equal(v.turn, 2); // seat 0's turn, seen from seat 2
});

test('full game: one human + 3 computer players, driven by alarms', () => {
  for (let n = 0; n < 5; n++) {
    const env = mkEnv(), room = new RoomLogic(null, env);
    const a = client(room, env, 'Zach'); a.join();
    assert.equal(a.last().t, 'lobby'); assert.ok(a.last().host);
    a.send({ t: 'start' });
    assert.equal(a.last().t, 'state');
    assert.equal(a.last().players.length, 4);
    // the human plays quickly with the same brain, via messages
    let guard = 0;
    run(room, env, () => {
      const st = a.last();
      if (st.over) return true;
      if (st.turn === 0 && guard++ < 4000) {
        if (st.phase === 'draw') a.send({ t: 'take', src: 'pile' });
        else { const hand = st.players[0].hand; a.send({ t: 'discard', id: hand[hand.length - 1].id }); }
      }
      return false;
    });
    const st = a.last();
    assert.ok(st.over, 'game finished');
    assert.equal(st.result.length, 4);
    assert.ok(st.players.every((p) => p.hand), 'all hands revealed at the end');
  }
});

test('timeouts auto-play for an idle human', () => {
  const env = mkEnv(), room = new RoomLogic(null, env);
  const a = client(room, env, 'Idle'); a.join(); a.send({ t: 'start' });
  assert.equal(a.last().turn, 0);
  env.t += TURN_MS + 1; room.alarm();
  assert.notEqual(a.last().turn, 0, 'turn moved on after timeout');
  assert.equal(a.last().players[0].hand.length, 8);
});

test('lobby: 2 humans, lobby timer fills with computers, only host starts, no late joiners', () => {
  const env = mkEnv(), room = new RoomLogic(null, env);
  const a = client(room, env, 'Host'), b = client(room, env, 'Friend'), late = client(room, env, 'Late');
  a.join(); b.join();
  assert.equal(b.last().seats.length, 2); assert.ok(!b.last().host);
  b.send({ t: 'start' }); assert.equal(b.last().t, 'error');
  env.t += LOBBY_MS + 1; room.alarm();
  assert.equal(a.last().t, 'state'); assert.equal(b.last().t, 'state');
  assert.deepEqual(a.last().players.map((p) => p.kind), ['human', 'human', 'npc', 'npc']);
  assert.equal(b.last().players[0].name, 'Friend');
  late.join(); assert.equal(late.last().t, 'error');
});

test('lobby is capped at 4 humans and tokens reconnect to the same seat', () => {
  const env = mkEnv(), room = new RoomLogic(null, env);
  const cs = ['A', 'B', 'C', 'D', 'E'].map((n) => client(room, env, n));
  cs.forEach((c) => c.join());
  assert.equal(cs[4].last().t, 'error');
  cs[0].send({ t: 'start' });
  const g = room.s.game;
  assert.deepEqual(g.players.map((p) => p.kind), ['human', 'human', 'human', 'human']);
  // seat 1 drops and returns on a new connection
  room.disconnect(cs[1].id);
  assert.equal(room.s.game.players[1].connected, false);
  const back = client(room, env, 'B'); back.token = cs[1].token; back.send({ t: 'join', name: 'B', token: cs[1].token });
  assert.equal(back.last().t, 'state'); assert.equal(back.last().you, 1);
});

test('state survives serialize/restore (Durable Object hibernation)', () => {
  const env = mkEnv(), room = new RoomLogic(null, env);
  const a = client(room, env, 'Zach'); a.join(); a.send({ t: 'start' });
  const copy = JSON.parse(JSON.stringify(room.serialize()));
  const room2 = new RoomLogic(copy, env);
  const a2 = client(room2, env, 'Zach'); a2.join();
  assert.equal(a2.last().t, 'state'); assert.equal(a2.last().players[0].hand.length, 8);
  assert.equal(JSON.stringify(a2.last().players[0].hand), JSON.stringify(a.last().players[0].hand));
});

test('host can start a rematch after the game ends', () => {
  const env = mkEnv(), room = new RoomLogic(null, env);
  const a = client(room, env, 'Zach'), b = client(room, env, 'Pal'); a.join(); b.join(); a.send({ t: 'start' });
  // let timeouts and NPCs finish the game
  run(room, env, () => a.last().over);
  assert.ok(a.last().over);
  b.send({ t: 'again' }); assert.equal(b.last().t, 'error');
  a.send({ t: 'again' }); assert.equal(a.last().over, false); assert.equal(a.last().players[0].hand.length, 8);
});

test('portraits: chosen looks reach every seat, bad ones are dropped', () => {
  const env = mkEnv(), room = new RoomLogic(null, env);
  const a = client(room, env, 'Ana'), b = client(room, env, 'Bo');
  a.send({ t: 'join', name: 'Ana', token: a.token, look: '2.3.bun.clip' });
  b.send({ t: 'join', name: 'Bo', token: b.token, look: '<svg onload=x>' });
  let seats = b.last().seats;
  assert.equal(seats[0].look, '2.3.bun.clip');
  assert.equal(seats[1].look, '');
  b.send({ t: 'join', name: 'Bo', token: b.token, look: '0.0.puff.hoops' });
  run(room, env, () => room.s.phase === 'playing');
  const v = b.inbox.filter((m) => m.t === 'state').at(-1);
  assert.equal(v.players[0].look, '0.0.puff.hoops');
  assert.equal(v.players[3].look, '2.3.bun.clip');
  a.send({ t: 'join', name: 'Ana', token: a.token, look: '1.1.short.none' });
  assert.equal(b.inbox.filter((m) => m.t === 'state').at(-1).players[3].look, '1.1.short.none');
});

test('portraits: the new look format syncs and bad values are dropped', () => {
  const env = mkEnv(), room = new RoomLogic(null, env);
  const a = client(room, env, 'Ana'), b = client(room, env, 'Bo');
  const good = 'v2.21.18.locs.full.cateye.bfv.septum.beads.headphones';
  a.send({ t: 'join', name: 'Ana', token: a.token, look: good });
  b.join();
  assert.equal(b.last().seats[0].look, good);
  const bad = [
    'v2.22.0.bob.none.none.-.none.none.none', // skin out of range
    'v2.0.23.bob.none.none.-.none.none.none', // hair out of range
    'v2.0.0.mohawk.none.none.-.none.none.none', // unknown style
    'v2.0.0.bob.none.none.ff.none.none.none', // repeated mark
    'v2.0.0.bob.none.none.x.none.none.none', // unknown mark
    'v2.0.0.bob.none.none.-.none.none', // missing a field
    'v2.0.0.bob.none.none.-.none.none.none.none', // extra field
    'v2.-1.0.bob.none.none.-.none.none.none',
  ];
  for (const look of bad) {
    a.send({ t: 'join', name: 'Ana', token: a.token, look });
    assert.equal(a.last().seats[0].look, '', look);
  }
  a.send({ t: 'join', name: 'Ana', token: a.token, look: 'v2.0.0.bald.none.none.-.none.none.none' });
  assert.equal(a.last().seats[0].look, 'v2.0.0.bald.none.none.-.none.none.none');
});

test('portraits: the game and the server agree on every option', async () => {
  const { readFileSync } = await import('node:fs');
  const { LOOK_OPTS } = await import('../src/looks.js');
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.deepEqual(JSON.parse(html.match(/const LOOK_OPTS=(\{.*?\});/)[1]), LOOK_OPTS);
});
