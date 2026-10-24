# Bookmark Shelf

在 VS Code 側邊欄瀏覽、搜尋、新增與編輯[書籤收藏櫃](https://github.com/lazyjerry/bookmark-shelf)的書籤。透過書籤收藏櫃的 API 與「應用程式帳密」操作，書籤仍存在你自己部署的 Cloudflare Worker 與 D1。

原始碼與問題回報：<https://github.com/lazyjerry/bookmark-shelf-ext>

## 功能

- **側邊欄書籤樹**：活動列的書架圖示開啟。書籤依分類分組（書籤多的分類在前，未分類在最後），展開書籤看網址、標題、摘要、分類、標籤、備註、中轉頁與新增時間、點擊次數。
- **首次設定引導**：尚未設定連線時，側邊欄顯示部署步驟、書籤收藏櫃的 GitHub 網址與一鍵部署連結；按「設定連線」依序輸入網域、應用程式帳號、密碼，連線測試通過才儲存。
- **新增書籤**：輸入網址後由伺服器自動抓取網頁，以 AI 產生標題、摘要、分類與標籤。輸入框預先帶入編輯器選取文字或剪貼簿裡的網址；編輯器右鍵也有「將選取的網址加入書籤收藏櫃」。網址已收藏過時可直接跳到那一筆。
- **編輯**：點細節列（標題、摘要、分類、標籤、備註）直接修改；書籤列的鉛筆圖示先選欄位再修改。分類可從既有分類挑選或輸入新分類。
- **刪除**：書籤列的垃圾桶圖示，確認後從伺服器刪除。
- **搜尋與篩選**：關鍵字搜尋、依標籤或網站篩選，排序可選最新建立、最近點擊、點擊最多；篩選條件顯示在側邊欄標題列。
- **開啟與複製**：在瀏覽器開啟原網址或中轉頁 `/b/<share_id>`，複製網址或 Markdown 連結。

## 使用方式

1. 在 Marketplace 搜尋「Bookmark Shelf」（發行者 `workjerry`）安裝。離線環境可改用 Release 附的 `bookmark-shelf-<版本>.vsix`：`code --install-extension bookmark-shelf-<版本>.vsix`。
2. 部署書籤收藏櫃（已部署可跳過）：
   1. 開啟 <https://github.com/lazyjerry/bookmark-shelf>，按「Deploy to Cloudflare」一鍵部署，過程中設定 `AUTH_PASS`（登入密碼）。手動部署與自訂網域見該 repo README 的〈部署〉。
   2. 用瀏覽器登入部署好的網站，到「設定」→「應用程式帳密」，輸入目前密碼與名稱（例如「VS Code」）後按「建立帳密」。
   3. 複製帳號（`app-` 開頭）與密碼。**密碼只會顯示這一次**，遺失時刪除該組帳密再重建。
3. 點活動列的書架圖示，按「設定連線」，依序輸入：
   - 網域：例如 `bookmark-shelf.<帳號>.workers.dev` 或自訂網域；沒寫協定會補 `https://`，貼上任何頁面網址都只取網域。
   - 帳號、密碼：上一步建立的應用程式帳密。
4. 連線成功後書籤會依分類列出。之後要換網域或帳密，從側邊欄標題列的「⋯」選「設定連線…」。

### 指令

| 指令 | 說明 |
|---|---|
| `bookmarkShelf.configure` | 設定連線：輸入網域、帳號、密碼並測試 |
| `bookmarkShelf.disconnect` | 從這台電腦清除已儲存的連線設定（伺服器上的帳密不受影響） |
| `bookmarkShelf.openDeployGuide` | 在瀏覽器開啟書籤收藏櫃的部署說明 |
| `bookmarkShelf.openWebsite` | 在瀏覽器開啟書籤收藏櫃網站 |
| `bookmarkShelf.refresh` | 重新載入書籤 |
| `bookmarkShelf.add` | 新增書籤 |
| `bookmarkShelf.addFromSelection` | 編輯器右鍵：將選取的網址加入書籤收藏櫃 |
| `bookmarkShelf.search` | 關鍵字搜尋，留空清除 |
| `bookmarkShelf.filterByTag` | 依標籤篩選 |
| `bookmarkShelf.filterBySite` | 依網站篩選 |
| `bookmarkShelf.sortBy` | 排序方式：最新建立、最近點擊、點擊最多 |
| `bookmarkShelf.clearFilters` | 清除搜尋與篩選（保留排序） |
| `bookmarkShelf.open` | 書籤列：在瀏覽器開啟原網址 |
| `bookmarkShelf.openSharePage` | 書籤列右鍵：開啟中轉頁 |
| `bookmarkShelf.copyUrl` | 書籤列右鍵：複製網址 |
| `bookmarkShelf.copyMarkdownLink` | 書籤列右鍵：複製 `[標題](網址)` |
| `bookmarkShelf.edit` | 書籤列：選欄位後編輯 |
| `bookmarkShelf.delete` | 書籤列：刪除（需確認） |

### 設定

| 設定 | 預設 | 說明 |
|---|---|---|
| `bookmarkShelf.maxItems` | `500` | 側邊欄最多載入的書籤數（100–2000）。每次請求取 100 筆，在本機依分類分組。超過時側邊欄會提示，請用搜尋或篩選縮小範圍。 |

## 限制

- 書籤一次載入到上限後在本機分組，不會無限捲動；書籤很多時請用搜尋或篩選。
- 摘要與備註的輸入框只有一行：換行請輸入 `\n`，反斜線本身輸入 `\\`。
- 從側邊欄開啟原網址是直接開，不經過網站的 `/go/<id>`，所以**不會增加點擊次數**（應用程式帳密只能呼叫書籤 API）。
- 網頁上或其他裝置的變更不會即時出現；側邊欄重新顯示且資料超過一分鐘時會自動重抓，或按「重新整理」。
- 新增書籤時抓取網頁與 AI 摘要通常要數秒，最長等 90 秒。

## 安全

- **連線設定存在系統鑰匙圈**（VS Code SecretStorage）：網域、帳號、密碼整組保存，不寫進設定檔、不跟著設定同步。網域刻意不做成設定項，避免工作區的 `.vscode/settings.json` 把帳密導到別的主機。
- **建議使用應用程式帳密**：只能讀寫書籤，外流時在網站設定頁刪掉那一組即可。輸入的帳號不是 `app-` 開頭（多半是權限完整的登入帳密）時會先警告。
- 只接受 https；http 只允許 `localhost`／`127.0.0.1`（本機 `wrangler dev`）。網址裡含帳密直接拒絕。
- 不跟隨伺服器轉址，避免帳密被送到別的主機。
- 書籤內容來自網頁與 AI，一律當純文字顯示；只開啟 http(s) 連結。
- 每次呼叫都帶 `User-Agent: bookmark-shelf-vscode/<版本>`，在網站「應用程式帳密」的呼叫紀錄可以辨認。
- 不讀取工作區檔案、不執行外部程式，受限模式（Restricted Mode）下照常可用。

## 專案結構

```
src/
  extension.ts                 進入點：註冊指令、接 vscode 事件
  core/                        純 Node 邏輯，不 import vscode
    connection.ts              網域正規化、帳密驗證、Basic Auth
    bookmark.ts                書籤解析、分組、編輯輸入轉換、網址檢查
    client.ts                  書籤 API client（逐頁載入、錯誤分類、不跟隨轉址）
  storage/connectionStore.ts   連線設定存取（SecretStorage）
  views/shelfTreeProvider.ts   側邊欄書籤樹與載入狀態
  commands/                    設定連線、新增、編輯、刪除、篩選等互動流程
  messages.ts                  錯誤說明與通知前綴
resources/                     Marketplace 圖示與側邊欄圖示
l10n/                          程式字串翻譯（英文 fallback + zh-tw）
package.nls*.json              package.json 內顯示文字的翻譯
test/unit/                     mocha 單元測試（純 Node）
test/integration/              以 @vscode/test-electron 跑的整合測試（本機假伺服器）
```

## 開發

見 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 授權

Apache-2.0，見 [LICENSE](LICENSE)。
