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

## Tech stack

JavaScript (ES6), [chess.js](https://github.com/jhlywa/chess.js) for rules and move generation, [chessboard.js](https://chessboardjs.com/) for the board UI, jQuery, Bootstrap 5, Web Workers.

## Project layout

```
index.html       UI shell
main.js          Game modes, controls, difficulty logic, puzzles, Chess960
ai.js            Negamax / alpha-beta engine and evaluation
ai-worker.js     Web Worker wrapper around ai.js
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
