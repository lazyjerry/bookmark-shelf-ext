// 進入點：唯一接 vscode 事件與註冊指令的地方。資料與判斷在 core/，畫面在 views/，互動流程在 commands/。
import * as vscode from 'vscode';

import * as bookmarks from './commands/bookmarks';
import { configureConnection, disconnect, openDeployGuide } from './commands/connection';
import type { Sort } from './core/client';
import { isSort } from './core/client';
import type { Connection } from './core/connection';
import { ConnectionStore } from './storage/connectionStore';
import { ShelfTreeProvider, VIEW_ID } from './views/shelfTreeProvider';

const SECTION = 'bookmarkShelf';
const SORT_KEY = 'bookmarkShelf.sort';
/** 側欄重新顯示時，資料超過這個時間就背景重抓（別的裝置或網頁可能改過）。 */
const STALE_MS = 60_000;

/** 整合測試用：headless 下看不到樹與通知，直接讀 provider 狀態；connect 跳過輸入框。 */
export interface BookmarkShelfApi {
  provider: ShelfTreeProvider;
  connect(connection: Connection): Promise<void>;
  disconnect(): Promise<void>;
}

function maxItems(): number {
  const value = vscode.workspace.getConfiguration(SECTION).get<number>('maxItems', 500);
  return Number.isInteger(value) ? Math.min(Math.max(value, 100), 2000) : 500;
}

export function activate(context: vscode.ExtensionContext): BookmarkShelfApi {
  const version = String((context.extension.packageJSON as { version?: unknown }).version ?? '0');
  const userAgent = `bookmark-shelf-vscode/${version}`;
  const store = new ConnectionStore(context.secrets);
  const savedSort = context.globalState.get<unknown>(SORT_KEY);
  const provider = new ShelfTreeProvider({ userAgent, maxItems, initialSort: isSort(savedSort) ? savedSort : 'created' });
  const view = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: provider, showCollapseAll: true });
  provider.attach(view);

  const deps: bookmarks.BookmarkDeps = {
    provider,
    saveSort: (sort: Sort) => context.globalState.update(SORT_KEY, sort),
  };

  // SecretStorage 是唯一來源：本視窗存檔、別的視窗改動都走 onDidChange 重新載入。
  // 存檔後指令本身與 onDidChange 都會呼叫，排成一條佇列，後到的看到連線沒變就不重抓
  let loadChain = Promise.resolve();
  const loadConnection = (): Promise<void> => {
    loadChain = loadChain.then(applyStoredConnection, applyStoredConnection);
    return loadChain;
  };
  const applyStoredConnection = async (): Promise<void> => {
    const connection = await store.load();
    const current = provider.getConnection();
    if (JSON.stringify(connection) === JSON.stringify(current) && provider.getStatus() !== 'unconfigured') {
      // 重新設定成同一組連線：上次失敗的話再試一次
      if (provider.getStatus() === 'error') {
        await provider.reload();
      }
      return;
    }
    provider.setConnection(connection);
    if (connection) {
      await provider.reload();
    }
  };

  const register = (id: string, handler: (...args: unknown[]) => unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(`${SECTION}.${id}`, handler));
  };

  register('configure', async () => {
    if (await configureConnection({ store, userAgent, current: () => provider.getConnection() })) {
      await loadConnection();
    }
  });
  register('disconnect', async () => {
    if (await disconnect(store)) {
      await loadConnection();
    }
  });
  register('openDeployGuide', () => openDeployGuide());
  register('openWebsite', () => bookmarks.openWebsite(deps));
  register('refresh', () => provider.reload());
  register('add', () => bookmarks.addBookmark(deps));
  register('addFromSelection', () => bookmarks.addBookmark(deps));
  register('search', () => bookmarks.search(deps));
  register('filterByTag', () => bookmarks.filterByTag(deps));
  register('filterBySite', () => bookmarks.filterBySite(deps));
  register('sortBy', () => bookmarks.sortBy(deps));
  register('clearFilters', () => bookmarks.clearFilters(deps));
  register('open', (arg) => bookmarks.openBookmark(deps, arg));
  register('openSharePage', (arg) => bookmarks.openSharePage(deps, arg));
  register('copyUrl', (arg) => bookmarks.copyUrl(deps, arg));
  register('copyMarkdownLink', (arg) => bookmarks.copyMarkdownLink(deps, arg));
  register('edit', (arg) => bookmarks.editBookmark(deps, arg));
  register('editField', (arg) => bookmarks.editFieldCommand(deps, arg));
  register('delete', (arg) => bookmarks.deleteBookmark(deps, arg));

  context.subscriptions.push(
    view,
    provider,
    store.onDidChange(() => {
      void loadConnection();
    }),
    view.onDidChangeVisibility((event) => {
      const status = provider.getStatus();
      if (event.visible && (status === 'ready' || status === 'empty') && provider.isStale(STALE_MS)) {
        void provider.reload();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(`${SECTION}.maxItems`)) {
        void provider.reload();
      }
    }),
  );

  void loadConnection();

  return {
    provider,
    connect: async (connection) => {
      await store.save(connection);
      await loadConnection();
    },
    disconnect: async () => {
      await store.clear();
      await loadConnection();
    },
  };
}

export function deactivate(): void {
  // 所有 disposable 都在 context.subscriptions，VS Code 會處理。
}
