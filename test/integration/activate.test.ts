import * as assert from 'node:assert/strict';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

import * as vscode from 'vscode';

import type { BookmarkShelfApi } from '../../src/extension';
import type { ShelfNode } from '../../src/views/shelfTreeProvider';

const EXTENSION_ID = 'workjerry.bookmark-shelf';
const USERNAME = 'app-0123456789ab';
const PASSWORD = 'test-password';

async function getApi(): Promise<BookmarkShelfApi> {
  const extension = vscode.extensions.getExtension(EXTENSION_ID);
  assert.ok(extension, `找不到延伸模組 ${EXTENSION_ID}`);
  return (await extension.activate()) as BookmarkShelfApi;
}

/** 書籤收藏櫃 API 的最小替身：只實作側欄用到的 GET /api/bookmarks，帳密錯回 401 純文字。 */
function startServer(): Promise<{ server: http.Server; baseUrl: string; requests: string[] }> {
  const items = [
    { id: 1, url: 'https://github.com/honojs/hono', title: 'Hono', category: '工具', tags: ['hono'], site: 'GitHub', host: 'github.com', share_id: 's1' },
    { id: 2, url: 'https://excalidraw.com', title: 'Excalidraw', category: '工具', tags: [], site: 'excalidraw.com', host: 'excalidraw.com', share_id: 's2' },
    { id: 3, url: 'https://example.com/read', title: '某篇文章', category: '', tags: [], site: 'example.com', host: 'example.com', share_id: 's3' },
  ];
  const requests: string[] = [];
  const expected = `Basic ${Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64')}`;
  const server = http.createServer((req, res) => {
    requests.push(`${req.method} ${req.url} ${req.headers['user-agent'] ?? ''}`);
    if (req.headers.authorization !== expected) {
      res.writeHead(401, { 'Content-Type': 'text/plain' }).end('Unauthorized');
      return;
    }
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/api/bookmarks') {
      const q = url.searchParams.get('q') ?? '';
      const found = items.filter((item) => item.title.includes(q));
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ items: found, hasMore: false }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'not found' }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}`, requests });
    });
  });
}

suite('Bookmark Shelf 延伸模組', () => {
  let api: BookmarkShelfApi;
  let server: http.Server;
  let baseUrl: string;
  let requests: string[];

  suiteSetup(async () => {
    api = await getApi();
    ({ server, baseUrl, requests } = await startServer());
  });

  suiteTeardown(async () => {
    await api.disconnect();
    await new Promise((resolve) => server.close(resolve));
  });

  test('指令有註冊', async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const id of ['configure', 'add', 'search', 'refresh', 'edit', 'editField', 'delete', 'openDeployGuide']) {
      assert.ok(commands.includes(`bookmarkShelf.${id}`), id);
    }
  });

  test('沒設定連線時樹是空的，讓引導頁顯示', async () => {
    await api.disconnect();
    assert.equal(api.provider.getStatus(), 'unconfigured');
    assert.deepEqual(api.provider.getChildren(), []);
  });

  test('連線後依分類分組，未分類排最後', async () => {
    await api.connect({ baseUrl, username: USERNAME, password: PASSWORD });
    assert.equal(api.provider.getStatus(), 'ready');
    const roots = api.provider.getChildren();
    assert.deepEqual(roots, [
      { kind: 'category', category: '工具' },
      { kind: 'category', category: '' },
    ]);
    const tools = api.provider.getChildren(roots[0]);
    assert.deepEqual(tools, [
      { kind: 'bookmark', id: 1 },
      { kind: 'bookmark', id: 2 },
    ]);
    const fields = api.provider.getChildren(tools[0]).map((node) => (node as Extract<ShelfNode, { kind: 'field' }>).field);
    assert.deepEqual(fields, ['url', 'title', 'summary', 'category', 'tags', 'note', 'sharePage', 'meta']);
    assert.match(requests.at(-1) ?? '', /^GET \/api\/bookmarks\?sort=created&limit=100&offset=0 bookmark-shelf-vscode\//);
  });

  test('搜尋只顯示符合的結果，清除後回復', async () => {
    await api.provider.setFilter({ q: 'Hono' });
    assert.equal(api.provider.isFiltered(), true);
    assert.deepEqual(api.provider.getBookmarks().map((bookmark) => bookmark.id), [1]);
    await api.provider.setFilter({ q: 'nothing-matches' });
    assert.deepEqual(
      api.provider.getChildren().map((node) => (node as Extract<ShelfNode, { kind: 'notice' }>).notice),
      ['noMatch', 'clearFilters'],
    );
    await vscode.commands.executeCommand('bookmarkShelf.clearFilters');
    assert.equal(api.provider.getBookmarks().length, 3);
  });

  test('複製網址與 Markdown 連結', async () => {
    await vscode.commands.executeCommand('bookmarkShelf.copyUrl', { kind: 'bookmark', id: 1 });
    assert.equal(await vscode.env.clipboard.readText(), 'https://github.com/honojs/hono');
    await vscode.commands.executeCommand('bookmarkShelf.copyMarkdownLink', { kind: 'field', id: 2, field: 'url' });
    assert.equal(await vscode.env.clipboard.readText(), '[Excalidraw](https://excalidraw.com)');
  });

  test('不合法的指令參數直接忽略', async () => {
    await vscode.env.clipboard.writeText('unchanged');
    for (const arg of [undefined, 'x', { kind: 'bookmark', id: '1' }, { kind: 'bookmark', id: 999 }, { kind: 'category', id: 1 }]) {
      await vscode.commands.executeCommand('bookmarkShelf.copyUrl', arg);
    }
    assert.equal(await vscode.env.clipboard.readText(), 'unchanged');
  });

  test('帳密錯誤時顯示錯誤與重新設定兩列', async () => {
    await api.connect({ baseUrl, username: USERNAME, password: 'wrong' });
    assert.equal(api.provider.getStatus(), 'error');
    assert.deepEqual(
      api.provider.getChildren().map((node) => (node as Extract<ShelfNode, { kind: 'notice' }>).notice),
      ['error', 'reconfigure'],
    );
  });

  test('清除連線回到未設定', async () => {
    await api.disconnect();
    assert.equal(api.provider.getStatus(), 'unconfigured');
    assert.equal(api.provider.getConnection(), undefined);
  });
});
