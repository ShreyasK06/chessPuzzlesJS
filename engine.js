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

    // The loaded/root position is itself a valid repetition target (the
    // most common case: a search line shuffling back to its own root), so
    // seed the hash stack with it. makeMove/unmakeMove push/pop in lock
    // step from here, so this entry always stays at hashStack[0].
    this.hashStack.push([this.hashLo, this.hashHi]);
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
    var ownRook = (us << 3) | ROOK;
    if (us === WHITE && s === sq(0, 4)) {
      if ((this.castlingRights & CASTLE_WK) &&
        squares[sq(0, 7)] === ownRook &&
        squares[sq(0, 5)] === EMPTY && squares[sq(0, 6)] === EMPTY &&
        !this.isSquareAttacked(sq(0, 4), BLACK) &&
        !this.isSquareAttacked(sq(0, 5), BLACK) &&
        !this.isSquareAttacked(sq(0, 6), BLACK)) {
        moves.push(encodeMove(sq(0, 4), sq(0, 6), 0, FLAG_CASTLE));
      }
      if ((this.castlingRights & CASTLE_WQ) &&
        squares[sq(0, 0)] === ownRook &&
        squares[sq(0, 3)] === EMPTY && squares[sq(0, 2)] === EMPTY && squares[sq(0, 1)] === EMPTY &&
        !this.isSquareAttacked(sq(0, 4), BLACK) &&
        !this.isSquareAttacked(sq(0, 3), BLACK) &&
        !this.isSquareAttacked(sq(0, 2), BLACK)) {
        moves.push(encodeMove(sq(0, 4), sq(0, 2), 0, FLAG_CASTLE));
      }
    } else if (us === BLACK && s === sq(7, 4)) {
      if ((this.castlingRights & CASTLE_BK) &&
        squares[sq(7, 7)] === ownRook &&
        squares[sq(7, 5)] === EMPTY && squares[sq(7, 6)] === EMPTY &&
        !this.isSquareAttacked(sq(7, 4), WHITE) &&
        !this.isSquareAttacked(sq(7, 5), WHITE) &&
        !this.isSquareAttacked(sq(7, 6), WHITE)) {
        moves.push(encodeMove(sq(7, 4), sq(7, 6), 0, FLAG_CASTLE));
      }
      if ((this.castlingRights & CASTLE_BQ) &&
        squares[sq(7, 0)] === ownRook &&
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

  // -- null move -------------------------------------------------------------
  // Used only by null-move pruning in search: flips the side to move and
  // clears the en-passant square without moving a piece. Pushes/pops a
  // hashStack entry in lock step with makeMove/unmakeMove so isRepetition
  // stays correct if probed from inside a null-move subtree.

  Board.prototype.makeNullMove = function () {
    var lo = this.hashLo, hi = this.hashHi;
    if (this.epSquare !== -1) {
      var f = fileOf(this.epSquare);
      lo ^= Z_EP_LO[f];
      hi ^= Z_EP_HI[f];
    }
    lo ^= Z_SIDE_LO;
    hi ^= Z_SIDE_HI;

    this.nullUndoStack = this.nullUndoStack || [];
    this.nullUndoStack.push({ epSquare: this.epSquare, hashLo: this.hashLo, hashHi: this.hashHi });

    this.epSquare = -1;
    this.side ^= 1;
    this.hashLo = lo | 0;
    this.hashHi = hi | 0;
    this.hashStack.push([this.hashLo, this.hashHi]);
  };

  Board.prototype.unmakeNullMove = function () {
    this.hashStack.pop();
    var undo = this.nullUndoStack.pop();
    this.side ^= 1;
    this.epSquare = undo.epSquare;
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
  // [...historyHashes, ...hashStack]. hashStack[0] is always the
  // loaded/root position (seeded in loadFen), so a search line that
  // shuffles back to its own root is caught by this same walk - the most
  // common repetition a search will meet. The hashStack walk is limited to
  // the last `halfmove` plies (any repetition must lie within the current
  // 50-move-clock window) and only visits same-side-to-move entries (every
  // 2 plies back); since the side to move is itself folded into the hash,
  // equal hashes already imply equal side to move. The historyHashes walk
  // (actual prior game positions, set via setHistory) is unbounded, since
  // the halfmove clock at those earlier points in the game isn't
  // necessarily known here. historyHashes and hashStack are independent
  // arrays compared with a plain OR, so a coincidental duplicate between
  // setHistory's last FEN and the root position is harmless - isRepetition
  // only needs one match, never a count.
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
  // Evaluation - tapered PeSTO (Rofchade) piece-square tables plus pawn
  // structure, bishop pair, rook file, mobility and king-safety terms.
  //
  // evaluateBoard() is called at every quiescence node by the search, so it
  // must not allocate: every scratch array it touches (pawn-file bitmasks)
  // is preallocated at module scope and merely cleared/reused each call.
  // Mobility is counted by scanning rays/offsets directly on board.squares
  // rather than via generateMoves(), to skip the pseudo-legal move array
  // allocation and the make/unmake-based legality filter.
  // ---------------------------------------------------------------------

  // -- material (centipawns) ----------------------------------------------

  var MAT_MG = [0, 82, 337, 365, 477, 1025, 0];
  var MAT_EG = [0, 94, 281, 297, 512, 936, 0];

  // Phase weight per piece type: N/B = 1, R = 2, Q = 4; summed over both
  // sides and capped at 24 (the starting-position total).
  var PHASE_WEIGHT = [0, 0, 1, 1, 2, 4, 0];

  // -- PeSTO/Rofchade piece-square tables ----------------------------------
  // Each table is written a8..h8 first (index 0 = a8), from white's point
  // of view, exactly as published on chessprogramming.org under "PeSTO's
  // Evaluation Function". For a white piece on 0x88 square sq (rank r =
  // sq>>4, file f = sq&7) the table index is (7-r)*8+f; for a black piece
  // it is the vertically mirrored r*8+f (same table, no separate black
  // table - see the index computation in evaluateBoard).

  var PAWN_MG_TABLE = [
    0, 0, 0, 0, 0, 0, 0, 0,
    98, 134, 61, 95, 68, 126, 34, -11,
    -6, 7, 26, 31, 65, 56, 25, -20,
    -14, 13, 6, 21, 23, 12, 17, -23,
    -27, -2, -5, 12, 17, 6, 10, -25,
    -26, -4, -4, -10, 3, 3, 33, -12,
    -35, -1, -20, -23, -15, 24, 38, -22,
    0, 0, 0, 0, 0, 0, 0, 0
  ];
  var PAWN_EG_TABLE = [
    0, 0, 0, 0, 0, 0, 0, 0,
    178, 173, 158, 134, 147, 132, 165, 187,
    94, 100, 85, 67, 56, 53, 82, 84,
    32, 24, 13, 5, -2, 4, 17, 17,
    13, 9, -3, -7, -7, -8, 3, -1,
    4, 7, -6, 1, 0, -5, -1, -8,
    13, 8, 8, 10, 13, 0, 2, -7,
    0, 0, 0, 0, 0, 0, 0, 0
  ];

  var KNIGHT_MG_TABLE = [
    -167, -89, -34, -49, 61, -97, -15, -107,
    -73, -41, 72, 36, 23, 62, 7, -17,
    -47, 60, 37, 65, 84, 129, 73, 44,
    -9, 17, 19, 53, 37, 69, 18, 22,
    -13, 4, 16, 13, 28, 19, 21, -8,
    -23, -9, 12, 10, 19, 17, 25, -16,
    -29, -53, -12, -3, -1, 18, -14, -19,
    -105, -21, -58, -33, -17, -28, -19, -23
  ];
  var KNIGHT_EG_TABLE = [
    -58, -38, -13, -28, -31, -27, -63, -99,
    -25, -8, -25, -2, -9, -25, -24, -52,
    -24, -20, 10, 9, -1, -9, -19, -41,
    -17, 3, 22, 22, 22, 11, 8, -18,
    -18, -6, 16, 25, 16, 17, 4, -18,
    -23, -3, -1, 15, 10, -3, -20, -22,
    -42, -20, -10, -5, -2, -20, -23, -44,
    -29, -51, -23, -15, -22, -18, -50, -64
  ];

  var BISHOP_MG_TABLE = [
    -29, 4, -82, -37, -25, -42, 7, -8,
    -26, 16, -18, -13, 30, 59, 18, -47,
    -16, 37, 43, 40, 35, 50, 37, -2,
    -4, 5, 19, 50, 37, 37, 7, -2,
    -6, 13, 13, 26, 34, 12, 10, 4,
    0, 15, 15, 15, 14, 27, 18, 10,
    4, 15, 16, 0, 7, 21, 33, 1,
    -33, -3, -14, -21, -13, -12, -39, -21
  ];
  var BISHOP_EG_TABLE = [
    -14, -21, -11, -8, -7, -9, -17, -24,
    -8, -4, 7, -12, -3, -13, -4, -14,
    2, -8, 0, -1, -2, 6, 0, 4,
    -3, 9, 12, 9, 14, 10, 3, 2,
    -6, 3, 13, 19, 7, 10, -3, -9,
    -12, -3, 8, 10, 13, 3, -7, -15,
    -14, -18, -7, -1, 4, -9, -15, -27,
    -23, -9, -23, -5, -9, -16, -5, -17
  ];

  var ROOK_MG_TABLE = [
    32, 42, 32, 51, 63, 9, 31, 43,
    27, 32, 58, 62, 80, 67, 26, 44,
    -5, 19, 26, 36, 17, 45, 61, 16,
    -24, -11, 7, 26, 24, 35, -8, -20,
    -36, -26, -12, -1, 9, -7, 6, -23,
    -45, -25, -16, -17, 3, 0, -5, -33,
    -44, -16, -20, -9, -1, 11, -6, -71,
    -19, -13, 1, 17, 16, 7, -37, -26
  ];
  var ROOK_EG_TABLE = [
    13, 10, 18, 15, 12, 12, 8, 5,
    11, 13, 13, 11, -3, 3, 8, 3,
    7, 7, 7, 5, 4, -3, -5, -3,
    4, 3, 13, 1, 2, 1, -1, 2,
    3, 5, 8, 4, -5, -6, -8, -11,
    -4, 0, -5, -1, -7, -12, -8, -16,
    -6, -6, 0, 2, -9, -9, -11, -3,
    -9, 2, 3, -1, -5, -13, 4, -20
  ];

  var QUEEN_MG_TABLE = [
    -28, 0, 29, 12, 59, 44, 43, 45,
    -24, -39, -5, 1, -16, 57, 28, 54,
    -13, -17, 7, 8, 29, 56, 47, 57,
    -27, -27, -16, -16, -1, 17, -2, 1,
    -9, -26, -9, -10, -2, -4, 3, -3,
    -14, 2, -11, -2, -5, 2, 14, 5,
    -35, -8, 11, 2, 8, 15, -3, 1,
    -1, -18, -9, 10, -15, -25, -31, -50
  ];
  var QUEEN_EG_TABLE = [
    -9, 22, 22, 27, 27, 19, 10, 20,
    -17, 20, 32, 41, 58, 25, 30, 0,
    -20, 6, 9, 49, 47, 35, 19, 9,
    3, 22, 24, 45, 57, 40, 57, 36,
    -18, 28, 19, 47, 31, 34, 39, 23,
    -16, -27, 15, 6, 9, 17, 10, 5,
    -22, -23, -30, -16, -16, -23, -36, -32,
    -33, -28, -22, -43, -5, -32, -20, -41
  ];

  var KING_MG_TABLE = [
    -65, 23, 16, -15, -56, -34, 2, 13,
    29, -1, -20, -7, -8, -4, -38, -29,
    -9, 24, 2, -16, -20, 6, 22, -22,
    -17, -20, -12, -27, -30, -25, -14, -36,
    -49, -1, -27, -39, -46, -44, -33, -51,
    -14, -14, -22, -46, -44, -30, -15, -27,
    1, 7, -8, -64, -43, -16, 9, 8,
    -15, 36, 12, -54, 8, -28, 24, 14
  ];
  var KING_EG_TABLE = [
    -74, -35, -18, -18, -11, 15, 4, -17,
    -12, 17, 14, 17, 17, 38, 23, 11,
    10, 17, 23, 15, 20, 45, 44, 13,
    -8, 22, 24, 27, 26, 33, 26, 3,
    -18, -4, 21, 24, 27, 23, 9, -11,
    -19, -3, 11, 21, 23, 16, 7, -9,
    -27, -11, 4, 13, 14, 4, -5, -17,
    -53, -34, -21, -11, -28, -14, -24, -43
  ];

  var PST_MG = [null, PAWN_MG_TABLE, KNIGHT_MG_TABLE, BISHOP_MG_TABLE, ROOK_MG_TABLE, QUEEN_MG_TABLE, KING_MG_TABLE];
  var PST_EG = [null, PAWN_EG_TABLE, KNIGHT_EG_TABLE, BISHOP_EG_TABLE, ROOK_EG_TABLE, QUEEN_EG_TABLE, KING_EG_TABLE];

  // -- pawn structure -------------------------------------------------------

  var PASSED_MG = [0, 5, 10, 20, 35, 60, 100, 0];
  var PASSED_EG = [0, 10, 20, 40, 70, 120, 200, 0];
  var DOUBLED_MG = -10, DOUBLED_EG = -20;
  var ISOLATED_MG = -10, ISOLATED_EG = -15;

  var BISHOP_PAIR_MG = 30, BISHOP_PAIR_EG = 50;
  var ROOK_OPEN_FILE = 25, ROOK_SEMI_OPEN_FILE = 10;

  // Mobility weights/baselines, indexed by piece type (N/B/R/Q only).
  var MOB_MG = [0, 0, 4, 5, 2, 1, 0];
  var MOB_EG = [0, 0, 4, 5, 4, 2, 0];
  var MOB_BASE = [0, 0, 4, 6, 7, 13, 0];

  var KING_SHIELD_PENALTY = -15;
  var KING_ATTACK_PENALTY = -8;

  // Popcount of an 8-bit mask, precomputed once.
  var POPCOUNT8 = new Uint8Array(256);
  for (var pc = 0; pc < 256; pc++) {
    var bits = pc, cnt = 0;
    while (bits) { cnt += bits & 1; bits >>= 1; }
    POPCOUNT8[pc] = cnt;
  }

  // Preallocated scratch: per-file bitmask (bit r set => pawn of that color
  // on rank r) for each color. Cleared and reused on every evaluateBoard()
  // call - never reallocated, so the hot (quiescence) path makes no
  // allocations.
  var PAWN_FILE_W = new Int32Array(8);
  var PAWN_FILE_B = new Int32Array(8);

  function countKnightMobility(squares, s, us) {
    var cnt = 0;
    for (var i = 0; i < KNIGHT_OFFSETS.length; i++) {
      var t = s + KNIGHT_OFFSETS[i];
      if (offboard(t)) continue;
      var p = squares[t];
      if (p === EMPTY || (p >> 3) !== us) cnt++;
    }
    return cnt;
  }

  function countSlidingMobility(squares, s, offsets, us) {
    var cnt = 0;
    for (var i = 0; i < offsets.length; i++) {
      var d = offsets[i];
      var t = s + d;
      while (!offboard(t)) {
        var p = squares[t];
        if (p === EMPTY) { cnt++; t += d; continue; }
        if ((p >> 3) !== us) cnt++;
        break;
      }
    }
    return cnt;
  }

  // Counts N/B/R/Q attackers of color byColor landing on square s. Used
  // only for the 8 squares around a king, so the ray scans stay cheap.
  function countAttackersOnSquare(squares, s, byColor) {
    var cnt = 0, i, t, d, p;

    var knightCode = KNIGHT | (byColor << 3);
    for (i = 0; i < KNIGHT_OFFSETS.length; i++) {
      t = s + KNIGHT_OFFSETS[i];
      if (!offboard(t) && squares[t] === knightCode) cnt++;
    }

    for (i = 0; i < BISHOP_OFFSETS.length; i++) {
      d = BISHOP_OFFSETS[i];
      t = s + d;
      while (!offboard(t)) {
        p = squares[t];
        if (p !== EMPTY) {
          if ((p >> 3) === byColor && ((p & 7) === BISHOP || (p & 7) === QUEEN)) cnt++;
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
          if ((p >> 3) === byColor && ((p & 7) === ROOK || (p & 7) === QUEEN)) cnt++;
          break;
        }
        t += d;
      }
    }

    return cnt;
  }

  function countMinorMajorAttacks(squares, kingSq, byColor) {
    var cnt = 0;
    for (var i = 0; i < KING_OFFSETS.length; i++) {
      var ring = kingSq + KING_OFFSETS[i];
      if (offboard(ring)) continue;
      cnt += countAttackersOnSquare(squares, ring, byColor);
    }
    return cnt;
  }

  // -15 per missing pawn from the 3-square shield in front of a castled
  // king (only applies when the king is on files a-c or f-h).
  function kingShieldPenalty(squares, kingSq, color) {
    var kr = kingSq >> 4, kf = kingSq & 7;
    if (kf > 2 && kf < 5) return 0;
    var shieldRank = color === WHITE ? kr + 1 : kr - 1;
    if (shieldRank < 0 || shieldRank > 7) return 0;
    var ownPawn = PAWN | (color << 3);
    var penalty = 0;
    for (var df = -1; df <= 1; df++) {
      var ff = kf + df;
      if (ff < 0 || ff > 7) continue;
      if (squares[sq(shieldRank, ff)] !== ownPawn) penalty += KING_SHIELD_PENALTY;
    }
    return penalty;
  }

  // Evaluates the position from the side-to-move's perspective (integer
  // centipawns; positive favors the side to move). No allocations: all
  // scratch state is either a module-level typed array (cleared in place)
  // or a local primitive.
  function evaluateBoard(board) {
    var squares = board.squares;
    var mgWhite = 0, mgBlack = 0, egWhite = 0, egBlack = 0, phase = 0;
    var bishopCountW = 0, bishopCountB = 0;
    var s, piece, type, color, r, f, idx;

    PAWN_FILE_W.fill(0);
    PAWN_FILE_B.fill(0);

    // Pass 1: material + PST + phase + pawn-file bitmasks + bishop counts.
    for (s = 0; s < 128; s++) {
      if (s & 0x88) continue;
      piece = squares[s];
      if (piece === EMPTY) continue;
      type = piece & 7;
      color = piece >> 3;
      r = s >> 4; f = s & 7;
      idx = color === WHITE ? (7 - r) * 8 + f : r * 8 + f;

      if (color === WHITE) {
        mgWhite += MAT_MG[type] + PST_MG[type][idx];
        egWhite += MAT_EG[type] + PST_EG[type][idx];
      } else {
        mgBlack += MAT_MG[type] + PST_MG[type][idx];
        egBlack += MAT_EG[type] + PST_EG[type][idx];
      }
      phase += PHASE_WEIGHT[type];

      if (type === PAWN) {
        if (color === WHITE) PAWN_FILE_W[f] |= (1 << r);
        else PAWN_FILE_B[f] |= (1 << r);
      } else if (type === BISHOP) {
        if (color === WHITE) bishopCountW++; else bishopCountB++;
      }
    }

    if (phase > 24) phase = 24;

    if (bishopCountW >= 2) { mgWhite += BISHOP_PAIR_MG; egWhite += BISHOP_PAIR_EG; }
    if (bishopCountB >= 2) { mgBlack += BISHOP_PAIR_MG; egBlack += BISHOP_PAIR_EG; }

    // Doubled pawns: once per file, scaled by the count of extra pawns.
    for (f = 0; f < 8; f++) {
      var cw = POPCOUNT8[PAWN_FILE_W[f] & 0xff];
      if (cw > 1) { mgWhite += DOUBLED_MG * (cw - 1); egWhite += DOUBLED_EG * (cw - 1); }
      var cb = POPCOUNT8[PAWN_FILE_B[f] & 0xff];
      if (cb > 1) { mgBlack += DOUBLED_MG * (cb - 1); egBlack += DOUBLED_EG * (cb - 1); }
    }

    // Pass 2: pawn isolated/passed bonuses, N/B/R/Q mobility + rook files,
    // king safety. Requires the pawn-file bitmasks from pass 1.
    for (s = 0; s < 128; s++) {
      if (s & 0x88) continue;
      piece = squares[s];
      if (piece === EMPTY) continue;
      type = piece & 7;
      color = piece >> 3;
      r = s >> 4; f = s & 7;

      if (type === PAWN) {
        var own = color === WHITE ? PAWN_FILE_W : PAWN_FILE_B;
        var opp = color === WHITE ? PAWN_FILE_B : PAWN_FILE_W;
        var leftMask = f > 0 ? own[f - 1] : 0;
        var rightMask = f < 7 ? own[f + 1] : 0;
        var isolated = (leftMask === 0 && rightMask === 0);

        var blocked;
        if (color === WHITE) {
          var aheadMaskW = r < 7 ? (0xff << (r + 1)) & 0xff : 0;
          blocked = (opp[f] & aheadMaskW) !== 0 ||
            (f > 0 && (opp[f - 1] & aheadMaskW) !== 0) ||
            (f < 7 && (opp[f + 1] & aheadMaskW) !== 0);
        } else {
          var aheadMaskB = r > 0 ? (1 << r) - 1 : 0;
          blocked = (opp[f] & aheadMaskB) !== 0 ||
            (f > 0 && (opp[f - 1] & aheadMaskB) !== 0) ||
            (f < 7 && (opp[f + 1] & aheadMaskB) !== 0);
        }
        var passed = !blocked;
        var relRank = color === WHITE ? r : 7 - r;

        var mgAdd = 0, egAdd = 0;
        if (isolated) { mgAdd += ISOLATED_MG; egAdd += ISOLATED_EG; }
        if (passed) { mgAdd += PASSED_MG[relRank]; egAdd += PASSED_EG[relRank]; }
        if (color === WHITE) { mgWhite += mgAdd; egWhite += egAdd; }
        else { mgBlack += mgAdd; egBlack += egAdd; }

      } else if (type === KNIGHT) {
        var mobN = countKnightMobility(squares, s, color) - MOB_BASE[KNIGHT];
        if (color === WHITE) { mgWhite += mobN * MOB_MG[KNIGHT]; egWhite += mobN * MOB_EG[KNIGHT]; }
        else { mgBlack += mobN * MOB_MG[KNIGHT]; egBlack += mobN * MOB_EG[KNIGHT]; }

      } else if (type === BISHOP) {
        var mobB = countSlidingMobility(squares, s, BISHOP_OFFSETS, color) - MOB_BASE[BISHOP];
        if (color === WHITE) { mgWhite += mobB * MOB_MG[BISHOP]; egWhite += mobB * MOB_EG[BISHOP]; }
        else { mgBlack += mobB * MOB_MG[BISHOP]; egBlack += mobB * MOB_EG[BISHOP]; }

      } else if (type === ROOK) {
        var mobR = countSlidingMobility(squares, s, ROOK_OFFSETS, color) - MOB_BASE[ROOK];
        var ownFile = color === WHITE ? PAWN_FILE_W[f] : PAWN_FILE_B[f];
        var oppFile = color === WHITE ? PAWN_FILE_B[f] : PAWN_FILE_W[f];
        var fileBonus = 0;
        if (ownFile === 0) fileBonus = oppFile === 0 ? ROOK_OPEN_FILE : ROOK_SEMI_OPEN_FILE;
        if (color === WHITE) {
          mgWhite += mobR * MOB_MG[ROOK] + fileBonus;
          egWhite += mobR * MOB_EG[ROOK] + fileBonus;
        } else {
          mgBlack += mobR * MOB_MG[ROOK] + fileBonus;
          egBlack += mobR * MOB_EG[ROOK] + fileBonus;
        }

      } else if (type === QUEEN) {
        var mobQ = countSlidingMobility(squares, s, KING_OFFSETS, color) - MOB_BASE[QUEEN];
        if (color === WHITE) { mgWhite += mobQ * MOB_MG[QUEEN]; egWhite += mobQ * MOB_EG[QUEEN]; }
        else { mgBlack += mobQ * MOB_MG[QUEEN]; egBlack += mobQ * MOB_EG[QUEEN]; }

      } else if (type === KING) {
        var penalty = kingShieldPenalty(squares, s, color) +
          KING_ATTACK_PENALTY * countMinorMajorAttacks(squares, s, color ^ 1);
        if (color === WHITE) mgWhite += penalty;
        else mgBlack += penalty;
      }
    }

    var totalMg = mgWhite - mgBlack;
    var totalEg = egWhite - egBlack;
    var score = ((totalMg * phase + totalEg * (24 - phase)) / 24) | 0;
    // Normalize -0 to 0 (score === 0 ? 0 : -score) so a drawn-material
    // position evaluates identically for either side to move under
    // assert.strict.equal's Object.is-based comparison (0 !== -0 there).
    return board.side === WHITE ? score : (score === 0 ? 0 : -score);
  }

  function evaluate(fen) {
    return evaluateBoard(new Board(fen));
  }

  // ---------------------------------------------------------------------
  // Search - negamax PVS with fail-soft alpha-beta, a transposition table,
  // quiescence search, null-move pruning, late-move reductions, killer and
  // history move ordering, iterative deepening with a wall-clock time
  // budget, and a small opening book.
  // ---------------------------------------------------------------------

  var MATE_SCORE = 30000;
  var SEARCH_INF = 32000;
  var MAX_PLY = 256;
  var MATE_THRESHOLD = MATE_SCORE - MAX_PLY;

  // -- transposition table -------------------------------------------------
  // 2^20 entries in parallel typed arrays (no per-entry objects). depth -1
  // in ttDepthArr marks a slot as never-written.

  var TT_SIZE = 1 << 20;
  var TT_MASK = TT_SIZE - 1;
  var ttKeyLo = new Int32Array(TT_SIZE);
  var ttKeyHi = new Int32Array(TT_SIZE);
  var ttMoveArr = new Int32Array(TT_SIZE);
  var ttScoreArr = new Int32Array(TT_SIZE);
  var ttDepthArr = new Int8Array(TT_SIZE);
  ttDepthArr.fill(-1);
  var ttFlagArr = new Int8Array(TT_SIZE);

  var TT_EXACT = 0, TT_LOWER = 1, TT_UPPER = 2;

  // Adjusts a mate score to/from a ply-independent form before storing in
  // (or after reading from) the TT, since the same TT entry can be probed
  // from different plies-from-root on different calls.
  function scoreToTT(score, ply) {
    if (score > MATE_THRESHOLD) return score + ply;
    if (score < -MATE_THRESHOLD) return score - ply;
    return score;
  }
  function scoreFromTT(score, ply) {
    if (score > MATE_THRESHOLD) return score - ply;
    if (score < -MATE_THRESHOLD) return score + ply;
    return score;
  }

  function ttProbe(lo, hi) {
    var idx = (lo >>> 0) & TT_MASK;
    if (ttDepthArr[idx] !== -1 && ttKeyLo[idx] === lo && ttKeyHi[idx] === hi) return idx;
    return -1;
  }

  function ttStore(lo, hi, depth, score, flag, move, ply) {
    var idx = (lo >>> 0) & TT_MASK;
    if (ttDepthArr[idx] === -1 ||
      (ttKeyLo[idx] === lo && ttKeyHi[idx] === hi) ||
      depth >= ttDepthArr[idx]) {
      ttKeyLo[idx] = lo;
      ttKeyHi[idx] = hi;
      ttMoveArr[idx] = move;
      ttScoreArr[idx] = scoreToTT(score, ply);
      ttDepthArr[idx] = depth;
      ttFlagArr[idx] = flag;
    }
  }

  // -- move ordering state ---------------------------------------------------

  var killer1 = new Int32Array(MAX_PLY);
  var killer2 = new Int32Array(MAX_PLY);
  var historyTable = new Int32Array(2 * 128 * 128);

  var ORDER_SCORES = new Int32Array(256);
  var QORDER_SCORES = new Int32Array(256);

  function hasNonPawnMaterial(board, side) {
    var squares = board.squares;
    for (var s = 0; s < 128; s++) {
      if (s & 0x88) continue;
      var p = squares[s];
      if (p === EMPTY) continue;
      if ((p >> 3) === side) {
        var t = p & 7;
        if (t !== PAWN && t !== KING) return true;
      }
    }
    return false;
  }

  // MVV-LVA style score for a capture or promotion: bigger victim / promoted
  // piece first, smaller attacker as a tiebreak.
  function captureOrderScore(board, m) {
    var flags = moveFlagsOf(m);
    var promo = movePromoType(m);
    var to = moveToSq(m);
    var capturedType = 0;
    if (flags & FLAG_EP) capturedType = PAWN;
    else if (flags & FLAG_CAPTURE) capturedType = board.squares[to] & 7;
    var movingType = board.squares[moveFromSq(m)] & 7;
    var victimValue = capturedType ? MAT_MG[capturedType] : 0;
    var promoValue = promo ? MAT_MG[promo] : 0;
    return victimValue * 16 + promoValue - movingType;
  }

  // Orders captures/promotions-only move lists (quiescence) by MVV-LVA,
  // in place, using a preallocated scratch score array (no allocation).
  function orderCaptures(board, moves) {
    var n = moves.length, i, j;
    for (i = 0; i < n; i++) QORDER_SCORES[i] = captureOrderScore(board, moves[i]);
    for (i = 1; i < n; i++) {
      var ks = QORDER_SCORES[i], km = moves[i];
      j = i - 1;
      while (j >= 0 && QORDER_SCORES[j] < ks) {
        QORDER_SCORES[j + 1] = QORDER_SCORES[j];
        moves[j + 1] = moves[j];
        j--;
      }
      QORDER_SCORES[j + 1] = ks;
      moves[j + 1] = km;
    }
  }

  // Orders a full legal move list for the main search: TT move, then
  // captures/promotions by MVV-LVA, then the two killer moves for this ply,
  // then quiets by history score. In place, no allocation.
  function orderMoves(board, moves, ttHint, ply) {
    var n = moves.length, i, j;
    for (i = 0; i < n; i++) {
      var m = moves[i], s;
      if (m === ttHint) {
        s = 2000000000;
      } else {
        var flags = moveFlagsOf(m);
        var promo = movePromoType(m);
        if ((flags & FLAG_CAPTURE) || promo) {
          s = 1000000 + captureOrderScore(board, m);
        } else if (m === killer1[ply]) {
          s = 500001;
        } else if (m === killer2[ply]) {
          s = 500000;
        } else {
          s = historyTable[board.side * 16384 + moveFromSq(m) * 128 + moveToSq(m)];
        }
      }
      ORDER_SCORES[i] = s;
    }
    for (i = 1; i < n; i++) {
      var keyScore = ORDER_SCORES[i], keyMove = moves[i];
      j = i - 1;
      while (j >= 0 && ORDER_SCORES[j] < keyScore) {
        ORDER_SCORES[j + 1] = ORDER_SCORES[j];
        moves[j + 1] = moves[j];
        j--;
      }
      ORDER_SCORES[j + 1] = keyScore;
      moves[j + 1] = keyMove;
    }
  }

  // -- quiescence ------------------------------------------------------------

  function quiescence(board, alpha, beta, ply, ctx) {
    ctx.nodes++;
    if (ctx.allowStop && (ctx.nodes & 2047) === 0 && Date.now() >= ctx.deadline) {
      ctx.stopped = true;
    }
    if (ctx.stopped) return 0;

    var inCheck = board.inCheck();
    var standPat = 0;
    if (!inCheck) {
      standPat = evaluateBoard(board);
      if (standPat >= beta) return standPat;
      if (standPat > alpha) alpha = standPat;
    }

    var moves = inCheck ? board.generateMoves() : board.generateCaptures();

    if (inCheck && moves.length === 0) {
      return -(MATE_SCORE - ply);
    }

    orderCaptures(board, moves);

    var bestScore = inCheck ? -SEARCH_INF : standPat;

    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      var flags = moveFlagsOf(m);
      var isCapture = (flags & FLAG_CAPTURE) !== 0;

      if (!inCheck && isCapture) {
        var to = moveToSq(m);
        var capturedType = (flags & FLAG_EP) ? PAWN : (board.squares[to] & 7);
        var victimValue = MAT_MG[capturedType];
        if (standPat + victimValue + 200 < alpha) continue;
      }

      board.makeMove(m);
      var score = -quiescence(board, -beta, -alpha, ply + 1, ctx);
      board.unmakeMove();

      if (ctx.stopped) return 0;

      if (score > bestScore) bestScore = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    }

    return bestScore;
  }

  // -- negamax PVS -------------------------------------------------------

  function negamax(board, depth, alpha, beta, ply, ctx, canNull) {
    ctx.nodes++;
    if (ctx.allowStop && (ctx.nodes & 2047) === 0 && Date.now() >= ctx.deadline) {
      ctx.stopped = true;
    }
    if (ctx.stopped) return 0;

    if (ply > 0 && (board.isRepetition() || board.halfmove >= 100)) return 0;

    if (depth <= 0) {
      return quiescence(board, alpha, beta, ply, ctx);
    }

    var lo = board.hashLo, hi = board.hashHi;
    var ttIdx = ttProbe(lo, hi);
    var ttHint = 0;
    if (ttIdx !== -1) {
      ttHint = ttMoveArr[ttIdx];
      // The root (ply 0) always runs its full move loop so the iterative
      // deepening driver gets a concrete root move/score every iteration;
      // a stale/strong TT bound must not short-circuit it.
      if (ply > 0 && ttDepthArr[ttIdx] >= depth) {
        var ttSc = scoreFromTT(ttScoreArr[ttIdx], ply);
        var flag = ttFlagArr[ttIdx];
        if (flag === TT_EXACT) return ttSc;
        if (flag === TT_LOWER && ttSc >= beta) return ttSc;
        if (flag === TT_UPPER && ttSc <= alpha) return ttSc;
      }
    }

    var inCheck = board.inCheck();
    if (inCheck) depth++;

    if (!inCheck && canNull && depth >= 3 && hasNonPawnMaterial(board, board.side)) {
      var R = 2 + (depth > 6 ? 1 : 0);
      board.makeNullMove();
      var nullScore = -negamax(board, depth - 1 - R, -beta, -beta + 1, ply + 1, ctx, false);
      board.unmakeNullMove();
      if (ctx.stopped) return 0;
      if (nullScore >= beta) return nullScore;
    }

    var moves = board.generateMoves();
    if (moves.length === 0) {
      return inCheck ? -(MATE_SCORE - ply) : 0;
    }

    orderMoves(board, moves, ttHint, ply);

    var bestScore = -SEARCH_INF;
    var bestMove = moves[0];
    var ttFlagOut = TT_UPPER;

    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      var mFlags = moveFlagsOf(m);
      var isCapture = (mFlags & FLAG_CAPTURE) !== 0;
      var isPromo = movePromoType(m) !== 0;
      var isQuiet = !isCapture && !isPromo;

      board.makeMove(m);
      var givesCheck = board.inCheck();
      var newDepth = depth - 1;
      var score;

      if (i === 0) {
        score = -negamax(board, newDepth, -beta, -alpha, ply + 1, ctx, true);
      } else {
        var reduction = 0;
        if (isQuiet && !inCheck && !givesCheck && i >= 3 && depth >= 3) {
          reduction = (i >= 8) ? 2 : 1;
          if (newDepth - reduction < 0) reduction = newDepth;
        }
        score = -negamax(board, newDepth - reduction, -alpha - 1, -alpha, ply + 1, ctx, true);
        if (!ctx.stopped && score > alpha && reduction > 0) {
          score = -negamax(board, newDepth, -alpha - 1, -alpha, ply + 1, ctx, true);
        }
        if (!ctx.stopped && score > alpha && score < beta) {
          score = -negamax(board, newDepth, -beta, -alpha, ply + 1, ctx, true);
        }
      }

      board.unmakeMove();

      if (ctx.stopped) return 0;

      if (score > bestScore) {
        bestScore = score;
        bestMove = m;
        if (ply === 0) { ctx.rootMove = m; ctx.rootScore = score; }
      }
      if (score > alpha) {
        alpha = score;
        ttFlagOut = TT_EXACT;
      }
      if (alpha >= beta) {
        ttFlagOut = TT_LOWER;
        if (isQuiet) {
          if (killer1[ply] !== m) { killer2[ply] = killer1[ply]; killer1[ply] = m; }
          historyTable[board.side * 16384 + moveFromSq(m) * 128 + moveToSq(m)] += depth * depth;
        }
        break;
      }
    }

    ttStore(lo, hi, depth, bestScore, ttFlagOut, bestMove, ply);

    return bestScore;
  }

  // -- opening book ----------------------------------------------------------
  // Keys are the FEN's first four fields (placement, side, castling, ep).
  // Built at module load by replaying UCI move sequences for mainstream
  // openings on a scratch Board; every move is validated legal against the
  // position it's played in (an illegal entry throws at require() time).

  function fenKey(fen) {
    var parts = fen.trim().split(/\s+/);
    return parts[0] + ' ' + parts[1] + ' ' + parts[2] + ' ' + parts[3];
  }

  var OPENING_LINES = [
    // 1.e4 e5 - Ruy Lopez, Italian, Petrov, Scotch, King's Gambit, Vienna
    ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'a7a6'],
    ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5', 'g8f6'],
    ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'f8c5'],
    ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6'],
    ['e2e4', 'e7e5', 'g1f3', 'g8f6'],
    ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'd2d4', 'e5d4'],
    ['e2e4', 'e7e5', 'f2f4', 'e5f4'],
    ['e2e4', 'e7e5', 'b1c3', 'g8f6'],
    ['e2e4', 'e7e5', 'b1c3', 'b8c6'],
    // 1.e4 c5 - Sicilian
    ['e2e4', 'c7c5', 'g1f3', 'd7d6', 'd2d4', 'c5d4'],
    ['e2e4', 'c7c5', 'g1f3', 'b8c6', 'd2d4', 'c5d4'],
    ['e2e4', 'c7c5', 'g1f3', 'e7e6'],
    ['e2e4', 'c7c5', 'b1c3', 'b8c6'],
    ['e2e4', 'c7c5', 'c2c3', 'd7d5'],
    // 1.e4 e6 - French
    ['e2e4', 'e7e6', 'd2d4', 'd7d5'],
    ['e2e4', 'e7e6', 'd2d4', 'd7d5', 'b1c3', 'g8f6'],
    ['e2e4', 'e7e6', 'd2d4', 'd7d5', 'b1d2', 'g8f6'],
    // 1.e4 c6 - Caro-Kann
    ['e2e4', 'c7c6', 'd2d4', 'd7d5'],
    ['e2e4', 'c7c6', 'd2d4', 'd7d5', 'b1c3', 'g8f6'],
    ['e2e4', 'c7c6', 'd2d4', 'd7d5', 'e4e5', 'c8f5'],
    // other 1.e4 replies
    ['e2e4', 'd7d6', 'd2d4', 'g8f6'],
    ['e2e4', 'g8f6', 'e4e5', 'f6d5'],
    ['e2e4', 'd7d5', 'e4d5', 'd8d5'],
    // 1.d4 d5 - QGD, Slav, QGA
    ['d2d4', 'd7d5', 'c2c4', 'e7e6'],
    ['d2d4', 'd7d5', 'c2c4', 'c7c6'],
    ['d2d4', 'd7d5', 'c2c4', 'd5c4'],
    ['d2d4', 'd7d5', 'g1f3', 'g8f6'],
    ['d2d4', 'd7d5', 'b1c3', 'g8f6'],
    // 1.d4 Nf6 - KID, Nimzo, Queen's Indian, Grunfeld
    ['d2d4', 'g8f6', 'c2c4', 'g7g6'],
    ['d2d4', 'g8f6', 'c2c4', 'e7e6', 'b1c3', 'f8b4'],
    ['d2d4', 'g8f6', 'c2c4', 'e7e6', 'g1f3', 'b7b6'],
    ['d2d4', 'g8f6', 'c2c4', 'g7g6', 'b1c3', 'd7d5'],
    ['d2d4', 'g8f6', 'g1f3', 'd7d5'],
    ['d2d4', 'g8f6', 'g1f3', 'e7e6'],
    // 1.c4 - English
    ['c2c4', 'e7e5', 'g1f3', 'g8f6'],
    ['c2c4', 'c7c5', 'g1f3', 'g8f6'],
    ['c2c4', 'g8f6', 'b1c3', 'e7e5'],
    ['c2c4', 'e7e6', 'g1f3', 'g8f6'],
    // 1.Nf3 - Reti
    ['g1f3', 'd7d5', 'c2c4', 'c7c6'],
    ['g1f3', 'g8f6', 'c2c4', 'g7g6'],
    ['g1f3', 'g8f6', 'd2d4', 'e7e6']
  ];

  function buildBook() {
    var book = Object.create(null);
    for (var li = 0; li < OPENING_LINES.length; li++) {
      var line = OPENING_LINES[li];
      var b = new Board();
      for (var ply = 0; ply < line.length; ply++) {
        var key = fenKey(b.toFen());
        var uci = line[ply];
        var legal = b.generateMoves();
        var mv = -1;
        for (var k = 0; k < legal.length; k++) {
          if (moveToUci(legal[k]) === uci) { mv = legal[k]; break; }
        }
        if (mv === -1) {
          throw new Error('opening book: illegal move ' + uci + ' in line ' + line.join(' ') + ' at ply ' + ply);
        }
        if (!book[key]) book[key] = [];
        if (book[key].indexOf(uci) === -1) book[key].push(uci);
        b.makeMove(mv);
      }
    }
    return book;
  }

  var BOOK = buildBook();

  function pickBookMove(board, fen) {
    var key = fenKey(fen);
    var entries = BOOK[key];
    if (!entries || entries.length === 0) return null;
    var legal = board.generateMoves();
    var candidates = [];
    for (var i = 0; i < entries.length; i++) {
      for (var j = 0; j < legal.length; j++) {
        if (moveToUci(legal[j]) === entries[i]) { candidates.push(legal[j]); break; }
      }
    }
    if (candidates.length === 0) return null;
    return candidates[(Math.random() * candidates.length) | 0];
  }

  // -- top-level search --------------------------------------------------

  function search(fen, opts) {
    opts = opts || {};
    var timeLimitMs = opts.timeLimitMs !== undefined ? opts.timeLimitMs : 2000;
    var maxDepth = opts.maxDepth !== undefined ? opts.maxDepth : 64;
    var history = opts.history || [];
    var useBook = opts.useBook !== undefined ? opts.useBook : true;

    var startTime = Date.now();

    if (useBook) {
      var bookBoard = new Board(fen);
      var bookMv = pickBookMove(bookBoard, fen);
      if (bookMv !== null) {
        return {
          move: { from: moveFrom(bookMv), to: moveTo(bookMv), promotion: movePromo(bookMv) },
          uci: moveToUci(bookMv),
          score: 0,
          depth: 0,
          nodes: 0,
          timeMs: Date.now() - startTime,
          book: true
        };
      }
    }

    var board = new Board(fen);
    board.setHistory(history);

    var rootInCheck = board.inCheck();
    var rootMoves = board.generateMoves();
    if (rootMoves.length === 0) {
      return {
        move: null,
        uci: null,
        score: rootInCheck ? -MATE_SCORE : 0,
        depth: 0,
        nodes: 0,
        timeMs: Date.now() - startTime,
        book: false
      };
    }

    killer1.fill(0);
    killer2.fill(0);
    historyTable.fill(0);

    var ctx = {
      nodes: 0,
      deadline: startTime + timeLimitMs,
      stopped: false,
      allowStop: false,
      rootMove: 0,
      rootScore: 0
    };

    var overallBestMove = rootMoves[0];
    var overallBestScore = 0;
    var completedDepth = 0;

    for (var depth = 1; depth <= maxDepth; depth++) {
      ctx.allowStop = depth > 1; // depth 1 always completes
      ctx.rootMove = 0;
      ctx.rootScore = 0;

      negamax(board, depth, -SEARCH_INF, SEARCH_INF, 0, ctx, true);

      if (ctx.rootMove !== 0) {
        overallBestMove = ctx.rootMove;
        overallBestScore = ctx.rootScore;
        completedDepth = depth;
      }

      if (ctx.stopped) break;

      if (Math.abs(overallBestScore) >= MATE_THRESHOLD) break; // proven mate

      var elapsed = Date.now() - startTime;
      if (elapsed > timeLimitMs * 0.5) break; // don't start a new iteration past 50% of budget
    }

    return {
      move: { from: moveFrom(overallBestMove), to: moveTo(overallBestMove), promotion: movePromo(overallBestMove) },
      uci: moveToUci(overallBestMove),
      score: overallBestScore,
      depth: completedDepth,
      nodes: ctx.nodes,
      timeMs: Date.now() - startTime,
      book: false
    };
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
    movePromo: movePromo,
    evaluateBoard: evaluateBoard,
    evaluate: evaluate,
    search: search,
    MATE_SCORE: MATE_SCORE,
    BOOK: BOOK
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
