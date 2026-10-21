// 畫面的純邏輯：把 markdown-it 設定成「每個區塊都帶起訖行、可改的單位標 ed、不可改的標 nope」。
// 畫面端（view.js）與 node 測試共用；這裡不碰 DOM。
//
//   createMd(markdownit, env)
//     markdownit：markdown-it 的建構函式
//     env.baseUri()：圖片相對路徑要接在哪個位址後面
//   行號直接用 markdown-it 的 token.map；檔案開頭的設定區由畫面端換成等量空行，所以行號天生對得上。
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MdRenderCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var EDITABLE_OPEN = { paragraph_open: 1, heading_open: 1, th_open: 1, td_open: 1 };
  var SELF_CLOSING_BLOCK = { fence: 1, code_block: 1, html_block: 1, hr: 1 };
  var NOPE = { fence: 1, code_block: 1, html_block: 1 };

  function slug(s) {
    return String(s).trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s+/g, "-");
  }

  function createMd(markdownit, env) {
    var md = markdownit({ html: true, linkify: true, breaks: false, typographer: false });

    md.core.ruler.push("mdview_lines", function (state) {
      var toks = state.tokens;
      for (var i = 0; i < toks.length; i++) {
        var t = toks[i];
        // 緊湊條列裡被藏起來的段落也畫出 <p>，才有東西可以點。
        if (t.type === "paragraph_open" && t.hidden) {
          t.hidden = false;
          var j = i + 1;
          while (j < toks.length && toks[j].type !== "paragraph_close") j++;
          if (j < toks.length) toks[j].hidden = false;
          t.attrJoin("class", "tight");
        }
        // 表格的格子沒有自己的行號（畫面端從那一列補），但一樣要標成可改。
        if (EDITABLE_OPEN[t.type]) t.attrJoin("class", "ed");
        if (NOPE[t.type]) t.attrJoin("class", "nope");
        if (!t.map) continue;
        if (t.nesting === 1 || SELF_CLOSING_BLOCK[t.type]) {
          t.attrSet("data-ls", String(t.map[0]));
          t.attrSet("data-le", String(t.map[1]));
        }
        if (t.type === "heading_open" && (t.markup === "=" || t.markup === "-")) t.attrSet("data-setext", "1");
      }
    });

    // 待辦勾選框：條列項開頭的 [ ]／[x] 畫成勾選框。
    md.core.ruler.push("mdview_tasks", function (state) {
      var toks = state.tokens;
      for (var i = 2; i < toks.length; i++) {
        if (toks[i].type !== "inline" || !toks[i].children || !toks[i].children.length) continue;
        if (toks[i - 1].type !== "paragraph_open" || toks[i - 2].type !== "list_item_open") continue;
        var first = toks[i].children[0];
        if (first.type !== "text") continue;
        var m = /^\[([ xX])\][ \t]+/.exec(first.content);
        if (!m) continue;
        first.content = first.content.slice(m[0].length);
        var cb = new state.Token("html_inline", "", 0);
        cb.content = '<input type="checkbox" class="task"' + (m[1] === " " ? "" : " checked") + ">";
        toks[i].children.unshift(cb);
        toks[i - 2].attrJoin("class", "task");
      }
    });

    // 圖片：相對路徑改指到畫面讀得到的位址，原路徑留在 data-src 給轉回 markdown 時用。
    var defaultImage = md.renderer.rules.image;
    md.renderer.rules.image = function (tokens, idx, options, envx, self) {
      var t = tokens[idx];
      var src = t.attrGet("src") || "";
      t.attrSet("data-src", src);
      if (src && !/^(https?:|data:|vscode-|file:)/i.test(src)) {
        t.attrSet("src", env.baseUri() + "/" + src.replace(/^\.\//, ""));
      }
      return defaultImage(tokens, idx, options, envx, self);
    };

    // 標題加 id，讓 #錨點 連結能跳。
    md.renderer.rules.heading_open = function (tokens, idx, options, envx, self) {
      var inline = tokens[idx + 1];
      tokens[idx].attrSet("id", slug(inline && inline.content ? inline.content : ""));
      return self.renderToken(tokens, idx, options);
    };

    return md;
  }

  return { createMd: createMd, slug: slug };
});
