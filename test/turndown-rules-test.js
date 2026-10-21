// 轉回 markdown 的測試：node test/turndown-rules-test.js
// 需要 node 版 turndown（含 DOM 替身）。路徑從環境變數 MDVIEW_TURNDOWN 來；沒有就找專案的 node_modules。
"use strict";
const assert = require("assert");
const path = require("path");
const fs = require("fs");

let TurndownService = null;
const candidates = [process.env.MDVIEW_TURNDOWN, path.join(__dirname, "..", "node_modules", "turndown")].filter(Boolean);
for (const c of candidates) {
  if (fs.existsSync(c)) { TurndownService = require(c); break; }
}
if (!TurndownService) {
  console.log("turndown-rules：找不到 node 版 turndown（設 MDVIEW_TURNDOWN 指到它的資料夾），略過");
  process.exit(0);
}
const rules = require("../media/turndown-rules.js");
const td = rules.createTurndown(TurndownService);
const conv = (html) => rules.inlineMarkdown(td, html);

let n = 0;
function t(name, fn) { n++; try { fn(); console.log("  ok  " + name); } catch (e) { console.log("  FAIL " + name); throw e; } }

console.log("turndown-rules");

t("純文字原樣", () => assert.strictEqual(conv("她把手放下。"), "她把手放下。"));
t("粗體兩個星號、斜體一個", () => assert.strictEqual(conv("<strong>用途</strong>：<em>裝載</em>"), "**用途**：*裝載*"));
t("瀏覽器塞的 <b>/<i> 也一樣", () => assert.strictEqual(conv("<b>粗</b><i>斜</i>"), "**粗***斜*"));
t("不加反斜線：星號、底線、井字照打", () => assert.strictEqual(conv("a*b_c # d"), "a*b_c # d"));
t("行內程式碼", () => assert.strictEqual(conv("用 <code>node --check</code> 驗"), "用 `node --check` 驗"));
t("連結", () => assert.strictEqual(conv('看 <a href="b.md">文</a>。'), "看 [文](b.md)。"));
t("文字等於網址的連結寫成光溜溜的網址", () => assert.strictEqual(conv('<a href="https://x.y">https://x.y</a>'), "https://x.y"));
t("刪除線", () => assert.strictEqual(conv("<s>舊</s>"), "~~舊~~"));
t("圖片用原路徑", () => assert.strictEqual(conv('<img src="https://base/img/a.png" data-src="img/a.png" alt="圖">'), "![圖](img/a.png)"));
t("硬換行：<br> 變行尾兩空白", () => assert.strictEqual(conv("甲<br>乙"), "甲  \n乙"));
t("Shift+Enter 塞的 div 攤平", () => assert.strictEqual(conv("甲<div>乙</div>"), "甲  \n乙"));
t("勾選框拿掉（前綴由 edit-core 保留）", () => assert.strictEqual(conv('<input type="checkbox" class="task">待辦'), "待辦"));
t("不換行空白換成一般空白", () => assert.strictEqual(conv("a&nbsp;b"), "a b"));

console.log(n + " 項全過");
