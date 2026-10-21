// MD 檢視器的畫面端：畫面、三種狀態、就地編輯、與主程式的通道。
//
// 三種狀態：locked（預覽鎖住，預設）／edit（預覽編輯）／source（原始碼編輯：同一個分頁換成純文字框，
// 整份文字用 replaceAll 送回；三顆鈕在三種狀態下都在）。
// 可改的單位（class="ed"）：段落、標題、表格的一格、引言或條列裡的段落。
// 不可改的（class="nope"）：程式碼區塊、原始 HTML、圖片、設定區——要改請切到原始碼。
//
// 改字怎麼寫回去：每個可改的單位都帶 data-ls／data-le（它在檔案裡的起訖行），
// 改完用 turndown 把那一格的 HTML 轉回 markdown 內文（turndown-rules.js），
// 再交給 edit-core.js 拼回原本的前綴，只送「這幾行換成這些」給主程式；其他行完全不經手。
// markdown-it 的設定在 render-core.js。
(function () {
  "use strict";
  var vscode = acquireVsCodeApi();
  var core = window.MdEditCore;

  var S = {
    text: "",
    lines: [],
    version: 0,
    baseUri: "",
    mode: "locked",
    editing: null,      // { el, orig }
    pending: null,      // 編輯中收到的新內容，改完再套
    fmLines: 0
  };

  var md = window.MdRenderCore.createMd(window.markdownit, {
    baseUri: function () { return S.baseUri; }
  });
  var td = window.MdTurndown.createTurndown(window.TurndownService);
  var slug = window.MdRenderCore.slug;

  // ---------- 畫面 ----------
  var content = document.getElementById("content");
  var fmBox = document.getElementById("fm");

  function render() {
    var scrollY = window.scrollY;
    var src = S.text;
    S.fmLines = core.frontMatterLines(src);
    if (S.fmLines) {
      fmBox.hidden = false;
      fmBox.innerHTML = '<pre class="nope"></pre>';
      fmBox.querySelector("pre").textContent = S.lines.slice(0, S.fmLines).join("\n");
      // 用等量的空行頂替，行號才對得上。
      src = new Array(S.fmLines + 1).join("\n") + S.lines.slice(S.fmLines).join("\n");
    } else {
      fmBox.hidden = true;
      fmBox.innerHTML = "";
    }
    if (!src.trim()) {
      content.innerHTML = '<p id="empty">（空檔案）要寫東西請切到原始碼</p>';
      return;
    }
    content.innerHTML = md.render(src);
    fixupTables();
    var imgs = content.querySelectorAll("p > img:only-child");
    for (var n = 0; n < imgs.length; n++) {
      imgs[n].parentNode.classList.add("nope");
      imgs[n].parentNode.classList.remove("ed");
    }
    window.scrollTo(0, scrollY);
  }

  // 表格格子沒有自己的行號，從那一列繼承；表頭那列的行數會把「|---|」算進去，改成只算自己那一行。
  function fixupTables() {
    var rows = content.querySelectorAll("tr[data-ls]");
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var ls = row.getAttribute("data-ls");
      var le = row.getAttribute("data-le");
      if (row.parentNode && row.parentNode.tagName === "THEAD") {
        le = String(parseInt(ls, 10) + 1);
        row.setAttribute("data-le", le);
      }
      var cells = row.children;
      for (var j = 0; j < cells.length; j++) {
        cells[j].setAttribute("data-ls", ls);
        cells[j].setAttribute("data-le", le);
        cells[j].setAttribute("data-cell", String(j));
      }
    }
  }

  function setText(text, version) {
    S.text = text;
    S.lines = text.split("\n");
    S.version = version;
  }

  // ---------- 三種狀態 ----------
  var btns = {
    locked: document.getElementById("m-locked"),
    edit: document.getElementById("m-edit"),
    source: document.getElementById("m-source")
  };
  var srcBox = document.getElementById("src");

  function setMode(mode) {
    if (mode === S.mode) return;
    var line = S.mode === "source" ? caretLine() : topLine();
    if (S.mode === "source") leaveSource();
    else commit();
    S.mode = mode;
    document.body.classList.toggle("locked", mode === "locked");
    document.body.classList.toggle("edit", mode === "edit");
    document.body.classList.toggle("source", mode === "source");
    btns.locked.classList.toggle("on", mode === "locked");
    btns.edit.classList.toggle("on", mode === "edit");
    btns.source.classList.toggle("on", mode === "source");
    if (mode === "source") enterSource(line);
    else setTimeout(function () { reveal(line, true); }, 0);
  }
  btns.locked.addEventListener("click", function () { setMode("locked"); });
  btns.edit.addEventListener("click", function () { setMode("edit"); });
  btns.source.addEventListener("click", function () { setMode("source"); });

  // 目前畫面最上方是檔案的第幾行（切換狀態時兩邊要對到同一處）。
  function topLine() {
    var els = content.querySelectorAll("[data-ls]");
    for (var i = 0; i < els.length; i++) {
      var r = els[i].getBoundingClientRect();
      if (r.bottom >= 8) return parseInt(els[i].getAttribute("data-ls"), 10) || 0;
    }
    return 0;
  }

  // ---------- 原始碼編輯（同一個分頁換成純文字框） ----------
  var srcTimer = null;

  function enterSource(line) {
    srcBox.value = S.text;
    srcBox.hidden = false;
    var lines = S.lines;
    var pos = 0;
    for (var i = 0; i < line && i < lines.length; i++) pos += lines[i].length + 1;
    srcBox.focus();
    srcBox.setSelectionRange(pos, pos);
    // 文字框自己捲動：讓那一行停在框的上方。
    var lh = parseFloat(getComputedStyle(srcBox).lineHeight) || 22;
    srcBox.scrollTop = Math.max(0, line * lh);
  }

  // 游標在第幾行。
  function caretLine() {
    var v = srcBox.value;
    var n = 0;
    for (var i = 0; i < srcBox.selectionStart && i < v.length; i++) if (v.charCodeAt(i) === 10) n++;
    return n;
  }

  function flushSource() {
    if (srcTimer) { clearTimeout(srcTimer); srcTimer = null; }
    var v = srcBox.value;
    if (v === S.text) return;
    setText(v, S.version);
    vscode.postMessage({ type: "replaceAll", text: v, version: S.version });
  }

  function leaveSource() {
    flushSource();
    srcBox.hidden = true;
    render();
  }

  srcBox.addEventListener("input", function () {
    if (srcTimer) clearTimeout(srcTimer);
    srcTimer = setTimeout(flushSource, 400);
  });
  srcBox.addEventListener("blur", flushSource);
  srcBox.addEventListener("keydown", function (e) {
    if (e.key === "Tab") {
      e.preventDefault();
      document.execCommand("insertText", false, "  ");
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      flushSource();
    }
  });

  // 原始碼編輯中收到外面改的內容：換掉文字框的內容，游標盡量留在原位。
  function applyExternalToSource(text) {
    var start = srcBox.selectionStart, end = srcBox.selectionEnd;
    srcBox.value = text;
    var max = text.length;
    srcBox.setSelectionRange(Math.min(start, max), Math.min(end, max));
  }

  // ---------- 就地編輯 ----------
  function editableFrom(target) {
    var el = target.closest ? target.closest(".ed") : null;
    if (!el || !content.contains(el)) return null;
    if (el.closest(".nope")) return null;
    return el;
  }

  content.addEventListener("mousedown", function (e) {
    if (S.mode !== "edit") return;
    if (e.target.closest("a") || e.target.closest("input")) return;
    var el = editableFrom(e.target);
    if (!el) return;
    if (S.editing && S.editing.el === el) return;
    commit();
    startEdit(el);
  });

  function startEdit(el) {
    S.editing = { el: el, orig: el.innerHTML };
    el.contentEditable = "true";
    el.classList.add("editing");
    el.spellcheck = false;
  }

  function commit() {
    var ed = S.editing;
    if (!ed) return;
    S.editing = null;
    var el = ed.el;
    el.contentEditable = "false";
    el.classList.remove("editing");
    var changed = el.innerHTML !== ed.orig;
    if (changed) {
      try { sendEdit(el); }
      catch (err) { vscode.postMessage({ type: "error", text: String(err && err.stack || err) }); }
    }
    if (S.pending) {
      var p = S.pending; S.pending = null;
      setText(p.text, p.version);
      render();
    } else if (!changed) {
      el.innerHTML = ed.orig;
    }
  }

  function sendEdit(el) {
    var from = parseInt(el.getAttribute("data-ls"), 10);
    var to = parseInt(el.getAttribute("data-le"), 10);
    if (isNaN(from) || isNaN(to) || to <= from) throw new Error("這一段找不到對應的行");
    var inline = window.MdTurndown.inlineMarkdown(td, el.innerHTML);
    var oldLines = S.lines.slice(from, to);
    var text;
    if (el.hasAttribute("data-cell")) {
      text = core.replaceCell(oldLines[0], parseInt(el.getAttribute("data-cell"), 10), inline);
      to = from + 1;
      oldLines = oldLines.slice(0, 1);
    } else {
      text = core.blockSource(oldLines, inline, { setext: el.hasAttribute("data-setext") });
    }
    if (text === oldLines.join("\n")) return;
    vscode.postMessage({ type: "edit", from: from, to: to, text: text, version: S.version });
  }

  document.addEventListener("keydown", function (e) {
    if (S.mode === "source") return;
    if (!S.editing) return;
    if (e.key === "Escape") { e.preventDefault(); commit(); return; }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); return; }
    if (e.key === "Enter" && e.shiftKey) {
      // 表格的格子與標題不能換行；段落的 Shift+Enter 是硬換行。
      var el = S.editing.el;
      if (el.hasAttribute("data-cell") || /^H[1-6]$/.test(el.tagName)) e.preventDefault();
    }
  });
  document.addEventListener("focusout", function (e) {
    if (!S.editing || e.target !== S.editing.el) return;
    setTimeout(function () {
      if (S.editing && document.activeElement !== S.editing.el) commit();
    }, 0);
  });
  document.addEventListener("paste", function (e) {
    if (S.mode === "source" || !S.editing) return;
    e.preventDefault();
    var t = (e.clipboardData || window.clipboardData).getData("text/plain");
    document.execCommand("insertText", false, t);
  });

  // 待辦勾選框：預覽編輯時點一下就切換。
  content.addEventListener("click", function (e) {
    var cb = e.target.closest && e.target.closest("input.task");
    if (!cb) return;
    if (S.mode !== "edit") { e.preventDefault(); return; }
    var p = cb.closest("p[data-ls]");
    if (!p) return;
    var line = parseInt(p.getAttribute("data-ls"), 10);
    var newLine = core.toggleTask(S.lines[line], cb.checked);
    if (newLine !== S.lines[line]) {
      vscode.postMessage({ type: "edit", from: line, to: line + 1, text: newLine, version: S.version });
    }
  });

  // 連結：一律交給主程式決定怎麼開；#錨點自己跳。
  content.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    e.preventDefault();
    var href = a.getAttribute("href");
    if (href.charAt(0) === "#") {
      var name = decodeURIComponent(href.slice(1));
      var target = document.getElementById(name) || document.getElementById(slug(name));
      if (target) target.scrollIntoView({ block: "start", behavior: "smooth" });
      return;
    }
    vscode.postMessage({ type: "openLink", href: href });
  });

  // 捲到某一行（連結帶行號、或切換狀態時對位）。quiet＝只捲不閃。
  function reveal(line, quiet) {
    var els = content.querySelectorAll("[data-ls]");
    var best = null;
    for (var i = 0; i < els.length; i++) {
      var ls = parseInt(els[i].getAttribute("data-ls"), 10);
      var le = parseInt(els[i].getAttribute("data-le"), 10);
      if (ls <= line && line < le) best = els[i];
      else if (ls > line) { if (!best) best = els[i]; break; }
    }
    if (!best) return;
    best.scrollIntoView({ block: "start" });
    if (quiet) return;
    best.classList.add("flash");
    setTimeout(function () { best.classList.remove("flash"); }, 1700);
  }

  // ---------- 與主程式的通道 ----------
  window.addEventListener("message", function (e) {
    var m = e.data || {};
    switch (m.type) {
      case "init":
        document.documentElement.style.setProperty("--md-size", (m.fontSize || 15) + "px");
        document.documentElement.style.setProperty("--md-max", m.maxWidth ? m.maxWidth + "px" : "none");
        S.baseUri = m.baseUri || "";
        setText(m.text, m.version);
        render();
        if (typeof m.reveal === "number") setTimeout(function () { reveal(m.reveal); }, 30);
        break;
      case "update":
        if (S.editing) { S.pending = { text: m.text, version: m.version }; break; }
        if (m.text === S.text) { S.version = m.version; break; }
        setText(m.text, m.version);
        if (S.mode === "source") applyExternalToSource(m.text);
        else render();
        break;
      case "reveal":
        reveal(m.line);
        break;
    }
  });
  window.addEventListener("error", function (e) {
    vscode.postMessage({ type: "error", text: String(e.message) + " @" + e.lineno });
  });

  vscode.postMessage({ type: "ready" });
})();
