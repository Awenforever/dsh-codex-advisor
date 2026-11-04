#!/usr/bin/env node
/**
 * L2 Host-level harness: apply the plugin with a stub Cordis context, then
 * execute the registered tools end-to-end against the fake app-server.
 *
 * No DSH model and no real Codex are involved.
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply } from '../../index.js';
import { nodeSpawn } from '../../lib/spawn.mjs';

const FAKE = fileURLToPath(new URL('../fake-app-server.mjs', import.meta.url));
const CWD = process.cwd();
const dir = mkdtempSync(join(tmpdir(), 'advisor-l2-'));
const statePath = join(dir, 'fake-state.json');

const tools = new Map();
const promptSections = [];
const disposeHandlers = [];
const toolsService = {
  register(definition) {
    tools.set(definition.name, definition);
    return () => tools.delete(definition.name);
  },
};
const ctx = {
  tools: toolsService,
  workingDirectory: { ensure: async () => CWD },
  systemPrompt: { section: (section) => { promptSections.push(section); return () => {}; } },
  get(name) {
    if (name === 'tools') return toolsService;
    if (name === 'subprocess') return { spawn: nodeSpawn() };
    if (name === 'workingDirectory') return ctx.workingDirectory;
    if (name === 'systemPrompt') return ctx.systemPrompt;
    return undefined;
  },
  on(event, handler) { if (event === 'dispose') disposeHandlers.push(handler); },
  logger() { return { debug() {}, info() {}, warn() {}, error() {} }; },
};

apply(ctx, {
  codexArgv: [process.execPath, FAKE],
  stateDir: dir,
  defaultWaitSeconds: 10,
  maxWaitSeconds: 30,
  idleRecycleMs: 0,
  quotaCheckTtlMs: 0,
  env: {
    ELECTRON_RUN_AS_NODE: process.env.ELECTRON_RUN_AS_NODE || '1',
    FAKE_CODEX_STATE: statePath,
    FAKE_CODEX_MODE: 'normal',
    FAKE_CODEX_TURN_DELAY_MS: '20',
  },
});

const exec = () => ({ agent: { id: 'sess-l2' }, signal: new AbortController().signal });

try {
  assert.deepEqual([...tools.keys()].sort(), ['codex_ask', 'codex_cancel', 'codex_history', 'codex_poll', 'codex_reset', 'codex_status']);
  assert.equal(promptSections.length, 1);
  assert.match(promptSections[0].text, /persistent/i);

  const ask = tools.get('codex_ask');
  const first = await ask.execute({ message: 'hello from L2' }, exec());
  assert.equal(first.status, 'completed');
  assert.equal(first.source.kind, 'codex-advisor');
  assert.ok(first.thread_id);
  assert.match(first.answer, /pong:hello from L2/);

  const second = await ask.execute({ message: 'second' }, exec());
  assert.equal(second.thread_id, first.thread_id);
  assert.match(second.answer, /history=1/);

  const history = await tools.get('codex_history').execute({ limit: 5 }, exec());
  assert.equal(history.thread_id, first.thread_id);
  assert.equal(history.source.kind, 'codex-advisor');
  assert.ok(history.turns.length >= 2);
  assert.match(history.turns.at(-1).answer, /history=1/);

  const status = await tools.get('codex_status').execute({}, exec());
  assert.equal(status.status, 'ok');
  assert.equal(status.codex.state, 'ready');
  assert.equal(status.thread.thread_id, first.thread_id);
  assert.equal(status.config.sandbox, 'workspace-write');
  assert.ok(status.tools.includes('codex_history'));

  const cancel = await tools.get('codex_cancel').execute({}, exec());
  assert.equal(cancel.status, 'idle');

  const reset = await tools.get('codex_reset').execute({ reason: 'L2 reset' }, exec());
  assert.equal(reset.status, 'reset');
  assert.notEqual(reset.thread_id, first.thread_id);

  console.log('L2 PASS', JSON.stringify({
    tools: [...tools.keys()],
    threadId: first.thread_id,
    resetThreadId: reset.thread_id,
    stateDir: dir,
  }));
} finally {
  for (const handler of disposeHandlers) await handler();
}
