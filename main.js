    
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
    if (puzzleMovesMade != 7) {
        puzzleMovesMade++;
    }


    if (game.turn == 'b') {
        document.getElementById('level').innerHTML = 'Black To Move';
    } else {
        document.getElementById('level').innerHTML = 'White  To Move';
    }

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
        var turn = game.turn();
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
            makePuzzleMove();
        } else {
            game.undo();
            return 'snapback'
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
        if (easy) {
            easy = false;
            document.getElementById('easy').classList.remove('on');
            document.getElementById('easy').classList.add('off');
            checkOff()
        } else {
            easy = true;
            switchBtnMode('grandmaster', 'hard', 'medium', 'easy');

        }
    })

    $('#medium').on('click', function () {
        if (medium) {
            medium = false;
            document.getElementById('medium').classList.remove('on');
            document.getElementById('medium').classList.add('off');
            checkOff()
        } else {
            medium = true;
            switchBtnMode('grandmaster', 'hard', 'easy', 'medium');
        }
    })

    $('#hard').on('click', function () {
        if (hard) {
            hard = false;
            document.getElementById('hard').classList.remove('on');
            document.getElementById('hard').classList.add('off');
            checkOff()
        } else {
            hard = true;
            switchBtnMode('grandmaster', 'medium', 'easy', 'hard');
        }
    })

    $('#grandmaster').on('click', function () {
        if (grandmaster) {
            grandmaster = false;
            document.getElementById('grandmaster').classList.remove('on');
            document.getElementById('grandmaster').classList.add('off');
            checkOff()
        } else {
            grandmaster = true;
            switchBtnMode('hard', 'medium', 'easy', 'grandmaster');
        }
    })

    $('#puzzle').on('click', function () {
        document.getElementById('ai').innerHTML = ' ';
        document.getElementById('ai').classList.add('gameMode');
        playingPuzzle = true;
        getPuzzles();
    })

    $('#chess960').on('click', function () {
        document.getElementById('ai').innerHTML = ' ';
        document.getElementById('ai').classList.add('gameMode');
    })

    $('#playground').on('click', function () {
        playingPuzzle = false;
        document.getElementById('ai').innerHTML = ' ';
        console.log(document.getElementById('startBtn').innerHTML);
        document.getElementById('ai').classList.add('gameMode');
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
        playingPuzzle = false;
        document.getElementById('ai').innerHTML = '🤖';
        document.getElementById('ai').classList.remove('gameMode');
        document.getElementById('gameBtns').classList.remove('pgMode');
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
    });
}

function switchBtnMode(on1, on2, on3, off1) {
    document.getElementById(on1).classList.remove('on');
    document.getElementById(on1).classList.add('off');
    document.getElementById(on2).classList.remove('on');
    document.getElementById(on2).classList.add('off');
    document.getElementById(on3).classList.remove('on');
    document.getElementById(on3).classList.add('off');
    document.getElementById(on3).classList.remove('on');
    document.getElementById(on3).classList.add('off');
    document.getElementById(off1).classList.add('on');
    document.getElementById(off1).classList.remove('off');

    document.getElementById('level').innerHTML = off1.toUpperCase() + ' LEVEL';
    document.getElementById('level').classList.add('over');
}

function checkOff() {
    if (!easy && !medium && !hard && !grandmaster) {
        document.getElementById('level').innerHTML = ' ';
        document.getElementById('level').classList.remove('over');
    }
}

function displayGameOver() {
    if (game.in_checkmate()) {
        if (turn === 'w') {
            document.getElementById('level').innerHTML = 'WHITE WINS';
            document.getElementById('level').classList.add('over');
        } else if (turn === 'w') {
            document.getElementById('level').innerHTML = 'BLACK WINS';
            document.getElementById('level').classList.add('over');
        }
    } else if (game.in_threefold_repetition()) {
        document.getElementById('level').innerHTML = 'THREEFOLD REPETITION';
        document.getElementById('level').classList.add('over');
    } else if (game.in_stalemate()) {
        document.getElementById('level').innerHTML = 'STALEMATE';
        document.getElementById('level').classList.add('over');
    } else if (game.insufficient_material()) {
        document.getElementById('level').innerHTML = 'INSUFFICIENT MATERIAL';
        document.getElementById('level').classList.add('over');
    }

    if (game.game_over() && grandmaster) {
        gameReview();
    }
}

async function getPuzzles() {
    // const apiUrl = 'https://chess-puzzles.p.rapidapi.com/?count=1&themes=["endgame"]&rating=1500&playerMoves=4';
    // const options = {
    //     method: 'GET',
    //     headers: {
    //         'X-RapidAPI-Key': '966dbf9131msh22bbb6805a935f5p186cfajsn640f0aba3bc3',
    //         'X-RapidAPI-Host': 'chess-puzzles.p.rapidapi.com'
    //     }
    // };
    // try {    
    //     const response = await fetch(apiUrl, options)
    //     puzzle = await response.json();
    //     console.log(puzzle);
    //     puzzleMoves = puzzle.puzzles[0].moves;

    // } catch (error) {
    //     console.log(error);
    // }
    setPuzzle('8/7p/6pk/1R6/p1BPP3/P6P/KPP5/2n2r2 w - - 3 37');
    document.getElementById('startBtn').innerHTML = "New Puzzle";

}

function setPuzzle(puzzle) {
    puzzleMovesMade = 0;
    position = puzzle;
    game.load(position);
    // turn = game.turn();
    // var from = puzzleMoves[0].substring(0, 2);
    // var to = puzzleMoves[0].substring(2, 4);
    // var queen = 'p';
    // if (puzzleMoves[0].length == 5) {
    //     queen = puzzleMoves[0].substring(4, 5);
    // }
    // if (queen === 'p') {
    //     game.move({ from: from, to: to });
    // } else {
    //     game.move({ from: from, to: to, promotion: queen });
    // }
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


