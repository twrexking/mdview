// 改字純邏輯的測試：node test/edit-core-test.js
"use strict";
const assert = require("assert");
const core = require("../media/edit-core.js");

let n = 0;
function t(name, fn) { n++; try { fn(); console.log("  ok  " + name); } catch (e) { console.log("  FAIL " + name); throw e; } }

console.log("edit-core");

t("前綴：一般段落沒有前綴", () => {
  assert.deepStrictEqual(core.splitPrefix("她把手放下。"), { prefix: "", rest: "她把手放下。" });
});
t("前綴：標題", () => {
  assert.deepStrictEqual(core.splitPrefix("## §0　定位表"), { prefix: "## ", rest: "§0　定位表" });
});
t("前綴：引言＋粗體內文", () => {
  assert.deepStrictEqual(core.splitPrefix("> **用途**：裝載後你就是她。"), { prefix: "> ", rest: "**用途**：裝載後你就是她。" });
});
t("前綴：條列（縮排兩格）", () => {
  assert.deepStrictEqual(core.splitPrefix("  - 第二層"), { prefix: "  - ", rest: "第二層" });
});
t("前綴：有序條列與待辦", () => {
  assert.deepStrictEqual(core.splitPrefix("1. [x] 做完了"), { prefix: "1. [x] ", rest: "做完了" });
});
t("前綴：段落開頭的方括號不是待辦", () => {
  assert.deepStrictEqual(core.splitPrefix("[x] 不是待辦"), { prefix: "", rest: "[x] 不是待辦" });
});
t("前綴：#字沒接空白不是標題", () => {
  assert.deepStrictEqual(core.splitPrefix("#hashtag 文字"), { prefix: "", rest: "#hashtag 文字" });
});
t("前綴：條列裡的標題", () => {
  assert.deepStrictEqual(core.splitPrefix("- ## 小標"), { prefix: "- ## ", rest: "小標" });
});

t("改字：段落只換內文", () => {
  assert.strictEqual(core.blockSource(["舊的字。"], "新的字。"), "新的字。");
});
t("改字：引言裡的段落保留 >", () => {
  assert.strictEqual(core.blockSource(["> 舊的"], "新的 **粗**"), "> 新的 **粗**");
});
t("改字：條列項的續行縮排對齊", () => {
  assert.strictEqual(core.blockSource(["- 一行"], "第一行  \n第二行"), "- 第一行  \n  第二行");
});
t("改字：引言裡的條列續行保留 > 並縮排", () => {
  assert.strictEqual(core.blockSource(["> - 一行"], "甲  \n乙"), "> - 甲  \n>   乙");
});
t("改字：標題不能換行，換行變空白", () => {
  assert.strictEqual(core.blockSource(["## 舊標"], "新\n標"), "## 新 標");
});
t("改字：底線式標題保留底線", () => {
  assert.strictEqual(core.blockSource(["舊標", "===="], "新標", { setext: true }), "新標\n====");
});
t("改字：原本硬換行的段落併成一行＋硬換行照內文", () => {
  assert.strictEqual(core.blockSource(["第一行", "第二行"], "合併後"), "合併後");
});
t("改字：結尾空白去掉", () => {
  assert.strictEqual(core.blockSource(["x"], "y   \n\n"), "y");
});

t("表格：拆格子（有頭尾直線）", () => {
  const r = core.splitCells("| 甲 | 乙 | 丙 |");
  assert.strictEqual(r.cells.length, 3);
  assert.strictEqual(r.leading, true);
  assert.strictEqual(r.trailing, true);
});
t("表格：換第二格，其他格原樣", () => {
  assert.strictEqual(core.replaceCell("| 甲 | 乙 | 丙 |", 1, "新乙"), "| 甲 | 新乙 | 丙 |");
});
t("表格：沒有頭尾直線也能換", () => {
  assert.strictEqual(core.replaceCell("甲 | 乙 | 丙", 2, "新丙"), "甲 | 乙 | 新丙 ");
});
t("表格：格內的直線跳過、新字的直線加反斜線", () => {
  assert.strictEqual(core.replaceCell("| a \\| b | c |", 1, "x|y"), "| a \\| b | x\\|y |");
});
t("表格：第一格", () => {
  assert.strictEqual(core.replaceCell("| 雷諾大宅 | **L1** |", 0, "雷諾大宅、鑑賞會"), "| 雷諾大宅、鑑賞會 | **L1** |");
});
t("表格：格子編號超出範圍不動", () => {
  assert.strictEqual(core.replaceCell("| a | b |", 5, "x"), "| a | b |");
});

t("待辦：勾起來", () => {
  assert.strictEqual(core.toggleTask("- [ ] 買菜", true), "- [x] 買菜");
});
t("待辦：取消勾選（縮排與有序）", () => {
  assert.strictEqual(core.toggleTask("  2. [X] 做完", false), "  2. [ ] 做完");
});
t("待辦：不是待辦的行不動", () => {
  assert.strictEqual(core.toggleTask("- 一般條列 [x]", true), "- 一般條列 [x]");
});

t("設定區：有就算行數", () => {
  assert.strictEqual(core.frontMatterLines("---\nname: x\n---\n# 標題"), 3);
});
t("設定區：沒有就是 0", () => {
  assert.strictEqual(core.frontMatterLines("# 標題\n---\n"), 0);
});
t("設定區：沒關起來就是 0", () => {
  assert.strictEqual(core.frontMatterLines("---\nname: x\n# 標題"), 0);
});

console.log(n + " 項全過");
