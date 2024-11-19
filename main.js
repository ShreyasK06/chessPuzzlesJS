
var board = null
var game = Chess();
var whiteSquareGrey = '#a9a9a9'
var blackSquareGrey = '#696969'
let lastPos;
let position = 'start';
let easy = false;
let medium = false;
let hard = false;
let grandmaster = false;
let turn;
let playingPuzzle = false;
let puzzleMoves;
let puzzleMovesMade = 0;
let puzzleFen;
let hardMove;
let receivedMove = false;
let move;
let bestMovesWhite = [];
let whiteMoves = [];
let puzzleCount = 0;
let maxPuzzleMoves = 0;


function removeGreySquares() {
    $('#board .square-55d63').css('background', '')
}

function greySquare(square) {
    var $square = $('#board .square-' + square)

    var background = whiteSquareGrey
    if ($square.hasClass('black-3c85d')) {
        background = blackSquareGrey
    }

    $square.css('background', background)
}

function onDragStart(source, piece) {
    // do not pick up pieces if the game is over
    if (game.game_over()) {
        return false
    }

    // or if it's not that side's turn
    if ((game.turn() === 'w' && piece.search(/^b/) !== -1) ||
        (game.turn() === 'b' && piece.search(/^w/) !== -1)) {
        return false
    }
}

function makeRandomMove() {
    var possibleMoves = game.moves()
    // game over
    if (possibleMoves.length === 0) return

    var randomIdx = Math.floor(Math.random() * possibleMoves.length)
    game.move(possibleMoves[randomIdx])
    board.position(game.fen())
}





function makeMediumMove() {

}

async function makeHardMove() {
    await getHardMove();
    console.log(hardMove);
    var from = hardMove.substring(0, 2);
    var to = hardMove.substring(2, 4);
    console.log(from);
    console.log(to);
    var queen = 'p';
    if (hardMove.length == 5) {
        queen = hardMove.substring(4, 5);
    }
    if (queen === 'p') {
        game.move({ from: from, to: to });
    } else {
        game.move({ from: from, to: to, promotion: queen });
    }
    board.position(game.fen());
}

async function makeGrandmasterMove() {
    await getBestMove();
    if (move) {
        console.log(move);
        var from = move.substring(0, 2);
        var to = move.substring(2, 4);
        var queen = 'p';
        if (move.length == 5) {
            queen = move.substring(4, 5);
        }
        if (queen === 'p') {
            game.move({ from: from, to: to });
        } else {
            game.move({ from: from, to: to, promotion: queen });
        }
        board.position(game.fen());
        move = null;
    } else {
        await getBestMove();
        var possibleMoves = game.moves();
        for (let i = 0; i < possibleMoves.length; i++) {
            game.move(possibleMoves[i]);
            if (game.in_checkmate()) {
                board.position(game.fen())
            } else {
                game.undo();
            }
        }
        makeGrandmasterMove();
    }
    displayGameOver();

}

function onDrop(source, target) {
    if (!playingPuzzle) {
        removeGreySquares()
        // see if the move is legal
        var move = game.move({
            from: source,
            to: target,
            promotion: 'q' // NOTE: always promote to a queen for example simplicity
        })
        turn = game.turn();

        // illegal move
        if (move === null) return 'snapback'

        if (easy) {
            window.setTimeout(makeRandomMove, 20)
        } else if (medium) {
            window.setTimeout(makeMediumMove, 20)
        } else if (hard) {
            makeHardMove();
        } else if (grandmaster) {
            makeGrandmasterMove();
        }
    } else {
        gamePos = game.fen();
        var move = game.move({
            from: source,
            to: target,
            promotion: 'q'
        })
        let Actmove = move.from + move.to;
        console.log(Actmove);
        console.log(puzzleMoves[puzzleMovesMade]);
        if (Actmove === puzzleMoves[puzzleMovesMade]) {
            puzzleMovesMade++;
            if (puzzleMovesMade === maxPuzzleMoves) {
                document.getElementById('level').innerHTML = 'Puzzle Solved';
                document.getElementById('startBtn').innerHTML = "New Puzzle";
            } else {
                makePuzzleMove();
            }
        } else {
            game.undo();
            return 'snapback'
        }
        if (puzzleMovesMade === maxPuzzleMoves) {
            document.getElementById('level').innerHTML = 'Puzzle Solved';
            document.getElementById('startBtn').innerHTML = "New Puzzle";
        }
    }
}

function onMouseoverSquare(square, piece) {

    // get list of possible moves for this square
    var moves = game.moves({
        square: square,
        verbose: true
    })

    // exit if there are no moves available for this square
    if (moves.length === 0) return

    // highlight the square they moused over
    greySquare(square)

    // highlight the possible squares for this piece
    for (var i = 0; i < moves.length; i++) {
        greySquare(moves[i].to)
    }
}

function onMouseoutSquare(square, piece) {
    removeGreySquares()
}

function onSnapEnd() {
    board.position(game.fen())
    displayGameOver();
}

var config = {
    draggable: true,
    position: position,
    onDragStart: onDragStart,
    onDrop: onDrop,
    onMouseoutSquare: onMouseoutSquare,
    onMouseoverSquare: onMouseoverSquare,
    onSnapEnd: onSnapEnd
}


board = Chessboard('board', config)
setButtons();

const ruyLopez = 'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R';
const italian = 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2BPP3/5N2/PPP2PPP/RNBQK2R';
const french = 'rnbqkbnr/ppp2ppp/4p3/3p4/3PP3/2N5/PPP2PPP/R1BQKBNR b KQkq - 0 1';
const queens = 'rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP2PPPP/RNBQKBNR w KQkq d6 0 1';
const english = 'r1b1kbnr/pppp1ppp/2n5/4P3/1q3B2/5N2/PPP1PPPP/RN1QKB1R w KQkq - 0 10';
const sicilian = 'r1bqk2r/pp2ppbp/2np1np1/8/3NP3/2N1BP2/PPPQ2PP/R3KB1R w KQkq - 0 1';

function setButtons() {
    $('#startBtn').on('click', function () {
        if (playingPuzzle) {
            console.log('Playing Puzzle')
            getPuzzles();
        } else {
            gameVisualReset();
            board.start()
            game.reset();
            document.getElementById('level').innerHTML = '';
            document.getElementById('level').classList.remove('over');
        }

    })
    $('#ruyLopez').on('click', function () {
        position = ruyLopez
        game.load(position);
        board.position(position);
    });
    $('#italian').on('click', function () {
        position = italian
        game.load(position);
        board.position(position);
    });

    $('#french').on('click', function () {
        position = french;
        game.load(position);
        board.position(position);
    });

    $('#queens').on('click', function () {
        position = queens;
        game.load(position);
        board.position(position);
    });

    $('#english').on('click', function () {
        position = english;
        game.load(position);
        board.position(position);
    });

    $('#sicilian').on('click', function () {
        position = sicilian;
        game.load(position);
        board.position(position);
    });

    $('#undoBtn').on('click', function () {
        lastPos = game.fen();
        game.undo();
        board.position(game.fen());
    });
    $('#redoBtn').on('click', function () {
        board.position(lastPos);
    });

    $('#easy').on('click', function () {
        gameModeDefaults();
        if (!easy) {
            easy = true;
            document.getElementById('easy').classList.remove('on');
            document.getElementById('easy').classList.add('off');
            switchBtnMode('easy')
        } else {
            gameReset();
            easy = false;
        }
    })

    $('#medium').on('click', function () {
        gameModeDefaults();
        if (!medium) {
            medium = true;
            document.getElementById('medium').classList.remove('on');
            document.getElementById('medium').classList.add('off');
            switchBtnMode('medium')
        } else {
            gameReset();
            medium = false;
        }
    })

    $('#hard').on('click', function () {
        gameModeDefaults();
        if (!hard) {
            hard = true;
            document.getElementById('hard').classList.remove('on');
            document.getElementById('hard').classList.add('off');
            switchBtnMode('hard')
        } else {
            gameReset();
            hard = false;
        }
    })

    $('#grandmaster').on('click', function () {
        gameModeDefaults();
        if (!grandmaster) {
            grandmaster = true;
            document.getElementById('grandmaster').classList.remove('on');
            document.getElementById('grandmaster').classList.add('off');
            switchBtnMode('grandmaster')
        } else {
            gameReset();
            grandmaster = false;
        }
    })

    $('#puzzle').on('click', function () {
        gameModeDefaults();
        playingPuzzle = true;
        getPuzzles();
    })

    $('#chess960').on('click', function () {
        gameModeDefaults();
    })

    $('#playground').on('click', function () {
        playingPuzzle = false;
        document.getElementById('ai').classList.add('gameMode');
        document.getElementById('level').classList.add('pgModeL');
        document.getElementById('board').classList.add('pgModeB');
        document.getElementById('gameBtns').classList.add('pgMode');
        config = {
            draggable: true,
            dropOffBoard: 'trash',
            sparePieces: true
        };
        board = Chessboard('board', config);
        board.clear(false);
    });

    $('#traditional').on('click', function () {
        gameVisualReset();
        gameReset();
    });
}

function gameModeDefaults() {
    document.getElementById('ai').classList.add('gameMode');
    document.getElementById('board').classList.add('gameModes');
    document.getElementById('level').classList.remove('normal');
}

function gameReset() {
    playingPuzzle = false;
    config = {
        draggable: true,
        position: position,
        onDragStart: onDragStart,
        onDrop: onDrop,
        onMouseoutSquare: onMouseoutSquare,
        onMouseoverSquare: onMouseoverSquare,
        onSnapEnd: onSnapEnd
    }
    board = Chessboard('board', config)
    board.start();
    game.reset();
}

function gameVisualReset() {
    document.getElementById('board').classList.remove('gameModes');
    document.getElementById('level').classList.add('normal');
    document.getElementById('ai').classList.remove('gameMode');
    if (document.getElementById('gameBtns').classList.contains('pgMode')) {
        document.getElementById('gameBtns').classList.remove('pgMode');
    }
}


function switchBtnMode(a) {
    level = ['easy', 'medium', 'hard', 'grandmaster'];
    level.splice(level.indexOf(a))
    for (let i = 0; i < level.length; i++) {
        document.getElementById(level[i]).classList.remove('on');
        document.getElementById(level[i]).classList.add('off');
    }
    document.getElementById('level').innerHTML = a.toUpperCase() + ' LEVEL';
}

function checkOff() {
    if (!easy && !medium && !hard && !grandmaster) {
        document.getElementById('level').innerHTML = ' ';
        document.getElementById('level').classList.remove('over');
    }
}

function displayGameOver() {
    if (game.in_checkmate()) {
        if (game.turn() === 'w') {
            document.getElementById('level').innerHTML = 'BLACK WINS';
        } else {
            document.getElementById('level').innerHTML = 'WHITE WINS';
        }
        document.getElementById('level').classList.remove('normal');

    } else if (game.in_threefold_repetition()) {
        document.getElementById('level').innerHTML = 'THREEFOLD REPETITION';
        document.getElementById('level').classList.remove('normal');
    } else if (game.in_stalemate()) {
        document.getElementById('level').innerHTML = 'STALEMATE';
        document.getElementById('level').classList.remove('normal');
    } else if (game.insufficient_material()) {
        document.getElementById('level').innerHTML = 'INSUFFICIENT MATERIAL';
        document.getElementById('level').classList.remove('normal');
    }

    if (game.in_checkmate() || game.insufficient_material() || game.in_stalemate() || game.in_threefold_repetition()) {
        if (grandmaster) {
            console.log("game over");
            gameReview();
        }
    }
}

async function getBestMove() {
    try {
        const response = await fetch(`https://chess-stockfish-16-api.p.rapidapi.com/chess/api?fen=${game.fen()} `, {
            method: 'POST',
            headers: {
                'X-RapidAPI-Key': '966dbf9131msh22bbb6805a935f5p186cfajsn640f0aba3bc3',
                'X-RapidAPI-Host': 'chess-stockfish-16-api.p.rapidapi.com'
            }
        });

        if (response.ok) {
            const result = await response.json();
            bestMovesWhite.push(result.ponder);
            move = result.bestmove;
        }
    } catch (err) {
        console.error(err);
    }
}

async function getHardMove() {
    const url = 'https://chess-move-maker.p.rapidapi.com/chess';
    const options = {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'X-RapidAPI-Key': '966dbf9131msh22bbb6805a935f5p186cfajsn640f0aba3bc3',
            'X-RapidAPI-Host': 'chess-move-maker.p.rapidapi.com'
        },
        body: {
            color: 'BLACK',
            positions: game.ascii(),
        }
    };

    try {
        hardMove = await fetch(url, options);
        console.log(hardMove);
    } catch (error) {
        console.error(error);
    }
}


function gameReview() {
    whiteMoves = game.history({ verbose: true });
    for (let i = 0; i < bestMovesWhite.length; i++) {
        var whiteMove = whiteMoves[i].from + whiteMoves[i].to;
        if (bestMovesWhite[i] == whiteMove) {
            console.log("On move ", i, " you played the right move");
        } else {
            console.log("On move ", i, " you should have played ", bestMovesWhite
            [i])
        }
    }
}

async function getPuzzles() {
    const apiUrl = 'https://chess-puzzles.p.rapidapi.com/?themes=%5B%22middlegame%22%2C%22advantage%22%5D&rating=1500&themesType=ALL&playerMoves=4&count=25';
    const options = {
        method: 'GET',
        headers: {
            'X-RapidAPI-Key': '966dbf9131msh22bbb6805a935f5p186cfajsn640f0aba3bc3',
            'X-RapidAPI-Host': 'chess-puzzles.p.rapidapi.com'
        }
    };
    try {
        const response = await fetch(apiUrl, options)
        puzzle = await response.json();
        puzzleMoves = puzzle.puzzles[puzzleCount].moves;
        maxPuzzleMoves = puzzleMoves.length;
        console.log(puzzleMoves);

    } catch (error) {
        console.log(error);
    }
    setPuzzle(puzzle.puzzles[puzzleCount].fen);
    puzzleCount++;
    document.getElementById('startBtn').innerHTML = "New Puzzle";

}

function setPuzzle(puzzle) {
    console.log(puzzle);
    puzzleMovesMade = 0;
    game.load(puzzle);
    board.position(puzzle);
    turn = game.turn();
    var from = puzzleMoves[0].substring(0, 2);
    var to = puzzleMoves[0].substring(2, 4);
    var queen = 'p';
    if (puzzleMoves[0].length == 5) {
        queen = puzzleMoves[0].substring(4, 5);
    }
    if (queen === 'p') {
        game.move({ from: from, to: to });
    } else {
        game.move({ from: from, to: to, promotion: queen });
    }
    turn = game.turn();
    console.log(puzzleMovesMade);
    board.position(game.fen());
    if (game.turn() == 'b') {
        document.getElementById('level').innerHTML = 'Black To Move';
    } else {
        document.getElementById('level').innerHTML = 'White  To Move';
    }
    puzzleMovesMade++;
}

function makePuzzleMove() {
    var from = puzzleMoves[puzzleMovesMade].substring(0, 2);
    var to = puzzleMoves[puzzleMovesMade].substring(2, 4);
    var queen = 'p';
    if (puzzleMoves[puzzleMovesMade].length == 5) {
        queen = puzzleMoves[puzzleMovesMade].substring(4, 5);
    }
    console.log(puzzleMovesMade);
    if (queen === 'p') {
        game.move({ from: from, to: to });
    } else {
        game.move({ from: from, to: to, promotion: queen });
    }
    board.position(game.fen());
    if (puzzleMovesMade != maxPuzzleMoves) {
        puzzleMovesMade++;
    } else {
        document.getElementById('level').innerHTML = 'Puzzle Solved';
        document.getElementById('startBtn').innerHTML = "New Puzzle";
    }


    if (game.turn == 'b') {
        document.getElementById('level').innerHTML = 'Black To Move';
    } else {
        document.getElementById('level').innerHTML = 'White  To Move';
    }

}