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
