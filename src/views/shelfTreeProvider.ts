// 側欄書籤樹：分類 → 書籤 → 細節欄位三層。書籤一次載入（逐頁到上限）後在本機分組，
// 狀態（連線、篩選、載入結果）都留在這裡，指令改完資料只更新本機快取，不整批重抓。
// 根節點回傳空陣列時，viewsWelcome 依 `bookmarkShelf.state` 顯示「尚未設定」或「尚無書籤」。

import * as vscode from 'vscode';

import type { Bookmark, EditableField } from '../core/bookmark';
import { categoryKey, formatTags, groupByCategory, oneLine, rankValues } from '../core/bookmark';
import type { ListFilter, Sort } from '../core/client';
import { BookmarkClient } from '../core/client';
import type { Connection } from '../core/connection';
import { displayHost } from '../core/connection';
import { describeError } from '../messages';

export const VIEW_ID = 'bookmarkShelf.tree';

export type ShelfStatus = 'unconfigured' | 'loading' | 'ready' | 'empty' | 'error';

export type DetailField = 'url' | EditableField | 'sharePage' | 'meta';

export type ShelfNode =
  | { kind: 'category'; category: string }
  | { kind: 'bookmark'; id: number }
  | { kind: 'field'; id: number; field: DetailField }
  | { kind: 'notice'; notice: 'error' | 'reconfigure' | 'noMatch' | 'clearFilters' | 'truncated' };

const DETAIL_FIELDS: readonly DetailField[] = ['url', 'title', 'summary', 'category', 'tags', 'note', 'sharePage', 'meta'];

export interface ShelfOptions {
  userAgent: string;
  maxItems: () => number;
  initialSort: Sort;
}

export class ShelfTreeProvider implements vscode.TreeDataProvider<ShelfNode> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  private connection: Connection | undefined;
  private client: BookmarkClient | undefined;
  private bookmarks: Bookmark[] = [];
  private filter: ListFilter;
  private status: ShelfStatus = 'unconfigured';
  private errorMessage = '';
  private truncated = false;
  private loadSeq = 0;
  private lastLoadedAt = 0;
  /** 最近一次「沒有篩選」時看到的分類、標籤、網站；篩選後挑選清單不會跟著縮小。 */
  private vocabulary = { categories: [] as string[], tags: [] as string[], sites: [] as string[] };
  private view: vscode.TreeView<ShelfNode> | undefined;

  constructor(private readonly options: ShelfOptions) {
    this.filter = { sort: options.initialSort };
  }

  attach(view: vscode.TreeView<ShelfNode>): void {
    this.view = view;
    this.updateViewChrome();
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }

  // ---- 狀態 ----

  getStatus(): ShelfStatus {
    return this.status;
  }

  getConnection(): Connection | undefined {
    return this.connection;
  }

  getClient(): BookmarkClient | undefined {
    return this.client;
  }

  getFilter(): ListFilter {
    return { ...this.filter };
  }

  isFiltered(): boolean {
    return Boolean(this.filter.q || this.filter.tag || this.filter.site);
  }

  getBookmarks(): readonly Bookmark[] {
    return this.bookmarks;
  }

  find(id: number): Bookmark | undefined {
    return this.bookmarks.find((bookmark) => bookmark.id === id);
  }

  isStale(maxAgeMs: number): boolean {
    return Date.now() - this.lastLoadedAt > maxAgeMs;
  }

  categories(): string[] {
    return mergeRanked(this.vocabulary.categories, this.bookmarks.map((bookmark) => bookmark.category));
  }

  tags(): string[] {
    return mergeRanked(this.vocabulary.tags, this.bookmarks.flatMap((bookmark) => bookmark.tags));
  }

  sites(): string[] {
    return mergeRanked(this.vocabulary.sites, this.bookmarks.map((bookmark) => bookmark.site || bookmark.host));
  }

  /** 換連線（含清除）：舊資料全部丟掉，進行中的載入結果作廢。 */
  setConnection(connection: Connection | undefined): void {
    this.connection = connection;
    this.client = connection ? new BookmarkClient(connection, { userAgent: this.options.userAgent }) : undefined;
    this.bookmarks = [];
    this.truncated = false;
    this.errorMessage = '';
    this.lastLoadedAt = 0;
    this.vocabulary = { categories: [], tags: [], sites: [] };
    this.loadSeq += 1;
    this.setStatus(connection ? 'loading' : 'unconfigured');
  }

  async setFilter(patch: Partial<ListFilter>): Promise<void> {
    this.filter = { ...this.filter, ...patch };
    await this.reload();
  }

  async reload(): Promise<void> {
    const client = this.client;
    if (!client) {
      this.setStatus('unconfigured');
      return;
    }
    const seq = ++this.loadSeq;
    if (this.status !== 'ready') {
      this.setStatus('loading');
    }
    await vscode.window.withProgress({ location: { viewId: VIEW_ID } }, async () => {
      try {
        const result = await client.listAll(this.filter, this.options.maxItems());
        if (seq !== this.loadSeq) {
          return;
        }
        this.bookmarks = result.items;
        this.truncated = result.truncated;
        this.lastLoadedAt = Date.now();
        if (!this.isFiltered()) {
          this.vocabulary = {
            categories: rankValues(result.items.map((bookmark) => bookmark.category)),
            tags: rankValues(result.items.flatMap((bookmark) => bookmark.tags)),
            sites: rankValues(result.items.map((bookmark) => bookmark.site || bookmark.host)),
          };
        }
        this.setStatus(result.items.length === 0 && !this.isFiltered() ? 'empty' : 'ready');
      } catch (error) {
        if (seq !== this.loadSeq) {
          return;
        }
        this.errorMessage = describeError(error);
        this.setStatus('error');
      }
    });
  }

  /** 新增或更新後放進本機快取；新的書籤排在最前面。 */
  upsert(bookmark: Bookmark): void {
    const index = this.bookmarks.findIndex((item) => item.id === bookmark.id);
    if (index >= 0) {
      this.bookmarks[index] = bookmark;
    } else {
      this.bookmarks.unshift(bookmark);
    }
    this.setStatus('ready');
  }

  remove(id: number): void {
    this.bookmarks = this.bookmarks.filter((bookmark) => bookmark.id !== id);
    this.setStatus(this.bookmarks.length === 0 && !this.isFiltered() ? 'empty' : 'ready');
  }

  async reveal(id: number): Promise<void> {
    if (this.view && this.find(id)) {
      await this.view.reveal({ kind: 'bookmark', id }, { select: true, focus: true, expand: true });
    }
  }

  private setStatus(status: ShelfStatus): void {
    this.status = status;
    void vscode.commands.executeCommand('setContext', 'bookmarkShelf.state', status);
    void vscode.commands.executeCommand('setContext', 'bookmarkShelf.filtered', this.isFiltered());
    this.updateViewChrome();
    this.changeEmitter.fire();
  }

  private updateViewChrome(): void {
    if (!this.view) {
      return;
    }
    const parts: string[] = [];
    if (this.filter.q) {
      parts.push(`“${this.filter.q}”`);
    }
    if (this.filter.tag) {
      parts.push(`#${this.filter.tag}`);
    }
    if (this.filter.site) {
      parts.push(this.filter.site);
    }
    if (this.filter.sort !== 'created') {
      parts.push(sortLabel(this.filter.sort));
    }
    if (parts.length === 0 && this.connection) {
      parts.push(displayHost(this.connection.baseUrl));
    }
    this.view.description = parts.join(' · ');
    this.view.message =
      this.status === 'ready' && this.truncated
        ? vscode.l10n.t('Showing the first {0} bookmarks. Use search or filters to narrow down.', String(this.bookmarks.length))
        : undefined;
  }

  // ---- TreeDataProvider ----

  getChildren(element?: ShelfNode): ShelfNode[] {
    if (!element) {
      return this.rootChildren();
    }
    if (element.kind === 'category') {
      return this.groups()
        .find((group) => group.category === element.category)
        ?.items.map((bookmark) => ({ kind: 'bookmark' as const, id: bookmark.id })) ?? [];
    }
    if (element.kind === 'bookmark') {
      const bookmark = this.find(element.id);
      if (!bookmark) {
        return [];
      }
      return DETAIL_FIELDS.filter((field) => field !== 'sharePage' || bookmark.shareId !== '').map((field) => ({
        kind: 'field' as const,
        id: element.id,
        field,
      }));
    }
    return [];
  }

  getParent(element: ShelfNode): ShelfNode | undefined {
    if (element.kind === 'bookmark') {
      const bookmark = this.find(element.id);
      return bookmark ? { kind: 'category', category: categoryKey(bookmark.category) } : undefined;
    }
    if (element.kind === 'field') {
      return { kind: 'bookmark', id: element.id };
    }
    return undefined;
  }

  getTreeItem(element: ShelfNode): vscode.TreeItem {
    switch (element.kind) {
      case 'category':
        return this.categoryItem(element.category);
      case 'bookmark':
        return this.bookmarkItem(element.id);
      case 'field':
        return this.fieldItem(element.id, element.field);
      case 'notice':
        return this.noticeItem(element.notice);
    }
  }

  private rootChildren(): ShelfNode[] {
    if (this.status === 'error') {
      return [
        { kind: 'notice', notice: 'error' },
        { kind: 'notice', notice: 'reconfigure' },
      ];
    }
    if (this.status !== 'ready') {
      return [];
    }
    if (this.bookmarks.length === 0) {
      return [
        { kind: 'notice', notice: 'noMatch' },
        { kind: 'notice', notice: 'clearFilters' },
      ];
    }
    const nodes: ShelfNode[] = this.groups().map((group) => ({ kind: 'category', category: group.category }));
    if (this.truncated) {
      nodes.push({ kind: 'notice', notice: 'truncated' });
    }
    return nodes;
  }

  private groups(): ReturnType<typeof groupByCategory> {
    return groupByCategory(this.bookmarks);
  }

  /** 篩選條件變了就換一組 id，讓篩選結果預設展開；沒篩選時沿用 VS Code 記住的展開狀態。 */
  private filterKey(): string {
    return this.isFiltered() ? JSON.stringify([this.filter.q, this.filter.tag, this.filter.site]) : '';
  }

  private categoryItem(category: string): vscode.TreeItem {
    const count = this.groups().find((group) => group.category === category)?.items.length ?? 0;
    const item = new vscode.TreeItem(
      category || vscode.l10n.t('Uncategorized'),
      this.isFiltered() ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed,
    );
    item.id = `category:${this.filterKey()}:${category}`;
    item.description = String(count);
    item.iconPath = new vscode.ThemeIcon('folder');
    item.contextValue = 'category';
    return item;
  }

  private bookmarkItem(id: number): vscode.TreeItem {
    const bookmark = this.find(id);
    if (!bookmark) {
      return new vscode.TreeItem('');
    }
    const item = new vscode.TreeItem(oneLine(bookmark.title || bookmark.url, 120), vscode.TreeItemCollapsibleState.Collapsed);
    item.id = `bookmark:${id}`;
    item.description = bookmark.site || bookmark.host;
    item.iconPath = new vscode.ThemeIcon('bookmark');
    item.contextValue = 'bookmark';
    item.tooltip = bookmarkTooltip(bookmark);
    return item;
  }

  private fieldItem(id: number, field: DetailField): vscode.TreeItem {
    const bookmark = this.find(id);
    const item = new vscode.TreeItem('');
    if (!bookmark) {
      return item;
    }
    item.id = `bookmark:${id}:${field}`;
    const node: ShelfNode = { kind: 'field', id, field };
    switch (field) {
      case 'url':
        item.label = oneLine(bookmark.url, 100);
        item.iconPath = new vscode.ThemeIcon('link-external');
        item.tooltip = bookmark.url;
        item.command = { command: 'bookmarkShelf.open', title: vscode.l10n.t('Open in Browser'), arguments: [node] };
        item.contextValue = 'field-url';
        return item;
      case 'sharePage':
        item.label = vscode.l10n.t('Share page');
        item.description = vscode.l10n.t('Viewable without signing in');
        item.iconPath = new vscode.ThemeIcon('globe');
        item.command = { command: 'bookmarkShelf.openSharePage', title: vscode.l10n.t('Open Share Page'), arguments: [node] };
        item.contextValue = 'field-share';
        return item;
      case 'meta':
        item.label = vscode.l10n.t('Added');
        item.description = vscode.l10n.t('{0} · {1} clicks', formatDate(bookmark.createdAt), String(bookmark.clickCount));
        item.iconPath = new vscode.ThemeIcon('history');
        item.contextValue = 'field-meta';
        return item;
      default: {
        const value = field === 'tags' ? formatTags(bookmark.tags) : bookmark[field];
        item.label = fieldLabel(field);
        item.description = value ? oneLine(value, 120) : vscode.l10n.t('(empty — click to edit)');
        item.tooltip = value ? new vscode.MarkdownString().appendText(value) : undefined;
        item.iconPath = new vscode.ThemeIcon(FIELD_ICONS[field]);
        item.command = { command: 'bookmarkShelf.editField', title: vscode.l10n.t('Edit'), arguments: [node] };
        item.contextValue = 'field-editable';
        return item;
      }
    }
  }

  private noticeItem(notice: Extract<ShelfNode, { kind: 'notice' }>['notice']): vscode.TreeItem {
    const item = new vscode.TreeItem('');
    item.id = `notice:${notice}`;
    switch (notice) {
      case 'error':
        item.label = vscode.l10n.t('Could not load bookmarks');
        item.description = this.errorMessage;
        item.tooltip = new vscode.MarkdownString().appendText(this.errorMessage);
        item.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('list.errorForeground'));
        item.command = { command: 'bookmarkShelf.refresh', title: vscode.l10n.t('Retry') };
        break;
      case 'reconfigure':
        item.label = vscode.l10n.t('Change connection settings…');
        item.iconPath = new vscode.ThemeIcon('gear');
        item.command = { command: 'bookmarkShelf.configure', title: vscode.l10n.t('Connect') };
        break;
      case 'noMatch':
        item.label = vscode.l10n.t('No bookmarks match the current filters.');
        item.iconPath = new vscode.ThemeIcon('info');
        break;
      case 'clearFilters':
        item.label = vscode.l10n.t('Clear filters');
        item.iconPath = new vscode.ThemeIcon('clear-all');
        item.command = { command: 'bookmarkShelf.clearFilters', title: vscode.l10n.t('Clear filters') };
        break;
      case 'truncated':
        item.label = vscode.l10n.t('More bookmarks on the server…');
        item.description = vscode.l10n.t('Raise bookmarkShelf.maxItems or narrow the search');
        item.iconPath = new vscode.ThemeIcon('ellipsis');
        break;
    }
    return item;
  }
}

const FIELD_ICONS: Record<EditableField, string> = {
  title: 'symbol-text',
  summary: 'note',
  category: 'symbol-folder',
  tags: 'tag',
  note: 'comment',
};

export function fieldLabel(field: EditableField): string {
  switch (field) {
    case 'title':
      return vscode.l10n.t('Title');
    case 'summary':
      return vscode.l10n.t('Summary');
    case 'category':
      return vscode.l10n.t('Category');
    case 'tags':
      return vscode.l10n.t('Tags');
    case 'note':
      return vscode.l10n.t('Note');
  }
}

export function sortLabel(sort: Sort): string {
  switch (sort) {
    case 'created':
      return vscode.l10n.t('Newest');
    case 'clicked':
      return vscode.l10n.t('Recently clicked');
    case 'popular':
      return vscode.l10n.t('Most clicked');
  }
}

function bookmarkTooltip(bookmark: Bookmark): vscode.MarkdownString {
  // 書籤內容來自網頁與 AI，一律 appendText 跳脫，不讓它被當成 Markdown 或連結
  const tooltip = new vscode.MarkdownString();
  tooltip.appendText(bookmark.title || bookmark.url);
  tooltip.appendMarkdown('\n\n');
  tooltip.appendText(bookmark.url);
  if (bookmark.summary) {
    tooltip.appendMarkdown('\n\n');
    tooltip.appendText(oneLine(bookmark.summary, 400));
  }
  if (bookmark.tags.length > 0) {
    tooltip.appendMarkdown('\n\n');
    tooltip.appendText(bookmark.tags.map((tag) => `#${tag}`).join(' '));
  }
  return tooltip;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString(vscode.env.language);
}

function mergeRanked(known: readonly string[], current: readonly string[]): string[] {
  const merged = [...rankValues(current)];
  for (const value of known) {
    if (!merged.includes(value)) {
      merged.push(value);
    }
  }
  return merged;
}
