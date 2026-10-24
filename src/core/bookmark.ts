// 書籤資料：解析伺服器回應、分組、編輯欄位的輸入轉換。伺服器回應一律當不可信資料逐欄驗證。

export interface Bookmark {
  id: number;
  url: string;
  title: string;
  summary: string;
  category: string;
  tags: string[];
  note: string;
  site: string;
  host: string;
  clickCount: number;
  createdAt: string;
  updatedAt: string;
  shareId: string;
}

/** 可在側欄編輯的欄位與伺服器端的長度上限（與 PATCH /api/bookmarks/:id 一致）。 */
export const EDITABLE_FIELDS = ['title', 'summary', 'category', 'tags', 'note'] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

export const FIELD_LIMITS: Record<Exclude<EditableField, 'tags'>, number> = {
  title: 300,
  summary: 2000,
  category: 40,
  note: 5000,
};
export const MAX_TAGS = 12;
export const MAX_TAG_LENGTH = 30;
export const MAX_URL_LENGTH = 2048;

export function isEditableField(value: unknown): value is EditableField {
  return typeof value === 'string' && (EDITABLE_FIELDS as readonly string[]).includes(value);
}

function str(value: unknown, max = 10_000): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function nonNegativeInt(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

export function parseBookmark(value: unknown): Bookmark | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const id = raw.id;
  const url = str(raw.url, MAX_URL_LENGTH);
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0 || url === '') {
    return undefined;
  }
  const shareId = str(raw.share_id, 100);
  return {
    id,
    url,
    title: str(raw.title, FIELD_LIMITS.title),
    summary: str(raw.summary, FIELD_LIMITS.summary),
    category: str(raw.category, FIELD_LIMITS.category),
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter((tag): tag is string => typeof tag === 'string').map((tag) => tag.slice(0, MAX_TAG_LENGTH))
      : [],
    note: str(raw.note, FIELD_LIMITS.note),
    site: str(raw.site, 200),
    host: str(raw.host, 300),
    clickCount: nonNegativeInt(raw.click_count),
    createdAt: str(raw.created_at, 40),
    updatedAt: str(raw.updated_at, 40),
    shareId: /^[A-Za-z0-9_-]+$/.test(shareId) ? shareId : '',
  };
}

export function parseListResponse(value: unknown): { items: Bookmark[]; hasMore: boolean } | undefined {
  if (typeof value !== 'object' || value === null || !Array.isArray((value as { items?: unknown }).items)) {
    return undefined;
  }
  const record = value as { items: unknown[]; hasMore?: unknown };
  const items = record.items.map(parseBookmark).filter((item): item is Bookmark => item !== undefined);
  return { items, hasMore: record.hasMore === true };
}

/** `{ bookmark: {...} }` 形式的回應。 */
export function parseBookmarkResponse(value: unknown): Bookmark | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  return parseBookmark((value as { bookmark?: unknown }).bookmark);
}

export interface CategoryGroup {
  /** 空字串代表未分類。 */
  category: string;
  items: Bookmark[];
}

/** 伺服器規則分類的預設值是「未分類」，跟空字串視為同一組。 */
export function categoryKey(category: string): string {
  const trimmed = category.trim();
  return trimmed === '未分類' ? '' : trimmed;
}

/** 依分類分組：書籤多的分類在前，同數量依名稱排序；未分類永遠排最後。組內維持伺服器給的順序。 */
export function groupByCategory(bookmarks: readonly Bookmark[]): CategoryGroup[] {
  const groups = new Map<string, Bookmark[]>();
  for (const bookmark of bookmarks) {
    const key = categoryKey(bookmark.category);
    const list = groups.get(key);
    if (list) {
      list.push(bookmark);
    } else {
      groups.set(key, [bookmark]);
    }
  }
  return [...groups.entries()]
    .map(([category, items]) => ({ category, items }))
    .sort((a, b) => {
      if ((a.category === '') !== (b.category === '')) {
        return a.category === '' ? 1 : -1;
      }
      return b.items.length - a.items.length || a.category.localeCompare(b.category, 'zh-Hant');
    });
}

/** 依出現次數排序的不重複值（標籤、網站、分類的挑選清單用）。 */
export function rankValues(values: Iterable<string>): string[] {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = value.trim();
    if (key !== '') {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-Hant'))
    .map(([value]) => value);
}

/** 輸入框以逗號（半形、全形、頓號）分隔標籤；去掉 `#`、空白與不分大小寫的重複。 */
export function parseTagsInput(input: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of input.split(/[,，、]/)) {
    const tag = part.trim().replace(/^#+/, '').trim().slice(0, MAX_TAG_LENGTH);
    const key = tag.toLowerCase();
    if (tag !== '' && !seen.has(key)) {
      seen.add(key);
      tags.push(tag);
    }
  }
  return tags.slice(0, MAX_TAGS);
}

export function formatTags(tags: readonly string[]): string {
  return tags.join(', ');
}

/**
 * 輸入框只有一行：換行以 `\n` 表示，反斜線本身寫成 `\\`，兩個方向可完整往返。
 * `decodeMultiline(encodeMultiline(s)) === s` 對任何字串都成立。
 */
export function encodeMultiline(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n');
}

export function decodeMultiline(text: string): string {
  return text.replace(/\\(\\|n)/g, (_match, char: string) => (char === 'n' ? '\n' : '\\'));
}

/** 只開 http(s)：書籤網址來自伺服器（最終來自任何人貼上的網址），不能讓 `file:`、`command:` 之類被開啟。 */
export function isWebUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname !== '';
  } catch {
    return false;
  }
}

/** 從選取文字或剪貼簿挑出第一個像網址的片段；沒有就回空字串。 */
export function findUrl(text: string): string {
  const match = text.slice(0, 10_000).match(/https?:\/\/[^\s<>"'`）」』]+/i);
  if (!match) {
    return '';
  }
  const candidate = match[0].replace(/[.,;:!?)\]}，。；：！？]+$/, '');
  return isWebUrl(candidate) ? candidate.slice(0, MAX_URL_LENGTH) : '';
}

export function markdownLink(bookmark: Pick<Bookmark, 'title' | 'url'>): string {
  const title = (bookmark.title.trim() || bookmark.url).replace(/([\\[\]])/g, '\\$1').replace(/\s+/g, ' ');
  // encodeURIComponent 不編碼括號，Markdown 連結裡的括號會截斷網址，要自己換
  const url = bookmark.url.replace(/[()\s]/g, (char) => (char === '(' ? '%28' : char === ')' ? '%29' : encodeURIComponent(char)));
  return `[${title}](${url})`;
}

export function sharePageUrl(baseUrl: string, shareId: string): string | undefined {
  return /^[A-Za-z0-9_-]+$/.test(shareId) ? `${baseUrl}/b/${shareId}` : undefined;
}

/** 單行顯示：壓掉換行與連續空白，超過長度加省略號。 */
export function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
