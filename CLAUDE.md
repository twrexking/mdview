# MD 檢視器（mdview）

VS Code 擴充：Markdown 檔點開就是畫面，三種狀態（預覽鎖住／預覽編輯／原始碼編輯）。
功能說明、檔案地圖、版本紀錄在 `README.md`（公開文件，用 UX 文案的口吻寫給一般使用者，不寫開發過程）。
本檔記「為什麼這樣做」，給下一個動這份程式的人。

## 設計上的三條鐵律

1. **沒碰的段落一個字都不動。** 這些 md 檔同時被人和 AI 讀寫；整份重排（Vditor／Milkdown／CKEditor 那類
   所見即所得編輯器的做法）會讓兩邊讀到不同東西。所以預覽編輯寫檔只有一種訊息：「第 from～to 行換成 text」，
   主程式照做、不經手其他行。原始碼編輯送整份文字，因為那時使用者就是在改整份。
2. **每次打開都是鎖住。** 大部分時間只看、偶爾改幾個字，鎖住是防手滑。
3. **三顆鈕永遠在同一個位置。** 原始碼編輯也留在同一個分頁裡（純文字框），不換成 VS Code 的文字編輯器：
   換過去鈕就不見了，使用者找不到回來的路（0.1.0 實際踩到）。想用真正的文字編輯器另有指令。

## 為什麼要「接手」別的程式開的 md（0.3.0）

VS Code 的 `workbench.editorAssociations` 只管使用者自己點開的檔；擴充程式呼叫 `showTextDocument`
一律開文字編輯器。官方 Claude Code 擴充的開檔（面板裡點連結的 `open_file`）就是這樣寫的，
所以對話裡點 md 連結永遠是原始碼。修在這邊而不是修在轉交連結的那一層：這裡一次擋住所有來源，
而且不用動別的擴充。做法與不接手的四種情況寫在 `extension.js` 接手那段的註解。

## 為什麼獨立一個擴充

它跟任何對官方擴充打補丁的工具無關，獨立做才不會被別人的發版流程綁住、出事也不連累別的功能。

## 改字怎麼轉回 markdown（會踩的地方）

- 可改單位是 `p`／`h1~h6`／`td`／`th`，各帶 `data-ls`／`data-le`（markdown-it 的 `token.map`）。
  檔案開頭的設定區由畫面端換成等量空行再丟給 markdown-it，所以行號天生對得上，不要再另外加位移（0.1.0 踩過：加了兩次）。
- 緊湊條列裡被 markdown-it 藏掉的段落（`hidden`）被強制畫出 `<p class="tight">`，才有東西可點。
- 表格格子沒有自己的 `map`，可改標記要在「沒行號就跳過」之前打上；行號由畫面端從 `<tr>` 補。
- turndown 的 `escape` 覆寫成原樣回傳：使用者打 `*` 就寫 `*`，不替她加反斜線。
- 前綴（`> `、`- `、`1. `、`[ ] `、`## `）從那一段的第一行用 `PREFIX_RE` 切出來保留；
  續行的前綴把記號換成等寬空白（引言的 `>` 留著）。
- 版本號對不上（改的當下檔案被別處改了）就不寫，退回最新內容重畫。

## 開工與發版

- 純邏輯只進 `media/*-core.js`／`turndown-rules.js`，改了就補 `test/`；`build.ps1` 會先跑 `test/run-all.js` 與 `node --check`。
  轉回 markdown 的測試需要 node 版 turndown，路徑放環境變數 `MDVIEW_TURNDOWN`（沒有就略過那支）。
- 發版：改 `package.json` 版號 → `build.ps1` → `code --install-extension mdview-<版號>.vsix --force` → 重新載入視窗
  → README 版本紀錄 → commit＋push（vsix 一起提交：repo 收 `mdview-<版號>.vsix`，舊版的刪掉只留最新一包；別台電腦的安裝腳本從 clone 裡拿版號最大的那包裝）。
- `.ps1` 含中文要存成 UTF-8 with BOM，不然 PowerShell 5.1 會讀壞（0.1.0 踩到）。
- 新增檔案要加進 `build.ps1` 的白名單。
- 不用截圖驗畫面：驗 `node --check`、測試、class 與 CSS 對照；畫面長怎樣交給使用者看。
- 介面不做 AI 風：引文不用彩色左邊線、圓角 6px 以內、不加表情符號、不用漸層與光暈、動畫只留有功能的。

## 定位重估（2026-10-22）

- **VS Code 1.131 起內建 Markdown Editor**（viewType `vscode.markdown.editor`，在 `markdown-language-features` 裡，原始碼隨附於 `markdown-editor-src/`，
  引擎是微軟發的 npm `@vscode/markdown-editor`，MIT，2026-10 仍是 0.0.2 預覽）。它的模型就是 markdown 原文字串，每次變動用 `computeTextEdit`
  算前後綴最小差寫回——**鐵律一它也守，而且是字元級、比本專案的段落級更細**。鎖定模式 `markdown.editor.toggleLocked`（mac cmd+E）對應鐵律二。
  1.143 **沒有字級設定**：provider 只讀 `highlightActiveBlock`／`experimental.richLinks.enabled`／`preview.openMarkdownLinks`，
  樣式寫 `var(--markdown-font-size, 14px)` 但編輯器樣板不注入那個變數（只有舊預覽注入），`markdown.styles` 也只對預覽生效；樣式只跟 VS Code 主題。
- **第三方**：concretios/markdown-for-humans（Tiptap＋turndown；0.4.1 起沒改的區塊保留原文、改過的區塊重寫成標準形、`\*` 會掉、部分 HTML 會丟；
  有字型／字級／行高設定；`priority: option`）。Vditor 系（cweijan/vscode-office、zaaack）與 Milkdown 系整份重寫，與鐵律一相衝，不考慮。
  SeardnaSchmid/markdown-inline-editor-vscode 走文字編輯器 decorations、完全不改檔，是另一種路線。
- **本機現況**：`workbench.editorAssociations` 的 `*.md` 指到 `markdownForHumans.editor`；本專案未安裝。
- **先擱置**。主需求（在 VS Code 裡像文章一樣看與改 md）內建版＋Markdown for Humans 已涵蓋。回頭做的觸發條件：內建的 14px 太小而 Humans 的標準化改寫不能接受。
- **若要續做，先做這四件**：①`priority` 改 `option`，不接管所有 .md，跟上面兩個並存；②補 mac 打包腳本（現在只有 `build.ps1`）；
  ③寫檔改成字元級 diff（學內建的 `computeTextEdit`），段落級對映（`token.map`、表格自補行號）的坑就不用再踩；
  ④差異化只剩：預設鎖住、三顆鈕固定位置、`mdview.fontSize`、中文介面。
- 查證方式與出處（release notes 版本、`gh api` 星數、原始碼行）：myharness `docs/dev-log/2026-10-22.md` §2。
