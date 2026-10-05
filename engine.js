/**
 * engine.js - fast 0x88 chess board/move-generator for the "Hard" AI level.
 *
 * This file does NOT require or load chess.js. It is a self-contained board
 * representation, legal move generator, make/unmake with incremental
 * Zobrist hashing, and perft. Works in three environments with no bundler:
 *   - browser <script src="engine.js"></script>       -> window.Engine
 *   - Web Worker importScripts('engine.js')            -> self.Engine
 *   - Node    const Engine = require('./engine.js')    -> module.exports
 *
 * Data layout (see task brief for the authoritative spec):
 *   - 0x88 board: board.squares is an Int8Array(128); sq = rank*16 + file,
 *     rank 0 = rank 1, file 0 = a. Off-board test: sq & 0x88.
 *   - Pieces: 0 empty; white 1..6 = P N B R Q K; black 9..14 = same + 8.
 *     color = piece >> 3, type = piece & 7.
 *   - Move int: from | (to<<7) | (promoType<<14) | (flags<<17), promoType is
 *     0 or 2..5 (N B R Q), flags: 1 capture, 2 double pawn push, 4 en
 *     passant, 8 castle.
 */
(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------

  var EMPTY = 0, PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
  var WHITE = 0, BLACK = 1;

  var PIECE_CHARS = {
    1: 'P', 2: 'N', 3: 'B', 4: 'R', 5: 'Q', 6: 'K',
    9: 'p', 10: 'n', 11: 'b', 12: 'r', 13: 'q', 14: 'k'
  };
  var CHAR_TO_PIECE = {
    P: 1, N: 2, B: 3, R: 4, Q: 5, K: 6,
    p: 9, n: 10, b: 11, r: 12, q: 13, k: 14
  };
  var PROMO_CHAR = { 2: 'n', 3: 'b', 4: 'r', 5: 'q' };

  // 0x88 direction offsets.
  var KNIGHT_OFFSETS = [-33, -31, -18, -14, 14, 18, 31, 33];
  var BISHOP_OFFSETS = [-17, -15, 15, 17];
  var ROOK_OFFSETS = [-16, -1, 1, 16];
  var KING_OFFSETS = [-17, -16, -15, -1, 1, 15, 16, 17]; // also queen directions

  var CASTLE_WK = 1, CASTLE_WQ = 2, CASTLE_BK = 4, CASTLE_BQ = 8;

  var FLAG_CAPTURE = 1, FLAG_DOUBLE = 2, FLAG_EP = 4, FLAG_CASTLE = 8;

  var START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  var FILES = 'abcdefgh';

  // ---------------------------------------------------------------------
  // 0x88 helpers
  // ---------------------------------------------------------------------

  function sq(rank, file) { return rank * 16 + file; }
  function rankOf(s) { return s >> 4; }
  function fileOf(s) { return s & 7; }
  function offboard(s) { return (s & 0x88) !== 0; }

  function sqToAlg(s) { return FILES[fileOf(s)] + (rankOf(s) + 1); }
  function algToSq(a) {
    var file = a.charCodeAt(0) - 97;
    var rank = a.charCodeAt(1) - 49;
    return sq(rank, file);
  }

  // Precomputed castling-rights mask, keyed by the square touched (as a
  // "from" or "to" square of a move). ANDing current rights with the masks
  // for both the from and to squares clears the right(s) tied to a king or
  // rook home square the instant it moves away from or is captured on.
  var CASTLE_MASK = new Int8Array(128);
  CASTLE_MASK.fill(15);
  CASTLE_MASK[sq(0, 4)] = 15 & ~(CASTLE_WK | CASTLE_WQ); // e1
  CASTLE_MASK[sq(0, 0)] = 15 & ~CASTLE_WQ; // a1
  CASTLE_MASK[sq(0, 7)] = 15 & ~CASTLE_WK; // h1
  CASTLE_MASK[sq(7, 4)] = 15 & ~(CASTLE_BK | CASTLE_BQ); // e8
  CASTLE_MASK[sq(7, 0)] = 15 & ~CASTLE_BQ; // a8
  CASTLE_MASK[sq(7, 7)] = 15 & ~CASTLE_BK; // h8

  // ---------------------------------------------------------------------
  // Move encode/decode
  // ---------------------------------------------------------------------

  function encodeMove(from, to, promo, flags) {
    return from | (to << 7) | (promo << 14) | (flags << 17);
  }
  function moveFromSq(m) { return m & 0x7f; }
  function moveToSq(m) { return (m >> 7) & 0x7f; }
  function movePromoType(m) { return (m >> 14) & 0x7; }
  function moveFlagsOf(m) { return (m >> 17) & 0xf; }

  function moveToUci(m) {
    var s = sqToAlg(moveFromSq(m)) + sqToAlg(moveToSq(m));
    var pt = movePromoType(m);
    if (pt) s += PROMO_CHAR[pt];
    return s;
  }
  function moveFrom(m) { return sqToAlg(moveFromSq(m)); }
  function moveTo(m) { return sqToAlg(moveToSq(m)); }
  function movePromo(m) {
    var pt = movePromoType(m);
    return pt ? PROMO_CHAR[pt] : null;
  }

  // ---------------------------------------------------------------------
  // Zobrist hashing - mulberry32 seeded PRNG, fixed seed.
  // ---------------------------------------------------------------------

  function makeRng(seed) {
    var s = seed >>> 0;
    return function next() {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return (t ^ (t >>> 14)) >>> 0;
    };
  }

  var rng = makeRng(0x9E3779B9);

  var Z_PIECE_LO = new Int32Array(16 * 128);
  var Z_PIECE_HI = new Int32Array(16 * 128);
  var zi;
  for (zi = 0; zi < 16 * 128; zi++) {
    Z_PIECE_LO[zi] = rng() | 0;
    Z_PIECE_HI[zi] = rng() | 0;
  }

  var Z_SIDE_LO = rng() | 0;
  var Z_SIDE_HI = rng() | 0;

  var Z_CASTLE_LO = new Int32Array(16);
  var Z_CASTLE_HI = new Int32Array(16);
  for (zi = 0; zi < 16; zi++) {
    Z_CASTLE_LO[zi] = rng() | 0;
    Z_CASTLE_HI[zi] = rng() | 0;
  }

  var Z_EP_LO = new Int32Array(8);
  var Z_EP_HI = new Int32Array(8);
  for (zi = 0; zi < 8; zi++) {
    Z_EP_LO[zi] = rng() | 0;
    Z_EP_HI[zi] = rng() | 0;
  }

  // ---------------------------------------------------------------------
  // Board
  // ---------------------------------------------------------------------

  function Board(fen) {
    this.squares = new Int8Array(128);
    this.side = WHITE;
    this.castlingRights = 0;
    this.epSquare = -1;
    this.halfmove = 0;
    this.fullmove = 1;
    this.kings = new Int32Array(2);
    this.hashLo = 0;
    this.hashHi = 0;
    this.hashStack = [];   // [lo, hi] pushed on every makeMove, popped on unmakeMove
    this.undoStack = [];
    this.historyHashes = []; // set via setHistory(): [[lo, hi], ...], oldest first
    this.loadFen(fen || START_FEN);
  }

  Board.prototype.loadFen = function (fen) {
    var parts = fen.trim().split(/\s+/);
    var placement = parts[0];
    var sideChar = parts[1] || 'w';
    var castle = parts[2] || '-';
    var ep = parts[3] || '-';
    var halfmove = parts[4] !== undefined ? parseInt(parts[4], 10) : 0;
    var fullmove = parts[5] !== undefined ? parseInt(parts[5], 10) : 1;

    this.squares.fill(0);
    this.kings[0] = -1;
    this.kings[1] = -1;

    var ranks = placement.split('/');
    for (var r = 0; r < 8; r++) {
      var rankStr = ranks[r];
      var ourRank = 7 - r; // FEN rank 8 first, our rank 0 = rank 1
      var file = 0;
      for (var i = 0; i < rankStr.length; i++) {
        var c = rankStr[i];
        if (c >= '1' && c <= '8') {
          file += parseInt(c, 10);
        } else {
          var piece = CHAR_TO_PIECE[c];
          var s = sq(ourRank, file);
          this.squares[s] = piece;
          if ((piece & 7) === KING) this.kings[piece >> 3] = s;
          file++;
        }
      }
    }

    this.side = sideChar === 'w' ? WHITE : BLACK;

    this.castlingRights = 0;
    if (castle.indexOf('K') !== -1) this.castlingRights |= CASTLE_WK;
    if (castle.indexOf('Q') !== -1) this.castlingRights |= CASTLE_WQ;
    if (castle.indexOf('k') !== -1) this.castlingRights |= CASTLE_BK;
    if (castle.indexOf('q') !== -1) this.castlingRights |= CASTLE_BQ;

    this.epSquare = ep === '-' ? -1 : algToSq(ep);
    this.halfmove = isNaN(halfmove) ? 0 : halfmove;
    this.fullmove = isNaN(fullmove) ? 1 : fullmove;

    this.undoStack.length = 0;
    this.hashStack.length = 0;

    this.computeHash();
  };

  Board.prototype.computeHash = function () {
    var lo = 0, hi = 0;
    for (var s = 0; s < 128; s++) {
      if (s & 0x88) continue;
      var p = this.squares[s];
      if (p) {
        lo ^= Z_PIECE_LO[p * 128 + s];
        hi ^= Z_PIECE_HI[p * 128 + s];
      }
    }
    if (this.side === BLACK) {
      lo ^= Z_SIDE_LO;
      hi ^= Z_SIDE_HI;
    }
    lo ^= Z_CASTLE_LO[this.castlingRights];
    hi ^= Z_CASTLE_HI[this.castlingRights];
    if (this.epSquare !== -1) {
      var f = fileOf(this.epSquare);
      lo ^= Z_EP_LO[f];
      hi ^= Z_EP_HI[f];
    }
    this.hashLo = lo | 0;
    this.hashHi = hi | 0;
  };

  Board.prototype.toFen = function () {
    var rows = [];
    for (var r = 7; r >= 0; r--) {
      var rowStr = '';
      var emptyCount = 0;
      for (var f = 0; f < 8; f++) {
        var p = this.squares[sq(r, f)];
        if (p === EMPTY) {
          emptyCount++;
        } else {
          if (emptyCount > 0) { rowStr += emptyCount; emptyCount = 0; }
          rowStr += PIECE_CHARS[p];
        }
      }
      if (emptyCount > 0) rowStr += emptyCount;
      rows.push(rowStr);
    }
    var placement = rows.join('/');
    var sideStr = this.side === WHITE ? 'w' : 'b';
    var castleStr = '';
    if (this.castlingRights & CASTLE_WK) castleStr += 'K';
    if (this.castlingRights & CASTLE_WQ) castleStr += 'Q';
    if (this.castlingRights & CASTLE_BK) castleStr += 'k';
    if (this.castlingRights & CASTLE_BQ) castleStr += 'q';
    if (castleStr === '') castleStr = '-';
    var epStr = this.epSquare === -1 ? '-' : sqToAlg(this.epSquare);
    return placement + ' ' + sideStr + ' ' + castleStr + ' ' + epStr + ' ' +
      this.halfmove + ' ' + this.fullmove;
  };

  // -- attacks -----------------------------------------------------------

  // Scans outward from `s` for an attacker of color `byColor`. No
  // allocations: all state is local primitives / fixed-size offset arrays.
  Board.prototype.isSquareAttacked = function (s, byColor) {
    var squares = this.squares;
    var t, i, d, p;

    if (byColor === WHITE) {
      t = s - 17; if (!offboard(t) && squares[t] === PAWN) return true;
      t = s - 15; if (!offboard(t) && squares[t] === PAWN) return true;
    } else {
      t = s + 17; if (!offboard(t) && squares[t] === (PAWN | 8)) return true;
      t = s + 15; if (!offboard(t) && squares[t] === (PAWN | 8)) return true;
    }

    var knightCode = KNIGHT | (byColor << 3);
    for (i = 0; i < KNIGHT_OFFSETS.length; i++) {
      t = s + KNIGHT_OFFSETS[i];
      if (!offboard(t) && squares[t] === knightCode) return true;
    }

    var kingCode = KING | (byColor << 3);
    for (i = 0; i < KING_OFFSETS.length; i++) {
      t = s + KING_OFFSETS[i];
      if (!offboard(t) && squares[t] === kingCode) return true;
    }

    for (i = 0; i < BISHOP_OFFSETS.length; i++) {
      d = BISHOP_OFFSETS[i];
      t = s + d;
      while (!offboard(t)) {
        p = squares[t];
        if (p !== EMPTY) {
          if ((p >> 3) === byColor && ((p & 7) === BISHOP || (p & 7) === QUEEN)) return true;
          break;
        }
        t += d;
      }
    }

    for (i = 0; i < ROOK_OFFSETS.length; i++) {
      d = ROOK_OFFSETS[i];
      t = s + d;
      while (!offboard(t)) {
        p = squares[t];
        if (p !== EMPTY) {
          if ((p >> 3) === byColor && ((p & 7) === ROOK || (p & 7) === QUEEN)) return true;
          break;
        }
        t += d;
      }
    }

    return false;
  };

  Board.prototype.inCheck = function () {
    return this.isSquareAttacked(this.kings[this.side], this.side ^ 1);
  };

  // -- pseudo-legal move generation --------------------------------------

  Board.prototype._addPromotions = function (from, to, flags, moves) {
    moves.push(encodeMove(from, to, QUEEN, flags));
    moves.push(encodeMove(from, to, ROOK, flags));
    moves.push(encodeMove(from, to, BISHOP, flags));
    moves.push(encodeMove(from, to, KNIGHT, flags));
  };

  Board.prototype._genPawn = function (s, moves, onlyCaptures) {
    var us = this.side;
    var squares = this.squares;
    var forward = us === WHITE ? 16 : -16;
    var startRank = us === WHITE ? 1 : 6;
    var promoRank = us === WHITE ? 7 : 0;

    var one = s + forward;
    if (!offboard(one) && squares[one] === EMPTY) {
      if (rankOf(one) === promoRank) {
        this._addPromotions(s, one, 0, moves);
      } else if (!onlyCaptures) {
        moves.push(encodeMove(s, one, 0, 0));
        if (rankOf(s) === startRank) {
          var two = s + forward * 2;
          if (squares[two] === EMPTY) moves.push(encodeMove(s, two, 0, FLAG_DOUBLE));
        }
      }
    }

    var capOffsets = us === WHITE ? [15, 17] : [-15, -17];
    for (var i = 0; i < 2; i++) {
      var t = s + capOffsets[i];
      if (offboard(t)) continue;
      if (t === this.epSquare) {
        moves.push(encodeMove(s, t, 0, FLAG_CAPTURE | FLAG_EP));
      } else {
        var p = squares[t];
        if (p !== EMPTY && (p >> 3) !== us) {
          if (rankOf(t) === promoRank) this._addPromotions(s, t, FLAG_CAPTURE, moves);
          else moves.push(encodeMove(s, t, 0, FLAG_CAPTURE));
        }
      }
    }
  };

  Board.prototype._genOffset = function (s, offsets, sliding, moves, onlyCaptures) {
    var us = this.side;
    var squares = this.squares;
    for (var i = 0; i < offsets.length; i++) {
      var d = offsets[i];
      var t = s + d;
      while (!offboard(t)) {
        var p = squares[t];
        if (p === EMPTY) {
          if (!onlyCaptures) moves.push(encodeMove(s, t, 0, 0));
        } else {
          if ((p >> 3) !== us) moves.push(encodeMove(s, t, 0, FLAG_CAPTURE));
          break;
        }
        if (!sliding) break;
        t += d;
      }
    }
  };

  Board.prototype._genCastle = function (s, moves) {
    var us = this.side;
    var squares = this.squares;
    if (us === WHITE && s === sq(0, 4)) {
      if ((this.castlingRights & CASTLE_WK) &&
        squares[sq(0, 5)] === EMPTY && squares[sq(0, 6)] === EMPTY &&
        !this.isSquareAttacked(sq(0, 4), BLACK) &&
        !this.isSquareAttacked(sq(0, 5), BLACK) &&
        !this.isSquareAttacked(sq(0, 6), BLACK)) {
        moves.push(encodeMove(sq(0, 4), sq(0, 6), 0, FLAG_CASTLE));
      }
      if ((this.castlingRights & CASTLE_WQ) &&
        squares[sq(0, 3)] === EMPTY && squares[sq(0, 2)] === EMPTY && squares[sq(0, 1)] === EMPTY &&
        !this.isSquareAttacked(sq(0, 4), BLACK) &&
        !this.isSquareAttacked(sq(0, 3), BLACK) &&
        !this.isSquareAttacked(sq(0, 2), BLACK)) {
        moves.push(encodeMove(sq(0, 4), sq(0, 2), 0, FLAG_CASTLE));
      }
    } else if (us === BLACK && s === sq(7, 4)) {
      if ((this.castlingRights & CASTLE_BK) &&
        squares[sq(7, 5)] === EMPTY && squares[sq(7, 6)] === EMPTY &&
        !this.isSquareAttacked(sq(7, 4), WHITE) &&
        !this.isSquareAttacked(sq(7, 5), WHITE) &&
        !this.isSquareAttacked(sq(7, 6), WHITE)) {
        moves.push(encodeMove(sq(7, 4), sq(7, 6), 0, FLAG_CASTLE));
      }
      if ((this.castlingRights & CASTLE_BQ) &&
        squares[sq(7, 3)] === EMPTY && squares[sq(7, 2)] === EMPTY && squares[sq(7, 1)] === EMPTY &&
        !this.isSquareAttacked(sq(7, 4), WHITE) &&
        !this.isSquareAttacked(sq(7, 3), WHITE) &&
        !this.isSquareAttacked(sq(7, 2), WHITE)) {
        moves.push(encodeMove(sq(7, 4), sq(7, 2), 0, FLAG_CASTLE));
      }
    }
  };

  Board.prototype._generatePseudo = function (onlyCaptures) {
    var moves = [];
    var us = this.side;
    var squares = this.squares;
    for (var s = 0; s < 128; s++) {
      if (s & 0x88) continue;
      var piece = squares[s];
      if (piece === EMPTY) continue;
      if ((piece >> 3) !== us) continue;
      var type = piece & 7;
      switch (type) {
        case PAWN: this._genPawn(s, moves, onlyCaptures); break;
        case KNIGHT: this._genOffset(s, KNIGHT_OFFSETS, false, moves, onlyCaptures); break;
        case BISHOP: this._genOffset(s, BISHOP_OFFSETS, true, moves, onlyCaptures); break;
        case ROOK: this._genOffset(s, ROOK_OFFSETS, true, moves, onlyCaptures); break;
        case QUEEN: this._genOffset(s, KING_OFFSETS, true, moves, onlyCaptures); break;
        case KING:
          this._genOffset(s, KING_OFFSETS, false, moves, onlyCaptures);
          if (!onlyCaptures) this._genCastle(s, moves);
          break;
      }
    }
    return moves;
  };

  Board.prototype._generateLegal = function (onlyCaptures) {
    var pseudo = this._generatePseudo(onlyCaptures);
    var legal = [];
    var us = this.side;
    for (var i = 0; i < pseudo.length; i++) {
      var m = pseudo[i];
      this.makeMove(m);
      if (!this.isSquareAttacked(this.kings[us], this.side)) legal.push(m);
      this.unmakeMove();
    }
    return legal;
  };

  Board.prototype.generateMoves = function () { return this._generateLegal(false); };
  Board.prototype.generateCaptures = function () { return this._generateLegal(true); };

  // -- make / unmake -------------------------------------------------------

  Board.prototype.makeMove = function (move) {
    var from = moveFromSq(move), to = moveToSq(move);
    var promo = movePromoType(move), flags = moveFlagsOf(move);
    var us = this.side, them = us ^ 1;
    var squares = this.squares;
    var piece = squares[from];
    var captured = EMPTY;

    var lo = this.hashLo, hi = this.hashHi;

    // Remove the moving piece from its origin square.
    lo ^= Z_PIECE_LO[piece * 128 + from];
    hi ^= Z_PIECE_HI[piece * 128 + from];

    if (flags & FLAG_EP) {
      var epCapSq = us === WHITE ? to - 16 : to + 16;
      captured = squares[epCapSq];
      lo ^= Z_PIECE_LO[captured * 128 + epCapSq];
      hi ^= Z_PIECE_HI[captured * 128 + epCapSq];
      squares[epCapSq] = EMPTY;
    } else if (flags & FLAG_CAPTURE) {
      captured = squares[to];
      lo ^= Z_PIECE_LO[captured * 128 + to];
      hi ^= Z_PIECE_HI[captured * 128 + to];
    }

    if (this.epSquare !== -1) {
      var oldEpFile = fileOf(this.epSquare);
      lo ^= Z_EP_LO[oldEpFile];
      hi ^= Z_EP_HI[oldEpFile];
    }

    lo ^= Z_CASTLE_LO[this.castlingRights];
    hi ^= Z_CASTLE_HI[this.castlingRights];

    var movedPiece = promo ? (promo | (us << 3)) : piece;
    squares[to] = movedPiece;
    squares[from] = EMPTY;
    lo ^= Z_PIECE_LO[movedPiece * 128 + to];
    hi ^= Z_PIECE_HI[movedPiece * 128 + to];

    if ((piece & 7) === KING) this.kings[us] = to;

    if (flags & FLAG_CASTLE) {
      var rook = ROOK | (us << 3);
      var rookFrom, rookTo;
      if (to === from + 2) { rookFrom = from + 3; rookTo = from + 1; }
      else { rookFrom = from - 4; rookTo = from - 1; }
      lo ^= Z_PIECE_LO[rook * 128 + rookFrom];
      hi ^= Z_PIECE_HI[rook * 128 + rookFrom];
      squares[rookFrom] = EMPTY;
      squares[rookTo] = rook;
      lo ^= Z_PIECE_LO[rook * 128 + rookTo];
      hi ^= Z_PIECE_HI[rook * 128 + rookTo];
    }

    var newRights = this.castlingRights & CASTLE_MASK[from] & CASTLE_MASK[to];
    lo ^= Z_CASTLE_LO[newRights];
    hi ^= Z_CASTLE_HI[newRights];

    var newEpSquare = -1;
    if (flags & FLAG_DOUBLE) {
      newEpSquare = us === WHITE ? from + 16 : from - 16;
      var newEpFile = fileOf(newEpSquare);
      lo ^= Z_EP_LO[newEpFile];
      hi ^= Z_EP_HI[newEpFile];
    }

    lo ^= Z_SIDE_LO;
    hi ^= Z_SIDE_HI;

    var undo = {
      move: move,
      captured: captured,
      castlingRights: this.castlingRights,
      epSquare: this.epSquare,
      halfmove: this.halfmove,
      hashLo: this.hashLo,
      hashHi: this.hashHi
    };
    this.undoStack.push(undo);

    this.castlingRights = newRights;
    this.epSquare = newEpSquare;
    this.halfmove = ((piece & 7) === PAWN || captured) ? 0 : this.halfmove + 1;
    if (us === BLACK) this.fullmove++;
    this.side = them;
    this.hashLo = lo | 0;
    this.hashHi = hi | 0;

    this.hashStack.push([this.hashLo, this.hashHi]);
  };

  Board.prototype.unmakeMove = function () {
    this.hashStack.pop();
    var undo = this.undoStack.pop();
    var move = undo.move;
    var from = moveFromSq(move), to = moveToSq(move);
    var promo = movePromoType(move), flags = moveFlagsOf(move);
    var us = this.side ^ 1; // side that made this move
    var squares = this.squares;

    if (us === BLACK) this.fullmove--;

    var movedPieceAtTo = squares[to];
    var originalPiece = promo ? (PAWN | (us << 3)) : movedPieceAtTo;

    squares[from] = originalPiece;
    squares[to] = EMPTY;

    if ((originalPiece & 7) === KING) this.kings[us] = from;

    if (flags & FLAG_CASTLE) {
      var rook = ROOK | (us << 3);
      var rookFrom, rookTo;
      if (to === from + 2) { rookFrom = from + 3; rookTo = from + 1; }
      else { rookFrom = from - 4; rookTo = from - 1; }
      squares[rookFrom] = rook;
      squares[rookTo] = EMPTY;
    }

    if (flags & FLAG_EP) {
      var epCapSq = us === WHITE ? to - 16 : to + 16;
      squares[epCapSq] = undo.captured;
    } else if (flags & FLAG_CAPTURE) {
      squares[to] = undo.captured;
    }

    this.side = us;
    this.castlingRights = undo.castlingRights;
    this.epSquare = undo.epSquare;
    this.halfmove = undo.halfmove;
    this.hashLo = undo.hashLo;
    this.hashHi = undo.hashHi;
  };

  // -- repetition ----------------------------------------------------------

  Board.prototype.setHistory = function (fens) {
    var scratch = new Board();
    var hashes = [];
    for (var i = 0; i < fens.length; i++) {
      scratch.loadFen(fens[i]);
      hashes.push([scratch.hashLo, scratch.hashHi]);
    }
    this.historyHashes = hashes;
  };

  // Compares the current hash against earlier entries in
  // [...historyHashes, ...hashStack]. The hashStack walk is limited to the
  // last `halfmove` plies (any repetition must lie within the current
  // 50-move-clock window) and only visits same-side-to-move entries (every
  // 2 plies back); since the side to move is itself folded into the hash,
  // equal hashes already imply equal side to move. The historyHashes walk
  // (actual prior game positions) is unbounded, since the halfmove clock at
  // those earlier points in the game isn't necessarily known here.
  Board.prototype.isRepetition = function () {
    var lo = this.hashLo, hi = this.hashHi;

    var stack = this.hashStack;
    var limit = Math.min(this.halfmove, stack.length - 1);
    for (var back = 2; back <= limit; back += 2) {
      var e = stack[stack.length - 1 - back];
      if (e[0] === lo && e[1] === hi) return true;
    }

    var hist = this.historyHashes;
    for (var j = 0; j < hist.length; j++) {
      if (hist[j][0] === lo && hist[j][1] === hi) return true;
    }

    return false;
  };

  // ---------------------------------------------------------------------
  // perft
  // ---------------------------------------------------------------------

  function perftRec(board, depth) {
    if (depth === 0) return 1;
    var moves = board.generateMoves();
    if (depth === 1) return moves.length;
    var count = 0;
    for (var i = 0; i < moves.length; i++) {
      board.makeMove(moves[i]);
      count += perftRec(board, depth - 1);
      board.unmakeMove();
    }
    return count;
  }

  function perft(fen, depth) {
    var board = new Board(fen);
    return perftRec(board, depth);
  }

  // ---------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------

  var Engine = {
    Board: Board,
    perft: perft,
    moveToUci: moveToUci,
    moveFrom: moveFrom,
    moveTo: moveTo,
    movePromo: movePromo
  };

  if (typeof self !== 'undefined') {
    self.Engine = Engine;
  } else if (typeof window !== 'undefined') {
    window.Engine = Engine;
  } else if (typeof globalThis !== 'undefined') {
    globalThis.Engine = Engine;
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Engine;
  }
})();
