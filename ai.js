/**
 * ai.js - minimax/negamax chess search engine (plain JS, no build step).
 *
 * Works in three environments with no bundler:
 *   - browser <script src="ai.js"></script>           -> window.AI
 *   - Web Worker importScripts('chess.js','ai.js')     -> self.AI
 *   - Node    const AI = require('./ai.js')            -> module.exports
 *
 * This file does NOT require or load chess.js itself - every function takes
 * an already-constructed chess.js 0.x `game` instance (the legacy snake_case
 * API: game_over(), in_draw(), in_checkmate(), moves({verbose:true}), move(),
 * undo(), turn(), board(), fen(), load()) as an argument.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------

  var MATE_SCORE = 100000;

  var PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

  // Piece-square tables (Tomasz Michniewski's "simplified evaluation
  // function" values). Each table is 8x8, row 0 = rank 8, row 7 = rank 1,
  // col 0 = file a, col 7 = file h - i.e. written from WHITE's point of
  // view exactly as it reads on a diagram with white at the bottom.
  // For a BLACK piece on the same square, the table is looked up with the
  // row mirrored (7 - row) so the "advance toward the enemy" bonuses point
  // the correct way for black too.
  var PST = {
    p: [
      [0, 0, 0, 0, 0, 0, 0, 0],
      [50, 50, 50, 50, 50, 50, 50, 50],
      [10, 10, 20, 30, 30, 20, 10, 10],
      [5, 5, 10, 25, 25, 10, 5, 5],
      [0, 0, 0, 20, 20, 0, 0, 0],
      [5, -5, -10, 0, 0, -10, -5, 5],
      [5, 10, 10, -20, -20, 10, 10, 5],
      [0, 0, 0, 0, 0, 0, 0, 0]
    ],
    n: [
      [-50, -40, -30, -30, -30, -30, -40, -50],
      [-40, -20, 0, 0, 0, 0, -20, -40],
      [-30, 0, 10, 15, 15, 10, 0, -30],
      [-30, 5, 15, 20, 20, 15, 5, -30],
      [-30, 0, 15, 20, 20, 15, 0, -30],
      [-30, 5, 10, 15, 15, 10, 5, -30],
      [-40, -20, 0, 5, 5, 0, -20, -40],
      [-50, -40, -30, -30, -30, -30, -40, -50]
    ],
    b: [
      [-20, -10, -10, -10, -10, -10, -10, -20],
      [-10, 0, 0, 0, 0, 0, 0, -10],
      [-10, 0, 5, 10, 10, 5, 0, -10],
      [-10, 5, 5, 10, 10, 5, 5, -10],
      [-10, 0, 10, 10, 10, 10, 0, -10],
      [-10, 10, 10, 10, 10, 10, 10, -10],
      [-10, 5, 0, 0, 0, 0, 5, -10],
      [-20, -10, -10, -10, -10, -10, -10, -20]
    ],
    r: [
      [0, 0, 0, 0, 0, 0, 0, 0],
      [5, 10, 10, 10, 10, 10, 10, 5],
      [-5, 0, 0, 0, 0, 0, 0, -5],
      [-5, 0, 0, 0, 0, 0, 0, -5],
      [-5, 0, 0, 0, 0, 0, 0, -5],
      [-5, 0, 0, 0, 0, 0, 0, -5],
      [-5, 0, 0, 0, 0, 0, 0, -5],
      [0, 0, 0, 5, 5, 0, 0, 0]
    ],
    q: [
      [-20, -10, -10, -5, -5, -10, -10, -20],
      [-10, 0, 0, 0, 0, 0, 0, -10],
      [-10, 0, 5, 5, 5, 5, 0, -10],
      [-5, 0, 5, 5, 5, 5, 0, -5],
      [0, 0, 5, 5, 5, 5, 0, -5],
      [-10, 5, 5, 5, 5, 5, 0, -10],
      [-10, 0, 5, 0, 0, 0, 0, -10],
      [-20, -10, -10, -5, -5, -10, -10, -20]
    ],
    k: [
      [-30, -40, -40, -50, -50, -40, -40, -30],
      [-30, -40, -40, -50, -50, -40, -40, -30],
      [-30, -40, -40, -50, -50, -40, -40, -30],
      [-30, -40, -40, -50, -50, -40, -40, -30],
      [-20, -30, -30, -40, -40, -30, -30, -20],
      [-10, -20, -20, -20, -20, -20, -20, -10],
      [20, 20, 0, 0, 0, 0, 20, 20],
      [20, 30, 10, 0, 0, 10, 30, 20]
    ],
    k_end: [
      [-50, -40, -30, -20, -20, -30, -40, -50],
      [-30, -20, -10, 0, 0, -10, -20, -30],
      [-30, -10, 20, 30, 30, 20, -10, -30],
      [-30, -10, 30, 40, 40, 30, -10, -30],
      [-30, -10, 30, 40, 40, 30, -10, -30],
      [-30, -10, 20, 30, 30, 20, -10, -30],
      [-30, -30, 0, 0, 0, 0, -30, -30],
      [-50, -30, -30, -30, -30, -30, -30, -50]
    ]
  };

  // Node counter for search diagnostics / benchmarking.
  var nodes = 0;
  function resetNodes() { nodes = 0; }
  function getNodes() { return nodes; }

  // ---------------------------------------------------------------------
  // Evaluation
  // ---------------------------------------------------------------------

  // Threshold (in centipawns) used by the endgame detector below: a side
  // counts as "down to endgame material" once its non-pawn, non-king
  // material is worth no more than a rook plus a bishop (500 + 330 = 830).
  var ENDGAME_MATERIAL_THRESHOLD = PIECE_VALUES.r + PIECE_VALUES.b;

  /**
   * Static evaluation of `game` from the perspective of the side to move
   * (negamax convention: positive = good for whoever moves next).
   *
   * Terminal handling:
   *  - checkmate -> -(MATE_SCORE - ply), so a mate found sooner (smaller
   *    ply) scores closer to -MATE_SCORE, i.e. is preferred/avoided more
   *    strongly than a mate found deeper. The side to move is the one who
   *    got mated, hence the large NEGATIVE score for them.
   *  - any other game-over state (in_draw(): stalemate, insufficient
   *    material, threefold repetition, or the 50-move rule, per this
   *    chess.js build's in_draw() implementation) -> 0.
   *  - otherwise: material + piece-square tables, white-relative, then
   *    flipped to the side-to-move's perspective.
   */
  function evaluate(game, ply) {
    if (game.in_checkmate()) {
      return -(MATE_SCORE - ply);
    }
    if (game.in_draw()) {
      return 0;
    }

    var b = game.board(); // b[0] = rank 8 ... b[7] = rank 1, matching PST layout
    var r, c, sq, val;

    // First pass: figure out whether we're in an endgame, so we know which
    // king PST to use. Endgame = no queens left on the board at all, OR
    // both sides' remaining non-pawn material is <= a rook+bishop's worth.
    var whiteNonPawn = 0, blackNonPawn = 0, whiteQueens = 0, blackQueens = 0;
    for (r = 0; r < 8; r++) {
      for (c = 0; c < 8; c++) {
        sq = b[r][c];
        if (!sq || sq.type === 'p' || sq.type === 'k') continue;
        val = PIECE_VALUES[sq.type];
        if (sq.color === 'w') {
          whiteNonPawn += val;
          if (sq.type === 'q') whiteQueens++;
        } else {
          blackNonPawn += val;
          if (sq.type === 'q') blackQueens++;
        }
      }
    }
    var noQueens = whiteQueens === 0 && blackQueens === 0;
    var lowMaterial =
      whiteNonPawn <= ENDGAME_MATERIAL_THRESHOLD &&
      blackNonPawn <= ENDGAME_MATERIAL_THRESHOLD;
    var isEndgame = noQueens || lowMaterial;

    // Second pass: material + PST, white-relative.
    var score = 0;
    for (r = 0; r < 8; r++) {
      for (c = 0; c < 8; c++) {
        sq = b[r][c];
        if (!sq) continue;
        val = PIECE_VALUES[sq.type];
        var table = sq.type === 'k' && isEndgame ? PST.k_end : PST[sq.type];
        var pstVal = sq.color === 'w' ? table[r][c] : table[7 - r][c];
        var total = val + pstVal;
        score += sq.color === 'w' ? total : -total;
      }
    }

    return game.turn() === 'w' ? score : -score;
  }

  // ---------------------------------------------------------------------
  // Move ordering
  // ---------------------------------------------------------------------

  // Three ordering tiers, highest sorts first: captures/promotions (by
  // MVV-LVA), then checks, then everything else. Big gaps between tiers
  // so within-tier MVV-LVA deltas never spill into the next tier.
  var TIER_CAPTURE = 1000000;
  var TIER_CHECK = 500000;

  function isCheckSan(san) {
    return typeof san === 'string' && (san.indexOf('+') !== -1 || san.indexOf('#') !== -1);
  }

  function moveOrderScore(m) {
    var isCapture = !!m.captured;
    var isPromotion = !!m.promotion;
    if (isCapture || isPromotion) {
      // MVV-LVA: victim value*10 - attacker value. A non-capturing
      // promotion has no real "victim", so it's valued as if capturing a
      // queen-weight target (promotions are tactically urgent too), and
      // the promoted-to piece's value is added on top so Q promotions
      // outrank lesser-piece promotions.
      var victimValue = isCapture ? PIECE_VALUES[m.captured] : PIECE_VALUES.q;
      var attackerValue = PIECE_VALUES[m.piece];
      var mvvLva = victimValue * 10 - attackerValue;
      if (isPromotion) mvvLva += PIECE_VALUES[m.promotion];
      return TIER_CAPTURE + mvvLva;
    }
    if (isCheckSan(m.san)) {
      return TIER_CHECK;
    }
    return 0;
  }

  /**
   * Order moves: captures first (MVV-LVA descending, promotions treated as
   * high-value captures), then checks, then the rest. Stable for ties
   * (original relative order preserved within equal scores).
   */
  function orderMoves(moves) {
    var tagged = moves.map(function (m, i) {
      return { m: m, score: moveOrderScore(m), i: i };
    });
    tagged.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return a.i - b.i; // stable tie-break, independent of engine sort stability
    });
    return tagged.map(function (t) { return t.m; });
  }

  // ---------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------

  var config = { pruning: true };

  /**
   * Fail-hard negamax with alpha-beta pruning.
   *   g     - chess.js game instance (mutated and restored via move/undo)
   *   depth - plies remaining to search
   *   alpha, beta - search window (negamax convention)
   *   ply   - plies from the root (used for mate scoring)
   *
   * When config.pruning === false this performs a full minimax scan of
   * every move (no cutoffs), used to benchmark pruned vs unpruned node
   * counts. In that mode the returned value is tracked independently of
   * the incoming alpha/beta window (via `best`), so a tight window handed
   * down from a pruning-enabled ancestor can never clip the true minimax
   * value - see the task note about this pitfall.
   */
  function negamax(g, depth, alpha, beta, ply) {
    nodes++;
    if (depth === 0 || g.game_over()) {
      return evaluate(g, ply);
    }

    var moves = orderMoves(g.moves({ verbose: true }));
    var best = -Infinity;

    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      g.move(m);
      var score = -negamax(g, depth - 1, -beta, -alpha, ply + 1);
      g.undo();

      if (config.pruning) {
        if (score >= beta) return beta; // fail-hard beta cutoff
        if (score > alpha) alpha = score;
      } else {
        if (score > best) best = score; // full scan, no cutoff
      }
    }

    return config.pruning ? alpha : best;
  }

  /**
   * Root search. opts = { depth = 3, timeLimitMs = null, pruning = true }.
   *
   * Without a time limit, searches exactly `depth` plies.
   * With a time limit, iterative deepening from depth 1 up to `depth`;
   * the clock is only checked between ROOT moves (never mid-recursion),
   * so every g.move()/g.undo() pair always completes and depth 1 always
   * finishes. On timeout the in-progress iteration is abandoned and the
   * last fully-completed iteration's result is returned. The previous
   * iteration's best move is searched first at the next depth.
   *
   * Returns { move: {from,to,promotion,san} | null, score, depth, nodes, timeMs }.
   */
  function search(game, opts) {
    opts = opts || {};
    var maxDepth = typeof opts.depth === 'number' ? opts.depth : 3;
    var timeLimitMs = typeof opts.timeLimitMs === 'number' ? opts.timeLimitMs : null;
    var pruning = typeof opts.pruning === 'boolean' ? opts.pruning : true;

    var prevPruning = config.pruning;
    config.pruning = pruning;
    resetNodes();

    var startTime = Date.now();
    var originalFen = game.fen();

    var legalMoves = game.moves({ verbose: true });
    if (legalMoves.length === 0) {
      config.pruning = prevPruning;
      return { move: null, score: 0, depth: 0, nodes: getNodes(), timeMs: Date.now() - startTime };
    }

    var bestMove = null;
    var bestScore = -Infinity;
    var completedDepth = 0;
    var preferredMove = null; // best move from the previous completed iteration

    for (var depth = 1; depth <= maxDepth; depth++) {
      var ordered = orderMoves(legalMoves);
      if (preferredMove) {
        var idx = -1;
        for (var k = 0; k < ordered.length; k++) {
          var cand = ordered[k];
          if (
            cand.from === preferredMove.from &&
            cand.to === preferredMove.to &&
            (cand.promotion || null) === (preferredMove.promotion || null)
          ) {
            idx = k;
            break;
          }
        }
        if (idx > 0) {
          var pm = ordered.splice(idx, 1)[0];
          ordered.unshift(pm);
        }
      }

      var iterBestMove = null;
      var iterBestScore = -Infinity;
      var alpha = -Infinity;
      var beta = Infinity;
      var timedOut = false;

      for (var mi = 0; mi < ordered.length; mi++) {
        // Only check the clock between root moves, and never on depth 1,
        // so depth 1 always completes and no move()/undo() is ever left
        // unmatched.
        if (timeLimitMs !== null && depth > 1 && Date.now() - startTime > timeLimitMs) {
          timedOut = true;
          break;
        }

        var m = ordered[mi];
        game.move(m);
        var score = -negamax(game, depth - 1, -beta, -alpha, 1);
        game.undo();

        if (score > iterBestScore) {
          iterBestScore = score;
          iterBestMove = m;
        }
        if (score > alpha) alpha = score;
      }

      if (timedOut) {
        break; // abandon this iteration; keep the previous completed one
      }

      bestMove = iterBestMove;
      bestScore = iterBestScore;
      completedDepth = depth;
      preferredMove = iterBestMove;

      if (timeLimitMs !== null && Date.now() - startTime > timeLimitMs) {
        break; // out of time budget, don't start a deeper iteration
      }
    }

    config.pruning = prevPruning;

    // Safety net: every move() above is matched by an undo(), so this
    // should be a no-op, but guard against leaving the game mutated.
    if (game.fen() !== originalFen) {
      game.load(originalFen);
    }

    return {
      move: bestMove
        ? { from: bestMove.from, to: bestMove.to, promotion: bestMove.promotion || null, san: bestMove.san }
        : null,
      score: bestScore,
      depth: completedDepth,
      nodes: getNodes(),
      timeMs: Date.now() - startTime
    };
  }

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------

  var AI = {
    MATE_SCORE: MATE_SCORE,
    PIECE_VALUES: PIECE_VALUES,
    PST: PST,
    config: config,
    evaluate: evaluate,
    orderMoves: orderMoves,
    negamax: negamax,
    search: search,
    resetNodes: resetNodes,
    getNodes: getNodes
  };

  if (typeof self !== 'undefined') {
    self.AI = AI;
  } else if (typeof window !== 'undefined') {
    window.AI = AI;
  } else if (typeof globalThis !== 'undefined') {
    globalThis.AI = AI;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AI;
  }
})();
