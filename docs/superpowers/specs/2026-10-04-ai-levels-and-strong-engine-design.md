# AI levels reshuffle + strong Hard engine — design

**Date:** 2026-10-04
**Status:** approved in chat, pending spec review

## Goal

Rework the AI difficulty ladder and add a much stronger top in-browser level:

| Level | Behavior | Source |
|---|---|---|
| Beginner | Prefers checks, then captures, else random | old Medium (`makeMediumMove`) |
| Easy | "Weak human": shallow search with deliberate blunders | new, built on `ai.js` |
| Medium | Negamax/alpha-beta, depth 3, 1.5 s | old Hard (`ai.js`, unchanged) |
| Hard | New fast engine, target ~1600–2000 (relative estimate) | new `engine.js` |
| Grandmaster | Stockfish web API | unchanged |

The old random-move Easy is removed.

Success: Beginner < Easy < Medium < Hard in head-to-head matches, Hard estimated at 1600–2000 relative to an anchored Medium, all tests green, no UI regressions.

## Why a new engine

The current search does all move generation through chess.js 0.x, measured at ~3,000 nodes/s in the browser. Engines in the 1600–2000 range need roughly 100× that. The new Hard engine therefore has its own board representation; chess.js remains the source of truth for the game itself (move legality for the human, game-over detection, history).

## Components

### `engine.js` (new) — Hard engine
Same environment pattern as `ai.js` (browser global / worker `importScripts` / Node `require`), no dependency on chess.js.

- **Board:** array-based (0x88 or 10×12 mailbox), side to move, castling rights, en passant square, halfmove clock, Zobrist hash. In-place `makeMove`/`unmakeMove`. `loadFen(fen)` and `moveToUci(move)`.
- **Move generation:** pseudo-legal generation plus legality check (king not left in check). Correctness proven by perft.
- **Search:** iterative deepening; PVS (principal variation search); transposition table (Zobrist, fixed-size array, depth-preferred replacement); quiescence search (captures + promotions, stand-pat, delta pruning); move ordering = TT move, MVV-LVA captures, killer moves, history heuristic; null-move pruning (not in check, not in pawn-only endgames); late move reductions for quiet late moves; check extension; repetition detection against game history + search path; 50-move rule; mate-distance scoring.
- **Time:** soft budget per move (default 2000 ms), clock checked every N nodes inside the search, aborting cleanly and returning the last completed iteration's best move.
- **Evaluation:** tapered middlegame/endgame (PeSTO piece-square tables and material), plus passed/doubled/isolated pawns, bishop pair, rooks on open/semi-open files, mobility, simple king safety (pawn shield + attackers near king).
- **Opening book:** small embedded table of common lines (keyed by position), randomly choosing among book moves; used only while in book.
- **API:** `Engine.search(fen, { timeLimitMs, maxDepth, history })` → `{ move: {from,to,promotion}, score, depth, nodes, timeMs, book }`, plus `Engine.perft(fen, depth)` and `Engine.evaluate(fen)` for tests. `history` is the list of prior position FENs (for repetition detection).

### `engine-worker.js` (new)
Mirrors `ai-worker.js`: receives `{id, fen, timeLimitMs, history}`, replies `{id, ok, move, score, depth, nodes, timeMs}` or `{id, ok:false, error}`.

### `ai-worker.js` (extended)
Accepts an optional `mode: 'easy'`. In that mode it searches at depth 2, scores all root moves, then picks: ~65% best move, ~25% random among top 4, ~10% random legal move (probabilities tuned so Easy beats Beginner and loses to Medium). Default mode unchanged (Medium).

`ai.js` gains one small additive export that returns scored root moves (needed for Easy); existing behavior and tests unchanged.

### `main.js` / `index.html`
- Replace the `easy/medium/hard/grandmaster` booleans with a single `level` variable (`null|'beginner'|'easy'|'medium'|'hard'|'grandmaster'`).
- Dropdown: Beginner, Easy, Medium, Hard, Grandmaster. Labels, Game Info "AI Level", help dialog updated.
- Dispatch: beginner → `makeBeginnerMove` (old `makeMediumMove`), easy → ai-worker `mode:'easy'`, medium → ai-worker (old Hard path), hard → engine-worker, grandmaster → unchanged.
- Worker requests reuse the existing request-id / stale-FEN / timeout-fallback logic (generalized to take a worker + payload). Fallbacks degrade: Hard → Medium path → one-ply heuristic → Beginner.
- Grandmaster's existing internal fallback to "Medium-style play" now calls `makeBeginnerMove` (same behavior, new name).

## Testing

- `tests/engine.test.js`: perft on 6 standard positions (start, Kiwipete, positions 3–6) at depths with published node counts; FEN round-trip; make/unmake restores hash and board; evaluation symmetry (color-mirrored position scores identically); mate-in-1/2 found; doesn't hang its queen; returns a legal move (verified with chess.js) across many positions; respects time limit.
- Existing `tests/ai.test.js` stays green; add tests for Easy's move selection (always legal, distribution sanity).
- `bench/match.js` extended to a ladder: Beginner–Easy, Easy–Medium, Medium–Hard, 20 games each, alternating colors, 200-ply adjudication. Reports score and Elo difference with a 95% interval.
- Browser smoke test: play a game at each level in headless Chrome; no console errors; AI replies within time budget.

## Rating reporting

No external engine. Elo gaps come from ladder scores (`diff = -400·log10(1/score − 1)`), anchored on Medium ≈ 1200 (design-based estimate). The README reports each level as an estimated range and states clearly that these are relative estimates, not measured ratings. If Hard lands below the target, tune search/eval and re-measure; report the actual result either way. A 20–0 sweep gives only a lower bound on the gap; in that case the ladder also runs Hard at reduced time vs Medium, or reports the bound as such.

## Out of scope

Stockfish/online rating measurement, multi-PV analysis UI, pondering, endgame tablebases, Chess960 castling fixes.
