// engine-worker.js
//
// Runs the Hard/Grandmaster-difficulty search (engine.js) off the main
// thread so the UI stays responsive while the engine looks ahead.
//
// Unlike ai-worker.js, engine.js has no chess.js dependency - it has its
// own internal board representation and move generator - so this worker
// only needs to load engine.js itself.

importScripts('engine.js');

onmessage = function (e) {
    const data = e.data || {};
    const id = data.id;
    const fen = data.fen;
    const timeLimitMs = data.timeLimitMs;
    const history = data.history;

    try {
        const result = Engine.search(fen, { timeLimitMs: timeLimitMs, history: history || [] });

        postMessage({
            id: id,
            ok: true,
            move: result.move,
            uci: result.uci,
            score: result.score,
            depth: result.depth,
            nodes: result.nodes,
            timeMs: result.timeMs,
            book: result.book
        });
    } catch (err) {
        postMessage({ id: id, ok: false, error: String(err) });
    }
};
