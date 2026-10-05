# AI Levels Reshuffle + Strong Hard Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorder the AI levels (Beginner / Easy / Medium / Hard / Grandmaster) and add a new, much stronger Hard engine (`engine.js`) targeting ~1600–2000, estimated relative to the existing levels.

**Architecture:** `engine.js` is a self-contained engine with its own 0x88 board, move generator, evaluation and search, so it is ~100× faster than searching through chess.js. chess.js stays the source of truth for the actual game. The existing `ai.js` becomes Medium unchanged and also powers Easy through a deliberate-blunder move picker. `main.js` switches from four booleans to one `level` variable and talks to two workers.

**Tech Stack:** Plain JavaScript (no build step, no new dependencies), chess.js 0.x (bundled), Web Workers, Node ≥ 22 `node:test` for tests.

**Spec:** `docs/superpowers/specs/2026-10-04-ai-levels-and-strong-engine-design.md`

**Note on code in this plan:** test code is given verbatim and is the contract. The engine itself (~1,200 lines) is specified by exact interfaces, data layouts and algorithms rather than pasted in full; implementers write it to make the given tests pass.

## Global Constraints

- No build step, no npm dependencies; files load via `<script>`, `importScripts`, and Node `require`.
- New engine files follow `ai.js`'s style: one IIFE, `'use strict'`, `var`, exports to `self`/`window`/`globalThis` and `module.exports`.
- `engine.js` must not depend on chess.js. Tests may use chess.js to cross-check.
- `ai.js`'s existing behavior and all 24 existing tests in `tests/ai.test.js` must stay green; additions to `ai.js` are additive only.
- Tests run with `npm test` (`node --test tests/*.test.js`) on Windows; keep the whole suite under ~90 s.
- Hard default time budget: 2000 ms per move. Medium: depth 3, 1500 ms (unchanged). Easy: depth 2.
- Level order everywhere in the UI: Beginner, Easy, Medium, Hard, Grandmaster.
- Rating claims in the README are labeled as relative estimates anchored on Medium ≈ 1200; no external engine is used.
- Commit after each task with a message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Do not push.

## Review Focus

1. **Promotions from the engine:** a pawn promotion move must reach chess.js as `{from, to, promotion: 'q'|'r'|'b'|'n'}`; a bad or missing promotion field would make the worker reply illegal → fallback. Test pinned in Task 3 (legality sweep includes promotion positions).
2. **Non-standard starting FENs** (opening buttons, Chess960, Playground positions with no castling rights, `-` fields, or an en passant square): engine must load them and play legal moves. Test pinned in Task 1 (FEN round-trip set) and Task 3 (legality sweep).
3. **Repetition draws:** the engine must see positions from the real game history, not just its own search path, or it will walk into or out of threefold repetitions blindly. Test pinned in Task 1 (`isRepetition` with history).
4. **User acts while the AI is thinking** (Undo / New Game / switch level mid-search): stale worker replies must be ignored for every worker-backed level. Test pinned in Task 5 (browser smoke test resets mid-think).
5. **Time overrun:** Hard must answer within its budget; the UI fallback timer must be longer than the engine's budget. Test pinned in Task 3 (time limit) and Task 5 (fallback timeout constant > time budget).

---

## File Map

| File | Status | Responsibility |
|---|---|---|
| `engine.js` | create | Hard engine: board, movegen, perft, eval, search, opening book |
| `engine-worker.js` | create | Web Worker wrapper for `engine.js` |
| `ai.js` | modify (additive) | add `scoreRootMoves` and `pickEasyMove` for the Easy level |
| `ai-worker.js` | modify | add `mode: 'easy'` |
| `main.js` | modify | single `level` variable, new dispatch, generalized worker request |
| `index.html` | modify | dropdown entries, help text, script comment |
| `tests/engine-board.test.js` | create | perft, FEN, make/unmake, repetition |
| `tests/engine-eval.test.js` | create | evaluation tests |
| `tests/engine-search.test.js` | create | search, tactics, legality, time, speed, book |
| `tests/easy.test.js` | create | Easy move selection |
| `bench/ladder.js` | create | level-vs-level matches + relative Elo |
| `bench/match.js`, `bench/match-results.json` | delete | superseded by ladder (level names changed) |
| `README.md` | modify | levels table, engine section, ladder results |

---

### Task 1: Engine board, move generation, perft

**Files:**
- Create: `engine.js`
- Test: `tests/engine-board.test.js`

**Interfaces:**
- Produces (on the exported `Engine` object):
  - `Engine.Board` — constructor; `new Engine.Board(fen)` (fen optional, defaults to start position)
  - `board.loadFen(fen)` — accepts 4–6 field FENs (halfmove/fullmove default to `0`/`1`)
  - `board.toFen()` → full 6-field FEN string
  - `board.generateMoves()` → array of legal moves (encoded ints, see below)
  - `board.generateCaptures()` → array of legal captures + promotions
  - `board.makeMove(move)` / `board.unmakeMove()` — in place, unmake restores everything including hash
  - `board.inCheck()` → boolean (side to move in check)
  - `board.isRepetition()` → true if the current hash occurred earlier in the game history or the search path since the last irreversible move
  - `board.setHistory(fens)` — prior game positions (oldest first, excluding current) used by `isRepetition`
  - `board.hashLo`, `board.hashHi` — 32-bit Zobrist halves
  - `board.side` — `0` white, `1` black
  - `Engine.perft(fen, depth)` → number
  - `Engine.moveToUci(move)` → e.g. `'e2e4'`, `'e7e8q'`
  - `Engine.moveFrom(move)` / `Engine.moveTo(move)` → algebraic squares (`'e2'`), `Engine.movePromo(move)` → `'q'|'r'|'b'|'n'|null`

**Data layout (required, later tasks rely on it):**
- 0x88 board: `board.squares` is an `Int8Array(128)`; square index `sq = rank * 16 + file`, rank 0 = rank 1, file 0 = a. Off-board test: `sq & 0x88`.
- Pieces: `0` empty; white `1..6` = P N B R Q K; black `9..14` = same + 8. `color = piece >> 3`, `type = piece & 7`.
- Move int: `from | (to << 7) | (promoType << 14) | (flags << 17)`, where promoType is 0 or 2..5 (N B R Q) and flags is a bitmask: 1 capture, 2 double pawn push, 4 en passant, 8 castle.
- King squares cached in `board.kings[2]`. Piece lists optional.
- Zobrist: seeded PRNG (mulberry32, fixed seed) filling `Int32Array` tables for piece×square (16×128) ×2 halves, side, castling (16), ep file (8).
- Undo stack stores captured piece, castling rights, ep square, halfmove clock, hashLo, hashHi.

- [ ] **Step 1: Write the failing tests**

```js
// tests/engine-board.test.js
'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Chess } = require(path.join(__dirname, '..', 'chess.js'));
const Engine = require(path.join(__dirname, '..', 'engine.js'));

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// Published perft node counts (chessprogramming.org "Perft Results").
const PERFT = [
  { name: 'start', fen: START, counts: [20, 400, 8902, 197281] },
  { name: 'kiwipete', fen: 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', counts: [48, 2039, 97862] },
  { name: 'position 3', fen: '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', counts: [14, 191, 2812, 43238] },
  { name: 'position 4', fen: 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', counts: [6, 264, 9467] },
  { name: 'position 5', fen: 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', counts: [44, 1486, 62379] },
  { name: 'position 6', fen: 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', counts: [46, 2079, 89890] },
];

describe('perft', () => {
  for (const p of PERFT) {
    p.counts.forEach((expected, i) => {
      test(`${p.name} depth ${i + 1} = ${expected}`, () => {
        assert.equal(Engine.perft(p.fen, i + 1), expected);
      });
    });
  }
});

describe('FEN', () => {
  const fens = [
    START,
    'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3', // en passant square
    '8/8/8/8/K7/8/3R4/k7 w - - 12 40',                              // no castling, clocks
    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1',
  ];
  for (const fen of fens) {
    test(`round-trips ${fen}`, () => {
      assert.equal(new Engine.Board(fen).toFen(), fen);
    });
  }
  test('accepts a 4-field FEN (no clocks)', () => {
    assert.equal(new Engine.Board('8/8/8/8/K7/8/3R4/k7 w - -').toFen(), '8/8/8/8/K7/8/3R4/k7 w - - 0 1');
  });
});

describe('make/unmake', () => {
  test('restores board, FEN and hash after every legal move to depth 2', () => {
    const b = new Engine.Board('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
    const fen0 = b.toFen(), lo0 = b.hashLo, hi0 = b.hashHi;
    for (const m of b.generateMoves()) {
      b.makeMove(m);
      for (const r of b.generateMoves()) { b.makeMove(r); b.unmakeMove(); }
      b.unmakeMove();
      assert.equal(b.toFen(), fen0);
      assert.equal(b.hashLo, lo0);
      assert.equal(b.hashHi, hi0);
    }
  });

  test('incremental hash equals hash of a freshly loaded board', () => {
    const b = new Engine.Board(START);
    for (const uci of ['e2e4', 'c7c5', 'g1f3', 'd7d6']) {
      const m = b.generateMoves().find(x => Engine.moveToUci(x) === uci);
      assert.ok(m, 'move ' + uci + ' should be legal');
      b.makeMove(m);
    }
    const fresh = new Engine.Board(b.toFen());
    assert.equal(b.hashLo, fresh.hashLo);
    assert.equal(b.hashHi, fresh.hashHi);
  });
});

describe('legal moves match chess.js', () => {
  const fens = [
    START,
    'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3',
    '4k3/1P6/8/8/8/8/6p1/4K3 w - - 0 1', // promotions both sides
  ];
  for (const fen of fens) {
    test(fen, () => {
      const ours = new Engine.Board(fen).generateMoves().map(Engine.moveToUci).sort();
      const theirs = new Chess(fen).moves({ verbose: true })
        .map(m => m.from + m.to + (m.promotion || '')).sort();
      assert.deepEqual(ours, theirs);
    });
  }
});

describe('check and repetition', () => {
  test('inCheck', () => {
    assert.equal(new Engine.Board('4k3/8/8/8/8/8/8/4R1K1 b - - 0 1').inCheck(), true);
    assert.equal(new Engine.Board(START).inCheck(), false);
  });

  test('isRepetition sees positions from game history', () => {
    // Nf3 Nf6 Ng1 Ng8 returns to the start position.
    const g = new Chess();
    const history = [g.fen()];
    for (const san of ['Nf3', 'Nf6', 'Ng1']) { g.move(san); history.push(g.fen()); }
    history.pop(); // history excludes the current position
    const b = new Engine.Board(g.fen());
    b.setHistory(history);
    assert.equal(b.isRepetition(), false);
    const m = b.generateMoves().find(x => Engine.moveToUci(x) === 'f6g8');
    b.makeMove(m);
    assert.equal(b.isRepetition(), true);
  });
});

describe('uci helpers', () => {
  test('moveToUci / moveFrom / moveTo / movePromo', () => {
    const b = new Engine.Board('4k3/1P6/8/8/8/8/8/4K3 w - - 0 1');
    const promo = b.generateMoves().find(m => Engine.moveToUci(m) === 'b7b8q');
    assert.ok(promo);
    assert.equal(Engine.moveFrom(promo), 'b7');
    assert.equal(Engine.moveTo(promo), 'b8');
    assert.equal(Engine.movePromo(promo), 'q');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/engine-board.test.js`
Expected: FAIL — `Cannot find module '...engine.js'`.

- [ ] **Step 3: Implement the board in `engine.js`**

Implement exactly the data layout above. Algorithm requirements:
- **Move generation:** pseudo-legal per piece using 0x88 direction offsets (N: ±14, ±18, ±31, ±33; B: ±15, ±17; R: ±1, ±16; K/Q: all eight of ±1, ±15, ±16, ±17). Pawns: single and double pushes, captures, en passant, promotions to all four pieces. Castling only if rights are set, squares between are empty, and the king is not in check and does not pass through or land on an attacked square.
- **Legality:** make the move, reject it if `isSquareAttacked(kings[us], them)`, unmake.
- `isSquareAttacked(sq, byColor)`: scan outward from `sq` (pawn diagonals, knight offsets, king offsets, sliding rays).
- `makeMove` updates castling rights through a 128-entry mask table (rook and king home squares), the ep square (only after a double push), the halfmove clock, the side, the hash incrementally, and pushes an undo record. It also pushes the new hash onto `board.hashStack` for repetition detection.
- `isRepetition()`: compare the current hash against earlier entries in `[...historyHashes, ...hashStack]`, walking back at most `halfmove` plies and only at positions with the same side to move (every 2 plies). (For the history-only part, also treat a match as a repetition even if `halfmove` resets are unknown for the history FENs; the halfmove field of each FEN is available if needed.)
- `setHistory(fens)` computes hashes by loading each FEN into a scratch board.
- `Engine.perft` uses a recursive count over `generateMoves`/`makeMove`/`unmakeMove`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/engine-board.test.js`
Expected: all PASS. If a perft count is off, the debugging technique is "divide": print per-root-move counts from our engine and from chess.js at the same depth and recurse into the move whose counts differ.

- [ ] **Step 5: Commit**

```bash
git add engine.js tests/engine-board.test.js
git commit -m "Add engine.js board representation and perft-verified move generator"
```

---

### Task 2: Engine evaluation

**Files:**
- Modify: `engine.js`
- Test: `tests/engine-eval.test.js`

**Interfaces:**
- Consumes: `Engine.Board` from Task 1.
- Produces: `Engine.evaluateBoard(board)` → integer centipawns from the side to move's perspective; `Engine.evaluate(fen)` → same, from a FEN.

- [ ] **Step 1: Write the failing tests**

```js
// tests/engine-eval.test.js
'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Engine = require(path.join(__dirname, '..', 'engine.js'));

const swapCase = s => s.replace(/[a-zA-Z]/g, ch => (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase()));

// Mirror a FEN vertically and swap colors (white<->black), so the mirrored
// position is the same position for the other side.
function mirrorFen(fen) {
  const [placement, side, castling, ep, half, full] = fen.split(' ');
  const rows = placement.split('/').reverse().map(swapCase);
  const newCastling = castling === '-' ? '-' : swapCase(castling).split('')
    .sort((a, b) => 'KQkq'.indexOf(a) - 'KQkq'.indexOf(b)).join('');
  const newEp = ep === '-' ? '-' : ep[0] + (ep[1] === '3' ? '6' : '3');
  return [rows.join('/'), side === 'w' ? 'b' : 'w', newCastling, newEp, half, full].join(' ');
}

const POSITIONS = [
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  'r1bq1rk1/2pnbppp/p2p1n2/1p2p3/3PP3/1BP2N1P/PP3PP1/RNBQR1K1 w - - 1 11',
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  '8/8/4k3/8/2P5/8/4K3/8 w - - 0 1',
  '6k1/5ppp/8/3P4/8/8/5PPP/6K1 b - - 0 1',
];

describe('evaluation', () => {
  test('start position evaluates to 0', () => {
    assert.equal(Engine.evaluate(POSITIONS[0]), 0);
  });

  for (const fen of POSITIONS) {
    test(`color-mirror symmetric: ${fen}`, () => {
      assert.equal(Engine.evaluate(fen), Engine.evaluate(mirrorFen(fen)));
    });
  }

  test('extra queen is clearly winning for its owner', () => {
    const fen = '4k3/8/8/8/8/8/8/3QK3 w - - 0 1';
    assert.ok(Engine.evaluate(fen) > 700);
    assert.ok(Engine.evaluate(fen.replace(' w ', ' b ')) < -700);
  });

  test('passed pawn on the 7th is worth more than on the 2nd', () => {
    const adv = Engine.evaluate('4k3/1P6/8/8/8/8/8/4K3 w - - 0 1');
    const back = Engine.evaluate('4k3/8/8/8/8/8/1P6/4K3 w - - 0 1');
    assert.ok(adv > back + 50, `advanced ${adv} should beat back ${back} by > 50`);
  });

  test('bishop pair is a bonus', () => {
    const pair = Engine.evaluate('4k3/8/8/8/8/8/8/2B1KB2 w - - 0 1');
    const bn = Engine.evaluate('4k3/8/8/8/8/8/8/2B1KN2 w - - 0 1');
    assert.ok(pair > bn);
  });

  test('evaluate is deterministic', () => {
    assert.equal(Engine.evaluate(POSITIONS[1]), Engine.evaluate(POSITIONS[1]));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/engine-eval.test.js`
Expected: FAIL — `Engine.evaluate is not a function`.

- [ ] **Step 3: Implement the evaluation**

Score is computed white-relative and then negated when black is to move. Required terms:
- **Tapered PeSTO:** middlegame and endgame material (mg: P82 N337 B365 R477 Q1025; eg: P94 N281 B297 R512 Q936) plus the PeSTO mg/eg piece-square tables (Rofchade/PeSTO tables as published on chessprogramming.org, "PeSTO's Evaluation Function"). Phase = N·1 + B·1 + R·2 + Q·4 summed over both sides, capped at 24; `score = (mg·phase + eg·(24−phase)) / 24`, rounded with `| 0` (truncation, symmetric for both colors since it is applied to the white-relative total).
- **Pawn structure:** passed pawn bonus by relative rank `[0, 5, 10, 20, 35, 60, 100, 0]` (mg) / `[0, 10, 20, 40, 70, 120, 200, 0]` (eg); doubled −10/−20; isolated −10/−15.
- **Bishop pair:** +30 mg / +50 eg.
- **Rooks:** open file +25, semi-open +10.
- **Mobility:** for N/B/R/Q, count pseudo-legal destination squares not occupied by own pieces; weight mg/eg N 4/4, B 5/5, R 2/4, Q 1/2, centered by subtracting a per-piece baseline (N 4, B 6, R 7, Q 13).
- **King safety (mg only):** −15 per missing pawn from the three-square shield in front of a castled king (king on files a–c or f–h), and −8 per enemy N/B/R/Q attack on the 8 squares around the king.
- **Tempo:** none (so the start position is exactly 0).
- Terminal positions are not handled here (search handles mate and stalemate).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/engine-eval.test.js tests/engine-board.test.js`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add engine.js tests/engine-eval.test.js
git commit -m "Add tapered PeSTO evaluation with pawn, rook, mobility and king-safety terms"
```

---

### Task 3: Engine search, time control, opening book

**Files:**
- Modify: `engine.js`
- Test: `tests/engine-search.test.js`

**Interfaces:**
- Consumes: `Engine.Board`, `Engine.evaluateBoard`, `Engine.moveFrom/moveTo/movePromo/moveToUci` from Tasks 1–2.
- Produces:
  - `Engine.search(fen, opts)` with `opts = { timeLimitMs = 2000, maxDepth = 64, history = [], useBook = true }`, where `history` holds earlier game FENs (oldest first, excluding `fen`).
  - Returns `{ move: { from, to, promotion } | null, uci, score, depth, nodes, timeMs, book }`. `promotion` is `'q'|'r'|'b'|'n'` or `null`; `book` is true when the move came from the opening book; `move` is null when there are no legal moves.
  - `Engine.MATE_SCORE = 30000`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/engine-search.test.js
'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Chess } = require(path.join(__dirname, '..', 'chess.js'));
const Engine = require(path.join(__dirname, '..', 'engine.js'));

function apply(fen, move) {
  const g = new Chess(fen);
  const r = g.move({ from: move.from, to: move.to, promotion: move.promotion || undefined });
  assert.ok(r, `engine move ${JSON.stringify(move)} must be legal in ${fen}`);
  return g;
}

const FAST = { timeLimitMs: 1000, useBook: false };

describe('tactics', () => {
  test('mate in 1: back rank (Ra8#)', () => {
    const fen = '6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1';
    const r = Engine.search(fen, FAST);
    assert.ok(apply(fen, r.move).in_checkmate());
  });

  test('mate in 1 for black (Ra1#)', () => {
    const fen = 'r3k3/8/8/8/8/8/5PPP/6K1 b - - 0 1';
    const r = Engine.search(fen, FAST);
    assert.ok(apply(fen, r.move).in_checkmate());
  });

  test('mate in 2: K+Q vs K and K+R vs K', () => {
    for (const fen of ['8/8/8/8/K7/Q7/8/k7 w - - 0 1', '8/8/8/8/K7/8/3R4/k7 w - - 0 1']) {
      const r = Engine.search(fen, FAST);
      assert.ok(r.score > Engine.MATE_SCORE - 10, `should see mate from ${fen}, score ${r.score}`);
      const g = apply(fen, r.move);
      // Every black reply must allow mate in 1.
      for (const reply of g.moves()) {
        g.move(reply);
        const mates = g.moves().some(m => { g.move(m); const ok = g.in_checkmate(); g.undo(); return ok; });
        assert.ok(mates, `after ${r.uci} ${reply} white must have mate in 1`);
        g.undo();
      }
    }
  });

  test('captures an undefended queen', () => {
    const r = Engine.search('q3k3/8/8/8/8/8/8/R3K3 w - - 0 1', FAST);
    assert.equal(r.move.to, 'a8');
  });

  test('does not leave its queen en prise to a pawn', () => {
    const fen = '4k3/8/8/4p3/3Q4/8/8/4K3 w - - 0 1';
    const g = apply(fen, Engine.search(fen, FAST).move);
    const freeQueen = g.moves({ verbose: true }).some(m => m.captured === 'q');
    assert.ok(!freeQueen, 'black must not be able to capture the white queen');
  });

  test('quiescence: does not grab a pawn defended by a pawn with its queen', () => {
    // Qxd5 loses the queen to ...exd5.
    const fen = 'rnbqkbnr/ppp2ppp/4p3/3p4/3P4/5Q2/PPP1PPPP/RNB1KBNR w KQkq - 0 3';
    const r = Engine.search(fen, FAST);
    assert.notEqual(r.uci, 'f3d5');
  });
});

describe('legality sweep (incl. promotions and unusual FENs)', () => {
  const fens = [
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    '4k3/1P6/8/8/8/8/6p1/4K3 w - - 0 1',   // white to move, promotion available
    '4k3/1P6/8/8/8/8/6p1/4K3 b - - 0 1',   // black to move, promotion available
    'rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3',
    'bnrbkrqn/pppppppp/8/8/8/8/PPPPPPPP/BNRBKRQN w - - 0 1', // Chess960-style, no castling
    '8/8/8/8/K7/8/3R4/k7 w - - 0 1',
  ];
  for (const fen of fens) {
    test(fen, () => {
      const r = Engine.search(fen, { timeLimitMs: 300, useBook: false });
      apply(fen, r.move);
    });
  }

  test('promotion move carries a lowercase promotion piece', () => {
    const r = Engine.search('4k3/1P6/8/8/8/8/8/4K3 w - - 0 1', FAST);
    assert.equal(r.move.from, 'b7');
    assert.equal(r.move.promotion, 'q');
  });
});

describe('terminal positions', () => {
  test('checkmated: move null', () => {
    assert.equal(Engine.search('R5k1/5ppp/8/8/8/8/8/4K3 b - - 0 1', FAST).move, null);
  });
  test('stalemated: move null', () => {
    assert.equal(Engine.search('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', FAST).move, null);
  });
});

describe('time and speed', () => {
  const MID = 'r1bq1rk1/2pnbppp/p2p1n2/1p2p3/3PP3/1BP2N1P/PP3PP1/RNBQR1K1 w - - 1 11';

  test('respects a 500 ms budget (returns within 800 ms)', () => {
    const t0 = Date.now();
    const r = Engine.search(MID, { timeLimitMs: 500, useBook: false });
    assert.ok(Date.now() - t0 < 800);
    assert.ok(r.move);
  });

  test('searches at least 100k nodes/s and reaches depth >= 6 in 2 s from a middlegame', () => {
    const r = Engine.search(MID, { timeLimitMs: 2000, useBook: false });
    const nps = r.nodes / (r.timeMs / 1000);
    assert.ok(nps >= 100000, `nps ${Math.round(nps)}`);
    assert.ok(r.depth >= 6, `depth ${r.depth}`);
  });
});

describe('opening book', () => {
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  test('start position: answers from the book instantly with a legal move', () => {
    const r = Engine.search(START, { timeLimitMs: 2000 });
    assert.equal(r.book, true);
    assert.ok(r.timeMs < 50);
    apply(START, r.move);
  });
  test('useBook:false disables the book', () => {
    assert.equal(Engine.search(START, { timeLimitMs: 200, useBook: false }).book, false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/engine-search.test.js`
Expected: FAIL — `Engine.search is not a function`.

- [ ] **Step 3: Implement search**

- **Iterative deepening** from depth 1 to `maxDepth`. The root uses the TT move first. Stop when the time is used or when a mate score is found and proven.
- **Time:** `deadline = start + timeLimitMs`. Check `Date.now()` every 2048 nodes; on expiry set `stopped = true` and unwind. Return the best move from the last completed iteration (or the best-so-far root move of the partial iteration if it was searched first, i.e. the previous PV move). Do not start a new iteration once more than 50% of the budget is used. Depth 1 always completes.
- **Negamax PVS** with fail-soft alpha-beta: the first move gets a full window, later moves a null window with a re-search on fail-high.
- **Transposition table:** 2^20 entries in parallel typed arrays (`Int32Array` keyLo/keyHi/move/score, `Int8Array` depth/flag). Store EXACT/LOWER/UPPER and the best move; depth-preferred replacement. Adjust mate scores by ply when storing and probing.
- **Quiescence:** stand-pat with the static eval; search captures and promotions ordered by MVV-LVA; delta pruning (skip a capture if `standPat + victimValue + 200 < alpha`). When in check, search all evasions instead.
- **Ordering:** TT move, then captures by MVV-LVA, then 2 killer moves per ply, then quiets by history score (`history[side][from][to] += depth*depth` on beta cutoffs by quiet moves).
- **Null-move pruning:** if not in check, depth ≥ 3, the side to move has a non-pawn piece, and the previous move wasn't a null move: `R = 2 + (depth > 6 ? 1 : 0)`; null-window search at `depth − 1 − R`; cutoff if ≥ beta. (A null move flips side and clears ep, updating the hash; unmake restores it.)
- **LMR:** for quiet, non-checking moves, not in check, move index ≥ 3 and depth ≥ 3, reduce by 1 (2 if index ≥ 8); re-search at full depth if the score exceeds alpha.
- **Check extension:** +1 depth when the side to move is in check.
- **Draws:** `isRepetition()` or `halfmove >= 100` returns 0 (not at the root). With no legal moves: in check → `-(MATE_SCORE - ply)`, else 0.
- **Root:** load `fen`, `setHistory(history)`. With no legal moves return `move: null`.
- **Opening book:** an embedded object mapping a position key (the FEN's first four fields) to an array of UCI moves, covering roughly 40 positions in the first 4–6 plies of mainstream openings (1.e4 e5 / Sicilian / French / Caro-Kann, 1.d4 d5 QGD / Slav, 1.d4 Nf6 KID / Nimzo, 1.c4, 1.Nf3), both colors. Pick uniformly at random among the listed moves that are legal. Book moves return `{ book: true, depth: 0, nodes: 0, score: 0 }`. Every book entry must be checked with a unit-style assertion during development (each listed move legal in its position); keep that check as a test in `tests/engine-search.test.js` if `Engine.BOOK` is exported.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/engine-search.test.js tests/engine-eval.test.js tests/engine-board.test.js`
Expected: all PASS. If the nps test fails, profile with `node --cpu-prof` and remove allocations from the hot path (no per-node arrays: preallocate move buffers per ply).

- [ ] **Step 5: Commit**

```bash
git add engine.js tests/engine-search.test.js
git commit -m "Add PVS search with TT, quiescence, pruning, time control and opening book"
```

---

### Task 4: Easy level move picker and worker modes

**Files:**
- Modify: `ai.js` (additive: two new exports)
- Modify: `ai-worker.js` (add `mode: 'easy'`)
- Create: `engine-worker.js`
- Test: `tests/easy.test.js`

**Interfaces:**
- Consumes: `AI.negamax`, `AI.orderMoves`, `AI.MATE_SCORE` (existing); `Engine.search` (Task 3).
- Produces:
  - `AI.scoreRootMoves(game, depth)` → `[{ move: {from,to,promotion,san}, score }]`, sorted by score descending, scored from the side to move's perspective with full-window negamax at `depth − 1` below each root move; `[]` if there are no moves. Leaves `game` unchanged.
  - `AI.pickEasyMove(scored, rng)` → one entry's `move`, or null. With `r = rng()`: `r < 0.65` → `scored[0]`; `r < 0.90` → uniform among the top `min(4, n)`; else uniform among all.
  - `AI.EASY_DEPTH = 2`.
  - `ai-worker.js` message `{id, fen, mode: 'easy'}` → `{id, ok, move, score, depth: 2, nodes, timeMs}`. Messages without `mode` behave exactly as now.
  - `engine-worker.js` message `{id, fen, timeLimitMs, history}` → `{id, ok, move, score, depth, nodes, timeMs, book}` or `{id, ok: false, error}`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/easy.test.js
'use strict';
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Chess } = require(path.join(__dirname, '..', 'chess.js'));
const AI = require(path.join(__dirname, '..', 'ai.js'));

function seq(values) { let i = 0; return () => values[i++ % values.length]; }

describe('scoreRootMoves', () => {
  test('returns every legal move, sorted desc, game unchanged', () => {
    const g = new Chess();
    const fen = g.fen();
    const scored = AI.scoreRootMoves(g, 2);
    assert.equal(scored.length, 20);
    for (let i = 1; i < scored.length; i++) assert.ok(scored[i - 1].score >= scored[i].score);
    assert.equal(g.fen(), fen);
  });

  test('ranks capturing a free queen first', () => {
    const g = new Chess('q3k3/8/8/8/8/8/8/R3K3 w - - 0 1');
    assert.equal(AI.scoreRootMoves(g, 2)[0].move.to, 'a8');
  });

  test('no legal moves -> []', () => {
    assert.deepEqual(AI.scoreRootMoves(new Chess('R5k1/5ppp/8/8/8/8/8/4K3 b - - 0 1'), 2), []);
  });
});

describe('pickEasyMove', () => {
  const scored = ['a', 'b', 'c', 'd', 'e', 'f'].map((n, i) => ({ move: n, score: 100 - i }));

  test('r < 0.65 picks the best move', () => {
    assert.equal(AI.pickEasyMove(scored, seq([0.1])), 'a');
  });

  test('0.65 <= r < 0.90 picks within the top 4', () => {
    for (const second of [0, 0.3, 0.6, 0.99]) {
      assert.ok(['a', 'b', 'c', 'd'].includes(AI.pickEasyMove(scored, seq([0.7, second]))));
    }
  });

  test('r >= 0.90 can pick anything, including the worst', () => {
    assert.equal(AI.pickEasyMove(scored, seq([0.95, 0.99])), 'f');
  });

  test('empty -> null', () => {
    assert.equal(AI.pickEasyMove([], Math.random), null);
  });

  test('distribution: best move chosen 65-80% of the time over 2000 draws', () => {
    let rngState = 12345;
    const rng = () => ((rngState = (rngState * 1103515245 + 12345) % 2147483648) / 2147483648);
    let best = 0;
    for (let i = 0; i < 2000; i++) if (AI.pickEasyMove(scored, rng) === 'a') best++;
    // P(best) = 0.65 + 0.25/4 + 0.10/6 ≈ 0.729
    assert.ok(best > 1300 && best < 1600, `best picked ${best}/2000`);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/easy.test.js`
Expected: FAIL — `AI.scoreRootMoves is not a function`.

- [ ] **Step 3: Implement**

In `ai.js`, add next to `search` (and export both plus `EASY_DEPTH`):

```js
  function scoreRootMoves(game, depth) {
    var moves = orderMoves(game.moves({ verbose: true }));
    var prevPruning = config.pruning;
    config.pruning = true;
    var out = [];
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      game.move(m);
      var score = -negamax(game, depth - 1, -Infinity, Infinity, 1);
      game.undo();
      out.push({ move: { from: m.from, to: m.to, promotion: m.promotion || null, san: m.san }, score: score });
    }
    config.pruning = prevPruning;
    out.sort(function (a, b) { return b.score - a.score; });
    return out;
  }

  function pickEasyMove(scored, rng) {
    if (!scored.length) return null;
    var r = rng();
    if (r < 0.65) return scored[0].move;
    if (r < 0.9) return scored[Math.floor(rng() * Math.min(4, scored.length))].move;
    return scored[Math.floor(rng() * scored.length)].move;
  }
```

In `ai-worker.js`, branch on `data.mode === 'easy'`: call `AI.resetNodes()`, then `AI.scoreRootMoves(game, AI.EASY_DEPTH)` and `AI.pickEasyMove(scored, Math.random)`. Post `score` = the chosen entry's score, `depth: AI.EASY_DEPTH`, `nodes: AI.getNodes()` and `timeMs`.

Create `engine-worker.js` modeled on `ai-worker.js`: `importScripts('engine.js')`, call `Engine.search(data.fen, { timeLimitMs: data.timeLimitMs, history: data.history || [] })`, and post the result fields listed above. Keep the try/catch → `{ok: false, error}`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all PASS, including the original 24 in `tests/ai.test.js`.

- [ ] **Step 5: Commit**

```bash
git add ai.js ai-worker.js engine-worker.js tests/easy.test.js
git commit -m "Add Easy-level blunder picker and engine worker"
```

---

### Task 5: Wire the new levels into the UI

**Files:**
- Modify: `main.js` (state vars lines 8–11; `getAILevelText` ~118; `makeRandomMove`/`makeMediumMove` ~209–261; Hard AI block ~263–510; Grandmaster fallbacks ~527, 551, 557; `onDrop` ~585 and dispatch ~636–645; difficulty handlers ~877–970; `resetAllDifficulties` ~1062; `gameReset` ~1105; `switchBtnMode` ~1133; `checkOff` ~1150; Game Info ~1714)
- Modify: `index.html` (dropdown lines 84–89; script include comment near line 36; help list lines 216–221)

**Interfaces:**
- Consumes: `ai-worker.js` modes and `engine-worker.js` (Task 4).
- Produces (in `main.js`): `let level = null;` with values `'beginner'|'easy'|'medium'|'hard'|'grandmaster'|null`; `const LEVELS = ['beginner','easy','medium','hard','grandmaster']`; `const LEVEL_LABELS = { beginner: 'Beginner', easy: 'Easy', medium: 'Medium', hard: 'Hard', grandmaster: 'Grandmaster' }`; `makeBeginnerMove()`; `makeWorkerMove(kind)` where kind is `'easy'|'medium'|'hard'`; `getPositionHistory()` → array of earlier FENs.

- [ ] **Step 1: Replace level state**

Remove the `easy`, `medium`, `hard`, `grandmaster` booleans and add `level`, `LEVELS` and `LEVEL_LABELS`. Replace every read:
- `if (easy)` → `level === 'easy'` (and so on for each level)
- `!easy && !medium && !hard && !grandmaster` → `!level`
- `easy || medium || hard || grandmaster` → `!!level`
- `resetAllDifficulties()` → `level = null`
- `getAILevelText()` and the Game Info block → `LEVEL_LABELS[level]`

Verify with `grep -nE "\b(easy|medium|hard|grandmaster)\b" main.js`: only string literals and element ids may remain.

- [ ] **Step 2: Move functions**

- Rename `makeMediumMove` to `makeBeginnerMove` (body unchanged) and delete `makeRandomMove`. Update the three Grandmaster fallbacks to call `makeBeginnerMove`.
- Generalize the Hard worker code into `makeWorkerMove(kind)`, keeping all existing safety logic (request ids, pending-id stale-reply check, FEN check, timeout fallback, `onerror` → mark failed, terminate):
  - one lazily-created worker per script: `ai-worker.js` (shared by easy and medium) and `engine-worker.js` (hard), each with its own failed flag
  - payloads:
    - easy: `{id, fen, mode: 'easy'}`
    - medium: `{id, fen, depth: 3, timeLimitMs: 1500}`
    - hard: `{id, fen, timeLimitMs: 2000, history: getPositionHistory()}`
  - fallback timeouts: easy and medium 5000 ms, hard 6000 ms (must exceed the 2000 ms budget)
  - fallback chain: hard → `makeWorkerMove('medium')` if that worker is usable, else the one-ply `pickHeuristicMove`; easy and medium → `pickHeuristicMove`; and finally `makeBeginnerMove`
  - console line: `'<Level> AI search: depth=… nodes=… timeMs=…'`
- `getPositionHistory()`: `const c = new Chess(); c.load_pgn(game.pgn()); const fens = []; while (c.undo()) fens.unshift(c.fen()); return fens;` wrapped in try/catch, returning `[]` on failure.
- Dispatch in `onDrop`: beginner → `makeBeginnerMove()`; easy/medium/hard → `makeWorkerMove(level)`; grandmaster → unchanged.

- [ ] **Step 3: Buttons and HTML**

- `index.html` dropdown: five buttons with ids `beginner`, `easy`, `medium`, `hard`, `grandmaster` and labels "Beginner Level" … "Grandmaster Level".
- Replace the four near-identical click handlers with one loop over `LEVELS`, keeping the current toggle-on/toggle-off behavior and text (`'AI Game - ' + LEVEL_LABELS[l] + ' Mode'`). `switchBtnMode` uses `LEVELS`.
- Help list:
  - Beginner: "Prefers checks and captures, otherwise random"
  - Easy: "Plays sensible moves but blunders often"
  - Medium: "Looks 3 moves ahead"
  - Hard: "Strong engine: deep search, opening book"
  - Grandmaster: unchanged
- Update the script comment near line 36. `engine.js` is not loaded on the page (worker only).

- [ ] **Step 4: Browser smoke test**

Serve the folder (`python -m http.server 8000` in the background), then run a headless Chrome Playwright script (playwright-core, `channel: 'chrome'`, installed in the session scratchpad, not the repo) that:
1. For each of the 5 levels, clicks `#difficultyDropdown`, then `#<level>`, drags `e2→e4` with mouse events on `.square-e2`/`.square-e4`, waits for `game.turn() === 'w'` (Grandmaster may fall back; allow 15 s), and asserts a black move was made.
2. On Hard, plays 6 full moves, asserting each reply arrives in < 3 s and the console shows `Hard AI search: depth=`.
3. Mid-think on Hard, clicks `#startBtn` right after a drop and asserts that 3 s later the board is the start position with no stray black move (stale reply ignored).
4. Asserts zero console errors and zero `pageerror`s throughout (warnings OK).

Expected: all assertions pass. Save screenshots in the scratchpad.

- [ ] **Step 5: Run unit tests and commit**

Run: `npm test` → all PASS.

```bash
git add main.js index.html
git commit -m "Reorder AI levels: Beginner/Easy/Medium/Hard/Grandmaster, new engine for Hard"
```

---

### Task 6: Ladder benchmark, relative Elo, README

**Files:**
- Create: `bench/ladder.js`
- Delete: `bench/match.js`, `bench/match-results.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: `AI.search`, `AI.scoreRootMoves`, `AI.pickEasyMove`, `Engine.search`.
- Produces: `bench/ladder-results.json` and a README results table.

- [ ] **Step 1: Write `bench/ladder.js`**

- Players, all seeded with mulberry32 (copy the PRNG from the old `bench/match.js`):
  - Beginner: the `makeBeginnerMove` logic
  - Easy: `AI.pickEasyMove(AI.scoreRootMoves(g, 2), rng)`
  - Medium: `AI.search(g, {depth: 3, timeLimitMs: 1500})`
  - Hard: `Engine.search(g.fen(), {timeLimitMs: HARD_MS, history})`, with `HARD_MS` from the CLI (`--hard-ms`) and defaulting to 2000; `history` tracked per game
- Pairings: Beginner–Easy, Easy–Medium, Medium–Hard, 20 games each (`--games` override).
- Openings: games start from these 5 FENs, each played twice per color:
  - `rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1`
  - `r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3`
  - `rnbqk2r/ppp1ppbp/3p1np1/8/2PPP3/2N5/PP3PPP/R1BQKBNR w KQkq - 0 5`
  - `rnbqkbnr/ppp2ppp/4p3/3p4/3PP3/2N5/PPP2PPP/R1BQKBNR b KQkq - 0 1`
  - `rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP2PPPP/RNBQKBNR b KQkq - 0 1`
- Draw at 200 plies or on any `game_over()` draw.
- Per pairing report: W/D/L for the stronger side, score `s = (W + D/2) / N`, Elo gap `-400*log10(1/s - 1)`, and a 95% interval from `s ± 1.96*sqrt(s(1-s)/N)` clamped to (0, 1). If `s` is 1 (or 0), report a lower bound using `s = (N - 0.5)/N` and mark it `">="`.
- If Medium–Hard is a sweep, also run Medium vs Hard at `HARD_MS = 100` (10 games) and report that gap as "Hard @100 ms".
- Anchor at Medium = 1200: chain the gaps for each level and print an estimated rating with its range. Write everything to `bench/ladder-results.json`, plus the machine info and total wall time.

- [ ] **Step 2: Smoke-run it**

Run: `node bench/ladder.js --games 2`. Expected: completes and writes JSON, no illegal-move errors.

- [ ] **Step 3: Full run (background)**

Run: `node bench/ladder.js` (≈ 60–90 min). If Hard's estimated rating comes out < 1600, report back to the controller with the numbers before tuning (do not tune silently).

- [ ] **Step 4: README**

- Levels table: five rows matching the spec.
- Rename the "Hard-level search engine (`ai.js`)" section to Medium, and add a "Hard engine (`engine.js`)" section listing: board/movegen, perft-verified; PVS; TT; quiescence; null-move; LMR; killers/history; PeSTO tapered eval + pawn/rook/mobility/king terms; opening book; 2 s budget; Web Worker.
- Tests section: add the engine test files.
- Replace the strength-match results with the ladder table (pairing, W/D/L, score, Elo gap ± range) and an "Estimated ratings (relative, anchored on Medium ≈ 1200)" list, with a sentence stating these are estimates from internal matches, not ratings measured against rated opponents.
- Project layout: add `engine.js`, `engine-worker.js`, and `bench/ladder.js` (remove `match.js`).
- Known limitations: replace the "Hard looks three plies ahead" bullet with a Medium equivalent, and add "Hard has no endgame tablebases."

- [ ] **Step 5: Commit**

```bash
git rm bench/match.js bench/match-results.json
git add bench/ladder.js bench/ladder-results.json README.md
git commit -m "Add level ladder benchmark with relative Elo estimates; update README"
```
