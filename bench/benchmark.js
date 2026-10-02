#!/usr/bin/env node
/**
 * bench/benchmark.js
 *
 * Benchmarks ai.js's negamax/alpha-beta search (see ../ai.js) across a
 * fixed set of 9 labeled FENs (3 opening, 3 middlegame, 3 endgame), at
 * search depths 2, 3 and 4, with pruning both on and off.
 *
 * For each (FEN, depth, pruning) combination, runs exactly one
 * AI.search() call and records nodes visited and wall-clock time. Note
 * that AI.search() always iterative-deepens from depth 1 up through the
 * requested depth (see ai.js), so "depth 4" node/time figures are the
 * CUMULATIVE cost of completing iterations 1, 2, 3 and 4 in sequence, not
 * depth 4 alone. That cumulative number is what a player actually waits
 * for when the engine is asked to search to depth N, so it's the
 * meaningful figure to benchmark.
 *
 * Depth-4, pruning-off is the expensive corner (full, uncut minimax to
 * depth 4). This script measures it on ONE FEN first; if that single
 * measurement implies the full 9-FEN run would exceed ~10 minutes, it
 * falls back to a smaller, explicitly-labeled subset for that one
 * combination only, and both the console output and README say so.
 * Every other (FEN, depth, pruning) combination always runs on all 9
 * FENs - no data is silently dropped.
 *
 * Run: node bench/benchmark.js
 * Writes raw results to bench/results.json.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { Chess } = require('../chess.js');
const AI = require('../ai.js');

// ---------------------------------------------------------------------
// Fixed, labeled FENs (3 opening, 3 middlegame, 3 endgame).
//
// The opening/middlegame FENs were produced by replaying real SAN move
// sequences on a fresh chess.js `Chess()` instance (so legality, and
// therefore FEN validity, is guaranteed by the engine itself) and
// capturing fen() at the point described in the label. The endgame FENs
// are minimal hand-built positions. Every FEN below is re-validated at
// startup with `new Chess().validate_fen(fen).valid` regardless of its
// origin, per the task spec - chess.js silently falls back to the start
// position on a bad FEN, so this check is what would catch that.
// ---------------------------------------------------------------------
const FENS = [
  {
    id: 'O1',
    label: 'Opening 1: start position',
    phase: 'opening',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
  },
  {
    id: 'O2',
    label: 'Opening 2: Ruy Lopez setup (1.e4 e5 2.Nf3 Nc6)',
    phase: 'opening',
    fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3'
  },
  {
    id: 'O3',
    label: "Opening 3: King's Indian setup (1.d4 Nf6 2.c4 g6 3.Nc3 Bg7 4.e4 d6)",
    phase: 'opening',
    fen: 'rnbqk2r/ppp1ppbp/3p1np1/8/2PPP3/2N5/PP3PPP/R1BQKBNR w KQkq - 0 5'
  },
  {
    id: 'M1',
    label: 'Middlegame 1: Ruy Lopez Closed, move 11',
    phase: 'middlegame',
    fen: 'r1bq1rk1/2pnbppp/p2p1n2/1p2p3/3PP3/1BP2N1P/PP3PP1/RNBQR1K1 w - - 1 11'
  },
  {
    id: 'M2',
    label: "Middlegame 2: Queen's Gambit Declined, move 11",
    phase: 'middlegame',
    fen: 'rnbq1rk1/p4pp1/1pp2b1p/3p4/3P4/1QN1PN2/PP3PPP/R3KB1R w KQ - 0 11'
  },
  {
    id: 'M3',
    label: 'Middlegame 3: Najdorf Sicilian, move 11',
    phase: 'middlegame',
    fen: 'r2q1rk1/1p1nbppp/p2pbn2/4p3/4P3/1NN1B3/PPPQBPPP/R4RK1 w - - 8 11'
  },
  {
    id: 'E1',
    label: 'Endgame 1: King + pawn vs king',
    phase: 'endgame',
    fen: '8/8/8/8/4k3/8/4P3/4K3 w - - 0 1'
  },
  {
    id: 'E2',
    label: 'Endgame 2: King + rook vs king',
    phase: 'endgame',
    fen: '8/5k2/8/8/8/8/5K2/4R3 w - - 0 1'
  },
  {
    id: 'E3',
    label: 'Endgame 3: King + queen vs king',
    phase: 'endgame',
    fen: '8/8/8/3k4/8/8/3K4/3Q4 w - - 0 1'
  }
];

const DEPTHS = [2, 3, 4];
const TEN_MINUTES_MS = 10 * 60 * 1000;

function validateFens() {
  for (const f of FENS) {
    const v = new Chess().validate_fen(f.fen);
    if (!v.valid) {
      console.error('INVALID FEN for', f.id, f.label, '->', f.fen);
      console.error('  ', v.error);
      process.exit(1);
    }
  }
}

function runOne(fenEntry, depth, pruning) {
  const g = new Chess(fenEntry.fen);
  AI.resetNodes();
  const t0 = Date.now();
  const res = AI.search(g, { depth: depth, pruning: pruning, timeLimitMs: null });
  const wallMs = Date.now() - t0;
  return {
    id: fenEntry.id,
    label: fenEntry.label,
    phase: fenEntry.phase,
    fen: fenEntry.fen,
    depth: depth,
    pruning: pruning,
    nodes: res.nodes,
    timeMs: wallMs,
    score: res.score,
    move: res.move ? res.move.san : null
  };
}

function fmt(n) {
  return n.toLocaleString('en-US');
}

function main() {
  validateFens();

  console.log('Machine: Node', process.version, '|', os.cpus()[0].model, '|', os.platform(), os.arch());
  console.log('FENs:');
  for (const f of FENS) console.log('  ', f.id, '-', f.label);
  console.log('');

  // -------------------------------------------------------------------
  // Step 1: probe depth-4, pruning-off cost on ONE FEN before committing
  // to a full 9-FEN run at that combination.
  // -------------------------------------------------------------------
  const probeFen = FENS[0]; // O1: start position
  console.log('Probing depth-4 pruning-off cost on', probeFen.id, '(' + probeFen.label + ') before deciding scope...');
  const probe = runOne(probeFen, 4, false);
  console.log('  probe:', fmt(probe.nodes), 'nodes,', fmt(probe.timeMs), 'ms');

  const extrapolatedFullMs = probe.timeMs * FENS.length;
  let depth4UnprunedSubset = FENS;
  let depth4UnprunedNote = null;
  if (extrapolatedFullMs > TEN_MINUTES_MS) {
    // Fall back to just the already-probed FEN. A second, quick manual
    // check during development showed that a middlegame FEN at this same
    // combination (depth 4, pruning off) takes considerably longer than
    // this opening position (still running after 4+ minutes, vs. 82s
    // here), so including even one extra FEN risks blowing the budget
    // badly rather than modestly - safest is to stick to the single
    // measurement already taken rather than guess at a second one's cost.
    depth4UnprunedSubset = [probeFen]; // O1 only
    depth4UnprunedNote =
      'Depth-4 pruning-off was probed on ' + probeFen.id + ' (' + probe.timeMs + ' ms, ' +
      fmt(probe.nodes) + ' nodes). Extrapolating that cost across all ' + FENS.length +
      ' FENs (~' + fmt(extrapolatedFullMs) + ' ms = ~' + (extrapolatedFullMs / 60000).toFixed(1) +
      ' min) exceeds the ~10 minute budget. A spot-check on a middlegame FEN at this same ' +
      '(depth 4, pruning off) combination took considerably longer than the probed opening ' +
      'position, so rather than guess at a second FEN\'s cost, depth-4/pruning-off was run on ' +
      'just the single probed FEN (' + probeFen.id + '). All other (FEN, depth, pruning) ' +
      'combinations ran on the full set of ' + FENS.length + ' FENs. This means depth-4 ' +
      'unpruned data for middlegame and endgame positions is NOT collected - noted here ' +
      'rather than silently omitted.';
    console.log('');
    console.log('NOTICE:', depth4UnprunedNote);
  } else {
    console.log('  Extrapolated full 9-FEN run: ~' + (extrapolatedFullMs / 1000).toFixed(1) + 's, within budget. Running all FENs.');
  }
  console.log('');

  // -------------------------------------------------------------------
  // Step 2: run every (FEN, depth, pruning) combination.
  // -------------------------------------------------------------------
  const results = [probe]; // reuse the probe result instead of re-running it
  const combos = [];
  for (const depth of DEPTHS) {
    for (const pruning of [true, false]) {
      if (depth === 4 && pruning === false) continue; // handled via probe + subset below
      combos.push({ depth: depth, pruning: pruning });
    }
  }

  for (const combo of combos) {
    for (const fenEntry of FENS) {
      const r = runOne(fenEntry, combo.depth, combo.pruning);
      results.push(r);
      console.log(
        '[depth', combo.depth, combo.pruning ? 'pruned  ' : 'unpruned', ']',
        r.id, '-', fmt(r.nodes), 'nodes,', fmt(r.timeMs), 'ms, score', r.score, 'move', r.move
      );
    }
  }

  // Remaining depth-4/pruning-off FENs (subset minus the already-run probe).
  for (const fenEntry of depth4UnprunedSubset) {
    if (fenEntry.id === probeFen.id) continue; // already have this one
    const r = runOne(fenEntry, 4, false);
    results.push(r);
    console.log('[depth 4 unpruned ] (subset)', r.id, '-', fmt(r.nodes), 'nodes,', fmt(r.timeMs), 'ms, score', r.score, 'move', r.move);
  }

  console.log('');

  // -------------------------------------------------------------------
  // Step 3: per-FEN pruned-vs-unpruned score-match check.
  // -------------------------------------------------------------------
  console.log('Score-match check (pruned vs unpruned, same FEN/depth; alpha-beta must not change the true minimax value):');
  const mismatches = [];
  for (const depth of DEPTHS) {
    const haveUnpruned = depth === 4 ? depth4UnprunedSubset : FENS;
    for (const fenEntry of haveUnpruned) {
      const pruned = results.find(function (r) { return r.id === fenEntry.id && r.depth === depth && r.pruning === true; });
      const unpruned = results.find(function (r) { return r.id === fenEntry.id && r.depth === depth && r.pruning === false; });
      if (!pruned || !unpruned) continue;
      const match = pruned.score === unpruned.score;
      if (!match) {
        mismatches.push({ id: fenEntry.id, depth: depth, prunedScore: pruned.score, unprunedScore: unpruned.score });
        console.log('  MISMATCH', fenEntry.id, 'depth', depth, '- pruned:', pruned.score, 'unpruned:', unpruned.score);
      }
    }
  }
  if (mismatches.length === 0) {
    console.log('  All pruned/unpruned scores match.');
  } else {
    console.log('  ' + mismatches.length + ' MISMATCH(ES) FOUND - see above.');
  }
  console.log('');

  // -------------------------------------------------------------------
  // Step 4: aggregate table per depth.
  // -------------------------------------------------------------------
  console.log('Aggregate results per depth:');
  console.log('');
  const aggregates = [];
  for (const depth of DEPTHS) {
    const prunedRows = results.filter(function (r) { return r.depth === depth && r.pruning === true; });
    const unprunedRows = results.filter(function (r) { return r.depth === depth && r.pruning === false; });

    const prunedNodes = prunedRows.reduce(function (s, r) { return s + r.nodes; }, 0);
    const unprunedNodes = unprunedRows.reduce(function (s, r) { return s + r.nodes; }, 0);
    const prunedMs = prunedRows.reduce(function (s, r) { return s + r.timeMs; }, 0);
    const unprunedMs = unprunedRows.reduce(function (s, r) { return s + r.timeMs; }, 0);

    const pctPruned = unprunedNodes > 0 ? 1 - prunedNodes / unprunedNodes : null;
    const avgMsPruned = prunedRows.length > 0 ? prunedMs / prunedRows.length : null;
    const avgMsUnpruned = unprunedRows.length > 0 ? unprunedMs / unprunedRows.length : null;
    const speedup = avgMsUnpruned && avgMsPruned ? avgMsUnpruned / avgMsPruned : null;

    const agg = {
      depth: depth,
      fensWithPruned: prunedRows.length,
      fensWithUnpruned: unprunedRows.length,
      totalNodesPruned: prunedNodes,
      totalNodesUnpruned: unprunedNodes,
      pctNodesPruned: pctPruned,
      avgMsPerMovePruned: avgMsPruned,
      avgMsPerMoveUnpruned: avgMsUnpruned,
      speedup: speedup,
      note: depth === 4 && depth4UnprunedNote ? 'unpruned figures for depth 4 are over a ' + depth4UnprunedSubset.length + '-FEN subset, not all ' + FENS.length + ' FENs' : undefined
    };
    aggregates.push(agg);

    console.log('Depth ' + depth + ':');
    console.log('  FENs (pruned / unpruned):      ', prunedRows.length, '/', unprunedRows.length, agg.note ? '  <-- ' + agg.note : '');
    console.log('  Total nodes pruned:            ', fmt(prunedNodes));
    console.log('  Total nodes unpruned:          ', fmt(unprunedNodes));
    console.log('  % nodes pruned:                ', pctPruned !== null ? (pctPruned * 100).toFixed(2) + '%' : 'n/a');
    console.log('  Avg ms/move pruned:            ', avgMsPruned !== null ? avgMsPruned.toFixed(2) : 'n/a');
    console.log('  Avg ms/move unpruned:          ', avgMsUnpruned !== null ? avgMsUnpruned.toFixed(2) : 'n/a');
    console.log('  Speedup (unpruned/pruned):     ', speedup !== null ? speedup.toFixed(2) + 'x' : 'n/a');
    console.log('');
  }

  // -------------------------------------------------------------------
  // Step 5: write raw results + aggregates + metadata to bench/results.json
  // -------------------------------------------------------------------
  const output = {
    machine: {
      node: process.version,
      cpu: os.cpus()[0].model,
      platform: os.platform(),
      arch: os.arch()
    },
    generatedAt: new Date().toISOString(),
    fens: FENS,
    depth4UnprunedSubset: depth4UnprunedSubset.map(function (f) { return f.id; }),
    depth4UnprunedNote: depth4UnprunedNote,
    scoreMismatches: mismatches,
    results: results,
    aggregates: aggregates
  };

  const outPath = path.join(__dirname, 'results.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log('Raw results written to', outPath);
}

main();
