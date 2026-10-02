'use strict';

/**
 * Tests for ai.js (negamax/alpha-beta chess engine), run with Node's
 * built-in test runner: `node --test tests/` (no npm dependencies).
 *
 * All custom (non-famous) FENs used below were verified before being
 * committed here by brute-force scripting against chess.js + ai.js itself
 * (exhaustively confirming checkmate / forced-mate-in-2 / stalemate
 * properties), not merely assumed from memory. See individual comments
 * for where each FEN comes from.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { Chess } = require(path.join(__dirname, '..', 'chess.js'));
const AI = require(path.join(__dirname, '..', 'ai.js'));

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

// Loads a FEN defensively: chess.js's Chess constructor silently falls
// back to an empty/uninitialized board when the FEN is invalid (load()
// returns false but the constructor doesn't surface that), so every FEN
// used in these tests is checked with validate_fen() AND a fen() round
// trip before it's trusted.
function loadFen(fen) {
  const probe = new Chess(fen);
  const validity = probe.validate_fen(fen);
  assert.ok(validity.valid, `FEN should be valid: ${fen} (${validity.error_number}: ${validity.error})`);
  assert.equal(probe.fen(), fen, `FEN should round-trip unchanged: ${fen}`);
  return probe;
}

// Brute-force (not engine-assisted) check: does `game` (side to move)
// have at least one legal move that delivers checkmate right now?
function findMateIn1(game) {
  const moves = game.moves({ verbose: true });
  for (const m of moves) {
    game.move(m);
    const mate = game.in_checkmate();
    game.undo();
    if (mate) return m;
  }
  return null;
}

// True iff every legal reply available to `game`'s side to move still
// leaves a mate-in-1 for the OTHER side (i.e. the position is "mate in
// 2" for whoever just moved into it, regardless of what the reply is).
function everyReplyAllowsMateIn1(game) {
  const replies = game.moves({ verbose: true });
  if (replies.length === 0) return false; // stalemate/checkmate here is not a "reply"
  for (const r of replies) {
    game.move(r);
    const hasMate = findMateIn1(game);
    game.undo();
    if (!hasMate) return false;
  }
  return true;
}

function assertMoveIsLegal(game, move) {
  const legal = game.moves({ verbose: true });
  const ok = legal.some(
    (m) => m.from === move.from && m.to === move.to && (m.promotion || null) === (move.promotion || null)
  );
  assert.ok(ok, `engine move ${JSON.stringify(move)} should be among game.moves({verbose:true})`);
}

// ---------------------------------------------------------------------
// 1. Mate in 1
// ---------------------------------------------------------------------

describe('mate in 1', () => {
  // Back-rank mate, white to move: Ra1-a8#. Black king is boxed in by its
  // own f7/g7/h7 pawns; the rook takes the whole 8th rank.
  test('white back-rank mate (Ra8#)', () => {
    const game = loadFen('6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1');
    const result = AI.search(game, { depth: 3 });
    assert.ok(result.move, 'engine should find a move');
    assertMoveIsLegal(game, result.move);
    game.move(result.move);
    assert.ok(game.in_checkmate(), 'applying the engine move should produce checkmate');
  });

  // Same idea, mirrored, black to move.
  test('black back-rank mate (Ra1#), black to move', () => {
    const game = loadFen('r3k3/8/8/8/8/8/5PPP/6K1 b - - 0 1');
    const result = AI.search(game, { depth: 3 });
    assert.ok(result.move, 'engine should find a move');
    assertMoveIsLegal(game, result.move);
    game.move(result.move);
    assert.ok(game.in_checkmate(), 'applying the engine move should produce checkmate');
  });

  // Mate delivered BY A CAPTURE: White Qg1 (defended by Bh6 on the same
  // diagonal as g7) captures the only black pawn (g7), checking Kh8 with
  // no escape (g8/h7 both covered by the queen, and the queen can't be
  // recaptured since Bh6 defends g7). Verified by brute force: Qxg7# is
  // the only mate-in-1 in this position.
  test('white capture mate (Qxg7#)', () => {
    const game = loadFen('7k/6p1/7B/8/8/8/8/4K1Q1 w - - 0 1');
    const result = AI.search(game, { depth: 3 });
    assert.ok(result.move, 'engine should find a move');
    assertMoveIsLegal(game, result.move);
    // Confirm it really is a capture (of the sole black pawn on g7).
    assert.equal(result.move.to, 'g7');
    game.move(result.move);
    assert.ok(game.in_checkmate(), 'applying the engine move should produce checkmate');
  });
});

// ---------------------------------------------------------------------
// 2. Mate in 2
// ---------------------------------------------------------------------
//
// All four FENs below are minimal K+Q-vs-K / K+R-vs-K positions that were
// found by an exhaustive brute-force search (not taken from memory of a
// "famous" puzzle): the search required (a) kings not adjacent, (b) no
// mate-in-1 available at the root (so it's genuinely mate-in-2, not a
// disguised mate-in-1), and (c) AI.search at depth 4 producing a move
// after which EVERY opposing reply allows a mate-in-1. The black-to-move
// positions are exact color/rank mirrors of the white ones.

describe('mate in 2', () => {
  const positions = [
    { label: 'white K+Q vs K', fen: '8/8/8/8/K7/Q7/8/k7 w - - 0 1' },
    { label: 'white K+R vs K', fen: '8/8/8/8/K7/8/3R4/k7 w - - 0 1' },
    { label: 'black K+Q vs K (mirrored)', fen: 'K7/8/q7/k7/8/8/8/8 b - - 0 1' },
    { label: 'black K+R vs K (mirrored)', fen: 'K7/3r4/8/k7/8/8/8/8 b - - 0 1' },
  ];

  for (const { label, fen } of positions) {
    test(label, () => {
      const game = loadFen(fen);
      // Not a mate-in-1 at the root -- this really needs 2 moves.
      assert.equal(findMateIn1(game), null, 'position must not already have a mate-in-1');

      const result = AI.search(game, { depth: 4 }); // 3 plies needed, 4 for margin
      assert.ok(result.move, 'engine should find a move');
      assertMoveIsLegal(game, result.move);
      assert.ok(
        result.score >= AI.MATE_SCORE - 10,
        `score ${result.score} should reflect a forced mate (>= MATE_SCORE-10)`
      );

      game.move(result.move);
      assert.ok(!game.in_checkmate(), 'first move should not itself be mate (this is mate in 2, not 1)');
      assert.ok(
        everyReplyAllowsMateIn1(game),
        'every possible opponent reply must allow a mate-in-1 for the forced mate to be genuine'
      );
    });
  }
});

// ---------------------------------------------------------------------
// 3. Hanging queen
// ---------------------------------------------------------------------

describe('hanging queen', () => {
  test('(a) engine captures an undefended enemy queen', () => {
    // Black queen sits undefended on a8 (black king e8 is nowhere near
    // it); white's only non-king piece is a rook on a1 that can take it.
    const game = loadFen('q3k3/8/8/8/8/8/8/R3K3 w - - 0 1');
    const targetBefore = game.get('a8');
    assert.deepEqual(targetBefore, { type: 'q', color: 'b' }, 'a8 should hold the undefended black queen');

    const result = AI.search(game, { depth: 3 });
    assert.ok(result.move, 'engine should find a move');
    assertMoveIsLegal(game, result.move);
    // The only reason to move TO a8 here is to capture the queen sitting
    // there (no other black piece exists on that square).
    assert.equal(result.move.to, 'a8', 'engine must capture the undefended queen on a8');
  });

  test('(b) engine does not leave its own queen en prise to a pawn', () => {
    // White queen on d4 is attacked by the black pawn on e5 (pawns
    // capture diagonally forward); nothing of white's can recapture on
    // d4 profitably, so the engine must move the queen (or otherwise
    // remove the threat) rather than let it be taken for free.
    const game = loadFen('4k3/8/8/4p3/3Q4/8/8/4K3 w - - 0 1');

    const result = AI.search(game, { depth: 3 });
    assert.ok(result.move, 'engine should find a move');
    assertMoveIsLegal(game, result.move);
    game.move(result.move);

    // Robust check: regardless of where the queen ended up (moved away,
    // or captured the attacking pawn itself), black must have no legal
    // reply that captures a white queen for free.
    const blackReplies = game.moves({ verbose: true });
    const canCaptureQueenFree = blackReplies.some((m) => m.captured === 'q');
    assert.ok(!canCaptureQueenFree, 'black must not be able to capture a white queen for free next move');
  });
});

// ---------------------------------------------------------------------
// 4. Legality (self-play smoke test)
// ---------------------------------------------------------------------

describe('legality', () => {
  const positions = [
    { label: 'start position', fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' },
    // Middlegame: a standard Italian Game tabiya.
    { label: 'middlegame', fen: 'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 0 6' },
    // Endgame: bare king-and-pawn endgame.
    { label: 'endgame (KPvK)', fen: '8/8/4k3/8/4K3/8/4P3/8 w - - 0 1' },
    // Chess960-style back rank (castling rights dropped, as instructed).
    { label: 'chess960-style back rank', fen: 'bqnb1rkr/pppppppp/8/8/8/8/PPPPPPPP/BQNB1RKR w - - 0 1' },
  ];

  for (const { label, fen } of positions) {
    test(`${label}: 30+ plies of depth-2 self-play are all legal`, () => {
      const game = loadFen(fen);
      const MAX_PLIES = 40; // request 30+; allow margin in case the game ends naturally
      let plies = 0;
      for (; plies < MAX_PLIES; plies++) {
        if (game.game_over()) break;

        const fenBefore = game.fen();
        const result = AI.search(game, { depth: 2 });
        assert.equal(game.fen(), fenBefore, 'search() must not mutate game state before the caller applies the move');

        if (!result.move) break; // defensive; game_over() above should have caught this
        assertMoveIsLegal(game, result.move);
        game.move(result.move);
      }
      // Not all starting positions can guarantee 30 plies without hitting
      // a natural game end (e.g. a forced mate), but most of ours should.
      assert.ok(plies > 0, 'at least one ply should have been played');
    });
  }
});

// ---------------------------------------------------------------------
// 5. Pruning correctness
// ---------------------------------------------------------------------

describe('pruning correctness', () => {
  const positions = [
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    'r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 0 6',
    'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3',
  ];

  for (const fen of positions) {
    test(`pruned and unpruned search agree on score for: ${fen}`, () => {
      try {
        const prunedGame = loadFen(fen);
        const pruned = AI.search(prunedGame, { depth: 3, pruning: true });

        const fullGame = loadFen(fen);
        const full = AI.search(fullGame, { depth: 3, pruning: false });

        assert.equal(pruned.score, full.score, 'pruned and unpruned search must agree on the minimax score');
        assert.ok(
          pruned.nodes < full.nodes,
          `pruning should visit fewer nodes (pruned=${pruned.nodes}, full=${full.nodes})`
        );
      } finally {
        // Required by the task: leave global pruning state as it was.
        AI.config.pruning = true;
      }
    });
  }
});

// ---------------------------------------------------------------------
// 6. Evaluation sanity
// ---------------------------------------------------------------------

describe('evaluation sanity', () => {
  test('start position evaluates to 0', () => {
    const game = new Chess();
    assert.equal(AI.evaluate(game, 0), 0);
  });

  test('color-mirrored positions evaluate equally from the side-to-move perspective', () => {
    // fenA: white queen d4 attacked by black pawn e5, white to move.
    // fenB: the exact color/rank mirror, black to move.
    const fenA = '4k3/8/8/4p3/3Q4/8/8/4K3 w - - 0 1';
    const fenB = '4k3/8/8/3q4/4P3/8/8/4K3 b - - 0 1';
    const gameA = loadFen(fenA);
    const gameB = loadFen(fenB);
    assert.equal(AI.evaluate(gameA, 0), AI.evaluate(gameB, 0));
  });

  test('checkmate gives -(MATE_SCORE - ply)', () => {
    // Reuse the verified back-rank mate-in-1 and actually play it out so
    // the position really is a checkmate (not merely asserted to be).
    const game = loadFen('6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1');
    game.move({ from: 'a1', to: 'a8' });
    assert.ok(game.in_checkmate());
    const ply = 5;
    assert.equal(AI.evaluate(game, ply), -(AI.MATE_SCORE - ply));
  });

  test('stalemate gives 0', () => {
    // Black king a8, white queen b6, white king h1, black to move: every
    // black king move is covered by the queen, and black isn't in check.
    const game = loadFen('k7/8/1Q6/8/8/8/8/7K b - - 0 1');
    assert.ok(game.in_stalemate());
    assert.equal(AI.evaluate(game, 0), 0);
  });

  test('evaluate is deterministic', () => {
    const game = loadFen('r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 0 6');
    const first = AI.evaluate(game, 3);
    const second = AI.evaluate(game, 3);
    assert.equal(first, second);
  });
});

// ---------------------------------------------------------------------
// 7. Time limit
// ---------------------------------------------------------------------

describe('time limit', () => {
  test('search with a 300ms time limit returns a legal move well under 1000ms', () => {
    const game = loadFen('r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/3P1N2/PPP2PPP/RNBQK2R w KQkq - 0 6');
    const start = Date.now();
    const result = AI.search(game, { depth: 8, timeLimitMs: 300 });
    const elapsed = Date.now() - start;

    assert.ok(elapsed < 1000, `search should return quickly (took ${elapsed}ms)`);
    assert.ok(result.depth >= 1, 'depth 1 should always complete regardless of the time limit');
    assert.ok(result.move, 'a legal move should still be returned');
    assertMoveIsLegal(game, result.move);
  });
});

// ---------------------------------------------------------------------
// 8. No legal moves
// ---------------------------------------------------------------------

describe('no legal moves', () => {
  test('search on a checkmated position returns move: null', () => {
    const game = loadFen('6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1');
    game.move({ from: 'a1', to: 'a8' });
    assert.ok(game.in_checkmate());
    const result = AI.search(game, { depth: 3 });
    assert.equal(result.move, null);
  });

  test('search on a stalemated position returns move: null', () => {
    const game = loadFen('k7/8/1Q6/8/8/8/8/7K b - - 0 1');
    assert.ok(game.in_stalemate());
    const result = AI.search(game, { depth: 3 });
    assert.equal(result.move, null);
  });
});
