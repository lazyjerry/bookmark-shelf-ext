import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

// out/test/unit/ → 專案根
const root = path.resolve(__dirname, '..', '..', '..');

function readJson(file: string): Record<string, string> {
  return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')) as Record<string, string>;
}

function listSources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listSources(full) : entry.name.endsWith('.ts') ? [full] : [];
  });
}

suite('package.nls', () => {
  const english = readJson('package.nls.json');
  const chinese = readJson('package.nls.zh-tw.json');

  test('英文與繁中的 key 集合相同', () => {
    assert.deepEqual(Object.keys(chinese).sort(), Object.keys(english).sort());
  });

  test('package.json 的每個 %key% 都有翻譯，且沒有多餘的 key', () => {
    const manifest = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
    const used = new Set([...manifest.matchAll(/%([\w.-]+)%/g)].map((match) => match[1]));
    assert.deepEqual([...used].sort(), Object.keys(english).sort());
  });

  test('每條設定都有 description', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      contributes: { configuration: { properties: Record<string, { description?: string; markdownDescription?: string }> } };
    };
    for (const [key, property] of Object.entries(manifest.contributes.configuration.properties)) {
      assert.ok(property.description ?? property.markdownDescription, `${key} 缺少說明`);
    }
  });
});

suite('l10n bundle', () => {
  const english = readJson('l10n/bundle.l10n.json');
  const chinese = readJson('l10n/bundle.l10n.zh-tw.json');

  test('英文 bundle 是 key 對自己，繁中 key 集合相同', () => {
    for (const [key, value] of Object.entries(english)) {
      assert.equal(value, key);
    }
    assert.deepEqual(Object.keys(chinese).sort(), Object.keys(english).sort());
  });

  test('程式裡每個 l10n.t() 的字串都在 bundle 內，bundle 也沒有沒用到的字串', () => {
    const used = new Set<string>();
    for (const file of listSources(path.join(root, 'src'))) {
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(/l10n\.t\(\s*'((?:[^'\\]|\\.)*)'/g)) {
        used.add(match[1]);
      }
    }
    assert.deepEqual([...used].sort(), Object.keys(english).sort());
  });
});
