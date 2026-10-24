import * as assert from 'node:assert/strict';

import {
  basicAuthHeader,
  displayHost,
  isValidUsername,
  looksLikeAppCredential,
  normalizeBaseUrl,
  parseConnection,
  serializeConnection,
} from '../../src/core/connection';

suite('normalizeBaseUrl', () => {
  test('沒寫協定補 https，只留 origin', () => {
    assert.deepEqual(normalizeBaseUrl(' bookmark.example.com '), { ok: true, url: 'https://bookmark.example.com' });
    assert.deepEqual(normalizeBaseUrl('https://bookmark.example.com/login?next=/'), { ok: true, url: 'https://bookmark.example.com' });
    assert.deepEqual(normalizeBaseUrl('HTTPS://Bookmark.Example.com:8443/'), { ok: true, url: 'https://bookmark.example.com:8443' });
  });

  test('http 只允許本機', () => {
    assert.deepEqual(normalizeBaseUrl('http://localhost:8787'), { ok: true, url: 'http://localhost:8787' });
    assert.deepEqual(normalizeBaseUrl('http://127.0.0.1:8787'), { ok: true, url: 'http://127.0.0.1:8787' });
    assert.deepEqual(normalizeBaseUrl('http://bookmark.example.com'), { ok: false, reason: 'insecure' });
  });

  test('拒絕空白、帶帳密、其他協定與壞網址', () => {
    assert.deepEqual(normalizeBaseUrl('   '), { ok: false, reason: 'empty' });
    assert.deepEqual(normalizeBaseUrl('https://user:pass@example.com'), { ok: false, reason: 'credentials' });
    assert.deepEqual(normalizeBaseUrl('ftp://example.com'), { ok: false, reason: 'invalid' });
    assert.deepEqual(normalizeBaseUrl('file:///etc/passwd'), { ok: false, reason: 'invalid' });
    assert.deepEqual(normalizeBaseUrl('https://exa mple.com'), { ok: false, reason: 'invalid' });
  });
});

suite('帳密', () => {
  test('帳號不能含冒號或換行', () => {
    assert.equal(isValidUsername('app-0123456789ab'), true);
    assert.equal(isValidUsername('a:b'), false);
    assert.equal(isValidUsername('a\nb'), false);
    assert.equal(isValidUsername(''), false);
  });

  test('應用程式帳密格式', () => {
    assert.equal(looksLikeAppCredential('app-0123456789ab'), true);
    assert.equal(looksLikeAppCredential('admin'), false);
    assert.equal(looksLikeAppCredential('app-XYZ'), false);
  });

  test('Basic Auth header 以 UTF-8 編碼', () => {
    assert.equal(basicAuthHeader({ username: 'app-0123456789ab', password: 'p:w' }), `Basic ${Buffer.from('app-0123456789ab:p:w').toString('base64')}`);
    assert.equal(basicAuthHeader({ username: 'u', password: '密碼' }), `Basic ${Buffer.from('u:密碼', 'utf8').toString('base64')}`);
  });
});

suite('parseConnection', () => {
  const connection = { baseUrl: 'https://bookmark.example.com', username: 'app-0123456789ab', password: 'secret' };

  test('序列化後可以完整讀回', () => {
    assert.deepEqual(parseConnection(serializeConnection(connection)), connection);
  });

  test('壞資料當作沒設定', () => {
    assert.equal(parseConnection(undefined), undefined);
    assert.equal(parseConnection('not json'), undefined);
    assert.equal(parseConnection('null'), undefined);
    assert.equal(parseConnection(JSON.stringify({ ...connection, password: 1 })), undefined);
    assert.equal(parseConnection(JSON.stringify({ ...connection, baseUrl: 'http://evil.example.com' })), undefined);
  });

  test('顯示用主機名稱', () => {
    assert.equal(displayHost('https://bookmark.example.com'), 'bookmark.example.com');
    assert.equal(displayHost('http://localhost:8787'), 'localhost:8787');
  });
});
