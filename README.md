# chessPuzzlesJS

A browser-based chess app with four AI difficulty levels, daily puzzles, Chess960, a position playground, and opening positions. It runs entirely client-side (no build step): open `index.html` or serve the folder statically.

## Features

**Game modes**
- **Traditional:** play standard chess against the computer, or against a friend with the Two Players toggle (same device).
- **Daily Puzzle:** puzzles come from a puzzles API (middlegame/advantage themes, rating around 1500), with a built-in set of puzzles used when the API is unavailable. The app plays the opening move, checks each of your moves against the stored solution, and replies with the opponent's move.
- **Chess960:** generates a random Fischer Random starting position (bishops on opposite colors, king between the rooks).
- **Playground:** set up any position with spare pieces; drag pieces off the board to remove them.
- **Openings:** one-click positions for the Ruy Lopez, Italian, French, Queen's Gambit, English, and Sicilian.

**Interface**
- Legal-move highlighting (normal moves, captures, checks), move history, undo/redo, game-over detection (checkmate, stalemate, repetition, insufficient material), dark mode, and a help dialog.

## AI levels

| Level | How it plays |
|---|---|
| **Easy** | A random legal move. |
| **Medium** | Prefers a check, then a capture, otherwise a random move. |
| **Hard** | Negamax search with alpha-beta pruning (see below). Falls back to a one-move heuristic if the search worker is unavailable. |
| **Grandmaster** | Asks a Stockfish 16 API for the best move; falls back to a mate-in-one check and then to Medium-style play if the call fails. After a game, a review compares your moves with the engine's suggestions. |

### Hard-level search engine (`ai.js`)

- **Negamax with alpha-beta pruning**, with pruning switchable off so the search can be compared against a full minimax scan.
- **Evaluation:** material plus piece-square tables (Michniewski's simplified evaluation values), with a separate king table for endgames.
- **Move ordering:** captures first (most valuable victim, least valuable attacker), then checks, then quiet moves, which makes pruning effective.
- **Mate and draw handling:** mate scores are depth-adjusted so faster mates are preferred; draws score zero.
- **Iterative deepening under a time budget:** the Hard level searches up to depth 3 with a 1.5 s limit, keeping the best move from the last completed depth.
- **Runs in a Web Worker** (`ai-worker.js`) so the board stays responsive while the engine thinks. The search reports depth reached, nodes searched, and time taken in the browser console.

## Running it

```bash
# any static server works; Web Workers need http://, not file://
python -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` directly from disk still works for everything except the Hard-level search, which will use its heuristic fallback because browsers block workers on `file://`.

### API keys

Daily Puzzle and Grandmaster use third-party APIs through RapidAPI. The app has built-in fallbacks for both, but to use the live APIs you need your own RapidAPI key. Because this is a static site, any key placed in client-side code is visible to visitors; use a key with a restricted quota, or put the calls behind a small proxy.

## Tests and benchmarks

Requires Node.js (no dependencies to install).

```bash
npm test                  # unit tests for ai.js (node --test)
node bench/benchmark.js   # search cost with and without pruning -> bench/results.json
node bench/match.js       # Hard vs Easy/Medium, 20 games each -> bench/match-results.json
```

**Pruning benchmark** (9 positions: 3 opening, 3 middlegame, 3 endgame; one search per position; Node 22, i5-1135G7). Depth N includes iterations 1 through N, because the search deepens iteratively.

| Depth | Nodes, pruned | Nodes, unpruned | Nodes cut | Avg time/move, pruned | Avg time/move, unpruned | Speedup |
|---|---|---|---|---|---|---|
| 2 | 1,437 | 6,963 | 79% | 168 ms | 431 ms | 2.6× |
| 3 | 15,337 | 258,817 | 94% | 1.33 s | 17.8 s | 13.3× |
| 4 | 73,737 | (1 position only) | n/a | 9.6 s | 108 s (start position) | ~11× |

At depth 4, the unpruned search ran on the starting position only, because the full 9-position run would have exceeded the time budget. Pruned and unpruned searches returned the same score in every position, which confirms pruning doesn't change the result.

**Strength match** (Hard at depth 3 with no time limit, alternating colors, draw declared at 200 plies, seeded random opponents):

| Opponent | W / D / L | Avg game length |
|---|---|---|
| Easy | 20 / 0 / 0 | 35.6 plies |
| Medium | 20 / 0 / 0 | 35.5 plies |

All 40 wins were by checkmate. In the browser, Hard also stops at a 1.5 s time limit, so on slower machines it may play at a shallower depth than in this match.

## Tech stack

JavaScript (ES6), [chess.js](https://github.com/jhlywa/chess.js) for rules and move generation, [chessboard.js](https://chessboardjs.com/) for the board UI, jQuery, Bootstrap 5, Web Workers.

## Project layout

```
index.html       UI shell
main.js          Game modes, controls, difficulty logic, puzzles, Chess960
ai.js            Negamax / alpha-beta engine and evaluation
ai-worker.js     Web Worker wrapper around ai.js
tests/           Unit tests for ai.js
bench/           Pruning benchmark, strength match, and their results
chess.js         Third-party rules library (BSD license, Jeff Hlywa)
main.css         Styles
```

## Known limitations

- Chess960 castling: chess.js 0.x assumes rooks start on the a and h files, so castling may not work correctly in Chess960 positions where they don't.
- Pawn promotion defaults to a queen.
- The Grandmaster review compares your moves with the engine's *predicted reply*, so its output is approximate.
- The Hard level looks three plies ahead at most, with no quiescence search, so it can misjudge positions with pending captures.

## License

MIT. `chess.js` is included under its own BSD license.
