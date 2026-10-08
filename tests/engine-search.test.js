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

// Additional check (not part of the brief's verbatim Step 1 test block):
// Step 3 of the brief requires every opening-book move to be legal in its
// position, and says to keep that check as a test here since Engine.BOOK
// is exported. Engine.js's buildBook() already throws at require() time if
// any line contains an illegal move, so this re-validates the same
// invariant directly against Engine.BOOK as a standing regression test.
describe('opening book validation', () => {
  test('every book move is legal in its position', () => {
    const keys = Object.keys(Engine.BOOK);
    assert.ok(keys.length >= 30, `expected roughly 40 book positions, got ${keys.length}`);
    for (const key of keys) {
      const fen = `${key} 0 1`;
      const board = new Engine.Board(fen);
      const legalUci = new Set(board.generateMoves().map(m => Engine.moveToUci(m)));
      for (const uci of Engine.BOOK[key]) {
        assert.ok(legalUci.has(uci), `book move ${uci} must be legal in ${fen}`);
      }
    }
  });
});
