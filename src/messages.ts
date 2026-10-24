// 使用者看得到的錯誤說明與通知前綴。字串一律 vscode.l10n.t，翻譯在 l10n/。

import * as vscode from 'vscode';

import { ApiError } from './core/client';

export function prefixed(message: string): string {
  return vscode.l10n.t('Bookmark Shelf: {0}', message);
}

/** API 錯誤 → 一句使用者看得懂、知道下一步的說明。 */
export function describeError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return error instanceof Error ? error.message : String(error);
  }
  switch (error.kind) {
    case 'timeout':
      return vscode.l10n.t('The server did not respond in time. Try again later.');
    case 'network':
      return vscode.l10n.t('Could not reach the server ({0}). Check the domain and your network.', error.detail);
    case 'redirect':
      return vscode.l10n.t('The server answered with a redirect ({0}). Check that the domain points to your Bookmark Shelf.', String(error.status));
    case 'invalidResponse':
      return vscode.l10n.t('The response does not come from Bookmark Shelf. Check that the domain is correct.');
    case 'http':
      return describeStatus(error);
  }
}

function describeStatus(error: ApiError): string {
  switch (error.status) {
    case 401:
      return vscode.l10n.t('Wrong username or password, or the app credential has been deleted.');
    case 403:
      return vscode.l10n.t('Permission denied: {0}', error.detail || '403');
    case 404:
      return error.detail
        ? vscode.l10n.t('Not found: {0}', error.detail)
        : vscode.l10n.t('API not found. Check that the domain points to your Bookmark Shelf.');
    case 409:
      return vscode.l10n.t('This URL is already saved.');
    case 503:
      return vscode.l10n.t('The server has no login password yet. Set AUTH_PASS with wrangler secret put AUTH_PASS.');
    default:
      return error.detail
        ? vscode.l10n.t('Server error {0}: {1}', String(error.status), error.detail)
        : vscode.l10n.t('Server error {0}.', String(error.status));
  }
}
