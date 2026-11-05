import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AdvisorManager, renderToolResult, resolveConfig } from '../lib/manager.mjs';
import { AdvisorStore } from '../lib/store.mjs';
import { nodeSpawn } from '../lib/spawn.mjs';

const FAKE = fileURLToPath(new URL('./fake-app-server.mjs', import.meta.url));
const CWD = process.cwd();

function makeManager({ mode = 'normal', dir, statePath, defaultWaitSeconds = 5, maxWaitSeconds = 10 }) {
  const store = new AdvisorStore({ dir });
  store.load();
  const config = resolveConfig({
    codexArgv: [process.execPath, FAKE],
    stateDir: dir,
    defaultWaitSeconds,
    maxWaitSeconds,
    idleRecycleMs: 0,
    quotaCheckTtlMs: 0,
    env: {
      FAKE_CODEX_STATE: statePath,
      FAKE_CODEX_MODE: mode,
      FAKE_CODEX_TURN_DELAY_MS: '20',
    },
  });
  const manager = new AdvisorManager({
    ctx: {},
    config,
    store,
    logger: () => {},
    spawn: nodeSpawn(),
    cwdResolver: async () => CWD,
  });
  return { manager, store, config };
}

const execFor = (id = 'sess-1') => ({ agent: { id }, signal: new AbortController().signal });

test('manager keeps one thread across asks and resumes it in a new manager', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'advisor-mgr-'));
  const statePath = join(dir, 'fake-state.json');
  const first = makeManager({ dir, statePath });
  const one = await first.manager.ask({ message: 'one' }, execFor());
  assert.equal(one.status, 'completed');
  assert.ok(one.thread_id);
  const two = await first.manager.ask({ message: 'two' }, execFor());
  assert.equal(two.thread_id, one.thread_id);
  assert.match(two.answer, /history=1/);
  await first.manager.dispose();

  const second = makeManager({ dir, statePath });
  const three = await second.manager.ask({ message: 'three' }, execFor());
  assert.equal(three.thread_id, one.thread_id);
  assert.match(three.answer, /history=2/);
  await second.manager.dispose();
});

test('quota exhaustion fails before starting a turn', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'advisor-mgr-'));
  const { manager } = makeManager({ mode: 'quota', dir, statePath: join(dir, 'state.json') });
  await assert.rejects(
    manager.ask({ message: 'hello' }, execFor()),
    (err) => err.code === 'CODEX_QUOTA_EXCEEDED' && /resets at/.test(err.message),
  );
  await manager.dispose();
});

test('slow turn returns running, then poll completes it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'advisor-mgr-'));
  const { manager } = makeManager({ mode: 'slow', dir, statePath: join(dir, 'state.json') });
  const running = await manager.ask({ message: 'slow', wait_seconds: 0 }, execFor());
  assert.equal(running.status, 'running');
  assert.ok(running.turn_id);
  const done = await manager.poll({ turn_id: running.turn_id, wait_seconds: 5 }, execFor());
  assert.equal(done.status, 'completed');
  assert.match(done.answer, /slow/);
  await manager.dispose();
});

test('a completion after an ask timeout is persisted for the card', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'advisor-mgr-'));
  const { manager } = makeManager({ mode: 'slow', dir, statePath: join(dir, 'state.json') });
  const running = await manager.ask({ message: 'slow', wait_seconds: 0 }, execFor());
  assert.equal(running.status, 'running');
  assert.ok(running.turn_id);
  await new Promise((resolve) => setTimeout(resolve, 2200));
  const snapshot = await manager.snapshot({}, execFor());
  assert.match(snapshot.last_answer, /slow/);
  assert.ok(snapshot.last_answer_at);
  const polled = await manager.poll({ turn_id: running.turn_id, wait_seconds: 0 }, execFor());
  assert.equal(polled.status, 'idle');
  assert.match(polled.answer, /slow/);
  await manager.dispose();
});

test('cancel interrupts a running turn', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'advisor-mgr-'));
  const { manager } = makeManager({ mode: 'slow', dir, statePath: join(dir, 'state.json') });
  const running = await manager.ask({ message: 'slow', wait_seconds: 0 }, execFor());
  assert.equal(running.status, 'running');
  const cancelled = await manager.cancel({ turn_id: running.turn_id }, execFor());
  assert.equal(cancelled.status, 'cancelled');
  await manager.dispose();
});

test('approval mode surfaces a declined approval', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'advisor-mgr-'));
  const { manager } = makeManager({ mode: 'approval', dir, statePath: join(dir, 'state.json') });
  const result = await manager.ask({ message: 'go' }, execFor());
  assert.equal(result.status, 'completed');
  assert.match(result.answer, /approval=decline/);
  assert.ok(result.activity.declined >= 1);
  await manager.dispose();
});

test('file changes are surfaced in activity', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'advisor-mgr-'));
  const { manager } = makeManager({ mode: 'files', dir, statePath: join(dir, 'state.json') });
  const result = await manager.ask({ message: 'edit' }, execFor());
  assert.equal(result.status, 'completed');
  assert.ok(result.activity.files.some((file) => file.paths.includes('src/app.js')));
  await manager.dispose();
});

test('missing bound thread fails closed to a new thread with the digest brief', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'advisor-mgr-'));
  const statePath = join(dir, 'fake-state.json');
  const { manager, store } = makeManager({ dir, statePath });
  store.bind('sess-1', { id: 'thr-missing' }, { cwd: CWD });
  store.recordTurn('sess-1', { ask: 'earlier request', answer: 'earlier answer', turnId: 'turn-old' });
  const result = await manager.ask({ message: 'continue', brief: 'extra brief' }, execFor());
  assert.equal(result.status, 'completed');
  assert.notEqual(result.thread_id, 'thr-missing');
  assert.equal(result.recovered, 'new-thread');
  assert.match(result.answer, /Recovered advisor context/);
  assert.match(result.answer, /earlier request/);
  assert.match(result.answer, /extra brief/);
  await manager.dispose();
});

test('status reports app-server and binding facts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'advisor-mgr-'));
  const { manager } = makeManager({ dir, statePath: join(dir, 'state.json') });
  await manager.ask({ message: 'hello' }, execFor());
  const status = await manager.status({}, execFor());
  assert.equal(status.status, 'ok');
  assert.equal(status.codex.state, 'ready');
  assert.ok(status.thread.thread_id);
  assert.equal(status.config.sandbox, 'workspace-write');
  await manager.dispose();
});

test('tool result renders the turn model and effort instead of the config fallback', () => {
  const text = renderToolResult('codex_ask', {
    source: { kind: 'codex-advisor', plugin: 'dsh-codex-advisor', version: '0.6.1', model: 'gpt-6-luna', effort: 'max' },
    status: 'completed',
    thread_id: 'thr-1',
    turn_id: 'turn-1',
    model: 'gpt-6-luna',
    effort: 'low',
    answer: 'ok',
  })[0].text;
  assert.match(text, /model: gpt-6-luna\s+effort: low/);
  assert.doesNotMatch(text, /effort: max/);
});

test('labeled threads pin a model while effort can vary', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'advisor-mgr-'));
  const { manager } = makeManager({ dir, statePath: join(dir, 'state.json') });
  const first = await manager.ask({ message: 'implement a small parser' }, execFor());
  assert.equal(first.status, 'completed');
  assert.equal(first.model, 'gpt-6.1-sol');
  assert.equal(first.effort, 'medium');

  const architecture = await manager.ask({
    message: 'review the top-level architecture',
    new_thread: true,
    label: 'Architecture review',
    purpose: 'architecture',
  }, execFor());
  assert.equal(architecture.status, 'completed');
  assert.equal(architecture.model, 'gpt-6-astra');
  assert.equal(architecture.effort, 'max');
  assert.notEqual(architecture.thread_id, first.thread_id);

  const followUp = await manager.ask({
    message: 'trace the failure path',
    thread: 'Architecture review',
    effort: 'xhigh',
  }, execFor());
  assert.equal(followUp.thread_id, architecture.thread_id);
  assert.equal(followUp.model, 'gpt-6-astra');
  assert.equal(followUp.effort, 'xhigh');

  await assert.rejects(
    manager.ask({ message: 'switch model', model: 'gpt-6-luna' }, execFor()),
    (err) => err.code === 'CODEX_THREAD_MODEL_PINNED',
  );

  const status = await manager.status({}, execFor());
  assert.equal(status.threads.length, 2);
  assert.ok(status.threads.some((thread) => thread.label === 'Architecture review' && thread.model === 'gpt-6-astra'));
  assert.ok(status.threads.some((thread) => thread.label === 'implement a small parser'));

  const history = await manager.history({ thread: 'Architecture review' }, execFor());
  assert.equal(history.label, 'Architecture review');
  assert.ok(history.turns.some((turn) => turn.model === 'gpt-6-astra' && turn.effort === 'xhigh'));
  await manager.dispose();
});
