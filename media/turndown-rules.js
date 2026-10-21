// 把改過的那一格 HTML 轉回 markdown 內文：turndown 的設定（畫面端與 node 測試共用）。
//
// 原則：你打什麼就寫什麼。不替你加反斜線；粗體 **、斜體 *、刪除線 ~~、連結 [字](網址)；
// 文字跟網址一樣的連結寫成光溜溜的網址（跟原本一樣）；圖片用原本的路徑（data-src）。
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MdTurndown = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function createTurndown(TurndownService) {
    var td = new TurndownService({
      headingStyle: "atx", hr: "---", bulletListMarker: "-", codeBlockStyle: "fenced",
      emDelimiter: "*", strongDelimiter: "**", linkStyle: "inlined", br: "  "
    });
    td.escape = function (s) { return s; };
    td.addRule("strike", { filter: ["s", "del", "strike"], replacement: function (c) { return "~~" + c + "~~"; } });
    td.addRule("mark", { filter: "mark", replacement: function (c) { return "==" + c + "=="; } });
    td.addRule("bareLink", {
      filter: function (node) {
        return node.nodeName === "A" && !!node.getAttribute("href") && node.textContent === node.getAttribute("href");
      },
      replacement: function (c, node) { return node.getAttribute("href"); }
    });
    td.addRule("imgKeep", {
      filter: "img",
      replacement: function (c, node) {
        var src = node.getAttribute("data-src") || node.getAttribute("src") || "";
        var alt = node.getAttribute("alt") || "";
        var title = node.getAttribute("title");
        return "![" + alt + "](" + src + (title ? ' "' + title + '"' : "") + ")";
      }
    });
    td.addRule("taskBox", { filter: function (n) { return n.nodeName === "INPUT"; }, replacement: function () { return ""; } });
    return td;
  }

  // 一格的 innerHTML → markdown 內文。contenteditable 按 Shift+Enter 之後瀏覽器會塞 <div>，先攤平成 <br>。
  function inlineMarkdown(td, html) {
    html = String(html)
      .replace(/<div><br><\/div>/gi, "<br>")
      .replace(/<div>/gi, "<br>")
      .replace(/<\/div>/gi, "");
    var out = td.turndown(html);
    return out.replace(/ /g, " ").replace(/[ \t]+\n/g, "  \n").trim();
  }

  return { createTurndown: createTurndown, inlineMarkdown: inlineMarkdown };
});
