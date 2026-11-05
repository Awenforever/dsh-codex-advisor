import test from 'node:test';
import assert from 'node:assert/strict';

import {
  UpdateService,
  compareVersions,
  normalizeVersion,
  parseGitHubRelease,
  resolveUpdateProvider,
  specForVersion,
} from '../lib/update.mjs';

function release(version, body = '') {
  return {
    ok: true,
    json: async () => ({
      tag_name: `v${version}`,
      name: `v${version}`,
      body,
      html_url: `https://github.com/Awenforever/dsh-codex-advisor/releases/tag/v${version}`,
      published_at: '2026-11-05T00:00:00Z',
    }),
  };
}

test('update check uses the latest release and reuses the cache', async () => {
  let now = 1000;
  let fetchCount = 0;
  const service = new UpdateService({}, {
    currentVersion: '0.5.0',
    ttlMs: 3600000,
    now: () => now,
    fetchImpl: async () => {
      fetchCount += 1;
      return release('0.9.1', '- fix one thing');
    },
  });
  const value = await service.check();
  assert.equal(value.currentVersion, '0.5.0');
  assert.equal(value.latestVersion, '0.9.1');
  assert.equal(value.updateAvailable, true);
  assert.equal(value.releaseNotes, '- fix one thing');
  assert.equal(value.spec, specForVersion('0.9.1'));
  assert.equal(value.canApply, false);

  now = 1001;
  const cached = await service.check();
  assert.equal(cached.latestVersion, '0.9.1');
  assert.equal(fetchCount, 1);

  now = 1002;
  service.fetchImpl = async () => {
    fetchCount += 1;
    return release('1.1.0');
  };
  const forced = await service.check(true);
  assert.equal(forced.latestVersion, '1.1.0');
  assert.equal(fetchCount, 2);
});

test('update check reports no update when the release is current', async () => {
  const service = new UpdateService({}, {
    currentVersion: '0.5.0',
    now: () => 2000,
    fetchImpl: async () => release('0.5.0'),
  });
  const value = await service.check(true);
  assert.equal(value.latestVersion, '0.5.0');
  assert.equal(value.updateAvailable, false);
});

test('apply delegates to the plugin manager with the release spec', async () => {
  let installed = null;
  const ctx = {
    get: (key) => (key === 'pluginManager'
      ? { installBundle: async (spec) => { installed = spec; return { application: 'applied', changed: true }; } }
      : undefined),
  };
  const service = new UpdateService(ctx, {
    currentVersion: '0.5.0',
    now: () => 3000,
    fetchImpl: async () => release('0.6.0'),
  });
  const info = await service.check(true);
  assert.equal(info.canApply, true);
  const result = await service.apply({ spec: info.spec });
  assert.equal(result.ok, true);
  assert.equal(result.application, 'applied');
  assert.equal(installed, info.spec);
  assert.equal(result.provider.id, 'dsh-plugin-manager');
});

test('apply rejects a stale spec and a manual provider', async () => {
  const service = new UpdateService({}, {
    currentVersion: '0.5.0',
    now: () => 4000,
    fetchImpl: async () => release('0.6.0'),
  });
  const info = await service.check(true);
  const stale = await service.apply({ spec: 'https://example.invalid/stale.tar.gz' });
  assert.equal(stale.ok, false);
  assert.equal(stale.error, 'stale-update');
  const manual = await service.apply({ spec: info.spec });
  assert.equal(manual.ok, false);
  assert.equal(manual.error, 'provider-unavailable');
  assert.equal(resolveUpdateProvider({}).canApply, false);
});

test('version parsing and release parsing are defensive', () => {
  assert.equal(normalizeVersion('v0.6.0'), '0.6.0');
  assert.ok(compareVersions('0.10.0', '0.9.9') > 0);
  assert.deepEqual(parseGitHubRelease({
    tag_name: 'v1.2.3',
    name: 'One two three',
    body: 'notes',
    html_url: 'https://example.invalid/release',
  }), {
    version: '1.2.3',
    tag: 'v1.2.3',
    htmlUrl: 'https://example.invalid/release',
    name: 'One two three',
    notes: 'notes',
    publishedAt: null,
  });
});
