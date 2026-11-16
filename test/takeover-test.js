// 接手邏輯的測試：用 vscode 替身跑 extension.js 的 onTabsChanged／takeOver。
// node test/takeover-test.js
"use strict";
const assert = require("assert");
const Module = require("module");
const path = require("path");

// ---------- vscode 替身 ----------
class Uri {
  constructor(fsPath) { this.fsPath = fsPath; this.scheme = "file"; }
  static file(p) { return new Uri(p); }
  static joinPath(base, ...parts) { return new Uri(path.join(base.fsPath, ...parts)); }
  toString() { return "file:///" + this.fsPath.replace(/\\/g, "/"); }
}
class TabInputText { constructor(uri) { this.uri = uri; } }
class Position { constructor(l, c) { this.line = l; this.character = c; } }
class Range { constructor(s, e) { this.start = s; this.end = e; } }
class Selection extends Range {}

const calls = { executed: [], closed: [], posted: [] };
const config = { mdview: { takeOver: true, autoSave: true }, workbench: { editorAssociations: undefined } };
const V = {
  Uri, TabInputText, Position, Range, Selection,
  ViewColumn: { Active: -1 },
  workspace: {
    getConfiguration(section) {
      const c = config[section] || {};
      return { get: (k, d) => (c[k] === undefined ? d : c[k]) };
    },
    workspaceFolders: [],
    onDidChangeTextDocument: () => ({ dispose() {} })
  },
  window: {
    tabGroups: {
      all: [],
      onDidChangeTabs: () => ({ dispose() {} }),
      close: async (tab) => { calls.closed.push(tab); return true; }
    },
    visibleTextEditors: [],
    registerCustomEditorProvider: () => ({ dispose() {} }),
    showTextDocument: async () => ({}),
    showErrorMessage() {}
  },
  commands: {
    registerCommand: () => ({ dispose() {} }),
    executeCommand: async (...a) => { calls.executed.push(a); }
  },
  env: { openExternal: async () => {} }
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  if (req === "vscode") return "vscode-stub";
  return origResolve.call(this, req, ...rest);
};
require.cache["vscode-stub"] = { id: "vscode-stub", filename: "vscode-stub", loaded: true, exports: V };

const ext = require("../extension.js");
const T = ext.__test;

let n = 0;
async function t(name, fn) { n++; try { await fn(); console.log("  ok  " + name); } catch (e) { console.log("  FAIL " + name); throw e; } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function openTextTab(fsPath, { line = 0, dirty = false, column = 2 } = {}) {
  const uri = Uri.file(fsPath);
  const group = { viewColumn: column, tabs: [] };
  const tab = { input: new TabInputText(uri), group };
  group.tabs.push(tab);
  V.window.tabGroups.all = [group];
  V.window.visibleTextEditors = [{
    document: { uri, isDirty: dirty },
    selection: new Selection(new Position(line, 0), new Position(line, 0))
  }];
  return { uri, tab };
}
function reset() {
  calls.executed.length = 0; calls.closed.length = 0; calls.posted.length = 0;
  V.window.tabGroups.all = []; V.window.visibleTextEditors = [];
  config.mdview.takeOver = true; config.workbench.editorAssociations = undefined;
  T.panelsByDoc.clear(); T.pendingReveal.clear();
}

(async () => {
  console.log("takeover");

  await t("別的程式開的 md 文字分頁：關掉、用檢視器開、帶行號", async () => {
    reset();
    const { uri, tab } = openTextTab("C:\\docs\\a.md", { line: 41, column: 2 });
    T.onTabsChanged({ opened: [tab], closed: [], changed: [] });
    await wait(150);
    assert.strictEqual(calls.closed.length, 1);
    assert.deepStrictEqual(calls.executed[0].slice(0, 3), ["vscode.openWith", uri, T.VIEW_TYPE]);
    assert.strictEqual(calls.executed[0][3], 2);
    assert.strictEqual(T.pendingReveal.get(uri.toString()), 41);
  });

  await t("不是 md、不是磁碟檔：不碰", async () => {
    reset();
    const a = openTextTab("C:\\docs\\a.txt");
    T.onTabsChanged({ opened: [a.tab], closed: [], changed: [] });
    const u = Uri.file("C:\\docs\\b.md"); u.scheme = "untitled";
    T.onTabsChanged({ opened: [{ input: new TabInputText(u), group: { viewColumn: 1, tabs: [] } }], closed: [], changed: [] });
    await wait(150);
    assert.strictEqual(calls.closed.length, 0);
    assert.strictEqual(calls.executed.length, 0);
  });

  await t("使用者自己要文字編輯器（allowText）：不碰", async () => {
    reset();
    const { uri, tab } = openTextTab("C:\\docs\\a.md");
    T.allowText(uri, 5000);
    T.onTabsChanged({ opened: [tab], closed: [], changed: [] });
    await wait(150);
    assert.strictEqual(calls.closed.length, 0);
  });

  await t("allowText 過期後就會接手", async () => {
    reset();
    const { uri, tab } = openTextTab("C:\\docs\\a.md");
    T.allowText(uri, -1);
    T.onTabsChanged({ opened: [tab], closed: [], changed: [] });
    await wait(150);
    assert.strictEqual(calls.closed.length, 1);
  });

  await t("設定關掉：不碰", async () => {
    reset();
    config.mdview.takeOver = false;
    const { tab } = openTextTab("C:\\docs\\a.md");
    T.onTabsChanged({ opened: [tab], closed: [], changed: [] });
    await wait(150);
    assert.strictEqual(calls.closed.length, 0);
  });

  await t("使用者把 *.md 預設編輯器改成別的：不碰", async () => {
    reset();
    config.workbench.editorAssociations = { "*.md": "default" };
    const { tab } = openTextTab("C:\\docs\\a.md");
    T.onTabsChanged({ opened: [tab], closed: [], changed: [] });
    await wait(150);
    assert.strictEqual(calls.closed.length, 0);
  });

  await t("預設編輯器明寫成檢視器：照常接手", async () => {
    reset();
    config.workbench.editorAssociations = { "*.md": T.VIEW_TYPE };
    const { tab } = openTextTab("C:\\docs\\a.md");
    T.onTabsChanged({ opened: [tab], closed: [], changed: [] });
    await wait(150);
    assert.strictEqual(calls.closed.length, 1);
  });

  await t("檔案有沒存的改動：不碰（關分頁會跳存檔視窗）", async () => {
    reset();
    const { tab } = openTextTab("C:\\docs\\a.md", { dirty: true });
    T.onTabsChanged({ opened: [tab], closed: [], changed: [] });
    await wait(150);
    assert.strictEqual(calls.closed.length, 0);
  });

  await t("分頁在動手前已經不見：不開第二份", async () => {
    reset();
    const { tab } = openTextTab("C:\\docs\\a.md");
    T.onTabsChanged({ opened: [tab], closed: [], changed: [] });
    V.window.tabGroups.all = [];
    await wait(150);
    assert.strictEqual(calls.closed.length, 0);
    assert.strictEqual(calls.executed.length, 0);
  });

  await t("同一檔已經有檢視器分頁：關文字分頁、叫舊分頁出來並捲到那一行", async () => {
    reset();
    const { uri, tab } = openTextTab("C:\\docs\\a.md", { line: 7 });
    let revealed = false;
    const panel = { reveal: () => { revealed = true; }, webview: { postMessage: (m) => calls.posted.push(m) } };
    T.panelsByDoc.set(uri.toString(), new Set([{ document: {}, panel }]));
    T.onTabsChanged({ opened: [tab], closed: [], changed: [] });
    await wait(150);
    assert.strictEqual(calls.closed.length, 1);
    assert.strictEqual(revealed, true);
    assert.deepStrictEqual(calls.posted[0], { type: "reveal", line: 7 });
    assert.strictEqual(calls.executed.length, 0);
  });

  console.log(n + " 項全過");
})().catch((e) => { console.error(e); process.exit(1); });
