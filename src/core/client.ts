// 書籤收藏櫃 API client：只用應用程式帳密能呼叫的 `/api/bookmarks*`。fetch 由外部注入，單元測試換成假的。

import type { Bookmark } from './bookmark';
import { parseBookmarkResponse, parseListResponse } from './bookmark';
import type { Connection } from './connection';
import { basicAuthHeader } from './connection';

export const SORTS = ['created', 'clicked', 'popular'] as const;
export type Sort = (typeof SORTS)[number];

export function isSort(value: unknown): value is Sort {
  return typeof value === 'string' && (SORTS as readonly string[]).includes(value);
}

export interface ListFilter {
  q?: string;
  tag?: string;
  site?: string;
  sort: Sort;
}

export type ApiErrorKind = 'http' | 'network' | 'timeout' | 'redirect' | 'invalidResponse';

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    /** 伺服器的錯誤說明（`{ error }` 或純文字），沒有就是空字串。 */
    readonly detail: string,
    readonly status = 0,
    /** 409 重複網址時伺服器回傳的既有書籤 id。 */
    readonly existingId?: number,
  ) {
    super(detail || kind);
    this.name = 'ApiError';
  }
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ClientOptions {
  fetch?: FetchLike;
  userAgent?: string;
  /** 一般請求逾時；新增書籤會抓網頁跑 AI，另用 createTimeoutMs。 */
  timeoutMs?: number;
  createTimeoutMs?: number;
}

const PAGE_SIZE = 100;

export function listPath(filter: ListFilter, limit: number, offset: number): string {
  const params = new URLSearchParams();
  for (const key of ['q', 'tag', 'site'] as const) {
    const value = filter[key]?.trim();
    if (value) {
      params.set(key, value);
    }
  }
  params.set('sort', filter.sort);
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  return `/api/bookmarks?${params.toString()}`;
}

export class BookmarkClient {
  private readonly fetchImpl: FetchLike;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly createTimeoutMs: number;

  constructor(
    private readonly connection: Connection,
    options: ClientOptions = {},
  ) {
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init));
    this.userAgent = options.userAgent ?? 'bookmark-shelf-vscode';
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.createTimeoutMs = options.createTimeoutMs ?? 90_000;
  }

  /** 連線測試：取一筆，能解析就代表網域、帳密、權限都對。 */
  async ping(): Promise<void> {
    const body = await this.request('GET', listPath({ sort: 'created' }, 1, 0));
    if (!parseListResponse(body)) {
      throw new ApiError('invalidResponse', '');
    }
  }

  /** 逐頁載入直到沒有下一頁或達到上限；truncated 表示伺服器還有更多。 */
  async listAll(filter: ListFilter, max: number): Promise<{ items: Bookmark[]; truncated: boolean }> {
    const items: Bookmark[] = [];
    const seen = new Set<number>();
    for (let offset = 0; offset < max; offset += PAGE_SIZE) {
      const limit = Math.min(PAGE_SIZE, max - offset);
      const page = parseListResponse(await this.request('GET', listPath(filter, limit, offset)));
      if (!page) {
        throw new ApiError('invalidResponse', '');
      }
      for (const item of page.items) {
        // 分頁之間有人新增書籤時，offset 會位移造成重複
        if (!seen.has(item.id)) {
          seen.add(item.id);
          items.push(item);
        }
      }
      if (!page.hasMore) {
        return { items, truncated: false };
      }
    }
    return { items, truncated: true };
  }

  async get(id: number): Promise<Bookmark> {
    return this.expectBookmark(await this.request('GET', `/api/bookmarks/${id}`));
  }

  /** 只給網址：伺服器自動抓取網頁並以 AI 產生標題、摘要、分類與標籤。 */
  async create(url: string): Promise<Bookmark> {
    return this.expectBookmark(await this.request('POST', '/api/bookmarks', { url }, this.createTimeoutMs));
  }

  async update(id: number, patch: Partial<Pick<Bookmark, 'title' | 'summary' | 'category' | 'tags' | 'note'>>): Promise<Bookmark> {
    return this.expectBookmark(await this.request('PATCH', `/api/bookmarks/${id}`, patch));
  }

  async remove(id: number): Promise<void> {
    await this.request('DELETE', `/api/bookmarks/${id}`);
  }

  private expectBookmark(body: unknown): Bookmark {
    const bookmark = parseBookmarkResponse(body);
    if (!bookmark) {
      throw new ApiError('invalidResponse', '');
    }
    return bookmark;
  }

  private async request(method: string, path: string, body?: unknown, timeoutMs = this.timeoutMs): Promise<unknown> {
    const headers: Record<string, string> = {
      Authorization: basicAuthHeader(this.connection),
      Accept: 'application/json',
      'User-Agent': this.userAgent,
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    let response: Response;
    try {
      response = await this.fetchImpl(this.connection.baseUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        // 不跟隨轉址：轉到別的主機時 Authorization 會一起送過去
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new ApiError('timeout', '');
      }
      throw new ApiError('network', error instanceof Error ? error.message : String(error));
    }

    if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
      throw new ApiError('redirect', '', response.status);
    }
    const text = await response.text().catch(() => '');
    let json: unknown;
    try {
      json = text === '' ? undefined : JSON.parse(text);
    } catch {
      json = undefined;
    }
    if (!response.ok) {
      const record = typeof json === 'object' && json !== null ? (json as { error?: unknown; id?: unknown }) : {};
      const detail = typeof record.error === 'string' ? record.error : json === undefined ? text : '';
      const existingId = typeof record.id === 'number' && Number.isInteger(record.id) ? record.id : undefined;
      throw new ApiError('http', detail.trim().slice(0, 300), response.status, existingId);
    }
    if (json === undefined) {
      throw new ApiError('invalidResponse', '');
    }
    return json;
  }
}
