#!/usr/bin/env node
/**
 * bench/match.js
 *
 * Plays the Hard AI (ai.js's negamax/alpha-beta search) against the Easy
 * and Medium move-pickers used elsewhere in this app, 20 games each,
 * alternating which colour Hard plays. Adjudicates a draw at 200 plies.
 * Easy and Medium replicate main.js's makeRandomMove()/makeMediumMove()
 * exactly (see comments below), minus the UI/setTimeout bits, and use a
 * seeded PRNG so results are reproducible.
 *
 * Hard setting: see HARD_DEPTH / HARD_TIME_LIMIT_MS below. The default
 * is AI.search with depth 3 and no time limit, as specified. A one-off
 * sample of bench/benchmark.js's depth-3/pruned timings (the setting
 * used here) showed per-move costs from a few ms up to ~700ms even in
 * the richest opening positions, and a game is roughly half Hard moves,
 * half opponent moves (near-instant), so 40 games of this scope were
 * expected to comfortably finish well under the ~20 minute budget - this
 * script prints and records the actual total wall time so that estimate
 * can be checked against what really happened, not assumed.
 *
 * Run: node bench/match.js
 * Writes raw results to bench/match-results.json.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Chess } = require('../chess.js');
const AI = require('../ai.js');

// ---------------------------------------------------------------------
// Seeded PRNG (mulberry32) so Easy/Medium move choices are reproducible
// across runs given the same SEED.
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
// Easy: uniformly random legal move. Replicates main.js's
// makeRandomMove(), which does:
//   const possibleMoves = game.moves();
//   const randomIdx = Math.floor(Math.random() * possibleMoves.length);
//   game.move(possibleMoves[randomIdx]);
// (UI/setTimeout parts omitted; Math.random() replaced with the seeded rng).
// ---------------------------------------------------------------------
function pickEasyMove(game) {
  const possibleMoves = game.moves();
  if (possibleMoves.length === 0) return null;
  return possibleMoves[randInt(possibleMoves.length)];
}

// ---------------------------------------------------------------------
// Medium: random check if any exist, else random capture, else random
// move. Replicates main.js's makeMediumMove(), which does:
//   const possibleMoves = game.moves({ verbose: true });
//   const captureMoves = possibleMoves.filter(move => move.captured);
//   const checkMoves = possibleMoves.filter(move => move.san.includes('+'));
//   if (checkMoves.length > 0) selectedMove = checkMoves[random];
//   else if (captureMoves.length > 0) selectedMove = captureMoves[random];
//   else selectedMove = possibleMoves[random];
// (UI/setTimeout parts omitted; Math.random() replaced with the seeded rng).
// ---------------------------------------------------------------------
function pickMediumMove(game) {
  const possibleMoves = game.moves({ verbose: true });
  if (possibleMoves.length === 0) return null;

  const captureMoves = possibleMoves.filter(function (m) { return m.captured; });
  const checkMoves = possibleMoves.filter(function (m) { return m.san.indexOf('+') !== -1; });

  if (checkMoves.length > 0) return checkMoves[randInt(checkMoves.length)];
  if (captureMoves.length > 0) return captureMoves[randInt(captureMoves.length)];
  return possibleMoves[randInt(possibleMoves.length)];
}

// ---------------------------------------------------------------------
// Hard: ai.js's negamax/alpha-beta search.
// ---------------------------------------------------------------------
const HARD_DEPTH = 3;
const HARD_TIME_LIMIT_MS = null; // null = fixed depth 3, no iterative-deepening time cap

function pickHardMove(game) {
  const res = AI.search(game, { depth: HARD_DEPTH, timeLimitMs: HARD_TIME_LIMIT_MS, pruning: true });
  return res.move; // {from,to,promotion,san} | null
}

// ---------------------------------------------------------------------
// Single game.
// ---------------------------------------------------------------------
const MAX_PLIES = 200;

function playGame(hardColor, opponentName, opponentFn) {
  const game = new Chess();
  let plies = 0;
  let adjudicated = false;

  while (!game.game_over()) {
    if (plies >= MAX_PLIES) {
      adjudicated = true;
      break;
    }

    const sideToMove = game.turn(); // 'w' | 'b'
    const moveChoice = sideToMove === hardColor ? pickHardMove(game) : opponentFn(game);

    if (!moveChoice) {
      // No legal moves despite game_over() being false - shouldn't happen,
      // but don't spin forever if it does.
      break;
    }

    // moveChoice is a SAN string from pickEasyMove() (mirrors main.js's
    // makeRandomMove(), which passes game.moves() entries straight to
    // game.move()), or a verbose {from,to,promotion,...} object from
    // pickMediumMove()/pickHardMove().
    const applied = typeof moveChoice === 'string'
      ? game.move(moveChoice)
      : game.move({ from: moveChoice.from, to: moveChoice.to, promotion: moveChoice.promotion || undefined });
    if (!applied) {
      throw new Error(
        'Illegal move produced during ' + opponentName + ' match (hard=' + hardColor + '): ' +
        JSON.stringify(moveChoice) + ' at FEN ' + game.fen()
      );
    }
    plies++;
  }

  let result; // 'hard_win' | 'hard_loss' | 'draw'
  let reason;
  if (!adjudicated && game.in_checkmate()) {
    const matedColor = game.turn(); // side to move = side that got mated
    result = matedColor === hardColor ? 'hard_loss' : 'hard_win';
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

// ---------------------------------------------------------------------
// Run a 20-game match against one opponent, alternating colours.
// ---------------------------------------------------------------------
const GAMES_PER_OPPONENT = 20;

function runMatch(opponentName, opponentFn) {
  const games = [];
  for (let i = 0; i < GAMES_PER_OPPONENT; i++) {
    const hardColor = i % 2 === 0 ? 'w' : 'b';
    const t0 = Date.now();
    const g = playGame(hardColor, opponentName, opponentFn);
    const wallMs = Date.now() - t0;
    const record = { gameIndex: i, hardColor: hardColor, result: g.result, reason: g.reason, plies: g.plies, wallMs: wallMs };
    games.push(record);
    console.log(
      '  game', (i + 1) + '/' + GAMES_PER_OPPONENT,
      '- Hard as', hardColor === 'w' ? 'White' : 'Black',
      '-', record.result, '(' + record.reason + ')',
      '-', record.plies, 'plies -', wallMs, 'ms'
    );
  }

  const wins = games.filter(function (g) { return g.result === 'hard_win'; }).length;
  const draws = games.filter(function (g) { return g.result === 'draw'; }).length;
  const losses = games.filter(function (g) { return g.result === 'hard_loss'; }).length;
  const totalPlies = games.reduce(function (s, g) { return s + g.plies; }, 0);
  const totalWallMs = games.reduce(function (s, g) { return s + g.wallMs; }, 0);

  return {
    opponent: opponentName,
    games: games,
    wins: wins,
    draws: draws,
    losses: losses,
    winRate: wins / GAMES_PER_OPPONENT,
    avgPlies: totalPlies / GAMES_PER_OPPONENT,
    totalWallMs: totalWallMs
  };
}

function main() {
  console.log('Machine: Node', process.version, '|', os.cpus()[0].model, '|', os.platform(), os.arch());
  console.log('Seed:', SEED, '| Hard setting: depth', HARD_DEPTH, 'timeLimitMs', HARD_TIME_LIMIT_MS, '| draw adjudicated at', MAX_PLIES, 'plies');
  console.log('');

  const overallStart = Date.now();

  console.log('Hard vs Easy (' + GAMES_PER_OPPONENT + ' games):');
  const vsEasy = runMatch('Easy', pickEasyMove);
  console.log('');

  console.log('Hard vs Medium (' + GAMES_PER_OPPONENT + ' games):');
  const vsMedium = runMatch('Medium', pickMediumMove);
  console.log('');

  const overallWallMs = Date.now() - overallStart;

  console.log('Summary:');
  for (const m of [vsEasy, vsMedium]) {
    console.log(
      '  Hard vs ' + m.opponent + ':',
      'W' + m.wins + '/D' + m.draws + '/L' + m.losses,
      '- win rate', (m.winRate * 100).toFixed(1) + '%',
      '- avg game length', m.avgPlies.toFixed(1), 'plies'
    );
  }
  console.log('  Total wall time:', (overallWallMs / 1000).toFixed(1) + 's', '(budget: ~20 min = 1200s)');
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
    hardSetting: { depth: HARD_DEPTH, timeLimitMs: HARD_TIME_LIMIT_MS, pruning: true },
    maxPlies: MAX_PLIES,
    gamesPerOpponent: GAMES_PER_OPPONENT,
    overallWallMs: overallWallMs,
    matches: [vsEasy, vsMedium]
  };

  const outPath = path.join(__dirname, 'match-results.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log('Raw results written to', outPath);
}

main();
