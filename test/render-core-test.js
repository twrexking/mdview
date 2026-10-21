// 畫面純邏輯的測試：用一份長得像使用者文件的樣本，驗每個區塊的行號、可改標記、待辦框、圖片路徑。
// node test/render-core-test.js
"use strict";
const assert = require("assert");
const markdownit = require("../media/markdown-it.min.js");
const rc = require("../media/render-core.js");

let n = 0;
function t(name, fn) { n++; try { fn(); console.log("  ok  " + name); } catch (e) { console.log("  FAIL " + name); throw e; } }

console.log("render-core");

const state = { base: "https://base" };
const md = rc.createMd(markdownit, { baseUri: () => state.base });

const sample = [
  "# 角色靈魂（重建版）",            // 0
  "",                                // 1
  "> **用途**：裝載後你就是她。",     // 2
  "> 第二行。",                      // 3
  "",                                // 4
  "## §0　定位表",                   // 5
  "",                                // 6
  "| 任務時點 | 層 |",               // 7
  "|---|---|",                       // 8
  "| 雷諾大宅 | **L1** |",           // 9
  "| 青草村 | L2 |",                 // 10
  "",                                // 11
  "- 第一項",                        // 12
  "- [ ] 待辦",                      // 13
  "  - 巢狀",                        // 14
  "",                                // 15
  "```js",                           // 16
  "code",                            // 17
  "```",                             // 18
  "",                                // 19
  "![圖](img/a.png)",                // 20
  "",                                // 21
  "底線標題",                        // 22
  "----",                            // 23
  "",                                // 24
  "看 https://example.com 與 [文](b.md)。" // 25
].join("\n");

const html = md.render(sample);

function attrs(tag, cls) {
  const re = new RegExp("<" + tag + "(\\s[^>]*)?>", "g");
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    const a = m[1] || "";
    const get = (k) => { const mm = new RegExp(k + '="([^"]*)"').exec(a); return mm ? mm[1] : null; };
    if (cls && !(get("class") || "").split(" ").includes(cls)) continue;
    out.push({ ls: get("data-ls"), le: get("data-le"), cls: get("class"), id: get("id"), setext: get("data-setext") });
  }
  return out;
}

t("標題帶起訖行與 ed、有 id", () => {
  const h = attrs("h1");
  assert.deepStrictEqual([h[0].ls, h[0].le], ["0", "1"]);
  assert.ok(h[0].cls.includes("ed"));
  assert.strictEqual(h[0].id, "角色靈魂重建版");
});
t("引言裡跨兩行的段落：行號 2～4", () => {
  const p = attrs("p").find((x) => x.ls === "2");
  assert.ok(p, "找不到引言段落");
  assert.strictEqual(p.le, "4");
  assert.ok(p.cls.includes("ed"));
});
t("表格列帶行號（表頭 7、第一列資料 9、第二列 10），格子標 ed", () => {
  const rows = attrs("tr");
  assert.deepStrictEqual(rows.map((r) => r.ls), ["7", "9", "10"]);
  assert.ok(attrs("td").every((c) => c.cls.includes("ed")));
  assert.ok(attrs("th").every((c) => c.cls.includes("ed")));
});
t("緊湊條列的段落也畫出 <p class=tight ed> 並帶行號", () => {
  const p = attrs("p", "tight");
  assert.ok(p.length >= 3, "緊湊段落數：" + p.length);
  assert.deepStrictEqual(p.map((x) => x.ls), ["12", "13", "14"]);
  assert.ok(p.every((x) => x.cls.includes("ed")));
});
t("待辦項畫成勾選框、條列項標 task", () => {
  assert.ok(/<li [^>]*class="task"[^>]*>/.test(html));
  assert.ok(/<input type="checkbox" class="task">待辦/.test(html));
});
t("程式碼區塊標 nope、不標 ed", () => {
  const c = attrs("code", "nope");
  assert.strictEqual(c.length, 1);
  assert.deepStrictEqual([c[0].ls, c[0].le], ["16", "19"]);
  assert.ok(!c[0].cls.includes("ed"));
});
t("圖片：相對路徑接上 baseUri、原路徑留在 data-src", () => {
  assert.ok(html.includes('src="https://base/img/a.png"'));
  assert.ok(html.includes('data-src="img/a.png"'));
});
t("底線式標題標 data-setext、行號 22～24", () => {
  const h = attrs("h2").find((x) => x.ls === "22");
  assert.ok(h);
  assert.strictEqual(h.le, "24");
  assert.strictEqual(h.setext, "1");
});
t("光溜溜的網址變連結", () => {
  assert.ok(html.includes('<a href="https://example.com">https://example.com</a>'));
});
t("設定區換成 3 行空行後，標題的行號是 3", () => {
  const h2 = md.render("\n\n\n# 標");
  assert.ok(h2.includes('data-ls="3"'));
});

console.log(n + " 項全過");
