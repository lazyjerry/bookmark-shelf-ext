# 開發指南

## 需求

- Node.js 22+
- macOS（`scripts/make-icon.sh` 依賴 sips；其他平台可略過）

## 常用指令

| 指令 | 說明 |
|---|---|
| `npm run build` | typecheck（tsc --noEmit）+ esbuild bundle 到 `out/extension.js` |
| `npm run lint` | eslint flat config |
| `npm run test:unit` | tsc 編譯後以 mocha 跑 `test/unit/`（純 Node，不開 VS Code） |
| `npm run test:integration` | 下載測試用 VS Code 跑 `test/integration/`，會在暫存目錄建工作區 |
| `npm run check` | lint + build + 全部測試 |
| `npm run package:vsix` | check 後以 vsce 打包（`--no-dependencies`，extension 已 bundle） |
| `./scripts/install-local.sh` | 打包並安裝到本機 VS Code（`--fast` 跳過 lint 與測試，`--all-profiles` 裝到所有 profile） |
| `./scripts/publish.sh patch\|minor\|major` / `./scripts/publish.sh` | 升版、發布到 Marketplace |

## 結構原則

- `src/core/` 是純 Node 純函式，**絕不 import vscode**——單元測試靠它。
- `src/extension.ts` 是唯一接 vscode 事件與註冊指令的地方；`activate()` 回傳的 API 讓整合測試直接讀狀態。
- 執行期沒有相依套件；需要第三方套件時由 esbuild 打進 bundle，放 devDependencies。
- `src/views/` 放 TreeDataProvider 與載入狀態，`src/commands/` 放輸入框、QuickPick 這類互動流程，`src/storage/` 只包 SecretStorage。
- API client（`src/core/client.ts`）的 fetch 由外部注入，單元測試用假的 fetch；整合測試在 `127.0.0.1` 起一個假伺服器，不連真的書籤收藏櫃。
- 伺服器回應與指令參數一律當不可信資料逐欄驗證（`parseBookmark`、`bookmarkFromArg`）。

## 雙語文字

- `package.json` 內的說明一律寫 `%bookmarkShelf.<key>%` 佔位，文字放 `package.nls.json`（英文，fallback）與 `package.nls.zh-tw.json`（繁中）。
- 程式裡給使用者看的字串一律 `vscode.l10n.t('English text')`，翻譯放 `l10n/bundle.l10n.zh-tw.json`；`l10n/bundle.l10n.json` 是英文 key 對自己。
- `test/unit/nls.test.ts` 會驗這四份檔案與 `package.json`、`src/` 的 key 集合一致，漏翻或留下沒用到的 key 都會失敗。

## 環境注意事項

- 整合測試噴 `bad option: --disable-extensions` = 環境繼承了 `ELECTRON_RUN_AS_NODE`；`test/runTest.ts` 已處理，勿移除。
- 整合測試 `listen EINVAL ...main.sock` = 專案路徑太長；`test/runTest.ts` 已改用短路徑的 `--user-data-dir`，勿移除。
- 測試跑的是 `out/` 下的 tsc 產物，改完 code 要先編譯（`npm run test:unit` 已包含）。
- 整合測試以 `--use-inmemory-secretstorage` 啟動，SecretStorage 不碰系統鑰匙圈；勿移除，否則 macOS 會跳鑰匙圈授權視窗。
