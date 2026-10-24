// 連線設定流程：依序輸入網域、帳號、密碼，連線測試通過才存進 SecretStorage。

import * as vscode from 'vscode';

import { BookmarkClient } from '../core/client';
import type { Connection } from '../core/connection';
import { displayHost, isValidPassword, isValidUsername, looksLikeAppCredential, normalizeBaseUrl } from '../core/connection';
import { describeError, prefixed } from '../messages';
import type { ConnectionStore } from '../storage/connectionStore';

export const DEPLOY_REPO_URL = 'https://github.com/lazyjerry/bookmark-shelf';
/** README〈部署〉節：一鍵部署、手動部署與應用程式帳密的建立方式。 */
export const DEPLOY_GUIDE_URL = `${DEPLOY_REPO_URL}#部署`;

export interface ConnectionDeps {
  store: ConnectionStore;
  userAgent: string;
  current: () => Connection | undefined;
}

function baseUrlProblem(value: string): string | undefined {
  const result = normalizeBaseUrl(value);
  if (result.ok) {
    return undefined;
  }
  switch (result.reason) {
    case 'empty':
      return vscode.l10n.t('Enter the domain of your Bookmark Shelf.');
    case 'insecure':
      return vscode.l10n.t('Use https. Plain http is only allowed for localhost.');
    case 'credentials':
      return vscode.l10n.t('Do not put the username or password in the URL.');
    case 'invalid':
      return vscode.l10n.t('This is not a valid domain or URL.');
  }
}

/** 回傳 true 代表已存入新的連線設定。 */
export async function configureConnection(deps: ConnectionDeps): Promise<boolean> {
  const saved = deps.current();
  let draft = { baseUrl: saved?.baseUrl ?? '', username: saved?.username ?? '' };

  for (;;) {
    const baseUrlInput = await vscode.window.showInputBox({
      title: vscode.l10n.t('Connect to Bookmark Shelf (1/3)'),
      prompt: vscode.l10n.t('Domain of your deployed Bookmark Shelf, e.g. bookmark-shelf.<account>.workers.dev or your custom domain.'),
      placeHolder: 'bookmark.example.com',
      value: draft.baseUrl,
      ignoreFocusOut: true,
      validateInput: baseUrlProblem,
    });
    if (baseUrlInput === undefined) {
      return false;
    }
    const normalized = normalizeBaseUrl(baseUrlInput);
    if (!normalized.ok) {
      return false;
    }
    const baseUrl = normalized.url;

    const usernameInput = await vscode.window.showInputBox({
      title: vscode.l10n.t('Connect to Bookmark Shelf (2/3)'),
      prompt: vscode.l10n.t('App credential username. Create one on the website: Settings → App credentials.'),
      placeHolder: 'app-xxxxxxxxxxxx',
      value: draft.username,
      ignoreFocusOut: true,
      validateInput: (value) =>
        isValidUsername(value.trim()) ? undefined : vscode.l10n.t('Enter the username (no colon).'),
    });
    if (usernameInput === undefined) {
      return false;
    }
    const username = usernameInput.trim();

    // 網域與帳號都沒變時可以留空沿用已存的密碼
    const canKeepPassword = saved !== undefined && saved.baseUrl === baseUrl && saved.username === username;
    const passwordInput = await vscode.window.showInputBox({
      title: vscode.l10n.t('Connect to Bookmark Shelf (3/3)'),
      prompt: canKeepPassword
        ? vscode.l10n.t('App credential password. Leave empty to keep the saved one.')
        : vscode.l10n.t('App credential password. It is shown only once, right after the credential is created.'),
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) =>
        (value === '' && canKeepPassword) || isValidPassword(value) ? undefined : vscode.l10n.t('Enter the password.'),
    });
    if (passwordInput === undefined) {
      return false;
    }
    const password = passwordInput === '' && canKeepPassword ? saved.password : passwordInput;
    draft = { baseUrl, username };

    if (!looksLikeAppCredential(username)) {
      const proceed = vscode.l10n.t('Use Anyway');
      const choice = await vscode.window.showWarningMessage(
        prefixed(vscode.l10n.t('This does not look like an app credential (app- followed by 12 characters).')),
        {
          modal: true,
          detail: vscode.l10n.t(
            'The login account (AUTH_USER / AUTH_PASS) can change every setting. An app credential can only read and write bookmarks, and can be deleted on its own if it leaks.',
          ),
        },
        proceed,
      );
      if (choice !== proceed) {
        continue;
      }
    }

    const connection: Connection = { baseUrl, username, password };
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: prefixed(vscode.l10n.t('Testing the connection…')) },
        () => new BookmarkClient(connection, { userAgent: deps.userAgent }).ping(),
      );
    } catch (error) {
      const retry = vscode.l10n.t('Try Again');
      const guide = vscode.l10n.t('Deployment Guide');
      const choice = await vscode.window.showErrorMessage(
        prefixed(vscode.l10n.t('Connection failed: {0}', describeError(error))),
        retry,
        guide,
      );
      if (choice === retry) {
        continue;
      }
      if (choice === guide) {
        await openDeployGuide();
      }
      return false;
    }

    await deps.store.save(connection);
    vscode.window.setStatusBarMessage(prefixed(vscode.l10n.t('Connected to {0}', displayHost(baseUrl))), 4000);
    return true;
  }
}

export async function disconnect(store: ConnectionStore): Promise<boolean> {
  const remove = vscode.l10n.t('Remove');
  const choice = await vscode.window.showWarningMessage(
    prefixed(vscode.l10n.t('Remove the saved domain and app credential from this computer?')),
    {
      modal: true,
      detail: vscode.l10n.t('The credential itself stays valid on the server. Delete it on the website if you no longer need it.'),
    },
    remove,
  );
  if (choice !== remove) {
    return false;
  }
  await store.clear();
  return true;
}

export async function openDeployGuide(): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse(DEPLOY_GUIDE_URL));
}
