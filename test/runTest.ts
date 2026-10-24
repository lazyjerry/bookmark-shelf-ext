import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
  const extensionTestsPath = path.resolve(__dirname, 'integration', 'index');
  // 專案路徑太長（含中文、雲端同步資料夾）會讓 IPC socket 超過 103 字元，改用短暫存目錄。勿移除。
  const temporaryRoot = process.platform === 'darwin' ? '/private/tmp' : os.tmpdir();
  const testProfilePath = await fs.mkdtemp(path.join(temporaryRoot, 'vsx-'));
  const workspacePath = path.join(testProfilePath, 'ws');
  await fs.mkdir(workspacePath);

  // VS Code 的整合終端機會繼承這個旗標，讓下載下來的 VS Code 以 Node 模式啟動並報 `bad option: --disable-extensions`。勿移除。
  delete process.env.ELECTRON_RUN_AS_NODE;

  try {
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      // 固定版本：不固定會每次去查最新版，離線或網路慢時卡住。
      version: '1.131.0',
      launchArgs: [
        workspacePath,
        '--disable-extensions',
        '--disable-workspace-trust',
        // SecretStorage 改用記憶體，測試不碰系統鑰匙圈（macOS 會跳授權視窗）
        '--use-inmemory-secretstorage',
        `--user-data-dir=${path.join(testProfilePath, 'u')}`,
        `--extensions-dir=${path.join(testProfilePath, 'e')}`,
      ],
    });
  } finally {
    await fs.rm(testProfilePath, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
