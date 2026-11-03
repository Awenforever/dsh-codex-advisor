#!/usr/bin/env node
/**
 * L2 restart harness: dispose the plugin, apply it again against the same
 * state directory, and prove the second instance resumes the first thread.
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
const dir = mkdtempSync(join(tmpdir(), 'advisor-restart-'));
const statePath = join(dir, 'fake-state.json');

const config = {
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
};

function boot() {
  const tools = new Map();
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
    systemPrompt: { section: () => () => {} },
    get(name) {
      if (name === 'tools') return toolsService;
      if (name === 'subprocess') return { spawn: nodeSpawn() };
      if (name === 'workingDirectory') return ctx.workingDirectory;
      return undefined;
    },
    on(event, handler) { if (event === 'dispose') disposeHandlers.push(handler); },
    logger() { return { debug() {}, info() {}, warn() {}, error() {} }; },
  };
  apply(ctx, config);
  return {
    tools,
    dispose: async () => { for (const handler of disposeHandlers) await handler(); },
  };
}

const exec = () => ({ agent: { id: 'sess-restart' }, signal: new AbortController().signal });

const first = boot();
const one = await first.tools.get('codex_ask').execute({ message: 'one' }, exec());
assert.equal(one.status, 'completed');
await first.dispose();

const second = boot();
const two = await second.tools.get('codex_ask').execute({ message: 'two' }, exec());
assert.equal(two.status, 'completed');
assert.equal(two.thread_id, one.thread_id, 'restart must resume the same Codex thread');
assert.match(two.answer, /history=1/);
await second.dispose();

console.log('RESTART PASS', JSON.stringify({ threadId: one.thread_id, stateDir: dir }));
