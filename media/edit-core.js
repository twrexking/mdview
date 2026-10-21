// 改字的純邏輯（畫面端與 node 測試共用，不碰 DOM、不碰 vscode）。
//
// 鐵律：使用者沒碰的段落，檔案裡一個字都不動。
// 所以這裡每一支函式都只收「那一段的原始行」與「改完的內容」，回傳那一段的新原始行；
// 其他行由呼叫端原樣保留。
//
// 名詞：
//   前綴（prefix）＝一行開頭的容器記號：引言的 >、條列的 - / 1. / [ ]、標題的 ##。
//   內文（inline）＝前綴之後、使用者真正在畫面上看到並改動的那段文字（已轉回 markdown）。
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MdEditCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // 第 1 組：引言記號（可重複，例：「> > 」）；第 2 組：條列記號；第 3 組：待辦勾選框；第 4 組：標題井字。
  var PREFIX_RE = /^((?:[ \t]*>)*[ \t]*)((?:[-*+]|\d{1,9}[.)])[ \t]+)?(\[[ xX]\][ \t]+)?(#{1,6}[ \t]+)?/;

  // 把一行拆成「前綴」與「其餘」。
  function splitPrefix(line) {
    var m = PREFIX_RE.exec(line) || [];
    var prefix;
    // 勾選框沒跟在條列記號後面就不算前綴（那只是內文裡的方括號）。
    if (m[3] && !m[2]) prefix = m[1] || "";
    else prefix = (m[1] || "") + (m[2] || "") + (m[3] || "") + (m[4] || "");
    return { prefix: prefix, rest: line.slice(prefix.length) };
  }

  // 同一段落的第二行起要用的前綴：引言的 > 保留，其餘記號換成等寬的空白（條列的續行要縮排）；
  // 標題不能換行，呼叫端會先把換行拿掉。
  function contPrefix(prefix) {
    return prefix.replace(/[^>\s]/g, " ");
  }

  // 一段（段落、標題、條列項的那一行文字）改完後的新原始行。
  //   oldLines：那一段原本的行（陣列，照檔案順序）
  //   inline：改完的內文（markdown，可能含「  \n」硬換行）
  //   opts.setext：標題是「文字＋底線」寫法（===／---），要把底線那行留住
  // 回傳：字串，行與行之間用 \n，結尾不帶 \n。
  function blockSource(oldLines, inline, opts) {
    opts = opts || {};
    var first = oldLines[0] || "";
    var sp = splitPrefix(first);
    var prefix = sp.prefix;
    var isHeading = /#{1,6}[ \t]+$/.test(prefix) || opts.setext;
    var body = String(inline).replace(/\r\n?/g, "\n").replace(/\s+$/, "");
    if (isHeading) body = body.replace(/[ \t]*\n[ \t]*/g, " ");
    var lines = body.split("\n");
    var out = [prefix + lines[0]];
    var cont = contPrefix(prefix);
    for (var i = 1; i < lines.length; i++) out.push(cont + lines[i]);
    if (opts.setext && oldLines.length >= 2) out.push(oldLines[oldLines.length - 1]);
    return out.join("\n");
  }

  // 表格行：找出每一格在那一行裡的位置。跳過「\|」（格內的直線要這樣寫）。
  // 回傳 { cells: [{ start, end }], leading, trailing }：start／end 是格內容（含兩側空白）在行裡的索引。
  function splitCells(line) {
    var bars = [];
    for (var i = 0; i < line.length; i++) {
      if (line[i] === "\\") { i++; continue; }
      if (line[i] === "|") bars.push(i);
    }
    var leading = bars.length > 0 && /^\s*$/.test(line.slice(0, bars[0]));
    var trailing = bars.length > 0 && /^\s*$/.test(line.slice(bars[bars.length - 1] + 1));
    var cells = [];
    var start = 0;
    var bounds = bars.slice();
    if (leading) start = bounds.shift() + 1;
    var tail = line.length;
    if (trailing && bounds.length) tail = bounds.pop();
    for (var j = 0; j < bounds.length; j++) {
      cells.push({ start: start, end: bounds[j] });
      start = bounds[j] + 1;
    }
    cells.push({ start: start, end: tail });
    // 「|」開頭且「|」結尾、中間什麼都沒有（例：「||」）也算一格。
    return { cells: cells, leading: leading, trailing: trailing };
  }

  // 把表格某一行的第 index 格換成 text（其他格的字與空白原樣不動）。
  function replaceCell(line, index, text) {
    var info = splitCells(line);
    var c = info.cells[index];
    if (!c) return line;
    var safe = String(text).replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
    return line.slice(0, c.start) + " " + safe + " " + line.slice(c.end);
  }

  // 待辦勾選框：把那一行的 [ ]／[x] 切成 checked 指定的狀態。
  function toggleTask(line, checked) {
    var sp = splitPrefix(line);
    var m = /\[([ xX])\]/.exec(sp.prefix);
    if (!m) return line;
    var idx = sp.prefix.indexOf(m[0]);
    var next = checked ? "[x]" : "[ ]";
    return sp.prefix.slice(0, idx) + next + sp.prefix.slice(idx + 3) + sp.rest;
  }

  // 檔案開頭的設定區（--- … ---）：回傳它占了幾行（0＝沒有）。
  function frontMatterLines(text) {
    var lines = text.split("\n");
    if (lines[0].replace(/\r$/, "") !== "---") return 0;
    for (var i = 1; i < lines.length; i++) {
      var l = lines[i].replace(/\r$/, "");
      if (l === "---" || l === "...") return i + 1;
    }
    return 0;
  }

  return {
    PREFIX_RE: PREFIX_RE,
    splitPrefix: splitPrefix,
    contPrefix: contPrefix,
    blockSource: blockSource,
    splitCells: splitCells,
    replaceCell: replaceCell,
    toggleTask: toggleTask,
    frontMatterLines: frontMatterLines
  };
});
