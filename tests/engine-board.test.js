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
