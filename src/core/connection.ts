// 連線設定（網域＋應用程式帳密）的正規化與驗證。整份存在 SecretStorage，不放設定檔：
// 網域若放在設定裡，工作區的 .vscode/settings.json 就能把帳密導到別的主機。

export interface Connection {
  /** 只有 origin，例：`https://bookmark.example.com`，結尾沒有斜線。 */
  baseUrl: string;
  username: string;
  password: string;
}

export type BaseUrlResult =
  | { ok: true; url: string }
  | { ok: false; reason: 'empty' | 'invalid' | 'insecure' | 'credentials' };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * 使用者輸入的網域 → origin。沒寫協定補 `https://`；路徑、查詢字串一律捨去（貼上 `/login` 也能用）。
 * 只接受 https；http 只限本機（開發用 `wrangler dev`）。網址內含帳密直接拒絕，避免帳密跟網址一起被記錄。
 */
export function normalizeBaseUrl(input: string): BaseUrlResult {
  const trimmed = input.trim();
  if (trimmed === '') {
    return { ok: false, reason: 'empty' };
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'credentials' };
  }
  if (url.protocol === 'http:' && !LOCAL_HOSTS.has(url.hostname)) {
    return { ok: false, reason: 'insecure' };
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.hostname === '') {
    return { ok: false, reason: 'invalid' };
  }
  return { ok: true, url: url.origin };
}

/** Basic Auth 的帳號不能含冒號（冒號是帳號與密碼的分隔）。 */
export function isValidUsername(username: string): boolean {
  return username.length > 0 && username.length <= 200 && !username.includes(':') && !/[\r\n]/.test(username);
}

export function isValidPassword(password: string): boolean {
  return password.length > 0 && password.length <= 1000 && !/[\r\n]/.test(password);
}

/** 設定頁建立的應用程式帳密固定 `app-` 開頭；其他帳號多半是權限完整的登入帳密。 */
export function looksLikeAppCredential(username: string): boolean {
  return /^app-[0-9a-f]{12}$/.test(username);
}

export function serializeConnection(connection: Connection): string {
  return JSON.stringify(connection);
}

/** SecretStorage 讀回來的字串逐欄驗證；壞掉或不完整就當作沒設定。 */
export function parseConnection(raw: string | undefined): Connection | undefined {
  if (!raw) {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const { baseUrl, username, password } = record;
  if (typeof baseUrl !== 'string' || typeof username !== 'string' || typeof password !== 'string') {
    return undefined;
  }
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized.ok || !isValidUsername(username) || !isValidPassword(password)) {
    return undefined;
  }
  return { baseUrl: normalized.url, username, password };
}

export function basicAuthHeader(connection: Pick<Connection, 'username' | 'password'>): string {
  return `Basic ${Buffer.from(`${connection.username}:${connection.password}`, 'utf8').toString('base64')}`;
}

/** 顯示用：只留主機名稱（含非預設埠）。 */
export function displayHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}
