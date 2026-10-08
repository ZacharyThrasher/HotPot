// Hotpot rules, scoring, computer-player brain and a pure game engine.
// Shared by the Cloudflare Worker (server authoritative) and the Node tests.
// Cards are {id, t}: t = category*3 + ingredient (0..23). 4 copies each = 96 cards.

export const CATS = [
  { key: 'veg', name: 'Vegetables', col: 'Yellow', ings: ['Corn', 'Carrot', 'Potato'] },
  { key: 'sea', name: 'Seafood', col: 'Blue', ings: ['Crab', 'Fish', 'Shrimp'] },
  { key: 'grn', name: 'Greens', col: 'Green', ings: ['Napa Cabbage', 'Green Onion', 'Bok Choy'] },
  { key: 'carb', name: 'Carbs', col: 'Grey', ings: ['Tofu', 'Dumpling', 'Rice Cake'] },
  { key: 'nood', name: 'Noodles', col: 'Brown', ings: ['Udon', 'Glass', 'Ramen'] },
  { key: 'mush', name: 'Mushrooms', col: 'Purple', ings: ['Morel', 'Brightshroom', 'Enoki'] },
  { key: 'spice', name: 'Spices', col: 'Orange', ings: ['Heatroot', 'Dari Clove', 'Garlic'] },
  { key: 'meat', name: 'Meat', col: 'Red', ings: ['Steak', 'Diced', 'Rolled'] },
];
export const catOf = (t) => (t / 3) | 0;
export const nameOf = (t) => CATS[catOf(t)].ings[t % 3];
export const TRIPLE_PTS = 120, CATEGORY_PTS = 60, WIN_BONUS = 100;
export const DIFFS = {
  cozy: { thr: 3.4, noise: 3.0, rand: 0.18 },
  standard: { thr: 1.6, noise: 0.7, rand: 0 },
  sharp: { thr: 0.7, noise: 0.05, rand: 0 },
};

/* ---------- sets ---------- */
export function bestSets(cards) {
  const a = [...cards].sort((x, y) => x.t - y.t);
  let best = { pts: -1, sets: [], left: [] };
  (function rec(rest, sets, left, pts) {
    if (!rest.length) {
      if (pts > best.pts || (pts === best.pts && left.length < best.left.length)) best = { pts, sets: sets.slice(), left: left.slice() };
      return;
    }
    const f = rest[0], tail = rest.slice(1);
    const same = tail.filter((c) => c.t === f.t);
    if (same.length >= 2) {
      const [p, q] = same;
      rec(tail.filter((c) => c !== p && c !== q), [...sets, { kind: 'triple', cards: [f, p, q] }], left, pts + TRIPLE_PTS);
    }
    const b = catOf(f.t) * 3, o = [b, b + 1, b + 2].filter((t) => t !== f.t);
    const p = tail.find((c) => c.t === o[0]), q = tail.find((c) => c.t === o[1]);
    if (p && q) rec(tail.filter((c) => c !== p && c !== q), [...sets, { kind: 'category', cards: [f, p, q] }], left, pts + CATEGORY_PTS);
    rec(tail, sets, [...left, f], pts);
  })(a, [], [], 0);
  return best;
}
export const canWin = (cards) => cards.length === 9 && bestSets(cards).sets.length === 3;

/* ---------- computer opponent ---------- */
export function evalC(c, seen, memo) {
  const key = c.join('');
  if (memo.has(key)) return memo.get(key);
  let i = 0;
  while (i < 24 && c[i] === 0) i++;
  if (i === 24) return 0;
  const b = i - (i % 3);
  c[i]--; let best = evalC(c, seen, memo); c[i]++;
  if (c[i] >= 3) { c[i] -= 3; best = Math.max(best, 10 + evalC(c, seen, memo)); c[i] += 3; }
  if (c[i] >= 2) { c[i] -= 2; const outs = Math.max(0, 4 - seen[i]); best = Math.max(best, 4.2 * Math.min(1, outs / 2) + evalC(c, seen, memo)); c[i] += 2; }
  const o = [b, b + 1, b + 2].filter((t) => t !== i);
  if (c[o[0]] && c[o[1]]) { c[i]--; c[o[0]]--; c[o[1]]--; best = Math.max(best, 10 + evalC(c, seen, memo)); c[i]++; c[o[0]]++; c[o[1]]++; }
  for (let k = 0; k < 2; k++) {
    const x = o[k], third = o[1 - k];
    if (c[x]) { const outs = Math.max(0, 4 - seen[third]); c[i]--; c[x]--; best = Math.max(best, 3.6 * Math.min(1, outs / 3) + evalC(c, seen, memo)); c[i]++; c[x]++; }
  }
  memo.set(key, best);
  return best;
}
export const counts = (h) => { const c = new Array(24).fill(0); h.forEach((x) => c[x.t]++); return c; };
export function seenFor(g, p) { const s = counts(p.hand); g.players.forEach((q) => q.discards.forEach((x) => s[x.t]++)); return s; }
export function pickDiscard(g, p, hand, noise) {
  const seen = seenFor(g, p), c = counts(hand);
  let best = -1e9, bt = -1;
  for (let t = 0; t < 24; t++) {
    if (!c[t]) continue;
    c[t]--; const v = evalC(c, seen, new Map()) + (Math.random() - 0.5) * noise; c[t]++;
    if (v > best) { best = v; bt = t; }
  }
  return { card: [...hand].reverse().find((x) => x.t === bt), val: best };
}
export function aiChooseSource(g, seat, d) {
  const p = g.players[seat], seen = seenFor(g, p);
  const cur = evalC(counts(p.hand), seen, new Map());
  let src = 'pile', gain = d.thr;
  for (let s = 0; s < g.players.length; s++) {
    if (s === seat || !g.players[s].discards.length) continue;
    const card = g.players[s].discards.at(-1), h9 = [...p.hand, card];
    if (canWin(h9)) return s;
    const gn = pickDiscard(g, p, h9, d.noise).val - cur;
    if (gn > gain) { gain = gn; src = s; }
  }
  return src;
}

/* ---------- engine (pure state transitions) ---------- */
export function newDeck(rng = Math.random) {
  const d = []; let id = 0;
  for (let t = 0; t < 24; t++) for (let k = 0; k < 4; k++) d.push({ id: id++, t });
  for (let i = d.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}
/** seats: [{name, kind:'human'|'npc'}] (exactly 4). Seat 0 moves first; play goes seat 0,1,2,3. */
export function createGame(seats, rng = Math.random) {
  const draw = newDeck(rng);
  const players = seats.map((s) => ({ ...s, hand: [], discards: [] }));
  for (let r = 0; r < 8; r++) players.forEach((p) => p.hand.push(draw.pop()));
  return { players, draw, turn: 0, round: 1, phase: 'draw', drawn: null, over: false, winner: null, log: [] };
}
const who = (g, s) => g.players[s].name;
export function doTake(g, seat, src) {
  if (g.over) return { ok: false, error: 'Game is over' };
  if (seat !== g.turn) return { ok: false, error: 'Not your turn' };
  if (g.phase !== 'draw') return { ok: false, error: 'You already drew' };
  const p = g.players[seat]; let card;
  if (src === 'pile') {
    if (!g.draw.length) return { ok: false, error: 'The pot is empty' };
    card = g.draw.pop();
    g.log.unshift(`${who(g, seat)} drew from the pot`);
  } else {
    if (!Number.isInteger(src) || src < 0 || src >= g.players.length || src === seat) return { ok: false, error: 'Cannot take that pile' };
    if (!g.players[src].discards.length) return { ok: false, error: 'That pile is empty' };
    card = g.players[src].discards.pop();
    g.log.unshift(`${who(g, seat)} took ${nameOf(card.t)} from ${who(g, src)}`);
  }
  p.hand.push(card); g.drawn = card; g.phase = 'discard'; g.log.length = Math.min(g.log.length, 3);
  if (canWin(p.hand)) { g.over = true; g.winner = seat; g.log.unshift(`${who(g, seat)} completed three sets`); }
  return { ok: true, card, won: g.over };
}
export function doDiscard(g, seat, cardId) {
  if (g.over) return { ok: false, error: 'Game is over' };
  if (seat !== g.turn) return { ok: false, error: 'Not your turn' };
  if (g.phase !== 'discard') return { ok: false, error: 'Draw first' };
  const p = g.players[seat], i = p.hand.findIndex((c) => c.id === cardId);
  if (i < 0) return { ok: false, error: 'You do not hold that card' };
  const [card] = p.hand.splice(i, 1); p.discards.push(card);
  g.log.unshift(`${who(g, seat)} discarded ${nameOf(card.t)}`); g.log.length = Math.min(g.log.length, 3);
  g.drawn = null;
  if (!g.draw.length) { g.over = true; g.winner = null; return { ok: true, card, ended: 'dry' }; }
  g.turn = (g.turn + 1) % g.players.length; if (g.turn === 0) g.round++;
  g.phase = 'draw';
  return { ok: true, card };
}
export function scoreGame(g) {
  return g.players.map((p, i) => {
    const bs = bestSets(p.hand), bonus = g.winner === i ? WIN_BONUS : 0;
    return { seat: i, name: p.name, sets: bs.sets.map((s) => ({ kind: s.kind, cards: s.cards })), left: bs.left, pts: bs.pts, bonus, total: bs.pts + bonus };
  });
}
/** Automatic move for a computer (or timed-out / absent) player. Mutates g. */
export function autoPlay(g, seat, diffName = 'standard') {
  const d = DIFFS[diffName] || DIFFS.standard;
  const p = g.players[seat];
  if (g.phase === 'draw') {
    let src = aiChooseSource(g, seat, d);
    if (Math.random() < d.rand) src = 'pile';
    const r = doTake(g, seat, src); if (!r.ok || r.won) return r;
  }
  let pick = pickDiscard(g, p, p.hand, d.noise).card;
  if (Math.random() < d.rand) pick = p.hand[(Math.random() * p.hand.length) | 0];
  return doDiscard(g, seat, pick.id);
}
/** What one seat may see. Seats are rotated so the viewer is always index 0 (bottom of the table). */
export function viewFor(g, mySeat) {
  const n = g.players.length, rel = (s) => (s - mySeat + n) % n;
  const players = Array.from({ length: n }, (_, i) => {
    const p = g.players[(mySeat + i) % n];
    return { name: p.name, kind: p.kind, connected: p.connected !== false, handCount: p.hand.length, discards: p.discards, hand: i === 0 || g.over ? p.hand : undefined };
  });
  return { players, turn: rel(g.turn), round: g.round, phase: g.phase, drawCount: g.draw.length, drawnId: g.turn === mySeat && g.phase === 'discard' ? g.drawn?.id ?? null : null, over: g.over, winner: g.winner == null ? null : rel(g.winner), log: g.log.slice(0, 3), result: g.over ? scoreGame(g).map((r) => ({ ...r, seat: rel(r.seat) })) : null };
}
