// 連線設定存在 SecretStorage（系統鑰匙圈）：密碼不落地成明文檔，也不進設定同步。
// SecretStorage 跨視窗共用，另一個視窗改了會觸發 onDidChange。

import type * as vscode from 'vscode';

import type { Connection } from '../core/connection';
import { parseConnection, serializeConnection } from '../core/connection';

const KEY = 'bookmarkShelf.connection';

export class ConnectionStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async load(): Promise<Connection | undefined> {
    return parseConnection(await this.secrets.get(KEY));
  }

  async save(connection: Connection): Promise<void> {
    await this.secrets.store(KEY, serializeConnection(connection));
  }

  async clear(): Promise<void> {
    await this.secrets.delete(KEY);
  }

  onDidChange(listener: () => void): vscode.Disposable {
    return this.secrets.onDidChange((event) => {
      if (event.key === KEY) {
        listener();
      }
    });
  }
}
