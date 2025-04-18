// Game variables
let board = null;
let game = Chess();
const whiteSquareGrey = '#a9a9a9';
const blackSquareGrey = '#696969';
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
let isLoading = false;
let twoPlayerMode = false; // Flag for two-player mode

// Initialize dark mode from localStorage or system preference
function initDarkMode() {
    const darkModeToggle = document.getElementById('darkModeToggle');
    const prefersDarkScheme = window.matchMedia('(prefers-color-scheme: dark)');

    // Check for saved theme preference or use the system preference
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark' || (!savedTheme && prefersDarkScheme.matches)) {
        document.body.setAttribute('data-theme', 'dark');
        darkModeToggle.checked = true;
    }

    // Add event listener for theme toggle
    darkModeToggle.addEventListener('change', function () {
        if (this.checked) {
            document.body.setAttribute('data-theme', 'dark');
            localStorage.setItem('theme', 'dark');
        } else {
            document.body.removeAttribute('data-theme');
            localStorage.setItem('theme', 'light');
        }
    });
}

// Initialize two-player mode
function initTwoPlayerMode() {
    const twoPlayerToggle = document.getElementById('twoPlayerToggle');

    // Check for saved preference
    const savedMode = localStorage.getItem('twoPlayerMode');
    if (savedMode === 'true') {
        twoPlayerMode = true;
        twoPlayerToggle.checked = true;
        document.getElementById('ai').classList.add('gameMode'); // Hide AI difficulty dropdown
        document.getElementById('gameState').innerHTML = 'Two-Player Mode';
        document.getElementById('level').innerHTML = getCurrentTurnText();
    }

    // Add event listener for two-player toggle
    twoPlayerToggle.addEventListener('change', function () {
        twoPlayerMode = this.checked;
        localStorage.setItem('twoPlayerMode', twoPlayerMode);

        if (twoPlayerMode) {
            // Switch to two-player mode
            resetAllDifficulties();
            document.getElementById('ai').classList.add('gameMode'); // Hide AI difficulty dropdown
            document.getElementById('gameState').innerHTML = 'Two-Player Mode';
            document.getElementById('level').innerHTML = getCurrentTurnText();

            // Make sure traditional button is selected if no other mode is selected
            if (!$('#myLeftnav .btn, #mySidenav .btn').hasClass('selected')) {
                clearSelectedModes();
                $('#traditional').addClass('selected');
            }

            updateGameInfo();
        } else {
            // Switch back to AI mode
            document.getElementById('ai').classList.remove('gameMode'); // Show AI difficulty dropdown
            document.getElementById('gameState').innerHTML = 'Traditional Chess';
            document.getElementById('level').innerHTML = 'Select a difficulty level';

            // Make sure traditional button is selected
            clearSelectedModes();
            $('#traditional').addClass('selected');

            updateGameInfo();
        }
    });
}

// Helper function to get current turn text
function getCurrentTurnText() {
    return game.turn() === 'w' ? 'White to Move' : 'Black to Move';
}

// Helper function to get AI level text
function getAILevelText() {
    if (easy) return 'Easy Level';
    if (medium) return 'Medium Level';
    if (hard) return 'Hard Level';
    if (grandmaster) return 'Grandmaster Level';
    return 'Select a difficulty level';
}

// Show/hide loading indicator
function toggleLoading(show) {
    const loadingIndicator = document.getElementById('loadingIndicator');
    isLoading = show;
    if (show) {
        loadingIndicator.classList.remove('d-none');
    } else {
        loadingIndicator.classList.add('d-none');
    }
}

// Square highlighting functions
function removeHighlights() {
    $('#board .square-55d63').removeClass('highlight-square highlight-capture highlight-check');
}

function highlightSquare(square, moveType) {
    const $square = $('#board .square-' + square);

    // Different highlight styles based on move type
    if (moveType === 'capture') {
        $square.addClass('highlight-capture');
    } else if (moveType === 'check') {
        $square.addClass('highlight-check');
    } else {
        $square.addClass('highlight-square');
    }
}

// Function to highlight possible moves for a square
function highlightPossibleMoves(square) {
    // Get list of possible moves for this square
    const moves = game.moves({
        square: square,
        verbose: true
    });

    // Exit if there are no moves available for this square
    if (moves.length === 0) return;

    // Highlight the possible squares for this piece
    for (const move of moves) {
        let moveType = 'normal';

        // Check if this is a capture move
        if (move.captured) {
            moveType = 'capture';
        }
        // Check if this is a check move
        else if (move.san.includes('+')) {
            moveType = 'check';
        }
        // Check if this is a checkmate move
        else if (move.san.includes('#')) {
            moveType = 'check';
        }

        highlightSquare(move.to, moveType);
    }
}

// Chess piece drag start handler
function onDragStart(source, piece) {
    // Do not pick up pieces if the game is over or if it's loading
    if (game.game_over() || isLoading) {
        return false;
    }

    // Or if it's not that side's turn
    if ((game.turn() === 'w' && piece.search(/^b/) !== -1) ||
        (game.turn() === 'b' && piece.search(/^w/) !== -1)) {
        return false;
    }

    // Show possible moves when a piece is picked up
    // First, clear any existing highlights
    removeHighlights();

    // Highlight possible moves for this piece
    highlightPossibleMoves(source);
}

// AI move functions
function makeRandomMove() {
    toggleLoading(true);

    setTimeout(() => {
        const possibleMoves = game.moves();
        // Game over
        if (possibleMoves.length === 0) {
            toggleLoading(false);
            return;
        }

        const randomIdx = Math.floor(Math.random() * possibleMoves.length);
        game.move(possibleMoves[randomIdx]);
        board.position(game.fen());
        displayGameOver();
        toggleLoading(false);
    }, 500); // Add a small delay for better UX
}

function makeMediumMove() {
    toggleLoading(true);

    setTimeout(() => {
        // Implement a slightly smarter algorithm than random
        const possibleMoves = game.moves({ verbose: true });
        if (possibleMoves.length === 0) {
            toggleLoading(false);
            return;
        }

        // Prioritize captures and checks
        const captureMoves = possibleMoves.filter(move => move.captured);
        const checkMoves = possibleMoves.filter(move => move.san.includes('+'));

        let selectedMove;

        if (checkMoves.length > 0) {
            // Prefer check moves
            selectedMove = checkMoves[Math.floor(Math.random() * checkMoves.length)];
        } else if (captureMoves.length > 0) {
            // Then prefer capture moves
            selectedMove = captureMoves[Math.floor(Math.random() * captureMoves.length)];
        } else {
            // Otherwise random move
            selectedMove = possibleMoves[Math.floor(Math.random() * possibleMoves.length)];
        }

        game.move(selectedMove);
        board.position(game.fen());
        displayGameOver();
        toggleLoading(false);
    }, 800);
}

function makeHardMove() {
    toggleLoading(true);

    setTimeout(() => {
        try {
            // Get all possible moves
            const possibleMoves = game.moves({ verbose: true });
            if (possibleMoves.length === 0) {
                toggleLoading(false);
                return;
            }

            // Assign scores to moves based on piece values and position
            const scoredMoves = possibleMoves.map(move => {
                let score = 0;

                // Base score for captures based on piece values
                if (move.captured) {
                    const pieceValues = {
                        'p': 1,   // pawn
                        'n': 3,   // knight
                        'b': 3.5, // bishop
                        'r': 5,   // rook
                        'q': 9,   // queen
                        'k': 100  // king (not actually capturable in legal chess)
                    };
                    score += pieceValues[move.captured] * 10;
                }

                // Bonus for checks
                if (move.san.includes('+')) {
                    score += 5;
                }

                // Bonus for checkmate
                if (move.san.includes('#')) {
                    score += 1000;
                }

                // Bonus for promotion
                if (move.promotion) {
                    const promotionValues = {
                        'q': 9,  // queen
                        'r': 5,  // rook
                        'b': 3,  // bishop
                        'n': 3   // knight
                    };
                    score += promotionValues[move.promotion] * 8;
                }

                // Bonus for controlling center squares
                const centerSquares = ['d4', 'd5', 'e4', 'e5'];
                if (centerSquares.includes(move.to)) {
                    score += 2;
                }

                // Bonus for developing pieces in opening
                if (game.history().length < 10) {
                    // Encourage knight and bishop development
                    if ((move.piece === 'n' || move.piece === 'b') &&
                        move.from.charAt(1) === (move.color === 'w' ? '1' : '8') &&
                        move.to.charAt(1) !== (move.color === 'w' ? '1' : '8')) {
                        score += 3;
                    }

                    // Encourage pawn moves to control center
                    if (move.piece === 'p' && centerSquares.includes(move.to)) {
                        score += 2;
                    }
                }

                // Add some randomness to make play less predictable
                score += Math.random() * 2;

                return { move, score };
            });

            // Sort moves by score (highest first)
            scoredMoves.sort((a, b) => b.score - a.score);

            // Select one of the top moves (not always the best for some unpredictability)
            const topMoves = scoredMoves.slice(0, Math.min(3, scoredMoves.length));
            const selectedMoveObj = topMoves[Math.floor(Math.random() * topMoves.length)];

            // Make the selected move
            game.move(selectedMoveObj.move);
            board.position(game.fen());
            displayGameOver();
            updateMoveHistory();
            updateGameInfo();
        } catch (error) {
            console.error('Error making hard move:', error);
            // Fallback to medium move if there's an error
            makeMediumMove();
        } finally {
            toggleLoading(false);
        }
    }, 1000); // Slightly longer delay to simulate thinking
}

async function makeGrandmasterMove() {
    toggleLoading(true);

    try {
        await getBestMove();
        if (move) {
            const from = move.substring(0, 2);
            const to = move.substring(2, 4);
            let queen = 'q'; // Default to queen for promotion

            if (move.length === 5) {
                queen = move.substring(4, 5);
            }

            const moveResult = game.move({
                from: from,
                to: to,
                promotion: queen
            });

            if (moveResult === null) {
                console.error('Invalid move returned from API');
                makeMediumMove();
                return;
            }

            board.position(game.fen());
            move = null;
        } else {
            // Fallback to checking for checkmate moves
            const possibleMoves = game.moves();
            let foundCheckmate = false;

            for (let i = 0; i < possibleMoves.length && !foundCheckmate; i++) {
                game.move(possibleMoves[i]);
                if (game.in_checkmate()) {
                    foundCheckmate = true;
                    board.position(game.fen());
                } else {
                    game.undo();
                }
            }

            if (!foundCheckmate) {
                // If no checkmate found, try again or fall back to medium
                makeMediumMove();
                return;
            }
        }

        displayGameOver();
    } catch (error) {
        console.error('Error making grandmaster move:', error);
        makeMediumMove();
    } finally {
        toggleLoading(false);
    }
}

function onDrop(source, target) {
    // Handle piece promotion
    let promotion = 'q'; // Default to queen

    // Check if this is a pawn promotion move
    const moveColor = game.turn();
    const sourceSquare = game.get(source);

    if (sourceSquare && sourceSquare.type === 'p') {
        const targetRank = target.charAt(1);
        if ((moveColor === 'w' && targetRank === '8') || (moveColor === 'b' && targetRank === '1')) {
            // This is a promotion move, but we'll use queen by default for simplicity
            // In a more advanced version, we could show a modal for piece selection
            promotion = 'q';
        }
    }

    if (!playingPuzzle) {
        removeHighlights();

        // Check if we're in AI mode but no difficulty is selected
        if (!twoPlayerMode && !easy && !medium && !hard && !grandmaster) {
            showGameResultModal('Select Difficulty', `
                <div class="text-center">
                    <i class="fas fa-exclamation-triangle text-warning" style="font-size: 2rem;"></i>
                    <p class="mt-3">Please select a difficulty level before playing.</p>
                    <p>Click on the Difficulty dropdown in the top-right corner.</p>
                </div>
            `);
            return 'snapback';
        }

        // See if the move is legal
        const moveResult = game.move({
            from: source,
            to: target,
            promotion: promotion
        });

        // Illegal move
        if (moveResult === null) return 'snapback';

        // Update the board and move history
        board.position(game.fen());
        updateMoveHistory();
        updateGameInfo();

        // Update turn indicator for two-player mode
        if (twoPlayerMode) {
            document.getElementById('level').innerHTML = getCurrentTurnText();
        }

        // Check for game over after player's move
        if (game.game_over()) {
            displayGameOver();
            return;
        }

        // Make AI move only if not in two-player mode
        if (!twoPlayerMode) {
            if (easy) {
                makeRandomMove();
            } else if (medium) {
                makeMediumMove();
            } else if (hard) {
                makeHardMove();
            } else if (grandmaster) {
                makeGrandmasterMove();
            }
        }
    } else {
        // Puzzle mode
        removeHighlights();

        // We'll use game.undo() if needed, no need to save position

        // Try the move
        const moveResult = game.move({
            from: source,
            to: target,
            promotion: promotion
        });

        // Illegal move
        if (moveResult === null) return 'snapback';

        // Update the board
        board.position(game.fen());
        updateMoveHistory();

        // Check if this is the expected move in the puzzle
        const actualMove = moveResult.from + moveResult.to;
        const expectedMove = puzzleMoves[puzzleMovesMade];

        if (actualMove === expectedMove) {
            // Correct move
            puzzleMovesMade++;
            updateGameInfo();

            // Check if puzzle is solved
            if (puzzleMovesMade === maxPuzzleMoves) {
                document.getElementById('level').innerHTML = 'Puzzle Solved!';
                document.getElementById('startBtn').innerHTML = "New Puzzle";

                // Show success message in modal
                showGameResultModal('Puzzle Solved!', `
                    <div class="text-center">
                        <i class="fas fa-trophy text-warning" style="font-size: 3rem;"></i>
                        <h4 class="mt-3">Congratulations!</h4>
                        <p>You solved the puzzle correctly.</p>
                        <p>Keep practicing to improve your tactical skills!</p>
                    </div>
                `);
            } else {
                // Make the next computer move in the puzzle
                makePuzzleMove();
            }
        } else {
            // Wrong move - undo and show hint
            game.undo();
            board.position(game.fen());

            // Show hint modal
            showGameResultModal('Try Again', `
                <div class="text-center">
                    <i class="fas fa-lightbulb text-warning" style="font-size: 2rem;"></i>
                    <p class="mt-3">That's not the best move in this position.</p>
                    <p>Look for a better move!</p>
                </div>
            `);

            return 'snapback';
        }
    }
}

function onMouseoverSquare(square, _piece) {
    // Don't show moves if we're loading or in a game over state
    if (isLoading || game.game_over()) return;

    // Clear previous highlights and show possible moves for this piece
    removeHighlights();
    highlightPossibleMoves(square);
}

function onMouseoutSquare(_square, _piece) {
    removeHighlights();
}

function onSnapEnd() {
    board.position(game.fen());
    removeHighlights();
    displayGameOver();
}

// Chess board configuration
const config = {
    draggable: true,
    position: position,
    onDragStart: onDragStart,
    onDrop: onDrop,
    onMouseoutSquare: onMouseoutSquare,
    onMouseoverSquare: onMouseoverSquare,
    onSnapEnd: onSnapEnd
};

// Opening positions
const ruyLopez = 'r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R';
const italian = 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2BPP3/5N2/PPP2PPP/RNBQK2R';
const french = 'rnbqkbnr/ppp2ppp/4p3/3p4/3PP3/2N5/PPP2PPP/R1BQKBNR b KQkq - 0 1';
const queens = 'rnbqkbnr/ppp1pppp/8/3p4/2PP4/8/PP2PPPP/RNBQKBNR w KQkq d6 0 1';
const english = 'r1b1kbnr/pppp1ppp/2n5/4P3/1q3B2/5N2/PPP1PPPP/RN1QKB1R w KQkq - 0 10';
const sicilian = 'r1bqk2r/pp2ppbp/2np1np1/8/3NP3/2N1BP2/PPPQ2PP/R3KB1R w KQkq - 0 1';

// Show game result in modal
function showGameResultModal(title, message) {
    const modalElement = document.getElementById('gameResultModal');
    const modal = new bootstrap.Modal(modalElement);
    document.getElementById('gameResultModalLabel').textContent = title;
    document.getElementById('gameResultContent').innerHTML = message;

    // Remove any existing event listeners to prevent duplicates
    const newGameBtn = document.getElementById('newGameBtn');
    const newGameBtnClone = newGameBtn.cloneNode(true);
    newGameBtn.parentNode.replaceChild(newGameBtnClone, newGameBtn);

    // Add event listener to new game button
    newGameBtnClone.addEventListener('click', function () {
        modal.hide();
        gameReset();
    });

    modal.show();
}

// Set up all button event handlers
function setButtons() {
    // Start/Reset button
    $('#startBtn').on('click', function () {
        if (playingPuzzle) {
            getPuzzles();
        } else {
            gameVisualReset();
            board.start();
            game.reset();
            document.getElementById('level').innerHTML = '';
            document.getElementById('level').classList.remove('over');
            document.getElementById('gameState').innerHTML = 'New Game';
            updateMoveHistory();
            updateGameInfo();
        }
    });

    // Opening position buttons
    $('#ruyLopez').on('click', function () {
        position = ruyLopez;
        game.load(position);
        board.position(position);
        updateMoveHistory();
        updateGameInfo();
        document.getElementById('gameState').innerHTML = 'Ruy Lopez Opening';
    });

    $('#italian').on('click', function () {
        position = italian;
        game.load(position);
        board.position(position);
        updateMoveHistory();
        updateGameInfo();
        document.getElementById('gameState').innerHTML = 'Italian Opening';
    });

    $('#french').on('click', function () {
        position = french;
        game.load(position);
        board.position(position);
        updateMoveHistory();
        updateGameInfo();
        document.getElementById('gameState').innerHTML = 'French Defense';
    });

    $('#queens').on('click', function () {
        position = queens;
        game.load(position);
        board.position(position);
        updateMoveHistory();
        updateGameInfo();
        document.getElementById('gameState').innerHTML = 'Queen\'s Gambit';
    });

    $('#english').on('click', function () {
        position = english;
        game.load(position);
        board.position(position);
        updateMoveHistory();
        updateGameInfo();
        document.getElementById('gameState').innerHTML = 'English Opening';
    });

    $('#sicilian').on('click', function () {
        position = sicilian;
        game.load(position);
        board.position(position);
        updateMoveHistory();
        updateGameInfo();
        document.getElementById('gameState').innerHTML = 'Sicilian Defense';
    });

    // Undo/Redo buttons
    $('#undoBtn').on('click', function () {
        // Save current position for redo
        lastPos = game.fen();
        // Undo the move
        game.undo();
        // Update the board
        board.position(game.fen());
        // Update the UI
        updateMoveHistory();
        updateGameInfo();
    });

    $('#redoBtn').on('click', function () {
        if (lastPos) {
            // Load the position into the game
            game.load(lastPos);
            // Update the board
            board.position(lastPos);
            // Update the UI
            updateMoveHistory();
            updateGameInfo();
        }
    });

    // Helper function to clear selected state from all difficulty buttons
    function clearSelectedDifficulties() {
        $('.dropdown-item').removeClass('selected');
    }

    // Difficulty level buttons
    $('#easy').on('click', function () {
        gameModeDefaults();
        if (!easy) {
            resetAllDifficulties();
            clearSelectedDifficulties();
            $(this).addClass('selected');
            easy = true;
            switchBtnMode('easy');
            document.getElementById('gameState').innerHTML = 'AI Game - Easy Mode';
            // Make sure a game mode is selected (default to traditional)
            if (!$('#myLeftnav .btn, #mySidenav .btn').hasClass('selected')) {
                $('#traditional').addClass('selected');
            }
        } else {
            gameReset();
            easy = false;
            $(this).removeClass('selected');
            document.getElementById('gameState').innerHTML = 'Choose Game Mode';
            document.getElementById('level').innerHTML = 'Select a difficulty level';
        }
        updateGameInfo();
    });

    $('#medium').on('click', function () {
        gameModeDefaults();
        if (!medium) {
            resetAllDifficulties();
            clearSelectedDifficulties();
            $(this).addClass('selected');
            medium = true;
            switchBtnMode('medium');
            document.getElementById('gameState').innerHTML = 'AI Game - Medium Mode';
            // Make sure a game mode is selected (default to traditional)
            if (!$('#myLeftnav .btn, #mySidenav .btn').hasClass('selected')) {
                $('#traditional').addClass('selected');
            }
        } else {
            gameReset();
            medium = false;
            $(this).removeClass('selected');
            document.getElementById('gameState').innerHTML = 'Choose Game Mode';
            document.getElementById('level').innerHTML = 'Select a difficulty level';
        }
        updateGameInfo();
    });

    $('#hard').on('click', function () {
        gameModeDefaults();
        if (!hard) {
            resetAllDifficulties();
            clearSelectedDifficulties();
            $(this).addClass('selected');
            hard = true;
            switchBtnMode('hard');
            document.getElementById('gameState').innerHTML = 'AI Game - Hard Mode';
            // Make sure a game mode is selected (default to traditional)
            if (!$('#myLeftnav .btn, #mySidenav .btn').hasClass('selected')) {
                $('#traditional').addClass('selected');
            }
        } else {
            gameReset();
            hard = false;
            $(this).removeClass('selected');
            document.getElementById('gameState').innerHTML = 'Choose Game Mode';
            document.getElementById('level').innerHTML = 'Select a difficulty level';
        }
        updateGameInfo();
    });

    $('#grandmaster').on('click', function () {
        gameModeDefaults();
        if (!grandmaster) {
            resetAllDifficulties();
            clearSelectedDifficulties();
            $(this).addClass('selected');
            grandmaster = true;
            switchBtnMode('grandmaster');
            document.getElementById('gameState').innerHTML = 'AI Game - Grandmaster Mode';
            // Make sure a game mode is selected (default to traditional)
            if (!$('#myLeftnav .btn, #mySidenav .btn').hasClass('selected')) {
                $('#traditional').addClass('selected');
            }
        } else {
            gameReset();
            grandmaster = false;
            $(this).removeClass('selected');
            document.getElementById('gameState').innerHTML = 'Choose Game Mode';
            document.getElementById('level').innerHTML = 'Select a difficulty level';
        }
        updateGameInfo();
    });

    // Helper function to clear selected state from all mode buttons
    function clearSelectedModes() {
        $('#myLeftnav .btn, #mySidenav .btn').removeClass('selected');
    }

    // Game mode buttons
    $('#puzzle').on('click', function () {
        clearSelectedModes();
        $(this).addClass('selected');
        gameModeDefaults();
        playingPuzzle = true;
        document.getElementById('gameState').innerHTML = 'Daily Puzzle';
        getPuzzles();
    });

    $('#chess960').on('click', function () {
        clearSelectedModes();
        $(this).addClass('selected');
        gameModeDefaults();
        resetAllDifficulties();
        playingPuzzle = false;

        // Generate a random Chess960 position
        const chess960Fen = generateChess960Position();

        // Load the position
        game.load(chess960Fen);
        board.position(chess960Fen);

        // Update the UI
        document.getElementById('level').innerHTML = 'Chess960 Mode';
        updateMoveHistory();
        updateGameInfo();

        // Show a modal with information about Chess960
        showGameResultModal('Chess960 Mode', `
            <p>You are now playing Chess960 (Fischer Random Chess).</p>
            <p>In this variant, the back rank pieces are randomized following these rules:</p>
            <ul>
                <li>Bishops must be on opposite colored squares</li>
                <li>The king must be placed between the two rooks</li>
            </ul>
            <p>All other rules of chess apply. Good luck!</p>
        `);
    });

    $('#playground').on('click', function () {
        clearSelectedModes();
        $(this).addClass('selected');
        playingPuzzle = false;
        resetAllDifficulties();
        document.getElementById('ai').classList.add('gameMode');
        document.getElementById('level').classList.add('pgModeL');
        document.getElementById('board').classList.add('pgModeB');
        document.getElementById('gameBtns').classList.add('pgMode');
        document.getElementById('gameState').innerHTML = 'Playground Mode';
        document.getElementById('level').innerHTML = 'Set up your own position';

        const playgroundConfig = {
            draggable: true,
            dropOffBoard: 'trash',
            sparePieces: true
        };

        board = Chessboard('board', playgroundConfig);
        board.clear(false);

        // Clear move history
        document.getElementById('moveHistory').innerHTML = '';

        // Update game info
        updateGameInfo();
    });

    $('#traditional').on('click', function () {
        clearSelectedModes();
        $(this).addClass('selected');
        gameVisualReset();
        gameReset();

        if (twoPlayerMode) {
            document.getElementById('gameState').innerHTML = 'Two-Player Chess';
            document.getElementById('level').innerHTML = getCurrentTurnText();
        } else {
            document.getElementById('gameState').innerHTML = 'Traditional Chess';
        }

        updateGameInfo();
    });
}

// Helper function to reset all difficulty settings
function resetAllDifficulties() {
    easy = false;
    medium = false;
    hard = false;
    grandmaster = false;
}

// Set default UI for game modes
function gameModeDefaults() {
    document.getElementById('ai').classList.add('gameMode');
    document.getElementById('board').classList.add('gameModes');
    document.getElementById('level').classList.remove('normal');
}

// Reset game to starting position
function gameReset() {
    playingPuzzle = false;
    const resetConfig = {
        draggable: true,
        position: position,
        onDragStart: onDragStart,
        onDrop: onDrop,
        onMouseoutSquare: onMouseoutSquare,
        onMouseoverSquare: onMouseoverSquare,
        onSnapEnd: onSnapEnd
    };
    board = Chessboard('board', resetConfig);
    board.start();
    game.reset();

    // Set appropriate messages based on game mode
    if (twoPlayerMode) {
        document.getElementById('gameState').innerHTML = 'Two-Player Mode';
        document.getElementById('level').innerHTML = 'White to Move';
    } else if (easy || medium || hard || grandmaster) {
        document.getElementById('gameState').innerHTML = 'New Game';
        document.getElementById('level').innerHTML = getAILevelText();
    } else {
        // Default to traditional mode
        document.getElementById('gameState').innerHTML = 'Traditional Chess';
        document.getElementById('level').innerHTML = 'Select a difficulty level';

        // Make sure traditional button is selected
        clearSelectedModes();
        $('#traditional').addClass('selected');
    }

    updateMoveHistory();
    updateGameInfo();
}

// Reset visual elements
function gameVisualReset() {
    document.getElementById('board').classList.remove('gameModes');
    document.getElementById('level').classList.add('normal');
    document.getElementById('ai').classList.remove('gameMode');
    if (document.getElementById('gameBtns').classList.contains('pgMode')) {
        document.getElementById('gameBtns').classList.remove('pgMode');
    }
}

// Switch between difficulty modes
function switchBtnMode(mode) {
    const levels = ['easy', 'medium', 'hard', 'grandmaster'];
    document.getElementById('level').innerHTML = mode.toUpperCase() + ' LEVEL';

    // Update button styles
    levels.forEach(level => {
        const btn = document.getElementById(level);
        if (level === mode) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

// Check if all difficulty modes are off
function checkOff() {
    if (!easy && !medium && !hard && !grandmaster) {
        if (twoPlayerMode) {
            document.getElementById('level').innerHTML = getCurrentTurnText();
        } else if (playingPuzzle) {
            // Keep puzzle message
        } else {
            document.getElementById('level').innerHTML = 'Select a difficulty level';
        }
        document.getElementById('level').classList.remove('over');
    }
}

// Display game over messages
function displayGameOver() {
    let gameOverMessage = '';
    let modalTitle = '';
    let modalContent = '';

    if (game.game_over()) {
        if (game.in_checkmate()) {
            const winner = game.turn() === 'w' ? 'Black' : 'White';
            gameOverMessage = winner + ' Wins';
            modalTitle = 'Checkmate!';
            modalContent = `
                <div class="text-center">
                    <i class="fas fa-chess-king text-${winner === 'White' ? 'light' : 'dark'} mb-3" style="font-size: 3rem;"></i>
                    <h4>${winner} wins by checkmate!</h4>
                </div>
            `;
        } else if (game.in_stalemate()) {
            gameOverMessage = 'Stalemate';
            modalTitle = 'Draw';
            modalContent = `
                <div class="text-center">
                    <i class="fas fa-handshake text-info mb-3" style="font-size: 3rem;"></i>
                    <h4>Game drawn by stalemate</h4>
                    <p>A player has no legal moves but is not in check.</p>
                </div>
            `;
        } else if (game.in_threefold_repetition()) {
            gameOverMessage = 'Draw by Repetition';
            modalTitle = 'Draw';
            modalContent = `
                <div class="text-center">
                    <i class="fas fa-sync-alt text-info mb-3" style="font-size: 3rem;"></i>
                    <h4>Game drawn by threefold repetition</h4>
                    <p>The same position has occurred three times.</p>
                </div>
            `;
        } else if (game.insufficient_material()) {
            gameOverMessage = 'Draw by Insufficient Material';
            modalTitle = 'Draw';
            modalContent = `
                <div class="text-center">
                    <i class="fas fa-balance-scale text-info mb-3" style="font-size: 3rem;"></i>
                    <h4>Game drawn by insufficient material</h4>
                    <p>Neither player has enough pieces to checkmate.</p>
                </div>
            `;
        } else {
            gameOverMessage = 'Game Over';
            modalTitle = 'Game Over';
            modalContent = `
                <div class="text-center">
                    <i class="fas fa-flag-checkered mb-3" style="font-size: 3rem;"></i>
                    <h4>The game has ended</h4>
                </div>
            `;
        }

        document.getElementById('level').innerHTML = gameOverMessage;
        document.getElementById('gameState').innerHTML = 'Game Over';

        // Show modal with game result
        showGameResultModal(modalTitle, modalContent);

        // Update game info
        updateGameInfo();

        // If in grandmaster mode, show game review
        if (grandmaster && !twoPlayerMode) {
            gameReview();
        }
    }
}

// Get best move from Stockfish API
async function getBestMove() {
    toggleLoading(true);

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
            if (result.ponder) {
                bestMovesWhite.push(result.ponder);
            }
            move = result.bestmove;
            return result.bestmove;
        } else {
            throw new Error(`API responded with status: ${response.status}`);
        }
    } catch (err) {
        console.error('Error getting best move:', err);
        return null;
    } finally {
        toggleLoading(false);
    }
}

// Note: We've replaced the API-based hard difficulty with our own implementation
// that uses a scoring system to evaluate moves.

// Review game moves compared to best moves
function gameReview() {
    whiteMoves = game.history({ verbose: true });
    let reviewContent = '<h4>Game Analysis</h4><ul class="list-group">';

    for (let i = 0; i < bestMovesWhite.length && i < whiteMoves.length; i++) {
        const playerMove = whiteMoves[i].from + whiteMoves[i].to;
        const bestMove = bestMovesWhite[i];

        if (bestMove === playerMove) {
            reviewContent += `<li class="list-group-item list-group-item-success">Move ${i + 1}: You played the best move (${playerMove})</li>`;
        } else {
            reviewContent += `<li class="list-group-item list-group-item-warning">Move ${i + 1}: You played ${playerMove}, but the best move was ${bestMove}</li>`;
        }
    }

    reviewContent += '</ul>';
    showGameResultModal('Game Analysis', reviewContent);
}

// Fetch chess puzzles from API
async function getPuzzles() {
    toggleLoading(true);
    resetAllDifficulties();
    playingPuzzle = true;

    // Predefined puzzles in case the API fails
    const predefinedPuzzles = [
        {
            fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
            moves: ['f3d4', 'f6d4', 'c4f7', 'e8f7', 'd1f3', 'f7g8', 'f3f7']
        },
        {
            fen: 'r1b1kb1r/pppp1ppp/2n2n2/4p1q1/2B1P3/2N2N2/PPPP1PPP/R1BQK2R w KQkq - 4 4',
            moves: ['c4f7', 'e8f7', 'f3e5', 'f7e8', 'e5g6']
        },
        {
            fen: 'r1bqkbnr/ppp2ppp/2np4/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4',
            moves: ['f3g5', 'd6e4', 'c4f7', 'e8f7', 'd1f3', 'f7g8', 'f3f7']
        },
        {
            fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p3/3PP3/5N2/PPP2PPP/RNBQKB1R w KQkq - 0 4',
            moves: ['d4e5', 'f6e4', 'f1d3', 'e4c3', 'b2c3', 'd7d5', 'e5d6']
        },
        {
            fen: 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
            moves: ['f1c4', 'g8f6', 'f3g5', 'd7d5', 'e4d5', 'c6a5', 'c4f7', 'e8f7', 'd1f3', 'f7g8', 'g5e6']
        }
    ];

    try {
        // Try to fetch from API first
        const apiUrl = 'https://chess-puzzles.p.rapidapi.com/?themes=%5B%22middlegame%22%2C%22advantage%22%5D&rating=1500&themesType=ALL&playerMoves=4&count=25';
        const options = {
            method: 'GET',
            headers: {
                'X-RapidAPI-Key': '966dbf9131msh22bbb6805a935f5p186cfajsn640f0aba3bc3',
                'X-RapidAPI-Host': 'chess-puzzles.p.rapidapi.com'
            }
        };

        const response = await fetch(apiUrl, options);

        if (!response.ok) {
            throw new Error(`API responded with status: ${response.status}`);
        }

        const puzzle = await response.json();

        if (!puzzle || !puzzle.puzzles || puzzle.puzzles.length === 0) {
            throw new Error('No puzzles returned from API');
        }

        // Reset puzzle counter if we've gone through all puzzles
        if (puzzleCount >= puzzle.puzzles.length) {
            puzzleCount = 0;
        }

        puzzleMoves = puzzle.puzzles[puzzleCount].moves;
        maxPuzzleMoves = puzzleMoves.length;

        // Set up the puzzle
        setPuzzle(puzzle.puzzles[puzzleCount].fen);
        puzzleCount++;

    } catch (error) {
        console.error('Error fetching puzzles:', error);

        // Use a predefined puzzle if API fails
        const randomIndex = Math.floor(Math.random() * predefinedPuzzles.length);
        const fallbackPuzzle = predefinedPuzzles[randomIndex];

        puzzleMoves = fallbackPuzzle.moves;
        maxPuzzleMoves = puzzleMoves.length;

        // Set up the fallback puzzle
        setPuzzle(fallbackPuzzle.fen);

        // Inform the user we're using a local puzzle
        showGameResultModal('Daily Puzzle', 'We\'re using a local puzzle today. Try to find the best moves!');
    } finally {
        document.getElementById('startBtn').innerHTML = "New Puzzle";
        updateGameInfo();
        toggleLoading(false);
    }
}

// Set up a chess puzzle
function setPuzzle(puzzleFen) {
    puzzleMovesMade = 0;
    game.load(puzzleFen);
    board.position(puzzleFen);

    // Make the first move of the puzzle
    if (puzzleMoves && puzzleMoves.length > 0) {
        const from = puzzleMoves[0].substring(0, 2);
        const to = puzzleMoves[0].substring(2, 4);
        let promotion = null;

        if (puzzleMoves[0].length === 5) {
            promotion = puzzleMoves[0].substring(4, 5);
        }

        try {
            const moveResult = game.move({
                from: from,
                to: to,
                promotion: promotion
            });

            if (moveResult === null) {
                throw new Error('Invalid puzzle move');
            }

            board.position(game.fen());

            // Update the UI to show whose turn it is
            const playerToMove = game.turn() === 'b' ? 'Black' : 'White';
            document.getElementById('level').innerHTML = `${playerToMove} to Move`;
            document.getElementById('gameState').innerHTML = 'Daily Puzzle';

            puzzleMovesMade++;
            updateMoveHistory();
        } catch (error) {
            console.error('Error setting up puzzle:', error);
            showGameResultModal('Error', 'There was an error setting up the puzzle. Please try another one.');
        }
    }
}

// Make the computer's move in a puzzle
function makePuzzleMove() {
    if (!puzzleMoves || puzzleMovesMade >= puzzleMoves.length) {
        return;
    }

    toggleLoading(true);

    // Add a small delay for better UX
    setTimeout(() => {
        try {
            const from = puzzleMoves[puzzleMovesMade].substring(0, 2);
            const to = puzzleMoves[puzzleMovesMade].substring(2, 4);
            let promotion = null;

            if (puzzleMoves[puzzleMovesMade].length === 5) {
                promotion = puzzleMoves[puzzleMovesMade].substring(4, 5);
            }

            const moveResult = game.move({
                from: from,
                to: to,
                promotion: promotion
            });

            if (moveResult === null) {
                throw new Error('Invalid puzzle move');
            }

            board.position(game.fen());
            updateMoveHistory();

            // Increment move counter if not at the end
            if (puzzleMovesMade < maxPuzzleMoves - 1) {
                puzzleMovesMade++;

                // Update the UI to show whose turn it is
                const playerToMove = game.turn() === 'b' ? 'Black' : 'White';
                document.getElementById('level').innerHTML = `${playerToMove} to Move`;
            } else {
                document.getElementById('level').innerHTML = 'Puzzle Solved!';
                document.getElementById('startBtn').innerHTML = "New Puzzle";
                showGameResultModal('Success!', `
                    <div class="text-center">
                        <i class="fas fa-trophy text-warning" style="font-size: 3rem;"></i>
                        <h4 class="mt-3">Congratulations!</h4>
                        <p>You solved the puzzle correctly.</p>
                        <p>Keep practicing to improve your tactical skills!</p>
                    </div>
                `);
            }

            updateGameInfo();
        } catch (error) {
            console.error('Error making puzzle move:', error);
            showGameResultModal('Error', 'There was an error with the puzzle. Please try another one.');
        } finally {
            toggleLoading(false);
        }
    }, 500);
}

// Generate a Chess960 position
function generateChess960Position() {
    // Chess960 rules:
    // 1. Bishops must be on opposite colored squares
    // 2. King must be between the rooks
    // 3. All other pieces can be anywhere

    // Create an array of 8 positions
    const positions = [0, 1, 2, 3, 4, 5, 6, 7];

    // Shuffle the positions
    for (let i = positions.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [positions[i], positions[j]] = [positions[j], positions[i]];
    }

    // Find positions for bishops (must be on opposite colored squares)
    let bishopPositions = [];

    // Find all even positions
    const evenPositions = positions.filter(pos => pos % 2 === 0);
    // Find all odd positions
    const oddPositions = positions.filter(pos => pos % 2 === 1);

    // Select one random even and one random odd position for bishops
    const evenBishopIndex = Math.floor(Math.random() * evenPositions.length);
    const oddBishopIndex = Math.floor(Math.random() * oddPositions.length);

    bishopPositions.push(evenPositions[evenBishopIndex]);
    bishopPositions.push(oddPositions[oddBishopIndex]);

    // Remove bishop positions from available positions
    const availablePositions = positions.filter(pos => !bishopPositions.includes(pos));

    // Find positions for knights (can be anywhere in remaining positions)
    let knightPositions = [];
    for (let i = 0; i < 2; i++) {
        const randomIndex = Math.floor(Math.random() * availablePositions.length);
        knightPositions.push(availablePositions[randomIndex]);
        availablePositions.splice(randomIndex, 1);
    }

    // Find positions for rooks and king (king must be between rooks)
    // First, sort the remaining positions
    availablePositions.sort((a, b) => a - b);

    // We need at least 3 positions for king and rooks
    if (availablePositions.length < 3) {
        // This shouldn't happen, but just in case
        return 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'; // Standard position
    }

    // Randomly select the king position from the middle positions
    // Make sure we have at least one position on each side for rooks
    const kingIndex = Math.floor(Math.random() * (availablePositions.length - 2)) + 1;
    const kingPosition = availablePositions[kingIndex];

    // Rooks go on either side of the king
    const rookPositions = [
        availablePositions[0], // Left rook
        availablePositions[availablePositions.length - 1] // Right rook
    ];

    // Remove king and rook positions
    const remainingPositions = availablePositions.filter(pos =>
        pos !== kingPosition && !rookPositions.includes(pos)
    );

    // Queen gets one of the remaining positions
    const queenPosition = remainingPositions.length > 0 ?
        remainingPositions[0] :
        availablePositions.find(pos => pos !== kingPosition && !rookPositions.includes(pos));

    // Create the FEN string for the starting position
    let pieces = new Array(8).fill(null);

    // Place the pieces
    rookPositions.forEach(pos => pieces[pos] = 'r');
    knightPositions.forEach(pos => pieces[pos] = 'n');
    bishopPositions.forEach(pos => pieces[pos] = 'b');
    pieces[queenPosition] = 'q';
    pieces[kingPosition] = 'k';

    // Create the FEN string for the first rank
    const firstRank = pieces.join('');

    // Complete FEN string
    return `${firstRank}/pppppppp/8/8/8/8/PPPPPPPP/${firstRank.toUpperCase()} w KQkq - 0 1`;
}

// Update move history display
function updateMoveHistory() {
    const history = game.history({ verbose: true });
    const moveHistoryDiv = document.getElementById('moveHistory');
    moveHistoryDiv.innerHTML = '';

    for (let i = 0; i < history.length; i += 2) {
        const moveNumber = Math.floor(i / 2) + 1;
        const moveRow = document.createElement('div');
        moveRow.className = 'move-row';

        const moveNumberSpan = document.createElement('span');
        moveNumberSpan.className = 'move-number';
        moveNumberSpan.textContent = moveNumber + '.';

        const whiteMoveSpan = document.createElement('span');
        whiteMoveSpan.className = 'move-white';
        whiteMoveSpan.textContent = history[i].san;

        const blackMoveSpan = document.createElement('span');
        blackMoveSpan.className = 'move-black';
        if (history[i + 1]) {
            blackMoveSpan.textContent = history[i + 1].san;
        }

        moveRow.appendChild(moveNumberSpan);
        moveRow.appendChild(whiteMoveSpan);
        moveRow.appendChild(blackMoveSpan);

        moveHistoryDiv.appendChild(moveRow);
    }

    // Scroll to the bottom of the move history
    moveHistoryDiv.scrollTop = moveHistoryDiv.scrollHeight;
}

// Update game info display
function updateGameInfo() {
    const gameInfoDiv = document.getElementById('gameInfo');
    let infoHTML = '';

    if (game.game_over()) {
        if (game.in_checkmate()) {
            const winner = game.turn() === 'w' ? 'Black' : 'White';
            infoHTML = `
                <p class="mb-1"><i class="fas fa-trophy me-2 text-warning"></i>${winner} wins by checkmate!</p>
                <p class="mb-1"><i class="fas fa-chess me-2"></i>Game over</p>
                <p class="mb-0"><i class="fas fa-redo me-2"></i>Click 'New Game' to play again</p>
            `;
        } else if (game.in_draw()) {
            let drawReason = 'Draw';
            if (game.in_stalemate()) {
                drawReason = 'Stalemate';
            } else if (game.in_threefold_repetition()) {
                drawReason = 'Threefold Repetition';
            } else if (game.insufficient_material()) {
                drawReason = 'Insufficient Material';
            }

            infoHTML = `
                <p class="mb-1"><i class="fas fa-handshake me-2 text-info"></i>Game drawn by ${drawReason}</p>
                <p class="mb-1"><i class="fas fa-chess me-2"></i>Game over</p>
                <p class="mb-0"><i class="fas fa-redo me-2"></i>Click 'New Game' to play again</p>
            `;
        }
    } else if (playingPuzzle) {
        infoHTML = `
            <p class="mb-1"><i class="fas fa-puzzle-piece me-2 text-success"></i>Daily Puzzle</p>
            <p class="mb-1"><i class="fas fa-chess-pawn me-2"></i>Find the best move</p>
            <p class="mb-0"><i class="fas fa-lightbulb me-2"></i>Moves made: ${puzzleMovesMade}/${maxPuzzleMoves}</p>
        `;
    } else if (twoPlayerMode) {
        // Two-player mode info
        const currentTurn = game.turn() === 'w' ? 'White' : 'Black';

        infoHTML = `
            <p class="mb-1"><i class="fas fa-chess-king me-2"></i>${currentTurn} to move</p>
            <p class="mb-1"><i class="fas fa-user-friends me-2"></i>Two-Player Mode</p>
            <p class="mb-0"><i class="fas fa-clock me-2"></i>Moves: ${Math.floor(game.history().length / 2)}</p>
        `;
    } else {
        // AI mode info
        const currentTurn = game.turn() === 'w' ? 'White' : 'Black';
        let difficultyLevel = 'None';

        if (easy) difficultyLevel = 'Easy';
        if (medium) difficultyLevel = 'Medium';
        if (hard) difficultyLevel = 'Hard';
        if (grandmaster) difficultyLevel = 'Grandmaster';

        infoHTML = `
            <p class="mb-1"><i class="fas fa-chess-king me-2"></i>${currentTurn} to move</p>
            <p class="mb-1"><i class="fas fa-robot me-2"></i>AI Level: ${difficultyLevel}</p>
            <p class="mb-0"><i class="fas fa-clock me-2"></i>Moves: ${Math.floor(game.history().length / 2)}</p>
        `;
    }

    gameInfoDiv.innerHTML = infoHTML;
}

// Initialize the board and set up event handlers when the page loads
document.addEventListener('DOMContentLoaded', function () {
    // Initialize the board
    board = Chessboard('board', config);

    // Set up button event handlers
    setButtons();

    // Initialize dark mode
    initDarkMode();

    // Initialize two-player mode
    initTwoPlayerMode();

    // Set traditional mode as default
    $('#traditional').addClass('selected');
    document.getElementById('gameState').innerHTML = 'Traditional Chess';
    document.getElementById('level').innerHTML = twoPlayerMode ?
        getCurrentTurnText() : 'Select a difficulty level';

    // Update initial game info
    updateGameInfo();

    // We can't use game.on('move') as it's not supported in chess.js
    // Instead, we'll update the history and info after each move in the onDrop function
});
