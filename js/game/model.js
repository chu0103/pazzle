/**
 * model.js —— 棋盘状态机（纯逻辑，不碰绘制）
 * 负责：放置合法性、放置/拿起、撤销、重置、胜负判定、提示定位。
 */
(function () {
  var G = typeof GameGlobal !== 'undefined' ? GameGlobal
        : (typeof window !== 'undefined' ? window : globalThis);
  var BF = G.BF || (G.BF = {});
  if (BF.Model) { return; }

  function Model(puzzle) {
    this.puzzle = puzzle;
    this.size = puzzle.size;
    this.area = puzzle.size * puzzle.size;
    this.reset(true);
  }

  /** 逐格记录归属，-1 = 空 */
  Model.prototype.reset = function (keepPieces) {
    var i, n = this.area;
    this.cells = new Array(n);
    for (i = 0; i < n; i++) { this.cells[i] = -1; }

    if (!keepPieces || !this.pieces) {
      this.pieces = this.puzzle.pieces.map(function (p) {
        return {
          id: p.id, w: p.w, h: p.h, color: p.color,
          solX: p.x, solY: p.y,          // 标准答案坐标（仅用于提示）
          fixed: !!p.fixed,              // 固定块：开局就位、不可拖动
          placed: false, x: 0, y: 0,
          pop: 0,                        // 落子动效 0~1
          px: 0, py: 0, scale: 1, tScale: 1
        };
      });
    } else {
      for (i = 0; i < this.pieces.length; i++) {
        var p = this.pieces[i];
        p.placed = false; p.x = 0; p.y = 0; p.pop = 0;
      }
    }

    // 固定块：开局直接盖章进棋盘，算"已放置"但不进 undoStack、不算 moves
    for (i = 0; i < this.pieces.length; i++) {
      var fp = this.pieces[i];
      if (!fp.fixed) { continue; }
      fp.placed = true;
      fp.x = fp.solX; fp.y = fp.solY;
      for (var dy = 0; dy < fp.h; dy++) {
        for (var dx = 0; dx < fp.w; dx++) {
          this.cells[this.idx(fp.x + dx, fp.y + dy)] = fp.id;
        }
      }
    }

    this.undoStack = [];
    this.moves = 0;
    this.undoCount = 0;   // 真正执行过几次撤销（undoStack 是历史记录，长度恒等于落子数，不能用它判断）
    this.hintCount = 0;
    this.resetCount = 0;
    this.dirty = true;   // 需要重排托盘
    return this;
  };

  Model.prototype.idx = function (x, y) { return y * this.size + x; };

  Model.prototype.canPlace = function (p, x, y) {
    if (x < 0 || y < 0 || x + p.w > this.size || y + p.h > this.size) { return false; }
    for (var dy = 0; dy < p.h; dy++) {
      for (var dx = 0; dx < p.w; dx++) {
        if (this.cells[this.idx(x + dx, y + dy)] !== -1) { return false; }
      }
    }
    return true;
  };

  /** 只判"本体不出界"，重叠/占用交给 canPlace —— 拖拽时的红/绿预览用 */
  Model.prototype.canPlaceAnywhere = function (p, x, y) {
    return x >= 0 && y >= 0 && x + p.w <= this.size && y + p.h <= this.size;
  };

  Model.prototype.place = function (p, x, y, record) {
    if (p.fixed) { return true; }   // 固定块已就位，幂等返回，不计入落子历史
    if (!this.canPlace(p, x, y)) { return false; }
    for (var dy = 0; dy < p.h; dy++) {
      for (var dx = 0; dx < p.w; dx++) {
        this.cells[this.idx(x + dx, y + dy)] = p.id;
      }
    }
    p.placed = true;
    p.x = x; p.y = y; p.pop = 1;
    this.moves++;
    if (record !== false) { this.undoStack.push({ id: p.id, x: x, y: y }); }
    return true;
  };

  Model.prototype.lift = function (p) {
    if (!p.placed || p.fixed) { return; }   // 固定块不可抬起
    for (var dy = 0; dy < p.h; dy++) {
      for (var dx = 0; dx < p.w; dx++) {
        var i = this.idx(p.x + dx, p.y + dy);
        if (this.cells[i] === p.id) { this.cells[i] = -1; }
      }
    }
    p.placed = false;
  };

  Model.prototype.undo = function () {
    var m = this.undoStack.pop();
    if (!m) { return false; }
    var p = this.pieces[m.id];
    this.lift(p);
    p.scale = 1; p.tScale = 1;
    this.undoCount++;
    this.dirty = true;
    return true;
  };

  Model.prototype.softReset = function () {
    this.resetCount++;
    this.reset(false);
    this.dirty = true;
  };

  Model.prototype.occupantAt = function (x, y) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) { return null; }
    var id = this.cells[this.idx(x, y)];
    return id >= 0 ? this.pieces[id] : null;
  };

  Model.prototype.filled = function () {
    var c = 0;
    for (var i = 0; i < this.area; i++) { if (this.cells[i] !== -1) { c++; } }
    return c;
  };

  Model.prototype.remaining = function () {
    var c = 0;
    for (var i = 0; i < this.pieces.length; i++) { if (!this.pieces[i].placed) { c++; } }
    return c;
  };

  Model.prototype.isSolved = function () {
    return this.remaining() === 0 && this.filled() === this.area;
  };

  /** 提示：找第一个未放置的块，返回它的标准答案位置 */
  Model.prototype.hint = function () {
    for (var i = 0; i < this.pieces.length; i++) {
      var p = this.pieces[i];
      if (p.placed) { continue; }
      var blocked = !this.canPlace(p, p.solX, p.solY);
      this.hintCount++;
      return { piece: p, x: p.solX, y: p.solY, blocked: blocked };
    }
    return null;
  };

  /** 星级：不用提示 + 不撤销/不重置 = 3 星（重新挪动方块不算，那是正常操作） */
  Model.prototype.stars = function () {
    var s = 3;
    if (this.hintCount > 0) { s--; }
    if (this.undoCount > 0 || this.resetCount > 0) { s--; }
    return Math.max(1, s);
  };

  Model.prototype.trayPieces = function () {
    var out = [], i;
    for (i = 0; i < this.puzzle.order.length; i++) {
      var p = this.pieces[this.puzzle.order[i]];
      if (!p.placed) { out.push(p); }
    }
    return out;
  };

  BF.Model = Model;
})();
