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
