import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexAppServer } from '../lib/codex.mjs';
import { nodeSpawn } from '../lib/spawn.mjs';

const FAKE = fileURLToPath(new URL('./fake-app-server.mjs', import.meta.url));
const CWD = process.cwd();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeClient({ mode = 'normal', statePath, delayMs = 20 }) {
  return new CodexAppServer({
    spawn: nodeSpawn(),
    argv: [process.execPath, FAKE],
    cwd: CWD,
    env: {
      ...process.env,
      FAKE_CODEX_STATE: statePath,
      FAKE_CODEX_MODE: mode,
      FAKE_CODEX_TURN_DELAY_MS: String(delayMs),
    },
  });
}

test('thread survives a process restart and resumes with its history', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'advisor-codex-'));
  const statePath = join(dir, 'fake-state.json');

  const first = makeClient({ statePath });
  await first.ensureStarted();
  const thread = await first.startThread({ cwd: CWD, sandbox: 'read-only' });
  assert.equal(thread.ephemeral, false);
  assert.ok(thread.id);
  const persisted = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.equal(persisted.threads[thread.id].sandbox, 'read-only');
  const turn1 = await first.startTurn({ threadId: thread.id, text: 'hello' });
  const snapshot1 = await turn1.completion;
  assert.equal(snapshot1.status, 'completed');
  assert.match(snapshot1.answer, /pong:hello/);
  await first.close();

  const second = makeClient({ statePath });
  await second.ensureStarted();
  const resumed = await second.resumeThread(thread.id);
  assert.equal(resumed.id, thread.id);
  assert.equal(resumed.turns.length, 1);
  const turn2 = await second.startTurn({ threadId: thread.id, text: 'again' });
  const snapshot2 = await turn2.completion;
  assert.equal(snapshot2.status, 'completed');
  assert.match(snapshot2.answer, /history=1/);
  await second.close();
});

test('missing thread reports no rollout found', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'advisor-codex-'));
  const client = makeClient({ statePath: join(dir, 'state.json') });
  await client.ensureStarted();
  await assert.rejects(client.resumeThread('does-not-exist'), (err) => /no rollout found/.test(err.message));
  await client.close();
});

test('a second writer on the same thread is rejected', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'advisor-codex-'));
  const statePath = join(dir, 'state.json');
  const first = makeClient({ statePath });
  await first.ensureStarted();
  const thread = await first.startThread({ cwd: CWD, sandbox: 'read-only' });
  await first.resumeThread(thread.id);

  const second = makeClient({ statePath });
  await second.ensureStarted();
  await assert.rejects(second.resumeThread(thread.id), (err) => /active writer/.test(err.message));
  await second.close();
  await first.close();
});

test('turn/interrupt yields an interrupted turn', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'advisor-codex-'));
  const client = makeClient({ mode: 'slow', statePath: join(dir, 'state.json') });
  await client.ensureStarted();
  const thread = await client.startThread({ cwd: CWD, sandbox: 'read-only' });
  const session = await client.startTurn({ threadId: thread.id, text: 'long' });
  await sleep(100);
  assert.equal(await session.interrupt(), true);
  const snapshot = await session.completion;
  assert.equal(snapshot.status, 'interrupted');
  await client.close();
});

test('approval requests are declined and surfaced on the turn', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'advisor-codex-'));
  const client = makeClient({ mode: 'approval', statePath: join(dir, 'state.json') });
  await client.ensureStarted();
  const thread = await client.startThread({ cwd: CWD, sandbox: 'read-only' });
  const session = await client.startTurn({ threadId: thread.id, text: 'need approval' });
  const snapshot = await session.completion;
  assert.equal(snapshot.status, 'completed');
  assert.match(snapshot.answer, /approval=decline/);
  assert.ok(snapshot.declinedApprovals >= 1);
  await client.close();
});
