import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

test('bundle manifest declares the patch and runtime files', () => {
  assert.equal(manifest.name, 'dsh-codex-advisor');
  assert.equal(manifest.private, false);
  assert.equal(manifest.type, 'module');
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml');
  assert.ok(manifest.engines?.dsh, 'public package must declare an engines.dsh range');
  assert.ok(!manifest.files.includes('docs/*.md'), 'internal docs must not ship in the npm package');
  for (const file of ['index.js', 'cordis.patch.yml', 'locale/en.json', 'locale/zh.json', 'icon.svg', 'lib/jsonrpc.mjs', 'lib/codex.mjs', 'lib/manager.mjs', 'lib/store.mjs', 'lib/spawn.mjs']) {
    assert.ok(existsSync(join(ROOT, file)), `missing ${file}`);
  }
  for (const pattern of ['index.js', 'lib/*.mjs', 'cordis.patch.yml', 'locale/*.json', 'icon.svg']) {
    assert.ok(manifest.files.includes(pattern), `files[] is missing ${pattern}`);
  }
});

test('patch inserts exactly one row with this package name', () => {
  const patch = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8');
  assert.match(patch, /- insert:/);
  assert.match(patch, /id: codex-advisor/);
  assert.match(patch, /name: dsh-codex-advisor/);
  assert.equal((patch.match(/name: dsh-codex-advisor/g) ?? []).length, 1);
});

test('locale metadata is meaningful', () => {
  const en = JSON.parse(readFileSync(join(ROOT, 'locale/en.json'), 'utf8'));
  const zh = JSON.parse(readFileSync(join(ROOT, 'locale/zh.json'), 'utf8'));
  assert.ok(en.meta.title && en.meta.description);
  assert.ok(zh.meta.title && zh.meta.description);
  assert.notEqual(en.meta.title, 'My Decoration');
});
