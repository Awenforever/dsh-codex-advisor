import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AdvisorManager, resolveConfig } from '../lib/manager.mjs';
import { AdvisorStore } from '../lib/store.mjs';
import { nodeSpawn } from '../lib/spawn.mjs';

const FAKE = fileURLToPath(new URL('./fake-app-server.mjs', import.meta.url));
const CWD = process.cwd();

function makeManager(dir) {
  const store = new AdvisorStore({ dir });
  store.load();
  const config = resolveConfig({
    codexArgv: [process.execPath, FAKE],
    stateDir: dir,
    defaultWaitSeconds: 5,
    maxWaitSeconds: 10,
    idleRecycleMs: 0,
    quotaCheckTtlMs: 0,
    approvalForExpensive: false,
    env: {
      FAKE_CODEX_STATE: join(dir, 'fake-state.json'),
      FAKE_CODEX_MODE: 'normal',
      FAKE_CODEX_TURN_DELAY_MS: '20',
    },
  });
  return new AdvisorManager({ ctx: {}, config, store, logger: () => {}, spawn: nodeSpawn(), cwdResolver: async () => CWD });
}

const execFor = (id = 'sess-prefs') => ({ agent: { id }, signal: new AbortController().signal });

test('a model chosen by the user switches the thread on the next ask', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'advisor-prefs-'));
  const manager = makeManager(dir);
  const first = await manager.ask({ message: 'first' }, execFor());
  assert.equal(first.model, 'gpt-6.1-terra');

  manager.setPrefs('sess-prefs', { model: 'astra' });
  const second = await manager.ask({ message: 'second' }, execFor());
  assert.notEqual(second.thread_id, first.thread_id);
  assert.equal(second.model, 'gpt-6-astra');
  assert.equal(manager.snapshot({}, execFor()).prefs.model, 'astra');

  // The preference is a target, not a per-ask reset: the new thread already uses it.
  const third = await manager.ask({ message: 'third' }, execFor());
  assert.equal(third.thread_id, second.thread_id);
  await manager.dispose();
});

test('effort chosen by the user overrides the routing policy', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'advisor-prefs-'));
  const manager = makeManager(dir);
  const first = await manager.ask({ message: 'architecture', purpose: 'architecture' }, execFor());
  assert.equal(first.effort, 'max');
  manager.setPrefs('sess-prefs', { effort: 'low' });
  const second = await manager.ask({ message: 'more', purpose: 'architecture' }, execFor());
  assert.equal(second.effort, 'low');
  assert.equal(second.model, 'gpt-6-astra');
  await manager.dispose();
});

test('clearing the preferences hands control back to the agent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'advisor-prefs-'));
  const manager = makeManager(dir);
  manager.setPrefs('sess-prefs', { model: 'astra', effort: 'low' });
  manager.setPrefs('sess-prefs', { model: '', effort: '' });
  const snapshot = manager.snapshot({}, execFor());
  assert.equal(snapshot.prefs.model, '');
  assert.equal(snapshot.prefs.effort, '');
  const result = await manager.ask({ message: 'routine work', purpose: 'routine' }, execFor());
  assert.equal(result.model, 'gpt-6-luna');
  assert.equal(result.effort, 'max');
  await manager.dispose();
});

test('an unknown effort is rejected at the boundary', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'advisor-prefs-'));
  const manager = makeManager(dir);
  assert.throws(
    () => manager.setPrefs('sess-prefs', { effort: 'turbo' }),
    (err) => err.code === 'CODEX_BAD_ARGS',
  );
  await manager.dispose();
});
