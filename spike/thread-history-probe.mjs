#!/usr/bin/env node
/**
 * M0 follow-up: resume the probe thread and dump its retained turns/items.
 * This performs NO turn/start, so it consumes no model quota.
 *
 * Usage: node thread-history-probe.mjs <threadId> [codexExe]
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const THREAD_ID = process.argv[2];
const CODEX = process.argv[3]
  ?? 'C:\\Users\\king_\\AppData\\Local\\OpenAI\\Codex\\bin\\22cfb1d302613eae\\codex.exe';
const CWD = process.cwd();
const RUN_DIR = join(CWD, 'codex-advisor', 'spike', 'runs',
  new Date().toISOString().replace(/[:.]/g, '-') + '-history');
mkdirSync(RUN_DIR, { recursive: true });
const OUT = join(RUN_DIR, 'history.json');

if (!THREAD_ID) {
  console.error('usage: node thread-history-probe.mjs <threadId> [codexExe]');
  process.exit(2);
}

const log = (event, data = {}) =>
  appendFileSync(join(RUN_DIR, 'probe.ndjson'), JSON.stringify({ t: new Date().toISOString(), event, ...data }) + '\n');

const proc = spawn(CODEX, ['app-server', '--stdio'], {
  cwd: CWD, env: process.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
});
const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity });
const pending = new Map();
let nextId = 1;
let stderr = '';

function write(obj) { proc.stdin.write(JSON.stringify(obj) + '\n'); }
function notify(method, params) {
  const m = { method };
  if (params !== undefined) m.params = params;
  write(m);
}
function request(method, params, timeoutMs = 30000) {
  const id = nextId++;
  const msg = { id, method };
  if (params !== undefined) msg.params = params;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(Object.assign(new Error(`${method} timed out`), { code: 'TIMEOUT' }));
    }, timeoutMs);
    pending.set(id, {
      resolve: (v) => { clearTimeout(timer); resolve(v); },
      reject: (e) => { clearTimeout(timer); reject(e); },
    });
    write(msg);
  });
}

proc.stderr.on('data', (d) => { stderr += d.toString(); });
proc.on('error', (e) => { log('spawn-error', { message: e.message }); });
proc.on('exit', (code, signal) => log('exit', { code, signal }));

rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.id !== undefined && msg.method === undefined) {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) {
      const err = new Error(msg.error.message ?? 'rpc error');
      err.code = msg.error.code;
      p.reject(err);
    } else p.resolve(msg.result);
    return;
  }
  if (msg.id !== undefined && msg.method) {
    // decline every interactive request
    let result = {};
    if (msg.method.endsWith('requestApproval')) result = { decision: 'decline' };
    else if (msg.method === 'item/permissions/requestApproval') result = { permissions: {}, scope: 'turn' };
    else if (msg.method === 'item/tool/requestUserInput') result = { answers: {} };
    else if (msg.method === 'mcpServer/elicitation/request') result = { action: 'decline', content: null, _meta: null };
    write({ id: msg.id, result });
  }
});

const textOf = (item) => (typeof item?.text === 'string' ? item.text : JSON.stringify(item ?? {}));
const summarizeTurn = (turn) => ({
  id: turn?.id,
  status: turn?.status,
  startedAt: turn?.startedAt,
  completedAt: turn?.completedAt,
  error: turn?.error ?? null,
  items: (turn?.items ?? []).map((item) => ({
    type: item?.type,
    phase: item?.phase,
    status: item?.status,
    text: textOf(item).slice(0, 600),
  })),
});

async function main() {
  const result = { threadId: THREAD_ID, codex: CODEX, startedAt: new Date().toISOString(), steps: [] };
  const step = (name, data) => { result.steps.push({ name, ...data }); console.log(name, JSON.stringify(data).slice(0, 500)); };

  const t0 = Date.now();
  await request('initialize', {
    clientInfo: { name: 'dsh-codex-advisor-spike-history', title: 'DSH Codex Advisor Spike', version: '0.0.1' },
    capabilities: { experimentalApi: false, requestAttestation: false },
  });
  notify('initialized');
  step('initialize', { ms: Date.now() - t0 });

  let resume;
  try {
    resume = await request('thread/resume', { threadId: THREAD_ID }, 60000);
  } catch (err) {
    step('thread.resume.error', { code: err.code, message: err.message });
    result.ok = false;
    writeFileSync(OUT, JSON.stringify(result, null, 2));
    process.exitCode = 1;
    return;
  }
  const thread = resume?.thread ?? {};
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  step('thread.resume', {
    id: thread.id,
    matched: thread.id === THREAD_ID,
    model: thread.model,
    reasoningEffort: thread.reasoningEffort,
    cwd: thread.cwd,
    status: thread.status,
    ephemeral: thread.ephemeral,
    turnCount: turns.length,
    threadKeys: Object.keys(thread),
  });
  result.resume = {
    id: thread.id,
    matched: thread.id === THREAD_ID,
    model: thread.model,
    reasoningEffort: thread.reasoningEffort,
    cwd: thread.cwd,
    status: thread.status,
    ephemeral: thread.ephemeral,
    turnCount: turns.length,
    turns: turns.map(summarizeTurn),
  };

  // Does the resumed conversation still carry the original user message (the token)?
  const allText = turns.flatMap((t) => (t.items ?? []).map((i) => textOf(i))).join('\n');
  result.historyTokenFound = allText.includes('AMBER-WALRUS-');
  result.historyFixturePathFound = allText.includes('fixture.txt');
  step('history.content', {
    tokenFound: result.historyTokenFound,
    fixturePathFound: result.historyFixturePathFound,
    textBytes: allText.length,
  });

  for (const method of ['thread/read', 'thread/list']) {
    const params = method === 'thread/read'
      ? { threadId: THREAD_ID, includeTurns: true }
      : { limit: 10 };
    try {
      const value = await request(method, params, 20000);
      const v = method === 'thread/read' ? (value?.thread ?? value) : value;
      step(method, {
        keys: v && typeof v === 'object' ? Object.keys(v) : null,
        turnCount: Array.isArray(v?.turns) ? v.turns.length : null,
        dataCount: Array.isArray(value?.data) ? value.data.length : null,
        sample: method === 'thread/list'
          ? (value?.data ?? []).slice(0, 5).map((t) => ({ id: t.id, name: t.name, status: t.status, updatedAt: t.updatedAt }))
          : undefined,
      });
      result[method.replace('/', '_')] = {
        keys: v && typeof v === 'object' ? Object.keys(v) : null,
        turnCount: Array.isArray(v?.turns) ? v.turns.length : null,
      };
    } catch (err) {
      step(`${method}.error`, { code: err.code, message: err.message });
      result[method.replace('/', '_') + '_error'] = { code: err.code, message: err.message };
    }
  }

  result.ok = Boolean(result.resume?.matched && result.historyTokenFound);
  result.finishedAt = new Date().toISOString();
  result.stderrTail = stderr.slice(-1000);
  writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log('OK ' + result.ok);
  console.log('OUT ' + OUT);
  if (!result.ok) process.exitCode = 2;
}

main()
  .catch((err) => {
    console.error('FATAL', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { proc.stdin.end(); } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 1500));
    try { proc.kill(); } catch { /* ignore */ }
    setTimeout(() => process.exit(process.exitCode ?? 0), 100);
  });
