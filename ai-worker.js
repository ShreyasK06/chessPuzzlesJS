// ai-worker.js
//
// Runs the Hard-difficulty AI search (ai.js) off the main thread so the UI
// stays responsive while the engine looks ahead.
//
// Note on Chess960: this app encodes Chess960 (Fischer Random) starting
// positions as a plain FEN string with standard "KQkq" castling-availability
// flags (see generateChess960Position() in main.js) rather than X-FEN /
// Shredder-FEN notation with file letters for the rooks. `new Chess(fen)`
// below parses that FEN exactly the same way the main thread's `game`
// object does (same chess.js build), so the worker always reproduces the
// same board the player sees. The one caveat is that chess.js 0.x's
// castling logic assumes rooks start on the a/h files, so for Chess960
// positions where a rook isn't on a/h, castling rights encoded in the FEN
// may not be honored correctly by either the main game or this worker.
// That's a pre-existing characteristic of this app's Chess960 support, not
// something introduced here, and is acceptable per spec.

importScripts('chess.js', 'ai.js');

onmessage = function (e) {
    const data = e.data || {};
    const id = data.id;
    const fen = data.fen;
    const depth = data.depth;
    const timeLimitMs = data.timeLimitMs;

    try {
        const game = new Chess(fen);
        const result = AI.search(game, { depth: depth, timeLimitMs: timeLimitMs });

        postMessage({
            id: id,
            ok: true,
            move: result.move,
            score: result.score,
            depth: result.depth,
            nodes: result.nodes,
            timeMs: result.timeMs
        });
    } catch (err) {
        postMessage({ id: id, ok: false, error: String(err) });
    }
};
