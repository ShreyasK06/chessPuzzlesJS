var board = null
var game = new Chess()
var whiteSquareGrey = '#a9a9a9'
var blackSquareGrey = '#696969'
let lastPos;
let easy = false;
let turn;

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

function onDrop(source, target) {
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

    window.setTimeout(makeRandomMove, 20)
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
    position: 'start',
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
        board.start()
        game.reset();
        document.getElementById('gameState').innerHTML = '';
        document.getElementById('gameState').classList.remove('over');

    })
    $('#ruyLopez').on('click', function () {
        board.position(ruyLopez)
    });
    $('#italian').on('click', function () {
        board.position(italian)
    });

    $('#french').on('click', function () {
        board.position(french)
    });

    $('#queens').on('click', function () {
        board.position(queens)
    });

    $('#english').on('click', function () {
        board.position(english)
    });

    $('#sicilian').on('click', function () {
        board.position(sicilian)
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
            document.getElementById('easy').classList.remove('off');
        } else {
            easy = true;
            document.getElementById('easy').classList.remove('off');
            document.getElementById('easy').classList.remove('on');
        }
    })
}
function displayGameOver() {
    if (game.in_checkmate()) {
        if (turn == "b") {
            document.getElementById('gameState').innerHTML = 'WHITE WINS';
            document.getElementById('gameState').classList.add('over');
        } else {
            document.getElementById('gameState').innerHTML = 'WHITE WINS';
            document.getElementById('gameState').classList.add('over');
        }
    }
}

