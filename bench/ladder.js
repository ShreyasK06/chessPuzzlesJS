#!/usr/bin/env node
/**
 * bench/ladder.js
 *
 * Ladder benchmark across the four AI difficulty levels:
 *   Beginner -> Easy -> Medium -> Hard
 *
 * Each adjacent pair plays a seeded match (mulberry32 PRNG, copied from the
 * retired bench/match.js) from 5 fixed opening FENs, each played twice per
 * colour (20 games per pairing by default). Medium vs Hard is additionally
 * re-run at HARD_MS = 100 ("Hard @100 ms") to show how much of Hard's
 * strength comes from search time vs. raw evaluation/move ordering.
 *
 * Levels:
 *   Beginner - random check, else random capture, else random move
 *              (main.js's makeBeginnerMove() logic).
 *   Easy     - AI.pickEasyMove(AI.scoreRootMoves(g, 2), rng)
 *   Medium   - AI.search(g, { depth: 3, timeLimitMs: 1500 })
 *   Hard     - Engine.search(g.fen(), { timeLimitMs: HARD_MS, history })
 *
 * Beginner/Easy move choices are seeded (mulberry32) so they're reproducible
 * run to run. Hard's opening book uses Math.random() internally, so Hard's
 * book moves (and therefore games that reach them) are not fully
 * deterministic - that's expected and fine; it's why many games are played.
 *
 * Per pairing we report the stronger side's W/D/L, score s = (W + D/2) / N,
 * an Elo gap -400*log10(1/s - 1), and a 95% confidence interval on s
 * (s +/- 1.96*sqrt(s(1-s)/N), clamped to (0,1)) converted to a gap range.
 * If s is 0 or 1 we instead report a one-sided bound (see eloGap below).
 *
 * Levels are chained from an anchor of Medium = 1200 to produce estimated
 * relative ratings for Beginner, Easy, Medium and Hard.
 *
 * Flags:
 *   --games N     games per pairing (default 20); also scales the
 *                 Medium-vs-Hard@100ms extra run to max(2, floor(N/2))
 *                 (default 10 when N=20).
 *   --hard-ms N   Hard's timeLimitMs for the main Medium-vs-Hard pairing
 *                 (default 2000). The @100ms sweep always uses 100ms.
 *   --selftest    print a couple of eloGap() sanity values and exit.
 *
 * Run: node bench/ladder.js [--games N] [--hard-ms N]
 * Writes raw results to bench/ladder-results.json.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Chess } = require('../chess.js');
const AI = require('../ai.js');
const Engine = require('../engine.js');

// ---------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------
function parseArgs(argv) {
  const out = { games: 20, hardMs: 2000, selftest: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--games') {
      out.games = parseInt(argv[++i], 10);
    } else if (a === '--hard-ms') {
      out.hardMs = parseInt(argv[++i], 10);
    } else if (a === '--selftest') {
      out.selftest = true;
    }
  }
  return out;
}

// ---------------------------------------------------------------------
// Seeded PRNG (mulberry32), copied verbatim from the retired bench/match.js
// so Beginner/Easy move choices stay reproducible across runs.
// ---------------------------------------------------------------------
const SEED = 20260101;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(SEED);
function randInt(n) {
  return Math.floor(rng() * n);
}

// ---------------------------------------------------------------------
// Beginner: random check, else random capture, else random move.
// Replicates main.js's makeBeginnerMove() (UI/setTimeout bits omitted,
// Math.random() replaced with the seeded rng).
// ---------------------------------------------------------------------
function pickBeginnerMove(game) {
  const possibleMoves = game.moves({ verbose: true });
  if (possibleMoves.length === 0) return null;

  const captureMoves = possibleMoves.filter(function (m) { return m.captured; });
  const checkMoves = possibleMoves.filter(function (m) { return m.san.indexOf('+') !== -1; });

  if (checkMoves.length > 0) return checkMoves[randInt(checkMoves.length)];
  if (captureMoves.length > 0) return captureMoves[randInt(captureMoves.length)];
  return possibleMoves[randInt(possibleMoves.length)];
}

// ---------------------------------------------------------------------
// Easy: AI.pickEasyMove(AI.scoreRootMoves(g, 2), rng)
// ---------------------------------------------------------------------
function pickEasyMove(game) {
  const scored = AI.scoreRootMoves(game, 2);
  return AI.pickEasyMove(scored, rng); // {from,to,promotion,san} | null
}

// ---------------------------------------------------------------------
// Medium: AI.search(g, { depth: 3, timeLimitMs: 1500 })
// ---------------------------------------------------------------------
function pickMediumMove(game) {
  const res = AI.search(game, { depth: 3, timeLimitMs: 1500 });
  return res.move; // {from,to,promotion,san} | null
}

// ---------------------------------------------------------------------
// Hard: Engine.search(fen, { timeLimitMs, history })
// `history` is the array of earlier FENs in this game, oldest first,
// excluding the current position (mirrors main.js's getPositionHistory()).
// ---------------------------------------------------------------------
function makePickHardMove(hardMs) {
  return function pickHardMove(game, history) {
    const res = Engine.search(game.fen(), { timeLimitMs: hardMs, history: history });
    return res.move; // {from,to,promotion} | null
  };
}

// ---------------------------------------------------------------------
// Pure Elo-gap math.
// ---------------------------------------------------------------------

/**
 * Elo rating-point gap implied by a score fraction s (0 < s < 1).
 * gap(0.5) = 0, gap(0.75) ~= 191.
 */
function eloGap(s) {
  const g = -400 * Math.log10(1 / s - 1);
  return g === 0 ? 0 : g; // normalize -0 to 0 for display/comparison
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

/**
 * Elo gap + 95% interval for a stronger side that scored `wins`/`draws`/
 * `losses` out of N games (score s = (W + D/2) / N).
 *
 * Returns { s, n, gap, lo, hi, bound } where `bound` is '>=' when s is 0 or
 * 1 (gap/lo/hi are then all equal - a one-sided bound, not an interval),
 * and '' otherwise.
 */
function pairingElo(wins, draws, losses) {
  const n = wins + draws + losses;
  const s = (wins + draws / 2) / n;

  if (s <= 0 || s >= 1) {
    // s = (N - 0.5) / N keeps the "won every game" case finite; gap is then
    // a lower bound on the true gap (the real s could be even higher).
    // By symmetry, "lost every game" uses s = 0.5 / N and the same ">="
    // label on the magnitude of the (negative) gap.
    const effectiveS = s >= 1 ? (n - 0.5) / n : 0.5 / n;
    const g = eloGap(effectiveS);
    return { s: s, n: n, gap: g, lo: g, hi: g, bound: '>=' };
  }

  const g = eloGap(s);
  const se = Math.sqrt((s * (1 - s)) / n);
  const loS = clamp(s - 1.96 * se, 1e-6, 1 - 1e-6);
  const hiS = clamp(s + 1.96 * se, 1e-6, 1 - 1e-6);
  return { s: s, n: n, gap: g, lo: eloGap(loS), hi: eloGap(hiS), bound: '' };
}

function fmtGap(r) {
  if (r.bound === '>=') {
    return (r.gap >= 0 ? '>= +' : '>= ') + r.gap.toFixed(0);
  }
  return r.gap.toFixed(0) + ' [' + r.lo.toFixed(0) + ', ' + r.hi.toFixed(0) + ']';
}

// ---------------------------------------------------------------------
// Openings: 5 fixed FENs, each played twice per colour.
// ---------------------------------------------------------------------
const OPENINGS = [
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
  'rnbqk2r/ppp1ppbp/3p1np1/8/2PPP3/2N5/PP3PPP/R1BQKBNR w KQkq - 0 5',
  'rnbqkbnr/ppp2ppp/4p3/3p4/3PP3/2N5/PPP2PPP/R1BQKBNR b KQkq - 0 1',
  'rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP2PPPP/RNBQKBNR b KQkq - 0 1'
];

const MAX_PLIES = 200;

/**
 * Play one game. `strongerFn`/`weakerFn` are (game, history) => move
 * pickers; `strongerColor` ('w'|'b') says which side `strongerFn` plays.
 * Both pickers may return either a SAN string (Beginner/Easy via chess.js
 * moves()) or a verbose {from,to,promotion,...} object (Medium/Hard).
 */
function playGame(openingFen, strongerColor, strongerFn, weakerFn) {
  const game = new Chess(openingFen);
  const history = [];
  let plies = 0;
  let adjudicated = false;

  while (!game.game_over()) {
    if (plies >= MAX_PLIES) {
      adjudicated = true;
      break;
    }

    const sideToMove = game.turn(); // 'w' | 'b'
    const fenBeforeMove = game.fen();
    const moveChoice = sideToMove === strongerColor
      ? strongerFn(game, history)
      : weakerFn(game, history);

    if (!moveChoice) {
      // No legal moves despite game_over() being false - shouldn't happen,
      // but don't spin forever if it does.
      break;
    }

    const applied = typeof moveChoice === 'string'
      ? game.move(moveChoice)
      : game.move({ from: moveChoice.from, to: moveChoice.to, promotion: moveChoice.promotion || undefined });
    if (!applied) {
      throw new Error(
        'Illegal move produced (stronger=' + strongerColor + '): ' +
        JSON.stringify(moveChoice) + ' at FEN ' + fenBeforeMove
      );
    }

    history.push(fenBeforeMove);
    plies++;
  }

  let result; // 'stronger_win' | 'stronger_loss' | 'draw'
  let reason;
  if (!adjudicated && game.in_checkmate()) {
    const matedColor = game.turn(); // side to move = side that got mated
    result = matedColor === strongerColor ? 'stronger_loss' : 'stronger_win';
    reason = 'checkmate';
  } else if (adjudicated) {
    result = 'draw';
    reason = 'adjudicated at ' + MAX_PLIES + ' plies';
  } else {
    result = 'draw';
    reason = game.in_stalemate() ? 'stalemate'
      : game.insufficient_material() ? 'insufficient material'
      : game.in_threefold_repetition() ? 'threefold repetition'
      : '50-move rule';
  }

  return { result: result, reason: reason, plies: plies, finalFen: game.fen() };
}

/**
 * Run `n` games for one pairing, cycling through the 5 openings and
 * alternating which named side is "stronger" (plays strongerFn) every
 * full pass through the opening list - this reproduces "each opening
 * played twice per colour" at n=20 and degrades sensibly for other n.
 */
function runPairing(label, strongerName, weakerName, strongerFn, weakerFn, n) {
  const games = [];
  for (let i = 0; i < n; i++) {
    const opening = OPENINGS[i % OPENINGS.length];
    const pass = Math.floor(i / OPENINGS.length);
    const strongerColor = pass % 2 === 0 ? 'w' : 'b';

    const t0 = Date.now();
    const g = playGame(opening, strongerColor, strongerFn, weakerFn);
    const wallMs = Date.now() - t0;
    const record = {
      gameIndex: i,
      openingIndex: i % OPENINGS.length,
      strongerColor: strongerColor,
      result: g.result,
      reason: g.reason,
      plies: g.plies,
      wallMs: wallMs
    };
    games.push(record);
    console.log(
      '  [' + label + ']', 'game', (i + 1) + '/' + n,
      '-', strongerName, 'as', strongerColor === 'w' ? 'White' : 'Black',
      '-', record.result, '(' + record.reason + ')',
      '-', record.plies, 'plies -', wallMs, 'ms'
    );
  }

  const wins = games.filter(function (g) { return g.result === 'stronger_win'; }).length;
  const draws = games.filter(function (g) { return g.result === 'draw'; }).length;
  const losses = games.filter(function (g) { return g.result === 'stronger_loss'; }).length;
  const totalPlies = games.reduce(function (s, g) { return s + g.plies; }, 0);
  const totalWallMs = games.reduce(function (s, g) { return s + g.wallMs; }, 0);
  const elo = pairingElo(wins, draws, losses);

  return {
    label: label,
    strongerName: strongerName,
    weakerName: weakerName,
    games: games,
    wins: wins,
    draws: draws,
    losses: losses,
    n: n,
    score: elo.s,
    eloGap: elo.gap,
    eloLo: elo.lo,
    eloHi: elo.hi,
    eloBound: elo.bound,
    avgPlies: totalPlies / n,
    totalWallMs: totalWallMs
  };
}

function printPairingSummary(p) {
  console.log(
    '  ' + p.strongerName + ' vs ' + p.weakerName + ':',
    'W' + p.wins + '/D' + p.draws + '/L' + p.losses,
    '- score', p.score.toFixed(3),
    '- Elo gap', fmtGap({ gap: p.eloGap, lo: p.eloLo, hi: p.eloHi, bound: p.eloBound }),
    '- avg', p.avgPlies.toFixed(1), 'plies'
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.selftest) {
    console.log('eloGap(0.5) =', eloGap(0.5));
    console.log('eloGap(0.75) =', eloGap(0.75).toFixed(0));
    return;
  }

  const GAMES = args.games;
  const HARD_MS = args.hardMs;
  const SWEEP_HARD_MS = 100;
  const SWEEP_GAMES = Math.max(2, Math.floor(GAMES / 2));

  console.log('Machine: Node', process.version, '|', os.cpus()[0].model, '|', os.platform(), os.arch());
  console.log(
    'Seed:', SEED, '| games per pairing:', GAMES, '| Hard timeLimitMs:', HARD_MS,
    '| draw adjudicated at', MAX_PLIES, 'plies'
  );
  console.log('');

  const overallStart = Date.now();

  console.log('Beginner vs Easy (' + GAMES + ' games):');
  const beginnerEasy = runPairing(
    'Beginner-Easy', 'Easy', 'Beginner',
    function (g) { return pickEasyMove(g); },
    function (g) { return pickBeginnerMove(g); },
    GAMES
  );
  console.log('');

  console.log('Easy vs Medium (' + GAMES + ' games):');
  const easyMedium = runPairing(
    'Easy-Medium', 'Medium', 'Easy',
    function (g) { return pickMediumMove(g); },
    function (g) { return pickEasyMove(g); },
    GAMES
  );
  console.log('');

  console.log('Medium vs Hard (' + GAMES + ' games, Hard @' + HARD_MS + 'ms):');
  const pickHardMain = makePickHardMove(HARD_MS);
  const mediumHard = runPairing(
    'Medium-Hard', 'Hard', 'Medium',
    function (g, h) { return pickHardMain(g, h); },
    function (g) { return pickMediumMove(g); },
    GAMES
  );
  console.log('');

  console.log('Medium vs Hard @100ms (' + SWEEP_GAMES + ' games):');
  const pickHardSweep = makePickHardMove(SWEEP_HARD_MS);
  const mediumHard100 = runPairing(
    'Medium-Hard@100ms', 'Hard@100ms', 'Medium',
    function (g, h) { return pickHardSweep(g, h); },
    function (g) { return pickMediumMove(g); },
    SWEEP_GAMES
  );
  console.log('');

  const overallWallMs = Date.now() - overallStart;

  console.log('Summary:');
  for (const p of [beginnerEasy, easyMedium, mediumHard, mediumHard100]) {
    printPairingSummary(p);
  }
  console.log('  Total wall time:', (overallWallMs / 1000).toFixed(1) + 's');
  console.log('');

  // ---------------------------------------------------------------------
  // Chain the gaps from an anchor of Medium = 1200 to get estimated
  // relative ratings for every level.
  // ---------------------------------------------------------------------
  const MEDIUM_ANCHOR = 1200;
  const estimated = {
    Medium: { rating: MEDIUM_ANCHOR, lo: MEDIUM_ANCHOR, hi: MEDIUM_ANCHOR },
    Easy: {
      rating: MEDIUM_ANCHOR - easyMedium.eloGap,
      lo: MEDIUM_ANCHOR - easyMedium.eloHi,
      hi: MEDIUM_ANCHOR - easyMedium.eloLo
    },
    Hard: {
      rating: MEDIUM_ANCHOR + mediumHard.eloGap,
      lo: MEDIUM_ANCHOR + mediumHard.eloLo,
      hi: MEDIUM_ANCHOR + mediumHard.eloHi
    }
  };
  // Beginner is chained off Easy using the Beginner-Easy gap.
  const easyRating = estimated.Easy.rating;
  estimated.Beginner = {
    rating: easyRating - beginnerEasy.eloGap,
    lo: estimated.Easy.lo - beginnerEasy.eloHi,
    hi: estimated.Easy.hi - beginnerEasy.eloLo
  };

  console.log('Estimated ratings (relative, anchored on Medium = ' + MEDIUM_ANCHOR + '):');
  for (const name of ['Beginner', 'Easy', 'Medium', 'Hard']) {
    const r = estimated[name];
    console.log('  ' + name + ':', r.rating.toFixed(0), '[' + r.lo.toFixed(0) + ', ' + r.hi.toFixed(0) + ']');
  }
  console.log('');

  const output = {
    machine: {
      node: process.version,
      cpu: os.cpus()[0].model,
      platform: os.platform(),
      arch: os.arch()
    },
    generatedAt: new Date().toISOString(),
    seed: SEED,
    gamesPerPairing: GAMES,
    hardTimeLimitMs: HARD_MS,
    sweepHardTimeLimitMs: SWEEP_HARD_MS,
    sweepGames: SWEEP_GAMES,
    maxPlies: MAX_PLIES,
    overallWallMs: overallWallMs,
    pairings: [beginnerEasy, easyMedium, mediumHard, mediumHard100],
    estimatedRatings: estimated,
    anchor: { level: 'Medium', rating: MEDIUM_ANCHOR }
  };

  const outPath = path.join(__dirname, 'ladder-results.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log('Raw results written to', outPath);
}

if (require.main === module) {
  main();
}

module.exports = { eloGap: eloGap, pairingElo: pairingElo };
