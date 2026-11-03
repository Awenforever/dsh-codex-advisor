#!/usr/bin/env node
/**
 * M0 spike: prove that a non-ephemeral Codex app-server thread survives an
 * app-server process restart and can be resumed with thread/resume.
 *
 * Read-only probe: it writes only under <runDir> and creates real Codex
 * threads under the current CODEX_HOME (expected, evidence).
 *
 * Usage:
 *   node appserver-probe.mjs [codexExe] [cwd] [runDir]
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const CODEX = process.argv[2]
  ?? 'C:\\Users\\king_\\AppData\\Local\\OpenAI\\Codex\\bin\\22cfb1d302613eae\\codex.exe';
const CWD = process.argv[3] ?? process.cwd();
const RUN_DIR = process.argv[4]
  ?? join(process.cwd(), 'codex-advisor', 'spike', 'runs', new Date().toISOString().replace(/[:.]/g, '-'));

mkdirSync(RUN_DIR, { recursive: true });
const GLOBAL_LOG = join(RUN_DIR, 'probe.ndjson');
const summary = {
  startedAt: new Date().toISOString(),
  codex: CODEX,
  cwd: CWD,
  runDir: RUN_DIR,
  steps: [],
  ok: false,
};

const now = () => new Date().toISOString();
const logGlobal = (event, data = {}) =>
  appendFileSync(GLOBAL_LOG, JSON.stringify({ t: now(), event, ...data }) + '\n');
const record = (name, data) => {
  summary.steps.push({ name, ...data });
  console.log(`[${name}] ${JSON.stringify(data).slice(0, 600)}`);
  logGlobal(name, data);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (s, n = 4000) => (typeof s === 'string' ? s.slice(0, n) : s);

class AppServer {
  constructor(label) {
    this.label = label;
    this.pending = new Map();
    this.nextId = 1;
    this.stderr = '';
    this.exit = null;
    this.turnState = null;
    this.onNotification = null;
  }

  start() {
    this.startedAt = Date.now();
    this.codex = CODEX;
    this.cwd = CWD;
    this.proc = spawn(this.codex, ['app-server', '--stdio'], {
      cwd: this.cwd,
      env: process.env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.rl = createInterface({ input: this.proc.stdout, crlfDelay: Infinity });
    this.rl.on('line', (line) => this.onLine(line));
    this.proc.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      this.stderr += text;
      this.log('stderr', { text: clip(text, 4000) });
    });
    this.proc.on('error', (err) => {
      this.log('spawn-error', { message: err.message });
      this.failAll(err);
    });
    this.proc.on('exit', (code, signal) => {
      this.exit = { code, signal };
      this.log('exit', { code, signal });
      this.failAll(new Error(`app-server exited (code=${code}, signal=${signal})`));
    });
    this.log('start', { pid: this.proc.pid });
  }

  log(event, data = {}) {
    appendFileSync(join(RUN_DIR, `server-${this.label}.ndjson`),
      JSON.stringify({ t: now(), server: this.label, event, ...data }) + '\n');
  }

  write(obj) {
    this.proc.stdin.write(JSON.stringify(obj) + '\n');
  }

  notify(method, params) {
    const msg = { method };
    if (params !== undefined) msg.params = params;
    this.write(msg);
  }

  request(method, params, timeoutMs = 120000) {
    const id = this.nextId++;
    const msg = { id, method };
    if (params !== undefined) msg.params = params;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const err = new Error(`${method} timed out after ${timeoutMs}ms`);
        err.code = 'TIMEOUT';
        reject(err);
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });
      try {
        this.write(msg);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  failAll(err) {
    for (const [id, p] of this.pending) {
      this.pending.delete(id);
      p.reject(err);
    }
    if (this.turnState?.resolveDone) {
      this.turnState.resolveDone({ status: 'process-exit', error: { message: err.message } });
    }
  }

  onLine(line) {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      this.log('non-json', { line: clip(line, 500) });
      return;
    }
    // response: id + no method
    if (msg.id !== undefined && msg.method === undefined) {
      const p = this.pending.get(msg.id);
      if (!p) { this.log('orphan-response', { id: msg.id }); return; }
      this.pending.delete(msg.id);
      if (msg.error) {
        const err = new Error(msg.error.message ?? 'rpc error');
        err.code = msg.error.code;
        err.data = msg.error.data;
        p.reject(err);
      } else {
        p.resolve(msg.result);
      }
      return;
    }
    // server request: id + method
    if (msg.id !== undefined && msg.method) {
      this.handleServerRequest(msg);
      return;
    }
    if (msg.method) this.handleNotification(msg.method, msg.params);
  }

  handleServerRequest(msg) {
    const { id, method } = msg;
    this.log('server-request', { method });
    let result;
    switch (method) {
      case 'item/commandExecution/requestApproval':
      case 'item/fileChange/requestApproval':
        result = { decision: 'decline' };
        break;
      case 'item/permissions/requestApproval':
        result = { permissions: {}, scope: 'turn' };
        break;
      case 'item/tool/requestUserInput':
        result = { answers: {} };
        break;
      case 'mcpServer/elicitation/request':
        result = { action: 'decline', content: null, _meta: null };
        break;
      default:
        result = {};
        this.log('unknown-server-request', { method });
    }
    this.write({ id, result });
  }

  handleNotification(method, params) {
    this.log('notification', {
      method,
      threadId: params?.threadId,
      turnId: params?.turnId ?? params?.turn?.id,
      itemType: params?.item?.type,
      itemPhase: params?.item?.phase,
      status: params?.turn?.status,
    });
    this.onNotification?.(method, params);
  }

  async initialize() {
    const t0 = Date.now();
    const result = await this.request('initialize', {
      clientInfo: {
        name: 'dsh-codex-advisor-spike',
        title: 'DSH Codex Advisor Spike',
        version: '0.0.1',
      },
      capabilities: { experimentalApi: false, requestAttestation: false },
    }, 120000);
    this.notify('initialized');
    this.log('initialized', { ms: Date.now() - t0, resultKeys: Object.keys(result ?? {}) });
    return { ms: Date.now() - t0, result };
  }

  async runTurn(threadId, text, { timeoutMs = 180000 } = {}) {
    const state = {
      threadId,
      turnId: null,
      observedTurnId: null,
      buffered: [],
      items: [],
      final: null,
      partial: null,
      unphased: null,
      startedAt: Date.now(),
      resolveDone: null,
    };
    this.turnState = state;
    const done = new Promise((resolve) => { state.resolveDone = resolve; });
    this.onNotification = (method, params) => {
      if (!params || params.threadId !== threadId) return;
      if (method === 'turn/started') {
        if (state.turnId === null && params.turn?.id) state.observedTurnId = params.turn.id;
        return;
      }
      if (method === 'item/completed' || method === 'turn/completed') {
        if (state.turnId === null) { state.buffered.push([method, params]); return; }
        this.applyTurnEvent(state, method, params);
      }
    };
    const started = await this.request('turn/start', {
      threadId,
      input: [{ type: 'text', text, text_elements: [] }],
    }, 60000);
    const turnId = started?.turn?.id;
    if (!turnId) throw new Error('turn/start did not return turn.id');
    if (state.observedTurnId && state.observedTurnId !== turnId) {
      this.log('turn-id-mismatch', { observed: state.observedTurnId, returned: turnId });
    }
    state.turnId = turnId;
    const buffered = state.buffered.splice(0);
    for (const [m, p] of buffered) this.applyTurnEvent(state, m, p);

    const timer = setTimeout(() => {
      state.resolveDone({ status: 'timeout', items: state.items, answer: state.pickAnswer() });
    }, timeoutMs);
    const result = await done;
    clearTimeout(timer);
    this.turnState = null;
    this.onNotification = null;
    return { turnId, ...result, elapsedMs: Date.now() - state.startedAt };
  }

  applyTurnEvent(state, method, params) {
    if (method === 'item/completed') {
      if (params.turnId !== state.turnId) return;
      const item = params.item ?? {};
      if (typeof item.text === 'string') {
        if (item.phase === 'final_answer') state.final = item.text;
        else if (item.phase === 'partial_answer') state.partial = item.text;
        else if (item.phase === null) state.unphased = item.text;
      }
      state.items.push({
        type: item.type,
        phase: item.phase,
        status: item.status,
        text: clip(item.text, 8000),
      });
      return;
    }
    if (method === 'turn/completed') {
      const turn = params.turn ?? {};
      if (turn.id !== state.turnId) return;
      state.resolveDone({
        status: turn.status,
        error: turn.error,
        items: state.items,
        answer: state.final ?? state.partial ?? state.unphased ?? null,
      });
    }
  }

  async close() {
    if (this.exit) return;
    try { this.proc.stdin.end(); } catch { /* ignore */ }
    await Promise.race([
      new Promise((resolve) => this.proc.once('exit', resolve)),
      sleep(4000),
    ]);
    if (!this.exit) {
      try { this.proc.kill(); } catch { /* ignore */ }
      await Promise.race([
        new Promise((resolve) => this.proc.once('exit', resolve)),
        sleep(2000),
      ]);
    }
    this.rl?.close();
    this.log('closed', { exit: this.exit });
  }
}

async function main() {
  const token = `AMBER-WALRUS-${Math.floor(1000 + Math.random() * 9000)}`;
  const fixture = join(RUN_DIR, 'fixture.txt');
  writeFileSync(fixture, 'FIXTURE-LINE-OK\nsecond line\n', 'utf8');
  record('fixture', { path: fixture, token });

  let serverA;
  let serverB;
  let threadId;
  let resumedThreadId;
  let recallAnswer = '';

  // ---- Process A: initialize, start a persistent thread, turn 1 ----
  serverA = new AppServer('A');
  serverA.start();
  const initA = await serverA.initialize();
  record('A.initialize', initA);

  const threadStart = await serverA.request('thread/start', {
    cwd: CWD,
    ephemeral: false,
    approvalPolicy: 'never',
    sandbox: 'read-only',
  }, 60000);
  const thread = threadStart?.thread ?? {};
  threadId = thread.id;
  record('A.thread.start', {
    threadId,
    ephemeral: thread.ephemeral,
    threadKeys: Object.keys(thread),
    resultKeys: Object.keys(threadStart ?? {}),
  });
  if (!threadId) throw new Error('thread/start did not return thread.id');

  try {
    const limits = await serverA.request('account/rateLimits/read', undefined, 30000);
    record('A.rateLimits', { limits });
  } catch (err) {
    record('A.rateLimits.error', { code: err.code, message: err.message });
  }
  try {
    const models = await serverA.request('model/list', { limit: 100 }, 30000);
    record('A.models', {
      count: models?.data?.length ?? null,
      sample: (models?.data ?? []).slice(0, 8).map((m) => ({ id: m.id, displayName: m.displayName, hidden: m.hidden })),
    });
  } catch (err) {
    record('A.models.error', { code: err.code, message: err.message });
  }

  const turn1Text = [
    `Remember the exact token ${token}.`,
    `Also read the file ${fixture} and reply with exactly: stored:<first line of that file>`,
    'Do not add anything else.',
  ].join('\n');
  const turn1 = await serverA.runTurn(threadId, turn1Text, { timeoutMs: 180000 });
  record('A.turn1', {
    turnId: turn1.turnId,
    status: turn1.status,
    answer: clip(turn1.answer, 1000),
    elapsedMs: turn1.elapsedMs,
    itemSummary: turn1.items.map((i) => `${i.type}:${i.phase ?? ''}`),
    error: turn1.error,
  });

  await serverA.close();

  // ---- Process B: new app-server, resume the same thread, turn 2 ----
  serverB = new AppServer('B');
  serverB.start();
  const initB = await serverB.initialize();
  record('B.initialize', initB);

  let resumeResult;
  try {
    resumeResult = await serverB.request('thread/resume', { threadId }, 60000);
    const rt = resumeResult?.thread ?? {};
    resumedThreadId = rt.id;
    record('B.thread.resume', {
      requested: threadId,
      returned: resumedThreadId,
      matched: resumedThreadId === threadId,
      threadKeys: Object.keys(rt),
      resultKeys: Object.keys(resumeResult ?? {}),
    });
  } catch (err) {
    record('B.thread.resume.error', { code: err.code, message: err.message, data: clip(JSON.stringify(err.data ?? null), 2000) });
    throw new Error(`thread/resume failed: ${err.message}`);
  }

  try {
    const loaded = await serverB.request('thread/loaded/list', {}, 15000);
    record('B.thread.loaded', { data: loaded?.data ?? loaded });
  } catch (err) {
    record('B.thread.loaded.error', { code: err.code, message: err.message });
  }

  const turn2 = await serverB.runTurn(
    threadId,
    'What token did I ask you to remember? Reply with only the token.',
    { timeoutMs: 180000 },
  );
  recallAnswer = turn2.answer ?? '';
  record('B.turn2', {
    turnId: turn2.turnId,
    status: turn2.status,
    answer: clip(recallAnswer, 1000),
    elapsedMs: turn2.elapsedMs,
    containsToken: recallAnswer.includes(token),
    error: turn2.error,
  });

  // ---- Negative: resume a thread that does not exist ----
  const bogus = randomUUID();
  try {
    const bogusResult = await serverB.request('thread/resume', { threadId: bogus }, 30000);
    record('B.resume.bogus.UNEXPECTED_SUCCESS', { bogus, resultKeys: Object.keys(bogusResult ?? {}) });
    try {
      const bogusTurn = await serverB.runTurn(bogus, 'ping', { timeoutMs: 30000 });
      record('B.resume.bogus.turn', { status: bogusTurn.status, error: bogusTurn.error });
    } catch (err) {
      record('B.resume.bogus.turn.error', { code: err.code, message: err.message });
    }
  } catch (err) {
    record('B.resume.bogus.error', {
      code: err.code,
      message: err.message,
      data: clip(JSON.stringify(err.data ?? null), 2000),
    });
  }

  // ---- Interrupt: start a long turn and interrupt it ----
  let interruptResult = null;
  try {
    const turnPromise = serverB.runTurn(
      threadId,
      'Write at least 800 words about the history of lighthouses. Do not stop early.',
      { timeoutMs: 120000 },
    );
    await sleep(1500);
    const running = serverB.turnState;
    if (running?.turnId) {
      await serverB.request('turn/interrupt', { threadId, turnId: running.turnId }, 30000);
      record('B.interrupt.sent', { turnId: running.turnId });
    } else {
      record('B.interrupt.no-turn-id', {});
    }
    interruptResult = await turnPromise;
    record('B.interrupt.result', {
      status: interruptResult.status,
      answerLength: interruptResult.answer?.length ?? 0,
      elapsedMs: interruptResult.elapsedMs,
    });
  } catch (err) {
    record('B.interrupt.error', { code: err.code, message: err.message });
  }

  await serverB.close();

  const pass = {
    threadPersistent: thread.ephemeral !== true,
    resumeMatched: resumedThreadId === threadId,
    recallToken: recallAnswer.includes(token),
    turn1Completed: turn1.status === 'completed',
    turn2Completed: turn2.status === 'completed',
  };
  summary.pass = pass;
  summary.ok = pass.threadPersistent && pass.resumeMatched && pass.recallToken
    && pass.turn1Completed && pass.turn2Completed;
  summary.threadId = threadId;
  summary.token = token;
  summary.finishedAt = now();
  summary.interruptStatus = interruptResult?.status ?? null;
  writeFileSync(join(RUN_DIR, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log('SUMMARY ' + JSON.stringify(summary.pass));
  console.log('RUN_DIR ' + RUN_DIR);
  if (!summary.ok) process.exitCode = 2;
}

main().catch((err) => {
  summary.ok = false;
  summary.fatal = { message: err?.message ?? String(err), code: err?.code, stack: clip(err?.stack, 4000) };
  summary.finishedAt = now();
  try {
    writeFileSync(join(RUN_DIR, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  } catch { /* ignore */ }
  console.error('FATAL', err);
  process.exitCode = 1;
});
