// 書籤操作：新增、編輯、刪除、開啟、複製、搜尋與篩選。樹節點參數一律先驗證再查本機快取，
// 指令也可能被其他延伸模組或 command 連結以任意參數呼叫。

import * as vscode from 'vscode';

import type { Bookmark, EditableField } from '../core/bookmark';
import {
  EDITABLE_FIELDS,
  FIELD_LIMITS,
  MAX_TAGS,
  MAX_URL_LENGTH,
  decodeMultiline,
  encodeMultiline,
  findUrl,
  formatTags,
  isEditableField,
  isWebUrl,
  markdownLink,
  oneLine,
  parseTagsInput,
  sharePageUrl,
} from '../core/bookmark';
import type { Sort } from '../core/client';
import { ApiError, SORTS } from '../core/client';
import { describeError, prefixed } from '../messages';
import type { ShelfTreeProvider } from '../views/shelfTreeProvider';
import { VIEW_ID, fieldLabel, sortLabel } from '../views/shelfTreeProvider';

export interface BookmarkDeps {
  provider: ShelfTreeProvider;
  saveSort: (sort: Sort) => Thenable<void>;
}

function statusMessage(message: string): void {
  vscode.window.setStatusBarMessage(prefixed(message), 3000);
}

function showError(error: unknown): void {
  void vscode.window.showErrorMessage(prefixed(describeError(error)));
}

/** 樹節點（bookmark／field）→ 本機快取裡的書籤。 */
function bookmarkFromArg(provider: ShelfTreeProvider, arg: unknown): Bookmark | undefined {
  if (typeof arg !== 'object' || arg === null) {
    return undefined;
  }
  const { kind, id } = arg as { kind?: unknown; id?: unknown };
  if ((kind !== 'bookmark' && kind !== 'field') || typeof id !== 'number' || !Number.isInteger(id)) {
    return undefined;
  }
  return provider.find(id);
}

function requireClient(provider: ShelfTreeProvider): ReturnType<ShelfTreeProvider['getClient']> {
  const client = provider.getClient();
  if (!client) {
    void vscode.window.showWarningMessage(prefixed(vscode.l10n.t('Connect to your Bookmark Shelf first.')));
  }
  return client;
}

// ---- 新增 ----

/** 預填網址：編輯器選取文字 → 剪貼簿，第一個像網址的片段。 */
async function initialUrl(): Promise<string> {
  const editor = vscode.window.activeTextEditor;
  if (editor && !editor.selection.isEmpty) {
    const fromSelection = findUrl(editor.document.getText(editor.selection));
    if (fromSelection) {
      return fromSelection;
    }
  }
  return findUrl(await vscode.env.clipboard.readText());
}

export async function addBookmark({ provider }: BookmarkDeps): Promise<void> {
  const client = requireClient(provider);
  if (!client) {
    return;
  }
  const input = await vscode.window.showInputBox({
    title: vscode.l10n.t('Add Bookmark'),
    prompt: vscode.l10n.t('URL to save. The server fetches the page and fills in the title, summary, category and tags.'),
    placeHolder: 'https://',
    value: await initialUrl(),
    ignoreFocusOut: true,
    validateInput: (value) => {
      const trimmed = value.trim();
      if (trimmed === '') {
        return vscode.l10n.t('Enter a URL.');
      }
      if (trimmed.length > MAX_URL_LENGTH) {
        return vscode.l10n.t('The URL is too long (max {0} characters).', String(MAX_URL_LENGTH));
      }
      return isWebUrl(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`)
        ? undefined
        : vscode.l10n.t('Only http and https URLs can be saved.');
    },
  });
  if (input === undefined) {
    return;
  }
  try {
    const bookmark = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: prefixed(vscode.l10n.t('Saving… fetching the page and summarizing can take a few seconds.')),
      },
      () => client.create(input.trim()),
    );
    provider.upsert(bookmark);
    await provider.reveal(bookmark.id);
    statusMessage(vscode.l10n.t('Saved “{0}”', oneLine(bookmark.title || bookmark.url, 60)));
  } catch (error) {
    if (error instanceof ApiError && error.status === 409 && error.existingId !== undefined) {
      await showExisting(provider, error.existingId);
      return;
    }
    showError(error);
  }
}

async function showExisting(provider: ShelfTreeProvider, id: number): Promise<void> {
  const show = vscode.l10n.t('Show');
  const choice = await vscode.window.showInformationMessage(prefixed(vscode.l10n.t('This URL is already saved.')), show);
  if (choice !== show) {
    return;
  }
  if (!provider.find(id)) {
    try {
      const client = provider.getClient();
      if (!client) {
        return;
      }
      provider.upsert(await client.get(id));
    } catch (error) {
      showError(error);
      return;
    }
  }
  await provider.reveal(id);
}

// ---- 編輯 ----

export async function editBookmark(deps: BookmarkDeps, arg: unknown): Promise<void> {
  const bookmark = bookmarkFromArg(deps.provider, arg);
  if (!bookmark) {
    return;
  }
  const picked = await vscode.window.showQuickPick(
    EDITABLE_FIELDS.map((field) => ({
      label: fieldLabel(field),
      description: oneLine(field === 'tags' ? formatTags(bookmark.tags) : bookmark[field], 80),
      field,
    })),
    { title: vscode.l10n.t('Edit “{0}”', oneLine(bookmark.title || bookmark.url, 60)), placeHolder: vscode.l10n.t('Choose a field to edit') },
  );
  if (picked) {
    await editBookmarkField(deps, bookmark, picked.field);
  }
}

export async function editFieldCommand(deps: BookmarkDeps, arg: unknown): Promise<void> {
  const bookmark = bookmarkFromArg(deps.provider, arg);
  const field = typeof arg === 'object' && arg !== null ? (arg as { field?: unknown }).field : undefined;
  if (bookmark && isEditableField(field)) {
    await editBookmarkField(deps, bookmark, field);
  }
}

async function editBookmarkField({ provider }: BookmarkDeps, bookmark: Bookmark, field: EditableField): Promise<void> {
  const client = requireClient(provider);
  if (!client) {
    return;
  }
  const title = vscode.l10n.t('Edit {0} — {1}', fieldLabel(field), oneLine(bookmark.title || bookmark.url, 50));
  let patch: Partial<Pick<Bookmark, EditableField>>;

  if (field === 'tags') {
    const input = await vscode.window.showInputBox({
      title,
      prompt: vscode.l10n.t('Separate tags with commas. Up to {0} tags.', String(MAX_TAGS)),
      value: formatTags(bookmark.tags),
      ignoreFocusOut: true,
      validateInput: (value) =>
        value.split(/[,，、]/).filter((part) => part.trim() !== '').length > MAX_TAGS
          ? vscode.l10n.t('Up to {0} tags.', String(MAX_TAGS))
          : undefined,
    });
    if (input === undefined) {
      return;
    }
    const tags = parseTagsInput(input);
    if (formatTags(tags) === formatTags(bookmark.tags)) {
      return;
    }
    patch = { tags };
  } else if (field === 'category') {
    const category = await pickOrType({
      title,
      placeholder: vscode.l10n.t('Pick a category or type a new one. Leave empty for none.'),
      values: provider.categories(),
      current: bookmark.category,
      maxLength: FIELD_LIMITS.category,
    });
    if (category === undefined || category === bookmark.category) {
      return;
    }
    patch = { category };
  } else {
    const multiline = field === 'summary' || field === 'note';
    const limit = FIELD_LIMITS[field];
    const input = await vscode.window.showInputBox({
      title,
      prompt: multiline
        ? vscode.l10n.t('Type {0} for a line break. Up to {1} characters.', '\\n', String(limit))
        : vscode.l10n.t('Up to {0} characters.', String(limit)),
      value: multiline ? encodeMultiline(bookmark[field]) : bookmark[field],
      ignoreFocusOut: true,
      validateInput: (value) =>
        (multiline ? decodeMultiline(value) : value).length > limit
          ? vscode.l10n.t('Too long: {0} / {1} characters.', String((multiline ? decodeMultiline(value) : value).length), String(limit))
          : undefined,
    });
    if (input === undefined) {
      return;
    }
    const value = multiline ? decodeMultiline(input) : input.trim();
    if (value === bookmark[field]) {
      return;
    }
    patch = { [field]: value };
  }

  try {
    const updated = await vscode.window.withProgress({ location: { viewId: VIEW_ID } }, () => client.update(bookmark.id, patch));
    provider.upsert(updated);
    statusMessage(vscode.l10n.t('Saved {0}', fieldLabel(field)));
  } catch (error) {
    showError(error);
  }
}

/** QuickPick：從既有值挑一個，或直接輸入新值。按 Esc 回傳 undefined。 */
function pickOrType(options: {
  title: string;
  placeholder: string;
  values: readonly string[];
  current: string;
  maxLength: number;
}): Promise<string | undefined> {
  return new Promise((resolve) => {
    const quickPick = vscode.window.createQuickPick<vscode.QuickPickItem & { value: string }>();
    quickPick.title = options.title;
    quickPick.placeholder = options.placeholder;
    quickPick.ignoreFocusOut = true;
    const existing = options.values.map((value) => ({
      label: value,
      description: value === options.current ? vscode.l10n.t('current') : undefined,
      value,
    }));
    const refreshItems = (): void => {
      const typed = quickPick.value.trim().slice(0, options.maxLength);
      const exact = existing.some((item) => item.value === typed);
      const typedItem = typed === ''
        ? { label: vscode.l10n.t('$(circle-slash) None'), value: '', alwaysShow: true }
        : { label: vscode.l10n.t('$(add) Use “{0}”', typed), value: typed, alwaysShow: true };
      quickPick.items = exact ? existing : [typedItem, ...existing];
    };
    let settled = false;
    quickPick.onDidChangeValue(refreshItems);
    quickPick.onDidAccept(() => {
      const item = quickPick.selectedItems[0] ?? quickPick.activeItems[0];
      settled = true;
      resolve(item ? item.value : quickPick.value.trim().slice(0, options.maxLength));
      quickPick.hide();
    });
    quickPick.onDidHide(() => {
      if (!settled) {
        resolve(undefined);
      }
      quickPick.dispose();
    });
    refreshItems();
    quickPick.activeItems = quickPick.items.filter((item) => item.value === options.current).slice(0, 1);
    quickPick.show();
  });
}

// ---- 刪除 ----

export async function deleteBookmark({ provider }: BookmarkDeps, arg: unknown): Promise<void> {
  const bookmark = bookmarkFromArg(provider, arg);
  const client = bookmark ? requireClient(provider) : undefined;
  if (!bookmark || !client) {
    return;
  }
  const remove = vscode.l10n.t('Delete');
  const choice = await vscode.window.showWarningMessage(
    prefixed(vscode.l10n.t('Delete “{0}”?', oneLine(bookmark.title || bookmark.url, 80))),
    { modal: true, detail: vscode.l10n.t('The bookmark is deleted on the server and cannot be restored.') },
    remove,
  );
  if (choice !== remove) {
    return;
  }
  try {
    await vscode.window.withProgress({ location: { viewId: VIEW_ID } }, () => client.remove(bookmark.id));
    provider.remove(bookmark.id);
    statusMessage(vscode.l10n.t('Deleted “{0}”', oneLine(bookmark.title || bookmark.url, 60)));
  } catch (error) {
    showError(error);
  }
}

// ---- 開啟與複製 ----

async function openWebUrl(url: string): Promise<void> {
  if (!isWebUrl(url)) {
    void vscode.window.showWarningMessage(prefixed(vscode.l10n.t('Only http and https links can be opened.')));
    return;
  }
  await vscode.env.openExternal(vscode.Uri.parse(url, true));
}

export async function openBookmark({ provider }: BookmarkDeps, arg: unknown): Promise<void> {
  const bookmark = bookmarkFromArg(provider, arg);
  if (bookmark) {
    await openWebUrl(bookmark.url);
  }
}

export async function openSharePage({ provider }: BookmarkDeps, arg: unknown): Promise<void> {
  const bookmark = bookmarkFromArg(provider, arg);
  const connection = provider.getConnection();
  const url = bookmark && connection ? sharePageUrl(connection.baseUrl, bookmark.shareId) : undefined;
  if (url) {
    await openWebUrl(url);
  }
}

export async function openWebsite({ provider }: BookmarkDeps): Promise<void> {
  const connection = provider.getConnection();
  if (connection) {
    await openWebUrl(connection.baseUrl);
  }
}

export async function copyUrl({ provider }: BookmarkDeps, arg: unknown): Promise<void> {
  const bookmark = bookmarkFromArg(provider, arg);
  if (bookmark) {
    await vscode.env.clipboard.writeText(bookmark.url);
    statusMessage(vscode.l10n.t('Copied the URL'));
  }
}

export async function copyMarkdownLink({ provider }: BookmarkDeps, arg: unknown): Promise<void> {
  const bookmark = bookmarkFromArg(provider, arg);
  if (bookmark) {
    await vscode.env.clipboard.writeText(markdownLink(bookmark));
    statusMessage(vscode.l10n.t('Copied a Markdown link'));
  }
}

// ---- 搜尋與篩選 ----

export async function search({ provider }: BookmarkDeps): Promise<void> {
  if (!requireClient(provider)) {
    return;
  }
  const input = await vscode.window.showInputBox({
    title: vscode.l10n.t('Search Bookmarks'),
    prompt: vscode.l10n.t('Keywords separated by spaces; all must match title, summary, note, URL, category or tags. Leave empty to clear.'),
    value: provider.getFilter().q ?? '',
  });
  if (input !== undefined) {
    await provider.setFilter({ q: input.trim().slice(0, 200) || undefined });
  }
}

export async function filterByTag({ provider }: BookmarkDeps): Promise<void> {
  if (!requireClient(provider)) {
    return;
  }
  const current = provider.getFilter().tag ?? '';
  const tag = await pickOrType({
    title: vscode.l10n.t('Filter by Tag'),
    placeholder: vscode.l10n.t('Pick a tag. Choose None to clear the tag filter.'),
    values: provider.tags(),
    current,
    maxLength: 30,
  });
  if (tag !== undefined && tag !== current) {
    await provider.setFilter({ tag: tag.replace(/^#+/, '') || undefined });
  }
}

export async function filterBySite({ provider }: BookmarkDeps): Promise<void> {
  if (!requireClient(provider)) {
    return;
  }
  const current = provider.getFilter().site ?? '';
  const site = await pickOrType({
    title: vscode.l10n.t('Filter by Website'),
    placeholder: vscode.l10n.t('Pick a website. Choose None to clear the website filter.'),
    values: provider.sites(),
    current,
    maxLength: 200,
  });
  if (site !== undefined && site !== current) {
    await provider.setFilter({ site: site || undefined });
  }
}

export async function sortBy({ provider, saveSort }: BookmarkDeps): Promise<void> {
  const current = provider.getFilter().sort;
  const picked = await vscode.window.showQuickPick(
    SORTS.map((sort) => ({
      label: sortLabel(sort),
      description: sort === current ? vscode.l10n.t('current') : undefined,
      detail: sort === 'clicked' ? vscode.l10n.t('Only bookmarks that have been clicked') : undefined,
      sort,
    })),
    { title: vscode.l10n.t('Sort Bookmarks') },
  );
  if (picked && picked.sort !== current) {
    await saveSort(picked.sort);
    await provider.setFilter({ sort: picked.sort });
  }
}

export async function clearFilters({ provider }: BookmarkDeps): Promise<void> {
  await provider.setFilter({ q: undefined, tag: undefined, site: undefined });
}
