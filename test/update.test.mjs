import test from 'node:test';
import assert from 'node:assert/strict';

import { checkForUpdate, resetUpdateCache } from '../lib/update.mjs';

test('update check detects a newer tag and reuses the cache', async () => {
  resetUpdateCache();
  const value = await checkForUpdate('0.5.0', {
    now: 1000,
    ttlMs: 1,
    fetchImpl: async () => ({
      ok: true,
      json: async () => [{ name: 'v0.4.3' }, { name: 'v0.9.1' }],
    }),
  });
  assert.equal(value.currentVersion, '0.5.0');
  assert.equal(value.latestVersion, '0.9.1');
  assert.equal(value.updateAvailable, true);

  const cached = await checkForUpdate('0.5.0', {
    now: 1001,
    ttlMs: 3600000,
    fetchImpl: async () => { throw new Error('network must not be called'); },
  });
  assert.equal(cached.latestVersion, '0.9.1');
  resetUpdateCache();
});

test('update check stays false when the current version is latest', async () => {
  resetUpdateCache();
  const value = await checkForUpdate('0.5.0', {
    now: 2000,
    ttlMs: 1,
    fetchImpl: async () => ({
      ok: true,
      json: async () => [{ name: 'v0.5.0' }, { name: 'v0.4.3' }],
    }),
  });
  assert.equal(value.latestVersion, '0.5.0');
  assert.equal(value.updateAvailable, false);
  resetUpdateCache();
});
