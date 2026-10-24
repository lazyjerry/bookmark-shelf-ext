import * as assert from 'node:assert/strict';

import type { FetchLike } from '../../src/core/client';
import { ApiError, BookmarkClient, listPath } from '../../src/core/client';

const connection = { baseUrl: 'https://b.example.com', username: 'app-0123456789ab', password: 'secret' };

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(responder: (call: Call) => Response | Promise<Response>): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      const call = { url, init };
      calls.push(call);
      return responder(call);
    },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function item(id: number): Record<string, unknown> {
  return { id, url: `https://example.com/${id}`, title: `t${id}`, tags: [], share_id: `s${id}` };
}

suite('listPath', () => {
  test('空白篩選不帶，其餘照順序編碼', () => {
    assert.equal(listPath({ sort: 'created', q: '  ', tag: 'web dev' }, 100, 0), '/api/bookmarks?tag=web+dev&sort=created&limit=100&offset=0');
    assert.equal(listPath({ sort: 'popular', q: 'a&b' }, 10, 20), '/api/bookmarks?q=a%26b&sort=popular&limit=10&offset=20');
  });
});

suite('BookmarkClient', () => {
  test('帶 Basic Auth、User-Agent，不跟隨轉址', async () => {
    const fake = fakeFetch(() => json({ items: [], hasMore: false }));
    await new BookmarkClient(connection, { fetch: fake.fetch, userAgent: 'test-agent' }).ping();
    const headers = fake.calls[0].init.headers as Record<string, string>;
    assert.equal(fake.calls[0].url, 'https://b.example.com/api/bookmarks?sort=created&limit=1&offset=0');
    assert.equal(headers.Authorization, `Basic ${Buffer.from('app-0123456789ab:secret').toString('base64')}`);
    assert.equal(headers['User-Agent'], 'test-agent');
    assert.equal(headers['Content-Type'], undefined);
    assert.equal(fake.calls[0].init.redirect, 'manual');
  });

  test('寫入請求帶 JSON 與 Content-Type', async () => {
    const fake = fakeFetch(() => json({ bookmark: item(5) }));
    const client = new BookmarkClient(connection, { fetch: fake.fetch });
    const updated = await client.update(5, { tags: ['a'] });
    assert.equal(updated.id, 5);
    assert.equal(fake.calls[0].init.method, 'PATCH');
    assert.equal(fake.calls[0].init.body, '{"tags":["a"]}');
    assert.equal((fake.calls[0].init.headers as Record<string, string>)['Content-Type'], 'application/json');
  });

  test('listAll 逐頁載入、去重複，到上限就標 truncated', async () => {
    const fake = fakeFetch(({ url }) => {
      const offset = Number(new URL(url).searchParams.get('offset'));
      const limit = Number(new URL(url).searchParams.get('limit'));
      // 第二頁開頭重複上一頁最後一筆，模擬分頁期間有人新增書籤
      const start = offset === 0 ? 1 : offset;
      return json({ items: Array.from({ length: limit }, (_, i) => item(start + i)), hasMore: true });
    });
    const result = await new BookmarkClient(connection, { fetch: fake.fetch }).listAll({ sort: 'created' }, 250);
    assert.equal(fake.calls.length, 3);
    assert.deepEqual(
      fake.calls.map((call) => new URL(call.url).searchParams.get('limit')),
      ['100', '100', '50'],
    );
    assert.equal(new Set(result.items.map((bookmark) => bookmark.id)).size, result.items.length);
    assert.equal(result.truncated, true);
  });

  test('沒有下一頁就停', async () => {
    const fake = fakeFetch(() => json({ items: [item(1), item(2)], hasMore: false }));
    const result = await new BookmarkClient(connection, { fetch: fake.fetch }).listAll({ sort: 'created' }, 500);
    assert.equal(fake.calls.length, 1);
    assert.equal(result.truncated, false);
    assert.equal(result.items.length, 2);
  });

  test('JSON 錯誤取 error 欄位；409 帶既有書籤 id', async () => {
    const fake = fakeFetch(() => json({ error: '這個網址已經收藏過了', id: 12 }, 409));
    await assert.rejects(
      new BookmarkClient(connection, { fetch: fake.fetch }).create('https://example.com'),
      (error: unknown) => error instanceof ApiError && error.kind === 'http' && error.status === 409 && error.existingId === 12,
    );
  });

  test('純文字錯誤（401、503）保留文字', async () => {
    const fake = fakeFetch(() => new Response('Unauthorized', { status: 401 }));
    await assert.rejects(
      new BookmarkClient(connection, { fetch: fake.fetch }).ping(),
      (error: unknown) => error instanceof ApiError && error.status === 401 && error.detail === 'Unauthorized',
    );
  });

  test('轉址、非 JSON 成功回應、格式不符都視為錯誤', async () => {
    const redirect = fakeFetch(() => new Response(null, { status: 302, headers: { Location: 'https://evil.example.com' } }));
    await assert.rejects(new BookmarkClient(connection, { fetch: redirect.fetch }).ping(), (error: unknown) => error instanceof ApiError && error.kind === 'redirect');

    const html = fakeFetch(() => new Response('<html></html>', { status: 200 }));
    await assert.rejects(new BookmarkClient(connection, { fetch: html.fetch }).ping(), (error: unknown) => error instanceof ApiError && error.kind === 'invalidResponse');

    const wrongShape = fakeFetch(() => json({ ok: true }));
    await assert.rejects(new BookmarkClient(connection, { fetch: wrongShape.fetch }).get(1), (error: unknown) => error instanceof ApiError && error.kind === 'invalidResponse');
  });

  test('網路錯誤與逾時分開回報', async () => {
    const network = fakeFetch(() => Promise.reject(new TypeError('fetch failed')));
    await assert.rejects(new BookmarkClient(connection, { fetch: network.fetch }).ping(), (error: unknown) => error instanceof ApiError && error.kind === 'network');

    const slow: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    await assert.rejects(new BookmarkClient(connection, { fetch: slow, timeoutMs: 20 }).ping(), (error: unknown) => error instanceof ApiError && error.kind === 'timeout');
  });
});
