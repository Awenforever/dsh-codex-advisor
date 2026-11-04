#!/usr/bin/env node
/**
 * Offline failure-path harness: the fake app-server fails a turn, then the
 * read-only snapshot/history routes must expose the failure and the turn error.
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
const dir = mkdtempSync(join(tmpdir(), 'advisor-failure-'));
const statePath = join(dir, 'fake-state.json');
const routes = new Map();
const tools = new Map();
const disposeHandlers = [];

const toolsService = {
  register(definition) {
    tools.set(definition.name, definition);
    return () => tools.delete(definition.name);
  },
};
const webServer = {
  register(route) {
    routes.set(route.path, route.handler);
    return () => routes.delete(route.path);
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
    if (name === 'systemPrompt') return ctx.systemPrompt;
    if (name === 'webServer') return webServer;
    return undefined;
  },
  on(event, handler) { if (event === 'dispose') disposeHandlers.push(handler); },
  logger() { return { debug() {}, info() {}, warn() {}, error() {} }; },
};

function jsonRoute(path, query) {
  const handler = routes.get(path);
  assert.equal(typeof handler, 'function', `route ${path} must be registered`);
  const request = { method: 'GET', url: `${path}?${query}` };
  const response = {
    statusCode: 0,
    headers: null,
    body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; },
    end(chunk) { this.body = chunk ?? ''; },
  };
  return Promise.resolve(handler(request, response)).then(() => ({
    status: response.statusCode,
    body: JSON.parse(response.body),
  }));
}

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
    FAKE_CODEX_MODE: 'turn-fail',
    FAKE_CODEX_TURN_DELAY_MS: '20',
  },
});

const exec = () => ({ agent: { id: 'sess-failure' }, signal: new AbortController().signal });

try {
  const failed = await tools.get('codex_ask').execute({ message: 'force a failure', wait_seconds: 5 }, exec());
  assert.equal(failed.status, 'failed');
  assert.equal(failed.code, 'CODEX_MODEL_UNAVAILABLE');
  assert.equal(failed.source.kind, 'codex-advisor');

  const polled = await tools.get('codex_poll').execute({ wait_seconds: 0 }, exec());
  assert.equal(polled.status, 'idle');
  assert.equal(polled.last_failure.code, 'CODEX_MODEL_UNAVAILABLE');

  const snapshot = await jsonRoute('/plugins/dsh-codex-advisor/snapshot', 'session_id=sess-failure');
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.body.status, 'bound');
  assert.equal(snapshot.body.last_failure.code, 'CODEX_MODEL_UNAVAILABLE');
  assert.match(snapshot.body.last_failure.message, /fake internal error/);

  const history = await jsonRoute('/plugins/dsh-codex-advisor/history', 'session_id=sess-failure&limit=1');
  assert.equal(history.status, 200);
  assert.equal(history.body.turns.length, 1);
  assert.equal(history.body.turns[0].status, 'failed');
  assert.match(history.body.turns[0].error, /fake internal error/);

  console.log('FAILURE PASS', JSON.stringify({
    code: failed.code,
    lastFailure: snapshot.body.last_failure,
    turnError: history.body.turns[0].error,
  }));
} finally {
  for (const handler of disposeHandlers.reverse()) await handler();
}
