import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { PANEL_DOCK_SPEC, PANEL_DOCK_VERSION, compareVersions, needsInstall, readInstalledVersion } from '../lib/panel-dock.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('panel-dock spec is pinned to an immutable tag', () => {
  assert.equal(PANEL_DOCK_SPEC, 'https://github.com/Awenforever/dsh-panel-dock/archive/refs/tags/v' + PANEL_DOCK_VERSION + '.tar.gz');
  assert.doesNotMatch(PANEL_DOCK_SPEC, /archive\/[0-9a-f]{40}\.tar\.gz/);
});

test('version comparison orders dotted releases', () => {
  assert.equal(compareVersions('0.3.12', '0.3.9'), 1);
  assert.equal(compareVersions('0.3.9', '0.3.12'), -1);
  assert.equal(compareVersions('0.3.12', '0.3.12'), 0);
  assert.equal(compareVersions('v0.4.0', '0.3.12'), 1);
  assert.equal(compareVersions('nope', '1.0.0'), null);
});

test('install is skipped when the installed copy is current or newer', () => {
  assert.equal(needsInstall(null), true);
  assert.equal(needsInstall('0.1.0'), true);
  assert.equal(needsInstall('0.3.9'), true);
  assert.equal(needsInstall(PANEL_DOCK_VERSION), false);
  assert.equal(needsInstall('0.4.0'), false);
  assert.equal(needsInstall('0.3.12', '0.3.9'), false);
});

test('a missing or unreadable install is repaired, not skipped', () => {
  assert.equal(readInstalledVersion(join(ROOT, 'does-not-exist')), null);
  assert.equal(needsInstall(readInstalledVersion(join(ROOT, 'does-not-exist'))), true);
});

test('the route refuses to downgrade and the client carries the same pin', () => {
  const index = readFileSync(join(ROOT, 'index.js'), 'utf8');
  assert.match(index, /needsInstall\(installedVersion\)/);
  assert.match(index, /application: 'up-to-date'/);
  const client = readFileSync(join(ROOT, 'client.js'), 'utf8');
  const spec = /const PANEL_DOCK_SPEC = '([^']+)'/.exec(client);
  assert.ok(spec, 'client must carry the spec');
  assert.equal(spec[1], PANEL_DOCK_SPEC);
});
