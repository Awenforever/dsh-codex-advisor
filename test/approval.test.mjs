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

function makeManager({ dir, approvalWaitSeconds = 5 }) {
  const store = new AdvisorStore({ dir });
  store.load();
  const config = resolveConfig({
    codexArgv: [process.execPath, FAKE],
    stateDir: dir,
    defaultWaitSeconds: 5,
    maxWaitSeconds: 10,
    idleRecycleMs: 0,
    quotaCheckTtlMs: 0,
    approvalForExpensive: true,
    approvalWaitSeconds,
    env: {
      FAKE_CODEX_STATE: join(dir, 'fake-state.json'),
      FAKE_CODEX_MODE: 'normal',
      FAKE_CODEX_TURN_DELAY_MS: '20',
    },
  });
  const manager = new AdvisorManager({ ctx: {}, config, store, logger: () => {}, spawn: nodeSpawn(), cwdResolver: async () => CWD });
  return { manager, store };
}

const execFor = (id = 'sess-approval') => ({ agent: { id }, signal: new AbortController().signal });

async function waitForPending(manager, key, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const pending = manager.pendingApprovalFor(key);
    if (pending) return pending;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('approval never appeared');
}

test('an expensive ask waits for a human and runs only after approval', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'advisor-approval-'));
  const { manager } = makeManager({ dir });
  const pendingAsk = manager.ask({ message: 'implement the parser', purpose: 'implement' }, execFor());
  const pending = await waitForPending(manager, 'sess-approval');
  assert.equal(pending.model, 'gpt-6.1-sol');
  assert.equal(pending.effort, 'medium');
  assert.match(pending.preview, /implement the parser/);
  // Nothing has been sent yet: no thread exists before the click.
  assert.equal(manager.store.get('sess-approval'), null);
  assert.equal(manager.resolveApproval(pending.id, 'approve').ok, true);
  const result = await pendingAsk;
  assert.equal(result.status, 'completed');
  assert.equal(result.model, 'gpt-6.1-sol');
  assert.equal(manager.pendingApprovalFor('sess-approval'), null);
  await manager.dispose();
});

test('rejecting an expensive ask sends nothing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'advisor-approval-'));
  const { manager } = makeManager({ dir });
  const pendingAsk = manager.ask({ message: 'review this', purpose: 'review' }, execFor());
  const pending = await waitForPending(manager, 'sess-approval');
  manager.resolveApproval(pending.id, 'reject');
  await assert.rejects(pendingAsk, (err) => err.code === 'CODEX_APPROVAL_REJECTED');
  assert.equal(manager.store.get('sess-approval'), null);
  await manager.dispose();
});

test('luna is cheap and runs without approval', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'advisor-approval-'));
  const { manager } = makeManager({ dir });
  const result = await manager.ask({ message: 'run the tests', purpose: 'verify' }, execFor());
  assert.equal(result.status, 'completed');
  assert.equal(result.model, 'gpt-6-luna');
  assert.equal(manager.pendingApprovalFor('sess-approval'), null);
  await manager.dispose();
});

test('no click within the window reports a timeout instead of sending', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'advisor-approval-'));
  const { manager } = makeManager({ dir, approvalWaitSeconds: 1 });
  await assert.rejects(
    manager.ask({ message: 'slow approval', purpose: 'general' }, execFor()),
    (err) => err.code === 'CODEX_APPROVAL_TIMEOUT',
  );
  assert.equal(manager.store.get('sess-approval'), null);
  await manager.dispose();
});

test('one pending approval per session', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'advisor-approval-'));
  const { manager } = makeManager({ dir });
  const first = manager.ask({ message: 'first', purpose: 'general' }, execFor());
  const pending = await waitForPending(manager, 'sess-approval');
  await assert.rejects(
    manager.ask({ message: 'second', purpose: 'general' }, execFor()),
    (err) => err.code === 'CODEX_APPROVAL_BUSY',
  );
  manager.resolveApproval(pending.id, 'approve');
  assert.equal((await first).status, 'completed');
  await manager.dispose();
});
