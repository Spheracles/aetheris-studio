/* 陸軍棋：孫武 vs 拿破崙｜PCDA 2.0 心智模型對弈
 * Engine (board, rules, hidden-information beliefs), two persona AIs and the game window.
 * The AIs translate each Skill's value order, five mental models and If-Then heuristics
 * into move-scoring weights. They are rule-based simulations, not the historical people. */
(function (root) {
'use strict';

/* ------------------------------------------------------------------ board */
const W = 5, H = 12, N = W * H;
const id = (x, y) => y * W + x, X = i => i % W, Y = i => (i / W) | 0;
const isCampXY = (x, y) => ((y === 2 || y === 4 || y === 7 || y === 9) && (x === 1 || x === 3)) || ((y === 3 || y === 8) && x === 2);
const isHQXY = (x, y) => (y === 0 || y === 11) && (x === 1 || x === 3);
const CAMP = [], HQ = [];
for (let i = 0; i < N; i++) { CAMP[i] = isCampXY(X(i), Y(i)); HQ[i] = isHQXY(X(i), Y(i)); }
const halfOf = y => (y >= 6 ? 0 : 1); // 0 = 孫武 (bottom, red), 1 = 拿破崙 (top, blue)

const ROAD = Array.from({ length: N }, () => new Set());
const link = (a, b) => { ROAD[a].add(b); ROAD[b].add(a); };
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = id(x, y);
  if (x + 1 < W) link(i, id(x + 1, y));
  if (y + 1 < H && (y !== 5 || x % 2 === 0)) link(i, id(x, y + 1));   // front lines meet only at columns 1, 3, 5
  if (isCampXY(x, y)) for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && nx < W && ny >= 0 && ny < H && halfOf(ny) === halfOf(y)) link(i, id(nx, ny));
  }
}
const RAIL = new Set(), rk = (a, b) => (a < b ? a + '-' + b : b + '-' + a);
for (const y of [1, 5, 6, 10]) for (let x = 0; x < 4; x++) RAIL.add(rk(id(x, y), id(x + 1, y)));
for (const x of [0, 4]) for (let y = 1; y < 10; y++) RAIL.add(rk(id(x, y), id(x, y + 1)));
RAIL.add(rk(id(2, 5), id(2, 6)));
const RN = Array.from({ length: N }, () => []);
for (const k of RAIL) { const [a, b] = k.split('-').map(Number); RN[a].push(b); RN[b].push(a); }
const ROADS = []; // for drawing
for (let a = 0; a < N; a++) for (const b of ROAD[a]) if (a < b) ROADS.push([a, b, RAIL.has(rk(a, b))]);

/* ------------------------------------------------------------------ pieces */
const TYPES = {
  SL: { n: '司令', r: 9, c: 1, v: 100 }, JZ: { n: '軍長', r: 8, c: 1, v: 80 }, SZ: { n: '師長', r: 7, c: 2, v: 60 },
  LZ: { n: '旅長', r: 6, c: 2, v: 45 }, TZ: { n: '團長', r: 5, c: 2, v: 34 }, YZ: { n: '營長', r: 4, c: 2, v: 26 },
  LC: { n: '連長', r: 3, c: 3, v: 18 }, PZ: { n: '排長', r: 2, c: 3, v: 12 }, GB: { n: '工兵', r: 1, c: 3, v: 16 },
  DL: { n: '地雷', r: 0, c: 3, v: 22 }, ZD: { n: '炸彈', r: 0, c: 2, v: 46 }, JQ: { n: '軍旗', r: 0, c: 1, v: 1000 },
};
const TK = Object.keys(TYPES), TI = {}; TK.forEach((k, j) => (TI[k] = j));
const BIT = k => 1 << TI[k], ALL = (1 << TK.length) - 1;
const IMMOBILE = BIT('DL') | BIT('JQ');

// outcome from the attacker's side: A attacker wins, D defender wins, B both removed, F flag taken
function resolve(a, d) {
  if (d === 'JQ') return 'F';
  if (a === 'ZD' || d === 'ZD') return 'B';
  if (d === 'DL') return a === 'GB' ? 'A' : 'D';
  const ra = TYPES[a].r, rd = TYPES[d].r;
  return ra > rd ? 'A' : ra < rd ? 'D' : 'B';
}

// rank b counted from the owner's back row (0) to its front row (5)
const toIdx = (side, x, b) => id(x, side === 0 ? 11 - b : b);
const advance = (side, i) => (side === 0 ? 11 - Y(i) : Y(i)); // 0..11 toward the enemy

/* ------------------------------------------------------------------ rng */
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

/* ------------------------------------------------------------------ deployment */
const SLOTS = []; // legal starting squares in (x,b)
for (let b = 0; b < 6; b++) for (let x = 0; x < 5; x++) if (!isCampXY(x, 11 - b)) SLOTS.push([x, b]);

function legalSlot(t, x, b) {
  if (t === 'JQ') return b === 0 && (x === 1 || x === 3);
  if (t === 'DL') return b <= 1;
  if (t === 'ZD') return b !== 5;
  return true;
}

function deploy(side, persona, rand) {
  const plan = persona.deploy(rand);
  const pool = []; TK.forEach(k => { for (let n = 0; n < TYPES[k].c; n++) pool.push(k); });
  const used = new Map();
  for (const [t, x, b] of plan) {
    const key = x + ',' + b;
    if (used.has(key) || !legalSlot(t, x, b) || isCampXY(x, 11 - b)) continue;
    const pi = pool.indexOf(t); if (pi < 0) continue;
    pool.splice(pi, 1); used.set(key, t);
  }
  // place the rest, most constrained first
  const order = ['JQ', 'DL', 'ZD'];
  pool.sort((a, b) => (order.indexOf(b) - order.indexOf(a)));
  const free = () => SLOTS.filter(([x, b]) => !used.has(x + ',' + b));
  for (const t of pool) {
    let opts = free().filter(([x, b]) => legalSlot(t, x, b));
    if (!opts.length) opts = free();
    const [x, b] = opts[(rand() * opts.length) | 0];
    used.set(x + ',' + b, t);
  }
  const out = [];
  for (const [key, t] of used) { const [x, b] = key.split(',').map(Number); out.push({ t, i: toIdx(side, x, b), b }); }
  return out;
}

/* ------------------------------------------------------------------ state */
function newGame(personas, seed) {
  const rand = rng(seed || (Date.now() & 0xffffffff));
  const st = { board: new Array(N).fill(null), pieces: [], turn: 0, ply: 0, quiet: 0, over: false, winner: -1, reason: '',
    flagShown: [false, false], belief: [new Map(), new Map()], last: [], rand, personas, history: [] };
  for (const side of [0, 1]) {
    for (const d of deploy(side, personas[side], rand)) {
      const p = { id: st.pieces.length, s: side, t: d.t, i: d.i, moved: false, alive: true };
      st.pieces.push(p); st.board[d.i] = p;
    }
  }
  // what each side may assume about the other side's hidden pieces
  for (const p of st.pieces) {
    const x = X(p.i), b = p.s === 0 ? 11 - Y(p.i) : Y(p.i);
    let m = ALL;
    if (b >= 2) m &= ~BIT('DL');
    if (b === 5) m &= ~BIT('ZD');
    if (!HQ[p.i]) m &= ~BIT('JQ');
    st.belief[1 - p.s].set(p.id, m);
  }
  personas.forEach(ps => ps.init && ps.init(st, rand));
  return st;
}

/* ------------------------------------------------------------------ moves */
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
function railStep(c, dx, dy) {
  const x = X(c) + dx, y = Y(c) + dy;
  if (x < 0 || x >= W || y < 0 || y >= H) return -1;
  const n = id(x, y); return RAIL.has(rk(c, n)) ? n : -1;
}
// engineer: true for real engineers; pseudo moves for unknown enemy pieces use straight rails only
function movesFrom(st, i, side, engineer) {
  const out = new Map();
  const add = (j, rail) => {
    const q = st.board[j];
    if (!q) { if (!out.has(j)) out.set(j, { from: i, to: j, rail, attack: false }); return true; }
    if (q.s !== side && !CAMP[j]) out.set(j, { from: i, to: j, rail, attack: true });
    return false;
  };
  for (const j of ROAD[i]) add(j, false);
  if (RN[i].length) {
    if (engineer) {
      const seen = new Set([i]), q = [i];
      while (q.length) {
        const c = q.shift();
        for (const n of RN[c]) {
          if (seen.has(n)) continue; seen.add(n);
          if (add(n, true)) q.push(n);
        }
      }
    } else {
      for (const [dx, dy] of DIRS) {
        let c = i;
        for (;;) { const n = railStep(c, dx, dy); if (n < 0) break; if (!add(n, true)) break; c = n; }
      }
    }
  }
  return [...out.values()];
}
function legalMoves(st, side) {
  const res = [];
  for (const p of st.pieces) {
    if (!p.alive || p.s !== side || p.t === 'DL' || p.t === 'JQ' || HQ[p.i]) continue;
    for (const m of movesFrom(st, p.i, side, p.t === 'GB')) { m.pid = p.id; res.push(m); }
  }
  return res;
}

/* ------------------------------------------------------------------ play a move */
function play(st, m, note) {
  const p = st.pieces[m.pid], d = st.board[m.to];
  const ev = { ply: st.ply + 1, side: p.s, pid: p.id, t: p.t, from: m.from, to: m.to, rail: m.rail, note: note || null };
  if (!p.moved) { p.moved = true; st.belief[1 - p.s].set(p.id, st.belief[1 - p.s].get(p.id) & ~IMMOBILE); }
  st.board[m.from] = null;
  if (!d) { st.board[m.to] = p; p.i = m.to; st.quiet++; }
  else {
    const o = resolve(p.t, d.t);
    ev.def = { pid: d.id, t: d.t }; ev.outcome = o; st.quiet = 0;
    // both sides learn the outcome: narrow each side's belief about the other piece
    const ba = st.belief[p.s], bd = st.belief[d.s];
    let ma = ba.get(d.id), md = bd.get(p.id);
    let na = 0, nd = 0;
    TK.forEach((u, j) => { if ((ma >> j) & 1 && resolve(p.t, u) === o) na |= 1 << j; if ((md >> j) & 1 && resolve(u, d.t) === o) nd |= 1 << j; });
    ba.set(d.id, na || ma); bd.set(p.id, nd || md);
    const kill = q => { q.alive = false; q.i = -1; if (q.t === 'SL') revealFlag(st, q.s); };
    if (o === 'F') { kill(d); st.board[m.to] = p; p.i = m.to; st.over = true; st.winner = p.s; st.reason = '奪得軍旗'; }
    else if (o === 'A') { kill(d); st.board[m.to] = p; p.i = m.to; }
    else if (o === 'D') { kill(p); }
    else { kill(d); kill(p); st.board[m.to] = null; }
  }
  st.ply++; st.turn = 1 - st.turn;
  st.last[p.id] = { from: m.from, to: m.to, ply: st.ply };
  st.history.push(ev);
  if (!st.over) {
    if (!legalMoves(st, st.turn).length) { st.over = true; st.winner = 1 - st.turn; st.reason = '對手已無子可動'; }
    else if (st.ply >= 400 || st.quiet >= 90) { st.over = true; st.winner = -1; st.reason = st.ply >= 400 ? '達到 400 手上限' : '連續 90 手沒有交鋒'; }
  }
  return ev;
}
function revealFlag(st, side) {
  if (st.flagShown[side]) return;
  st.flagShown[side] = true;
  const flag = st.pieces.find(q => q.s === side && q.t === 'JQ');
  for (const q of st.pieces) if (q.s === side && q.alive && HQ[q.i]) {
    const b = st.belief[1 - side]; b.set(q.id, q === flag ? BIT('JQ') : b.get(q.id) & ~BIT('JQ'));
  }
}

/* ------------------------------------------------------------------ beliefs → probabilities */
// iterative proportional fitting: each hidden piece's type distribution, consistent with the army's totals
function distributions(st, side) {
  const enemy = st.pieces.filter(p => p.s !== side), bel = st.belief[side];
  const w = TK.map(k => TYPES[k].c), cnt = w.slice();
  let rows = [];
  for (let it = 0; it < 8; it++) {
    const E = new Array(TK.length).fill(0);
    rows = enemy.map(p => {
      const m = bel.get(p.id); let s = 0;
      const r = TK.map((k, j) => { const v = (m >> j) & 1 ? w[j] : 0; s += v; return v; });
      return r.map(v => (s ? v / s : 0));
    });
    rows.forEach(r => r.forEach((v, j) => (E[j] += v)));
    for (let j = 0; j < w.length; j++) if (E[j] > 1e-9) w[j] *= cnt[j] / E[j];
  }
  const D = new Map(); enemy.forEach((p, k) => D.set(p.id, rows[k]));
  return D;
}

/* ------------------------------------------------------------------ shared evaluation helpers */
const val = k => TYPES[k].v;
function beatChance(P, t) { // chance an enemy piece with distribution P removes my piece of type t when it attacks
  let s = 0;
  TK.forEach((u, j) => { if (!P[j] || u === 'DL' || u === 'JQ') return; const o = resolve(u, t); if (o === 'A') s += P[j]; else if (o === 'B') s += P[j] * 0.55; });
  return s;
}
function reachMap(st, side, D) { // squares the enemy could reach next turn (pseudo moves, types unknown)
  const reach = Array.from({ length: N }, () => []);
  for (const e of st.pieces) {
    if (!e.alive || e.s === side || HQ[e.i]) continue;
    const P = D.get(e.id); if ((P[TI.DL] + P[TI.JQ]) > 0.995) continue;
    const eng = P[TI.GB] > 0.5;
    for (const m of movesFrom(st, e.i, e.s, eng)) reach[m.to].push(e.id);
  }
  return reach;
}
function danger(st, D, reach, sq, t) {
  if (CAMP[sq]) return 0;
  let worst = 0;
  for (const eid of reach[sq]) worst = Math.max(worst, beatChance(D.get(eid), t));
  return worst;
}
function flagThreat(st, side, D, board) { // can any enemy piece attack my flag square next turn?
  const flag = st.pieces.find(p => p.s === side && p.t === 'JQ' && p.alive);
  if (!flag) return 0;
  const save = st.board; st.board = board;
  let threat = 0;
  for (const e of st.pieces) {
    if (!e.alive || e.s === side || HQ[e.i] || board[e.i] !== e) continue;
    const P = D.get(e.id); const mob = 1 - P[TI.DL] - P[TI.JQ]; if (mob < 0.02) continue;
    if (movesFrom(st, e.i, e.s, P[TI.GB] > 0.3).some(m => m.to === flag.i)) threat = Math.max(threat, mob);
  }
  st.board = save;
  return threat;
}
function enemyFlagGuess(st, side, D) {
  const out = [];
  for (const e of st.pieces) if (e.alive && e.s !== side && HQ[e.i]) out.push({ i: e.i, p: D.get(e.id)[TI.JQ] });
  return out;
}
const manhattan = (a, b) => Math.abs(X(a) - X(b)) + Math.abs(Y(a) - Y(b));

/* ------------------------------------------------------------------ persona AI */
function think(st, side) {
  const ps = st.personas[side], K = ps.k, rand = st.rand;
  const D = distributions(st, side), reach = reachMap(st, side, D);
  const moves = legalMoves(st, side);
  const flags = enemyFlagGuess(st, side, D);
  const myFlag = st.pieces.find(p => p.s === side && p.t === 'JQ');
  const enemyNear = st.pieces.some(e => e.alive && e.s !== side && advance(1 - side, e.i) >= 9);
  const scored = [];
  for (const m of moves) {
    const p = st.pieces[m.pid], t = p.t;
    const f = { cat: 'advance', win: 0, tie: 0, lose: 0, guess: null };
    let s = 0;
    // positional intent
    const dAdv = advance(side, m.to) - advance(side, m.from);
    s += dAdv * ps.advW(t, st) ;
    s += ps.place ? ps.place(st, p, m, f) : 0;
    if (CAMP[m.to] && !CAMP[m.from]) { s += K.camp; f.cat = 'camp'; }
    if (m.rail && Math.abs(X(m.to) - X(m.from)) + Math.abs(Y(m.to) - Y(m.from)) >= 3) { s += K.rail; if (f.cat === 'advance') f.cat = 'rail'; }
    // escape: piece currently threatened
    const dNow = danger(st, D, reach, m.from, t);
    if (dNow > 0.25) { s += dNow * val(t) * K.loss * 0.8; if (dAdv <= 0 && !m.attack && danger(st, D, reach, m.to, t) < dNow * 0.5) f.cat = 'escape'; }
    // flag hunting
    for (const g of flags) if (g.p > 0.05 && (advance(side, m.to) >= 6 || t === 'GB')) s += (manhattan(m.from, g.i) - manhattan(m.to, g.i)) * g.p * K.hunt;
    // guarding home when the enemy is close
    if (enemyNear && myFlag && myFlag.alive && t !== 'GB' && manhattan(m.from, myFlag.i) <= 2 && manhattan(m.to, myFlag.i) > 2) { s -= K.guard; }
    if (enemyNear && myFlag && myFlag.alive && manhattan(m.to, myFlag.i) < manhattan(m.from, myFlag.i) && TYPES[t].r >= 4) { s += K.guard * 0.4; if (f.cat === 'advance') f.cat = 'guard'; }
    // no shuffling back and forth
    const lm = st.last[p.id]; if (lm && lm.from === m.to && st.ply - lm.ply < 6) s -= 9;
    if (m.attack) {
      const d = st.board[m.to], P = D.get(d.id);
      let ev = 0, unc = 1 - Math.max(...P);
      TK.forEach((u, j) => {
        const pr = P[j]; if (!pr) return;
        const o = resolve(t, u);
        if (o === 'F') ev += pr * 6000;
        else if (o === 'A') { ev += pr * (val(u) - danger(st, D, reach, m.to, t) * val(t) * K.loss * K.risk); f.win += pr; }
        else if (o === 'D') { ev -= pr * val(t) * K.loss; f.lose += pr; }
        else { ev += pr * (val(u) - val(t) * K.loss); f.tie += pr; }
      });
      if (t === 'ZD') { const big = P[TI.SL] + P[TI.JZ] + P[TI.SZ]; if (big < K.bombGate) ev -= 70; }
      const cheap = val(t) <= 18;
      ev += unc * K.info * (cheap ? 1 : 0.25);
      s += ev;
      f.guess = TK.map((u, j) => [u, P[j]]).filter(a => a[1] > 0.01).sort((a, b) => b[1] - a[1]).slice(0, 2);
      if (P[TI.JQ] > 0.6) f.cat = 'flag';
      else if (t === 'ZD') f.cat = 'bomb';
      else if (t === 'GB' && P[TI.DL] > 0.3) f.cat = 'sap';
      else if (cheap && unc > 0.45) f.cat = 'probe';
      else f.cat = 'strike';
    } else {
      s -= danger(st, D, reach, m.to, t) * val(t) * K.loss * K.risk;
    }
    s += (rand() - 0.5) * K.noise;
    scored.push({ m, s, f });
  }
  // flag safety: look one enemy move ahead
  const nowThreat = flagThreat(st, side, D, st.board);
  for (const c of scored) {
    const b = st.board.slice(), p = st.pieces[c.m.pid];
    b[c.m.from] = null;
    if (!c.m.attack || c.f.win + c.f.tie > 0.5) b[c.m.to] = (c.m.attack && c.f.tie > c.f.win) ? null : p;
    const th = flagThreat(st, side, D, b);
    c.s -= th * 3500;
    if (nowThreat > 0.3 && th < nowThreat) { c.s += 400; c.f.cat = 'guard'; }
  }
  scored.sort((a, b) => b.s - a.s);
  const pick = scored[0];
  if (!pick) return null;
  pick.f.cat = ps.recolor ? ps.recolor(st, pick) : pick.f.cat;
  return { move: pick.m, info: pick.f, score: pick.s };
}

/* ------------------------------------------------------------------ the two personas */
const SUN = {
  key: 'sun', name: '孫武', seal: '孫', color: 'red', img: 'media/sunwu.webp',
  // 先為不可勝：三雷護旗、主力居中靠後、工兵在前試探
  deploy(rand) {
    const fx = rand() < 0.5 ? 1 : 3, ox = 4 - fx;
    return [
      ['JQ', fx, 0], ['DL', fx - 1, 0], ['DL', fx + 1, 0], ['DL', fx, 1],
      ['LC', ox, 0],                                   // decoy in the other HQ
      ['SL', 2, 2], ['JZ', ox, 1], ['ZD', fx === 1 ? 0 : 4, 2], ['ZD', 2, 4],
      ['SZ', fx === 1 ? 4 : 0, 3], ['SZ', fx === 1 ? 0 : 4, 4],
      ['GB', 0, 5], ['GB', 4, 5], ['GB', fx, 3],
      ['PZ', 1, 5], ['PZ', 3, 5], ['LC', 2, 5],
    ];
  },
  k: { loss: 1.55, risk: 1.0, info: 16, camp: 7, rail: 1, hunt: 3.2, guard: 9, bombGate: 0.62, noise: 2.5 },
  advW(t, st) { const early = st.ply < 36; const r = TYPES[t].r; return t === 'GB' || r <= 3 ? (early ? 1.4 : 1.6) : (early ? 0.35 : 1.3); },
  models: [['M1', '五事七計'], ['M2', '全勝思維'], ['M3', '先勝後戰'], ['M4', '避實擊虛・奇正'], ['M5', '水無常形']],
  motto: '先算後動，先全後破；守其不可勝，攻其可勝。',
};
const NAP = {
  key: 'nap', name: '拿破崙', seal: '拿', color: 'blue', img: 'media/napoleon.webp',
  init() { this.flank = this._flank; },
  // 中間位置與集中：主力壓在一側鐵路，炸彈隨行，工兵分散開路
  deploy(rand) {
    const F = rand() < 0.5 ? 0 : 4; this._flank = F;
    const fx = F === 0 ? 3 : 1, G = 4 - F;
    return [
      ['JQ', fx, 0], ['DL', fx - 1, 0], ['DL', fx + 1, 0], ['DL', fx, 1],
      ['SL', F, 4], ['JZ', F, 5], ['SZ', F, 3], ['SZ', 2, 5], ['ZD', F, 2], ['ZD', 2, 4],
      ['LZ', F === 0 ? 1 : 3, 5], ['GB', F, 1], ['GB', G, 5], ['GB', 2, 2],
      ['TZ', G, 4], ['LZ', G, 3],
    ];
  },
  k: { loss: 1.0, risk: 0.6, info: 6, camp: 2, rail: 4, hunt: 4.5, guard: 6, bombGate: 0.36, noise: 3.5 },
  advW(t, st) { const r = TYPES[t].r; return r >= 6 ? 3.2 : t === 'ZD' ? 2.2 : t === 'GB' ? 1.8 : 2.0; },
  place(st, p, m, f) { // concentration on the chosen flank
    const F = this.flank ?? this._flank ?? 0;
    const towards = Math.abs(X(m.from) - F) - Math.abs(X(m.to) - F);
    const mine = st.pieces.filter(q => q.alive && q.s === p.s).length;
    let s = towards * (TYPES[p.t].r >= 5 ? 2.4 : 1.2);
    if (mine < 12 && advance(p.s, m.to) > advance(p.s, m.from)) s -= 3; // H06: shorter lines when thin
    return s;
  },
  models: [['M1', '中間位置・分向擊破'], ['M2', '軍團分進合擊'], ['M3', '士氣槓桿'], ['M4', '制度化'], ['M5', '攻勢節奏']],
  motto: '時間、主動權、集中；進取但有界。',
};
SUN.init = function () {};

/* ------------------------------------------------------------------ commentary */
const pick = (arr, r) => arr[(r * arr.length) | 0];
const SUN_TALK = {
  flag: { m: 'M3', t: ['敵旗已在掌中，勝兵先勝而後求戰，此時一擊定局。'], q: '《軍形》「勝兵先勝，而後求戰」', h: 'H1 原典' },
  bomb: { m: 'M2', t: ['以炸彈換其主力，代價小而保全大局，不與之硬拼。', '伐其主將，不攻其城。'], q: '《謀攻》「上兵伐謀」', h: 'H1 原典' },
  probe: { m: 'M1', t: ['以{p}試其虛實，先求知彼，再定攻守。', '小子先行，探其陣勢，損之不痛。'], q: '《謀攻》「知彼知己，百戰不殆」', h: 'H1 原典' },
  strike: { m: 'M4', t: ['算其勝算在我，擊其虛處。', '敵子已露其形，避實而擊之。'], q: '《虛實》「避實而擊虛」', h: 'H1 原典' },
  sap: { m: 'M4', t: ['以工兵排雷，為主力開路，以奇勝之。'], q: '《兵勢》「以正合，以奇勝」', h: 'H1 原典' },
  escape: { m: 'M5', t: ['此子受威脅，避其鋒芒，不以忿戰。', '勢不在我，暫退以存其力。'], q: '《火攻》「主不可以怒而興師」', h: 'H1 原典' },
  camp: { m: 'M3', t: ['入行營固守，先為不可勝。', '據營而守，以待敵之可勝。'], q: '《軍形》「先為不可勝，以待敵之可勝」', h: 'H1 原典' },
  guard: { m: 'M3', t: ['敵近大本營，回防固本，守住不可失的底線。'], q: '《軍形》「不可勝在己，可勝在敵」', h: 'H1 原典' },
  rail: { m: 'M5', t: ['因敵之形，順鐵路轉移兵力。'], q: '《虛實》「兵因敵而制勝」', h: 'H1 原典' },
  advance: { m: 'M5', t: ['因勢調整陣形，不急於決戰。', '緩進穩推，兵無常勢。'], q: '《虛實》「兵無常勢，水無常形」', h: 'H1 原典' },
};
const NAP_TALK = {
  flag: { m: 'M1', t: ['戰略裁決：直取大本營，一擊結束戰役。'] },
  bomb: { m: 'M5', t: ['以炸彈打開缺口，不給對手重整防線的時間。'] },
  probe: { m: 'M5', t: ['先派小部隊偵察，再決定主力的去向。'] },
  strike: { m: 'M1', t: ['在決定性位置集中優勢，擊破孤立之敵。', '對手陣線出現空隙，立刻壓上。'] },
  sap: { m: 'M2', t: ['工兵先行清除障礙，主力隨後會師。'] },
  escape: { m: 'M5', t: ['此子孤立受威脅，撤回保存選擇權。', '戰線過長，先縮短補給線。'] },
  camp: { m: 'M2', t: ['佔住行營作為前進據點，讓各部可互相支援。'] },
  guard: { m: 'M4', t: ['後方出現威脅，回防要點，先穩住補給線。'] },
  rail: { m: 'M5', t: ['沿鐵路急行，搶在對手協同之前到位。', '速度就是主動權，主力換線推進。'] },
  advance: { m: 'M1', t: ['兵力向{f}集中，準備在那裡形成局部優勢。', '持續推進，逼對手被動回應。'] },
  rally: { m: 'M3', t: ['剛失一子，立刻取得一個看得見的小勝，穩住全軍士氣。'] },
};
NAP.recolor = function (st, c) {
  const last = st.history[st.history.length - 1];
  const lostLast = last && last.side !== 1 && last.def && (last.outcome === 'A' || last.outcome === 'B') && st.pieces[last.def.pid].s === 1;
  if (lostLast && c.m.attack && c.f.win > 0.55) return 'rally';
  return c.f.cat;
};
function talk(st, side, info, move) {
  const ps = st.personas[side], T = (ps.key === 'sun' ? SUN_TALK : NAP_TALK)[info.cat] || (ps.key === 'sun' ? SUN_TALK.advance : NAP_TALK.advance);
  const p = st.pieces[move.pid];
  let line = pick(T.t, st.rand()).replace('{p}', TYPES[p.t].n).replace('{f}', NAP.flank === 0 ? '本方右翼' : '本方左翼');
  let calc = '';
  if (move.attack) {
    const pct = v => Math.round(v * 100) + '%';
    calc = `棋局估算｜勝 ${pct(info.win)}・同歸 ${pct(info.tie)}・敗 ${pct(info.lose)}`;
    if (info.guess && info.guess.length) calc += `｜對手可能是 ${info.guess.map(g => TYPES[g[0]].n + ' ' + pct(g[1])).join('、')}`;
  }
  return { model: T.m, line, quote: T.q || null, tag: T.h || 'H4 角色模擬', calc };
}

/* ------------------------------------------------------------------ exports for tests */
const Engine = { W, H, N, id, X, Y, CAMP, HQ, RN, ROADS, RAIL, rk, TYPES, TK, TI, resolve, newGame, legalMoves, play, think, talk, distributions, SUN, NAP };
if (typeof module !== 'undefined' && module.exports) { module.exports = Engine; return; }
root.LZQEngine = Engine;

/* ================================================================== game window */
const doc = root.document;
const CSS = `
.lzq{position:fixed;inset:0;z-index:90;display:grid;grid-template-rows:auto 1fr auto;background:radial-gradient(120% 90% at 50% 0%,#18213f,#070b17 70%);color:var(--text,#eef1fb);font-family:var(--f-body,system-ui);animation:lzqIn .35s ease both}
.lzq[hidden]{display:none}
@keyframes lzqIn{from{opacity:0;transform:scale(.985)}to{opacity:1;transform:none}}
.lzq-top{display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:14px 20px;border-bottom:1px solid var(--line,rgba(188,208,255,.15))}
.lzq-title{min-width:0;flex:1}
.lzq-title span{display:block;font:600 11.5px/1.2 var(--f-tech,sans-serif);letter-spacing:.2em;color:var(--holo,#86d8ff)}
.lzq-title h2{margin:4px 0 0;font:900 22px/1.2 var(--f-display,serif);letter-spacing:.04em}
.lzq-title h2 i{font-style:normal;font-family:var(--f-tech,sans-serif);color:var(--amber,#f3b867);margin:0 6px;font-size:.8em}
.lzq-ctrl{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.lzq-b{height:36px;padding:0 14px;border-radius:999px;border:1px solid var(--line,rgba(188,208,255,.2));background:rgba(255,255,255,.05);color:inherit;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.lzq-b:hover{border-color:var(--amber,#f3b867)}
.lzq-b.pri{background:linear-gradient(180deg,#ffd394,#f3b867);color:#2a1a06;border:0;font-weight:700}
.lzq-b[aria-pressed="true"]{border-color:var(--holo,#86d8ff);color:var(--holo,#86d8ff)}
.lzq-b.pri[aria-pressed="true"]{color:#2a1a06;background:linear-gradient(180deg,#e9f6ff,#86d8ff)}
.lzq-seg{display:inline-flex;border:1px solid var(--line,rgba(188,208,255,.2));border-radius:999px;overflow:hidden}
.lzq-seg button{height:34px;padding:0 11px;border:0;background:transparent;color:var(--muted,#a7b1cc);font-size:12.5px;cursor:pointer}
.lzq-seg button[aria-pressed="true"]{background:rgba(134,216,255,.18);color:#fff}
.lzq-x{width:36px;padding:0;justify-content:center;font-size:18px}
.lzq-main{display:grid;grid-template-columns:minmax(230px,300px) minmax(0,1fr) minmax(230px,300px);gap:16px;padding:14px 20px;min-height:0}
.lzq-side{display:flex;flex-direction:column;gap:10px;min-height:0;overflow:auto;padding:14px;border-radius:18px;background:rgba(10,17,36,.78);border:1px solid var(--line,rgba(188,208,255,.15))}
.lzq-side header{display:flex;gap:12px;align-items:center}
.lzq-side header{align-items:flex-end}
.lzq-face{position:relative;flex:none;width:96px;height:96px;border-radius:18px;overflow:hidden;transition:box-shadow .35s,transform .35s}
.lzq-face img{width:100%;height:100%;object-fit:cover;display:block}
.s0 .lzq-face{box-shadow:0 0 0 2px rgba(255,150,120,.45)}
.s1 .lzq-face{box-shadow:0 0 0 2px rgba(246,217,131,.45)}
.lzq-side.turn .lzq-face{transform:scale(1.04)}
.s0.turn .lzq-face{box-shadow:0 0 0 3px #ff8f73,0 0 26px rgba(255,120,90,.6)}
.s1.turn .lzq-face{box-shadow:0 0 0 3px #f6d983,0 0 26px rgba(246,217,131,.55)}
.lzq-seal{position:absolute;right:4px;bottom:4px;display:grid;place-items:center;width:26px;height:26px;border-radius:7px;font:900 14px/1 var(--f-display,serif)}
.s0 .lzq-seal{background:linear-gradient(160deg,#d24a3c,#8e1f17);color:#ffe9d2;box-shadow:0 0 0 2px rgba(255,190,160,.3)}
.s1 .lzq-seal{background:linear-gradient(160deg,#2f56b0,#152c66);color:#f6d983;box-shadow:0 0 0 2px rgba(246,217,131,.3)}
.lzq-side header b{display:block;font:900 19px/1.2 var(--f-display,serif)}
.lzq-side header small{display:block;font-size:11.5px;color:var(--muted,#a7b1cc)}
.lzq-motto{font:600 13.5px/1.6 var(--f-display,serif);color:#e6dcc8;padding:8px 10px;border-left:2px solid var(--amber,#f3b867);background:rgba(243,184,103,.07);border-radius:0 8px 8px 0}
.lzq-models{display:flex;flex-wrap:wrap;gap:5px}
.lzq-models li{font-size:11.5px;padding:4px 8px;border-radius:999px;border:1px solid var(--line,rgba(188,208,255,.18));color:var(--muted,#a7b1cc);transition:all .3s;list-style:none}
.lzq-models li b{font-family:var(--f-tech,sans-serif);margin-right:4px;color:#cfd6ea}
.lzq-models li.on{border-color:var(--amber,#f3b867);color:#fff;background:rgba(243,184,103,.18);box-shadow:0 0 12px rgba(243,184,103,.3)}
.lzq-think{border-radius:12px;padding:12px;background:rgba(255,255,255,.04);border:1px solid var(--line,rgba(188,208,255,.15));min-height:118px}
.lzq-think .k{font:600 11px/1 var(--f-tech,sans-serif);letter-spacing:.16em;color:var(--holo,#86d8ff)}
.lzq-think .l{margin-top:7px;font-size:14px;line-height:1.6}
.lzq-think .q{margin-top:6px;font:600 13px/1.5 var(--f-display,serif);color:#ffdcab}
.lzq-think .q em,.lzq-think .tag{font:500 10.5px var(--f-tech,sans-serif);font-style:normal;color:#8a95b2;margin-left:6px;letter-spacing:.06em}
.lzq-think .c{margin-top:6px;font-size:12px;color:var(--muted,#a7b1cc);font-variant-numeric:tabular-nums}
.lzq-stat{display:flex;gap:8px}
.lzq-stat div{flex:1;padding:8px;border-radius:10px;background:rgba(255,255,255,.04);text-align:center;font-size:11.5px;color:var(--muted,#a7b1cc)}
.lzq-stat b{display:block;font:700 22px/1.1 var(--f-tech,sans-serif);color:#fff;font-variant-numeric:tabular-nums}
.lzq-tray{display:flex;flex-wrap:wrap;gap:4px;min-height:24px}
.lzq-tray span{font:600 11px/1 var(--f-display,serif);padding:5px 6px;border-radius:5px;opacity:.85}
.s0 .lzq-tray span{background:#1f3a7a;color:#f6d983}
.s1 .lzq-tray span{background:#a3352b;color:#ffe9d2}
.lzq-tl{font-size:11px;color:#8a95b2}
.lzq-boardwrap{position:relative;min-height:0;display:grid;place-items:center}
.lzq-board{width:100%;height:100%;max-height:calc(100vh - 190px);display:block}
.lzq-result{position:absolute;inset:auto 0 50% 0;transform:translateY(50%);margin:auto;width:min(380px,90%);padding:22px;border-radius:18px;background:rgba(8,13,28,.94);border:1px solid var(--amber,#f3b867);text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.lzq-result[hidden]{display:none}
.lzq-result b{display:block;font:900 26px/1.3 var(--f-display,serif)}
.lzq-result p{margin:8px 0 14px;color:var(--muted,#a7b1cc);font-size:14px}
.lzq-log{padding:10px 20px 14px;border-top:1px solid var(--line,rgba(188,208,255,.15));max-height:120px;overflow:auto}
.lzq-log ol{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:3px;font-size:12.5px;color:var(--muted,#a7b1cc);font-variant-numeric:tabular-nums}
.lzq-log li b{color:#fff;font-weight:500}
.lzq-log .r{color:#ffb1a8}.lzq-log .bl{color:#a9c4ff}
.lzq-note{font-size:11.5px;color:#8a95b2;padding:0 20px 10px}
.lzq-rules{position:absolute;right:20px;top:68px;z-index:3;width:min(420px,calc(100% - 40px));max-height:70vh;overflow:auto;padding:18px;border-radius:16px;background:rgba(8,13,28,.96);border:1px solid var(--line,rgba(188,208,255,.25));font-size:13.5px;line-height:1.7;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.lzq-rules[hidden]{display:none}
.lzq-rules h3{margin:0 0 6px;font:900 17px var(--f-display,serif)}
.lzq-rules ul{margin:6px 0 0;padding-left:18px}
.pc{transition:transform .5s cubic-bezier(.3,.8,.2,1),opacity .4s}
.pc.gone{opacity:0}
.pc text{font-family:var(--f-display,"Noto Serif TC",serif);font-weight:900;pointer-events:none}
@keyframes lzqBoom{from{r:4;opacity:1}to{r:34;opacity:0}}
.boom{animation:lzqBoom .7s ease-out forwards}
@keyframes lzqTag{0%{opacity:0;transform:translateY(6px)}15%,80%{opacity:1;transform:none}100%{opacity:0}}
.btag{animation:lzqTag 1.6s ease both}
@media (max-width:980px){
  .lzq{display:block;overflow-y:auto}
  .lzq-boardwrap{display:block}
  .lzq-board{margin:0 auto}
  .lzq-main{grid-template-columns:1fr 1fr;grid-template-areas:"b b" "s0 s1"}
  .lzq-boardwrap{grid-area:b}.lzq-side.s0{grid-area:s0}.lzq-side.s1{grid-area:s1}
  .lzq-board{max-height:none;width:min(100%,460px);height:auto}
  .lzq-motto,.lzq-tl{display:none}
}
@media (max-width:980px){ .lzq-face{width:64px;height:64px;border-radius:14px} .lzq-seal{width:20px;height:20px;font-size:11px} }
@media (max-width:560px){ .lzq-main{grid-template-columns:1fr;grid-template-areas:"b" "s0" "s1"} .lzq-title h2{font-size:18px} .lzq-ctrl{gap:6px}.lzq-b{padding:0 10px;font-size:12px;height:34px}.lzq-top{padding:12px 14px} }
@media (prefers-reduced-motion:reduce){ .pc{transition:none} .boom,.btag{animation:none} }
`;

const PX = x => 40 + x * 80, PY = y => 34 + y * 50 + (y >= 6 ? 36 : 0);
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs, parent) => { const e = doc.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
const COL = 'ABCDE', sq = i => COL[X(i)] + (12 - Y(i));

let root$, svg, gPieces, gFx, st, timer = null, running = false, speed = 'mid', fog = false, built = false, nodes = new Map(), stepping = false;
const DELAY = { slow: 1500, mid: 850, fast: 320 };

function build() {
  const style = doc.createElement('style'); style.textContent = CSS; doc.head.appendChild(style);
  root$ = doc.createElement('div');
  root$.className = 'lzq'; root$.hidden = true;
  root$.setAttribute('role', 'dialog'); root$.setAttribute('aria-modal', 'true'); root$.setAttribute('aria-label', '孫武與拿破崙的陸軍棋對弈');
  const side = (ps, k) => `<aside class="lzq-side s${k}"><header><span class="lzq-face"><img src="${ps.img}" alt="${ps.name}肖像（AI 生成插畫）"></span><div><b>${ps.name}</b><small>${k === 0 ? '紅方・先手' : '藍方・後手'}｜PCDA 2.0 心智模型</small></div></header>
    <p class="lzq-motto">${ps.motto}</p>
    <ul class="lzq-models" data-models>${ps.models.map(m => `<li data-m="${m[0]}"><b>${m[0]}</b>${m[1]}</li>`).join('')}</ul>
    <div class="lzq-think" data-think><span class="k">等待開局</span><p class="l">${k === 0 ? '先算後動。布陣已定，靜待敵勢。' : '布陣完畢，主力已就位。'}</p></div>
    <div class="lzq-stat"><div><b data-alive>25</b>存活</div><div><b data-cap>0</b>吃子</div><div><b data-lost>0</b>折損</div></div>
    <div><span class="lzq-tl">吃下的棋子</span><div class="lzq-tray" data-tray></div></div></aside>`;
  root$.innerHTML = `<div class="lzq-top"><div class="lzq-title"><span>成果 08｜PCDA 2.0 心智模型對弈</span><h2>孫武<i>VS</i>拿破崙｜陸軍棋</h2></div>
    <div class="lzq-ctrl">
      <button class="lzq-b pri" type="button" data-act="play" aria-pressed="false"><svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3.2v9.6L12.8 8z" fill="currentColor"/></svg><span>開始對弈</span></button>
      <button class="lzq-b" type="button" data-act="step"><span>下一手</span></button>
      <span class="lzq-seg" role="group" aria-label="速度"><button type="button" data-speed="slow" aria-pressed="false">慢</button><button type="button" data-speed="mid" aria-pressed="true">中</button><button type="button" data-speed="fast" aria-pressed="false">快</button></span>
      <button class="lzq-b" type="button" data-act="fog" aria-pressed="false"><span>暗棋視角</span></button>
      <button class="lzq-b" type="button" data-act="new"><span>重新布陣</span></button>
      <button class="lzq-b" type="button" data-act="rules" aria-expanded="false"><span>規則</span></button>
      <button class="lzq-b lzq-x" type="button" data-act="close" aria-label="關閉對弈視窗">×</button>
    </div></div>
    <div class="lzq-main">${side(SUN, 0)}<div class="lzq-boardwrap"><svg class="lzq-board" viewBox="0 0 400 690" role="img" aria-label="陸軍棋棋盤"></svg><div class="lzq-result" hidden></div></div>${side(NAP, 1)}</div>
    <div><div class="lzq-log"><ol></ol></div><p class="lzq-note">兩位棋手由《孫武｜兵聖戰略心智模型》與《拿破崙一世｜人物認知蒸餾》兩份 PCDA 2.0 Skill 的價值排序、五個心智模型與決策規則轉成評估參數，在看不見對方棋子的暗棋條件下即時計算。這是認知模擬，不是孫武或拿破崙本人；引文標 H1 者出自《孫子兵法》原典，拿破崙的判斷語句為角色模擬（H4），並非歷史原話。</p></div>
    <div class="lzq-rules" hidden><h3>陸軍棋規則（本局採用）</h3><ul>
      <li>每方 25 子：司令、軍長、師長×2、旅長×2、團長×2、營長×2、連長×3、排長×3、工兵×3、地雷×3、炸彈×2、軍旗。</li>
      <li>大小依序：司令 ＞ 軍長 ＞ 師長 ＞ 旅長 ＞ 團長 ＞ 營長 ＞ 連長 ＞ 排長 ＞ 工兵；同級同歸於盡。</li>
      <li>炸彈與任何棋子相碰都同歸於盡。地雷不能移動，只有工兵能排除；其他棋子碰雷陣亡，雷仍在。</li>
      <li>軍旗只能放在大本營；地雷只能在最後兩排；炸彈不能放第一排。進入大本營的棋子不能再移動。</li>
      <li>行營中的棋子不能被攻擊。粗線是鐵路：棋子可沿直線連續行駛，工兵可在鐵路上轉彎。</li>
      <li>奪得對方軍旗，或對方無子可動即獲勝。司令陣亡時須亮出軍旗位置。400 手或連續 90 手無交鋒判和。</li>
      <li>雙方都看不到對方棋子，只能從交鋒結果推理；「暗棋視角」顯示雙方實際掌握的情報。</li></ul></div>`;
  doc.body.appendChild(root$);
  svg = root$.querySelector('.lzq-board');
  drawBoard();
  root$.addEventListener('click', onClick);
  doc.addEventListener('keydown', e => { if (!root$.hidden && e.key === 'Escape') { e.stopImmediatePropagation(); close(); } }, true);
  built = true;
}

function drawBoard() {
  svg.innerHTML = '';
  const defs = el('defs', {}, svg);
  const grad = (idn, a, b) => { const g = el('linearGradient', { id: idn, x1: 0, y1: 0, x2: 0, y2: 1 }, defs); el('stop', { offset: 0, 'stop-color': a }, g); el('stop', { offset: 1, 'stop-color': b }, g); };
  grad('lzqRed', '#d2493b', '#8f1f16'); grad('lzqBlue', '#335cb8', '#14295e'); grad('lzqPaper', '#f3e8cf', '#e3d3ae');
  el('rect', { x: 4, y: 4, width: 392, height: 682, rx: 18, fill: 'url(#lzqPaper)', stroke: '#8b6d3f', 'stroke-width': 3 }, svg);
  // river band
  el('rect', { x: 10, y: PY(5) + 14, width: 380, height: PY(6) - PY(5) - 28, fill: 'rgba(139,109,63,.12)' }, svg);
  for (const x of [1, 3]) { const t = el('text', { x: PX(x), y: (PY(5) + PY(6)) / 2 + 5, 'text-anchor': 'middle', 'font-size': 13, fill: '#8b6d3f', 'font-family': 'serif' }, svg); t.textContent = '山 界'; }
  const g = el('g', {}, svg);
  for (const [a, b, rail] of ROADS) {
    const at = { x1: PX(X(a)), y1: PY(Y(a)), x2: PX(X(b)), y2: PY(Y(b)) };
    if (rail) { el('line', { ...at, stroke: '#3b2f22', 'stroke-width': 5, 'stroke-linecap': 'round' }, g); el('line', { ...at, stroke: '#f3e8cf', 'stroke-width': 2, 'stroke-dasharray': '7 6' }, g); }
    else el('line', { ...at, stroke: '#8b6d3f', 'stroke-width': 1.4 }, g);
  }
  for (let i = 0; i < N; i++) {
    const cx = PX(X(i)), cy = PY(Y(i));
    if (CAMP[i]) el('circle', { cx, cy, r: 19, fill: '#f6ecd5', stroke: '#8b6d3f', 'stroke-width': 1.6 }, g);
    else if (HQ[i]) { el('rect', { x: cx - 32, y: cy - 18, width: 64, height: 36, rx: 14, fill: '#f6ecd5', stroke: '#8b6d3f', 'stroke-width': 1.6 }, g); const t = el('text', { x: cx, y: cy + (Y(i) === 0 ? -22 : 30), 'text-anchor': 'middle', 'font-size': 10, fill: '#8b6d3f' }, g); t.textContent = '大本營'; }
    else el('rect', { x: cx - 27, y: cy - 13, width: 54, height: 26, rx: 4, fill: '#f6ecd5', stroke: '#a88a5a', 'stroke-width': 1 }, g);
  }
  // edge labels
  for (let x = 0; x < 5; x++) { const t = el('text', { x: PX(x), y: 682, 'text-anchor': 'middle', 'font-size': 9, fill: '#a88a5a', 'font-family': 'monospace' }, svg); t.textContent = COL[x]; }
  gFx = el('g', {}, svg); el('g', { 'data-hl': '' }, svg);
  gPieces = el('g', {}, svg);
}

function pieceNode(p) {
  let n = nodes.get(p.id);
  if (!n) {
    n = el('g', { class: 'pc' }, gPieces);
    el('rect', { x: -27, y: -14, width: 54, height: 28, rx: 5, fill: p.s === 0 ? 'url(#lzqRed)' : 'url(#lzqBlue)', stroke: p.s === 0 ? '#ffcdb8' : '#f6d983', 'stroke-width': 1.2 }, n);
    const t = el('text', { x: 0, y: 6, 'text-anchor': 'middle', 'font-size': 15.5, fill: p.s === 0 ? '#fff1e2' : '#f6d983' }, n);
    t.textContent = TYPES[p.t].n;
    nodes.set(p.id, n);
  }
  return n;
}
function label(p) { // what the spectator sees in fog mode: what the opponent actually knows
  if (!fog) return TYPES[p.t].n;
  const m = st.belief[1 - p.s].get(p.id);
  const j = TK.findIndex((k, jj) => m === 1 << jj);
  return j >= 0 ? TYPES[TK[j]].n : '？';
}
function render(full) {
  for (const p of st.pieces) {
    const n = pieceNode(p);
    if (!p.alive) { if (!n.classList.contains('gone')) { n.classList.add('gone'); setTimeout(() => n.remove(), 450); } continue; }
    n.style.transform = `translate(${PX(X(p.i))}px,${PY(Y(p.i))}px)`;
    n.querySelector('text').textContent = label(p);
  }
  if (full) for (const [pid, n] of nodes) if (!st.pieces[pid] || !n.isConnected) nodes.delete(pid);
  for (const k of [0, 1]) {
    const side = root$.querySelector('.s' + k);
    const alive = st.pieces.filter(p => p.s === k && p.alive).length;
    const caps = st.history.filter(h => h.def && ((h.side === k && (h.outcome === 'A' || h.outcome === 'B' || h.outcome === 'F')) || (h.side !== k && h.outcome === 'D'))).map(h => (h.side === k ? h.def.t : h.t));
    side.querySelector('[data-alive]').textContent = alive;
    side.querySelector('[data-cap]').textContent = caps.length;
    side.querySelector('[data-lost]').textContent = 25 - alive;
    side.querySelector('[data-tray]').innerHTML = caps.map(t => `<span>${TYPES[t].n}</span>`).join('');
  }
}

function fx(ev) {
  const hl = svg.querySelector('[data-hl]'); hl.innerHTML = '';
  const c = ev.side === 0 ? '#ffb199' : '#9fc0ff';
  el('rect', { x: PX(X(ev.from)) - 29, y: PY(Y(ev.from)) - 16, width: 58, height: 32, rx: 6, fill: 'none', stroke: c, 'stroke-width': 2, 'stroke-dasharray': '4 3' }, hl);
  if (!ev.def) return;
  const cx = PX(X(ev.to)), cy = PY(Y(ev.to));
  el('circle', { cx, cy, r: 4, fill: 'none', stroke: '#ffd394', 'stroke-width': 4, class: 'boom' }, gFx);
  const txt = { A: ev.def.t === 'DL' ? '排雷' : '吃子', D: ev.def.t === 'DL' ? '觸雷' : '敗退', B: ev.t === 'ZD' || ev.def.t === 'ZD' ? '引爆' : '同歸', F: '奪旗' }[ev.outcome];
  const g = el('g', { class: 'btag' }, gFx);
  el('rect', { x: cx - 24, y: cy - 42, width: 48, height: 20, rx: 10, fill: '#0b1226', stroke: '#ffd394' }, g);
  const t = el('text', { x: cx, y: cy - 28, 'text-anchor': 'middle', 'font-size': 12, fill: '#ffd394', 'font-weight': 700 }, g); t.textContent = txt;
  setTimeout(() => { gFx.innerHTML = ''; }, 1700);
}

function logLine(ev) {
  const who = ev.side === 0 ? '孫武' : '拿破崙', cls = ev.side === 0 ? 'r' : 'bl';
  let s = `<span class="${cls}">第 ${ev.ply} 手｜${who}</span>　<b>${TYPES[ev.t].n}</b> ${sq(ev.from)} → ${sq(ev.to)}`;
  if (ev.def) {
    const res = { A: `擊敗 ${TYPES[ev.def.t].n}`, D: ev.def.t === 'DL' ? '觸雷陣亡' : `敗給 ${TYPES[ev.def.t].n}`, B: `與 ${TYPES[ev.def.t].n} 同歸於盡`, F: '奪得軍旗' }[ev.outcome];
    s += `：${res}`;
  }
  const li = doc.createElement('li'); li.innerHTML = s;
  root$.querySelector('.lzq-log ol').prepend(li);
  root$.querySelector('.lzq-log').scrollTop = 0;
}

function showThought(side, th) {
  const box = root$.querySelector('.s' + side);
  box.querySelectorAll('[data-models] li').forEach(li => li.classList.toggle('on', li.dataset.m === th.model));
  const tag = th.quote ? `<p class="q">${th.quote}<em>${th.tag}</em></p>` : `<span class="tag">${th.tag}</span>`;
  box.querySelector('[data-think]').innerHTML = `<span class="k">${th.model}｜${(side === 0 ? SUN : NAP).models.find(m => m[0] === th.model)[1]}</span><p class="l">${th.line}</p>${tag}${th.calc ? `<p class="c">${th.calc}</p>` : ''}`;
}

function markTurn(){ [0,1].forEach(k => root$.querySelector('.s' + k).classList.toggle('turn', !!st && !st.over && st.turn === k)); }
function step() {
  if (!st || st.over) return false;
  const side = st.turn;
  const d = think(st, side);
  if (!d) { st.over = true; st.winner = 1 - side; st.reason = '對手已無子可動'; finish(); return false; }
  const th = talk(st, side, d.info, d.move);
  const ev = play(st, d.move, th);
  showThought(side, th); render(); fx(ev); logLine(ev); markTurn();
  if (root.SFX) root.SFX.play(!ev.def ? 'move' : (ev.t === 'ZD' || ev.def.t === 'ZD' || (ev.def.t === 'DL' && ev.outcome === 'D')) ? 'boom' : 'clash');
  if (st.over) finish();
  return true;
}
function loop() {
  clearTimeout(timer);
  if (!running || !st || st.over) return;
  step();
  timer = setTimeout(loop, DELAY[speed]);
}
function setRunning(on) {
  running = on && !st.over;
  const b = root$.querySelector('[data-act="play"]');
  b.setAttribute('aria-pressed', String(running));
  b.querySelector('span').textContent = st.over ? '對局結束' : running ? '暫停' : (st.ply ? '繼續' : '開始對弈');
  b.disabled = st.over;
  b.querySelector('svg').innerHTML = running ? '<path d="M4.5 3h2.4v10H4.5zM9.1 3h2.4v10H9.1z" fill="currentColor"/>' : '<path d="M5 3.2v9.6L12.8 8z" fill="currentColor"/>';
  if (running) timer = setTimeout(loop, 250); else clearTimeout(timer);
}
function finish() {
  running = false; clearTimeout(timer);
  const box = root$.querySelector('.lzq-result');
  const who = st.winner === 0 ? '孫武（紅方）獲勝' : st.winner === 1 ? '拿破崙（藍方）獲勝' : '和局';
  const alive = k => st.pieces.filter(p => p.s === k && p.alive).length;
  box.innerHTML = `<b>${who}</b><p>${st.reason}｜共 ${st.ply} 手｜剩餘棋子 孫武 ${alive(0)}・拿破崙 ${alive(1)}</p><button class="lzq-b pri" type="button" data-act="new">再下一局</button>`;
  box.hidden = false;
  setRunning(false);
  if (root.SFX) root.SFX.play('win');
}
function newMatch() {
  clearTimeout(timer); running = false;
  for (const n of nodes.values()) n.remove(); nodes.clear();
  st = newGame([SUN, NAP]);
  root$.querySelector('.lzq-result').hidden = true;
  root$.querySelector('.lzq-log ol').innerHTML = '';
  svg.querySelector('[data-hl]').innerHTML = ''; gFx.innerHTML = '';
  [0, 1].forEach(k => { const b = root$.querySelector('.s' + k); b.querySelector('[data-think]').innerHTML = `<span class="k">布陣完成</span><p class="l">${k === 0 ? '三雷護旗，主力居中靠後，工兵在前準備試探。' : '主力壓在' + (NAP.flank === 0 ? '本方右翼' : '本方左翼') + '鐵路線上，炸彈隨行，準備集中突破。'}</p><span class="tag">H3 棋局轉譯</span>`; b.querySelectorAll('[data-models] li').forEach(li => li.classList.remove('on')); });
  render(true);
  setRunning(false); markTurn();
}
function onClick(e) {
  const b = e.target.closest('[data-act],[data-speed]'); if (!b) return;
  if (b.dataset.speed) { speed = b.dataset.speed; root$.querySelectorAll('[data-speed]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); return; }
  const a = b.dataset.act;
  if (a === 'play') setRunning(!running);
  else if (a === 'step') { setRunning(false); step(); }
  else if (a === 'new') newMatch();
  else if (a === 'fog') { fog = !fog; b.setAttribute('aria-pressed', String(fog)); b.querySelector('span').textContent = fog ? '全知視角' : '暗棋視角'; render(); }
  else if (a === 'rules') { const r = root$.querySelector('.lzq-rules'); r.hidden = !r.hidden; b.setAttribute('aria-expanded', String(!r.hidden)); }
  else if (a === 'close') close();
}
function open() {
  if (!built) build();
  root$.hidden = false; doc.documentElement.classList.add('lzq-open');
  if (!st) newMatch();
  root$.querySelector('[data-act="play"]').focus();
}
function close() {
  if (root.SFX) root.SFX.play('close');
  setRunning(false); root$.hidden = true; doc.documentElement.classList.remove('lzq-open');
  const t = doc.querySelector('[data-lzq]'); if (t) t.focus({ preventScroll: true });
}
root.LZQ = { open, close };
})(typeof window !== 'undefined' ? window : globalThis);
