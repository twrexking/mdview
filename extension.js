// MD 檢視器：VS Code 的 Markdown 自訂編輯器（host 端）。
//
// 角色分工：
//   這一檔只做「開分頁、把檔案內容送進畫面、把畫面送回來的改動寫進檔案、開連結」。
//   怎麼畫、怎麼改，全在 media/view.js（畫面端）與 media/edit-core.js（純邏輯，有測試）。
//
// 三種狀態（畫面右上角那組鈕，三種狀態都在同一個分頁裡，鈕不會消失）：
//   預覽鎖住（預設）／預覽編輯（就地改字）／原始碼編輯（同一個畫面換成純文字框）。
//   另有指令「改用 VS Code 文字編輯器開」給想用一般編輯器的人；那邊的分頁標題列有一顆眼睛可以回來。
//
// 寫檔的鐵律：預覽編輯只送「第 from 行到第 to 行（不含）換成 text」，這裡照做、不碰其他行。
// 原始碼編輯送的是整份文字（使用者自己在改整份），一樣只在版本對得上時才寫。
"use strict";
const vscode = require("vscode");
const path = require("path");

const VIEW_TYPE = "mdview.editor";
const EXTERNAL_EXT = /\.(html?|pdf|png|jpe?g|gif|webp|svg|docx?|xlsx?|pptx?)$/i;

/** 每個檔案目前開著的畫面；開連結指定行號時要推給已經開著的那個。 */
const panelsByDoc = new Map();
/** 開檔之前先登記「開好後捲到第幾行」。 */
const pendingReveal = new Map();

function activate(context) {
  const provider = new MdViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, provider, {
      webviewOptions: { retainContextWhenHidden: true, enableFindWidget: true },
      supportsMultipleEditorsPerDocument: true
    }),
    vscode.commands.registerCommand("mdview.openView", openView),
    vscode.commands.registerCommand("mdview.openSource", () => {
      const panel = provider.activePanel;
      if (panel) provider.openSource(panel.document, panel.panel, 0);
    })
  );
}

/** 從文字編輯器回到檢視器：先存檔、關掉文字分頁，再用檢視器開同一檔。 */
async function openView(uri) {
  const editor = vscode.window.activeTextEditor;
  let target = uri;
  let column = vscode.ViewColumn.Active;
  let line = 0;
  if (editor && (!uri || editor.document.uri.toString() === uri.toString())) {
    target = editor.document.uri;
    column = editor.viewColumn || column;
    line = editor.visibleRanges.length ? editor.visibleRanges[0].start.line : 0;
    if (editor.document.isDirty) await editor.document.save();
    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
  }
  if (!target) return;
  pendingReveal.set(target.toString(), line);
  await vscode.commands.executeCommand("vscode.openWith", target, VIEW_TYPE, column);
}

class MdViewProvider {
  constructor(context) {
    this.context = context;
    this.activePanel = null;
  }

  async resolveCustomTextEditor(document, panel) {
    const webview = panel.webview;
    const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, "media");
    const docDir = vscode.Uri.file(path.dirname(document.uri.fsPath));
    const roots = [mediaRoot, docDir];
    for (const f of vscode.workspace.workspaceFolders || []) roots.push(f.uri);
    webview.options = { enableScripts: true, localResourceRoots: roots };
    webview.html = this.html(webview, mediaRoot);

    const key = document.uri.toString();
    const entry = { document, panel };
    if (!panelsByDoc.has(key)) panelsByDoc.set(key, new Set());
    panelsByDoc.get(key).add(entry);
    if (panel.active) this.activePanel = entry;

    const cfg = () => vscode.workspace.getConfiguration("mdview");
    const sendInit = () => {
      const line = pendingReveal.get(key);
      pendingReveal.delete(key);
      webview.postMessage({
        type: "init",
        text: document.getText(),
        version: document.version,
        baseUri: webview.asWebviewUri(docDir).toString(),
        fileName: path.basename(document.uri.fsPath),
        fontSize: cfg().get("fontSize", 15),
        maxWidth: cfg().get("maxWidth", 980),
        reveal: typeof line === "number" ? line : null
      });
    };

    const subs = [];
    subs.push(vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== key) return;
      webview.postMessage({ type: "update", text: e.document.getText(), version: e.document.version });
    }));
    subs.push(panel.onDidChangeViewState(() => { if (panel.active) this.activePanel = entry; }));
    subs.push(webview.onDidReceiveMessage(async (msg) => {
      try {
        switch (msg.type) {
          case "ready": sendInit(); break;
          case "edit": await this.applyEdit(document, webview, msg); break;
          case "replaceAll": await this.replaceAll(document, webview, msg); break;
          case "openSource": await this.openSource(document, panel, msg.line || 0); break;
          case "openLink": await this.openLink(document, msg.href, panel.viewColumn); break;
          case "error": console.error("[mdview]", msg.text); break;
        }
      } catch (err) {
        console.error("[mdview]", err);
        vscode.window.showErrorMessage("MD 檢視器：" + (err && err.message ? err.message : String(err)));
      }
    }));
    panel.onDidDispose(() => {
      subs.forEach((d) => d.dispose());
      const set = panelsByDoc.get(key);
      if (set) { set.delete(entry); if (!set.size) panelsByDoc.delete(key); }
      if (this.activePanel === entry) this.activePanel = null;
    });
  }

  /** 把畫面送回來的「第 from～to 行換成 text」寫進檔案；版本對不上就退回最新內容讓畫面重畫。 */
  async applyEdit(document, webview, msg) {
    if (msg.version !== document.version) {
      webview.postMessage({ type: "update", text: document.getText(), version: document.version });
      return;
    }
    const from = Math.max(0, msg.from | 0);
    const to = Math.min(document.lineCount, msg.to | 0);
    if (to <= from) return;
    const start = new vscode.Position(from, 0);
    let end, text;
    if (to < document.lineCount) {
      end = new vscode.Position(to, 0);
      text = msg.text + "\n";
    } else {
      end = document.lineAt(document.lineCount - 1).range.end;
      text = msg.text;
    }
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, new vscode.Range(start, end), text);
    const ok = await vscode.workspace.applyEdit(edit);
    if (ok && vscode.workspace.getConfiguration("mdview").get("autoSave", true)) {
      await document.save();
    }
  }

  /** 原始碼編輯：整份文字換掉（使用者自己在純文字框裡改的）。版本對不上就退回最新內容。 */
  async replaceAll(document, webview, msg) {
    if (msg.version !== document.version) {
      webview.postMessage({ type: "update", text: document.getText(), version: document.version });
      return;
    }
    if (typeof msg.text !== "string" || msg.text === document.getText()) return;
    const whole = new vscode.Range(new vscode.Position(0, 0), document.lineAt(document.lineCount - 1).range.end);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, whole, msg.text);
    const ok = await vscode.workspace.applyEdit(edit);
    if (ok && vscode.workspace.getConfiguration("mdview").get("autoSave", true)) {
      await document.save();
    }
  }

  /** 改用 VS Code 文字編輯器：開一般文字編輯器、捲到同一行，然後把這個檢視器分頁收掉。 */
  async openSource(document, panel, line) {
    const pos = new vscode.Position(Math.max(0, Math.min(line, document.lineCount - 1)), 0);
    await vscode.window.showTextDocument(document, {
      viewColumn: panel.viewColumn,
      selection: new vscode.Range(pos, pos),
      preview: false
    });
    panel.dispose();
  }

  /** 畫面裡的連結：網址交給系統、md 用檢視器開、其他檔案交給 VS Code 或系統預設程式。 */
  async openLink(document, href, column) {
    if (!href) return;
    if (/^https?:/i.test(href) || /^mailto:/i.test(href)) {
      await vscode.env.openExternal(vscode.Uri.parse(href));
      return;
    }
    let target = null, line = null;
    let m = /^vscode:\/\/file\/(.+?)(?::(\d+))?(?::(\d+))?$/i.exec(href);
    if (m) {
      target = vscode.Uri.file(decodeURIComponent(m[1]).replace(/^\/([a-zA-Z]:)/, "$1"));
      if (m[2]) line = parseInt(m[2], 10) - 1;
    } else if (/^file:/i.test(href)) {
      target = vscode.Uri.parse(href);
    } else if (/^[a-zA-Z]:[\\/]/.test(href)) {
      target = vscode.Uri.file(href);
    } else {
      const clean = href.split("#")[0];
      if (!clean) return;
      target = vscode.Uri.file(path.resolve(path.dirname(document.uri.fsPath), decodeURIComponent(clean)));
    }
    if (/\.(md|markdown)$/i.test(target.fsPath)) {
      const key = target.toString();
      const open = panelsByDoc.get(key);
      if (open && open.size) {
        const first = open.values().next().value;
        first.panel.reveal(undefined, false);
        if (line !== null) first.panel.webview.postMessage({ type: "reveal", line });
        return;
      }
      if (line !== null) pendingReveal.set(key, line);
      await vscode.commands.executeCommand("vscode.openWith", target, VIEW_TYPE, column);
      return;
    }
    if (EXTERNAL_EXT.test(target.fsPath)) {
      await vscode.env.openExternal(target);
      return;
    }
    await vscode.commands.executeCommand("vscode.open", target, column);
  }

  html(webview, mediaRoot) {
    const nonce = Array.from({ length: 24 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");
    const uri = (f) => webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, f));
    return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${uri("view.css")}">
<title>MD 檢視器</title>
</head>
<body class="locked">
<div id="bar">
  <button id="m-locked" class="mb on" title="預覽鎖住：只看、不會改到">${ICON.lock}</button>
  <button id="m-edit" class="mb" title="預覽編輯：點一段就能在原地改字">${ICON.pencil}</button>
  <button id="m-source" class="mb" title="原始碼編輯：直接改 markdown 原文">${ICON.code}</button>
</div>
<div id="fm" hidden></div>
<article id="content"></article>
<textarea id="src" hidden spellcheck="false" wrap="soft" aria-label="原始碼"></textarea>
<script nonce="${nonce}" src="${uri("markdown-it.min.js")}"></script>
<script nonce="${nonce}" src="${uri("turndown.js")}"></script>
<script nonce="${nonce}" src="${uri("edit-core.js")}"></script>
<script nonce="${nonce}" src="${uri("render-core.js")}"></script>
<script nonce="${nonce}" src="${uri("turndown-rules.js")}"></script>
<script nonce="${nonce}" src="${uri("view.js")}"></script>
</body>
</html>`;
  }
}

const ICON = {
  lock: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>',
  pencil: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 2.5l2 2L5 13H3v-2z"/><path d="M10 4l2 2"/></svg>',
  code: '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 4.5L2 8l3.5 3.5"/><path d="M10.5 4.5L14 8l-3.5 3.5"/><path d="M9 3L7 13"/></svg>'
};

function deactivate() {}

module.exports = { activate, deactivate };
