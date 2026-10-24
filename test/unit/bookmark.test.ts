import * as assert from 'node:assert/strict';

import type { Bookmark } from '../../src/core/bookmark';
import {
  decodeMultiline,
  encodeMultiline,
  findUrl,
  groupByCategory,
  isWebUrl,
  markdownLink,
  parseBookmark,
  parseListResponse,
  parseTagsInput,
  rankValues,
  sharePageUrl,
} from '../../src/core/bookmark';

function bookmark(id: number, category: string, extra: Partial<Bookmark> = {}): Bookmark {
  return {
    id,
    url: `https://example.com/${id}`,
    title: `t${id}`,
    summary: '',
    category,
    tags: [],
    note: '',
    site: 'example.com',
    host: 'example.com',
    clickCount: 0,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    shareId: 'abc',
    ...extra,
  };
}

suite('parseBookmark', () => {
  const raw = {
    id: 12,
    url: 'https://github.com/honojs/hono',
    title: 'Hono',
    summary: '輕量 Web 框架',
    category: '工具',
    tags: ['hono', 3, 'web'],
    note: '',
    site: 'GitHub',
    host: 'github.com',
    click_count: 4,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-02T00:00:00Z',
    share_id: 'Ab_9-x',
    extra: { stars: 1 },
  };

  test('伺服器欄位轉成本地型別，非字串標籤丟掉', () => {
    const parsed = parseBookmark(raw);
    assert.ok(parsed);
    assert.equal(parsed.id, 12);
    assert.deepEqual(parsed.tags, ['hono', 'web']);
    assert.equal(parsed.clickCount, 4);
    assert.equal(parsed.shareId, 'Ab_9-x');
  });

  test('缺 id 或網址的資料不收', () => {
    assert.equal(parseBookmark({ ...raw, id: '12' }), undefined);
    assert.equal(parseBookmark({ ...raw, id: -1 }), undefined);
    assert.equal(parseBookmark({ ...raw, url: '' }), undefined);
    assert.equal(parseBookmark(null), undefined);
  });

  test('share_id 含路徑字元時清空，不拿來組網址', () => {
    assert.equal(parseBookmark({ ...raw, share_id: '../settings' })?.shareId, '');
  });

  test('列表回應：壞項目略過、hasMore 只認 true', () => {
    assert.deepEqual(parseListResponse({ items: [raw, { id: 'x' }], hasMore: 'yes' })?.items.map((item) => item.id), [12]);
    assert.equal(parseListResponse({ items: [] })?.hasMore, false);
    assert.equal(parseListResponse({ error: 'x' }), undefined);
  });
});

suite('groupByCategory', () => {
  test('數量多的分類在前，同數量依名稱，未分類最後，組內維持原順序', () => {
    const groups = groupByCategory([
      bookmark(1, ''),
      bookmark(2, '閱讀'),
      bookmark(3, '工具'),
      bookmark(4, '工具'),
      bookmark(5, ' 設計 '),
    ]);
    assert.deepEqual(
      groups.map((group) => [group.category, group.items.map((item) => item.id)]),
      [
        ['工具', [3, 4]],
        ['設計', [5]],
        ['閱讀', [2]],
        ['', [1]],
      ],
    );
  });

  test('伺服器的「未分類」與空分類併成同一組', () => {
    const groups = groupByCategory([bookmark(1, '未分類'), bookmark(2, ''), bookmark(3, '工具')]);
    assert.deepEqual(
      groups.map((group) => [group.category, group.items.map((item) => item.id)]),
      [
        ['工具', [3]],
        ['', [1, 2]],
      ],
    );
  });

  test('rankValues 依次數排序並去掉空白', () => {
    assert.deepEqual(rankValues(['b', 'a', 'b', ' ', 'c', 'a', 'b']), ['b', 'a', 'c']);
  });
});

suite('編輯輸入轉換', () => {
  test('標籤：各種逗號、去 #、不分大小寫去重、最多 12 個', () => {
    assert.deepEqual(parseTagsInput('#Hono, hono，web、 工具 ,,'), ['Hono', 'web', '工具']);
    assert.equal(parseTagsInput(Array.from({ length: 20 }, (_, i) => `t${i}`).join(',')).length, 12);
  });

  test('多行文字往返不失真', () => {
    for (const text of ['', 'a\nb', 'C:\\path\\new', 'literal \\n here\n第二行', '\\\\n', 'end\\']) {
      assert.equal(decodeMultiline(encodeMultiline(text)), text);
    }
    assert.equal(encodeMultiline('a\r\nb'), 'a\\nb');
  });
});

suite('網址', () => {
  test('只認 http(s)', () => {
    assert.equal(isWebUrl('https://example.com/a'), true);
    assert.equal(isWebUrl('http://example.com'), true);
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'command:workbench.action.terminal.new', 'vscode://x', 'not a url']) {
      assert.equal(isWebUrl(url), false, url);
    }
  });

  test('從文字挑出網址，去掉句尾標點', () => {
    assert.equal(findUrl('看這個 https://example.com/a?b=1。'), 'https://example.com/a?b=1');
    assert.equal(findUrl('(https://example.com/x)'), 'https://example.com/x');
    assert.equal(findUrl('[文件](https://example.com/doc)'), 'https://example.com/doc');
    assert.equal(findUrl('沒有網址'), '');
  });

  test('Markdown 連結跳脫方括號與括號', () => {
    assert.equal(markdownLink({ title: 'a [b] c', url: 'https://example.com/x_(y)' }), '[a \\[b\\] c](https://example.com/x_%28y%29)');
    assert.equal(markdownLink({ title: '', url: 'https://example.com' }), '[https://example.com](https://example.com)');
  });

  test('中轉頁網址只接受安全的 share_id', () => {
    assert.equal(sharePageUrl('https://b.example.com', 'Ab_9-x'), 'https://b.example.com/b/Ab_9-x');
    assert.equal(sharePageUrl('https://b.example.com', ''), undefined);
    assert.equal(sharePageUrl('https://b.example.com', '../x'), undefined);
  });
});
