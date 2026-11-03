#!/usr/bin/env node
/**
 * Deterministic Codex app-server stand-in for offline contract tests.
 *
 * Env:
 *   FAKE_CODEX_STATE             JSON state file shared across restarts
 *   FAKE_CODEX_MODE              normal | quota | turn-fail | slow | approval | files | empty
 *   FAKE_CODEX_TURN_DELAY_MS     delay before a turn completes (default 30)
 *   FAKE_CODEX_ANSWER_PREFIX     answer prefix (default "pong:")
 *
 * It speaks the subset of the app-server protocol the advisor bridge uses and
 * keeps threads in the state file so a new process can resume them.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';

const STATE_PATH = process.env.FAKE_CODEX_STATE || '';
const MODE = process.env.FAKE_CODEX_MODE || 'normal';
const DELAY = Number(process.env.FAKE_CODEX_TURN_DELAY_MS || 30);
const PREFIX = process.env.FAKE_CODEX_ANSWER_PREFIX || 'pong:';
const QUOTA_RESET = Number(process.env.FAKE_CODEX_QUOTA_RESET || Math.floor(Date.now() / 1000) + 3600);

let state = { threads: {}, locks: {}, requests: [] };
if (STATE_PATH && existsSync(STATE_PATH)) {
  try {
    const parsed = JSON.parse(readFileSync(STATE_PATH, 'utf8'));
    state = { threads: {}, locks: {}, requests: [], ...parsed };
  } catch { /* start fresh */ }
}

const save = () => {
  if (!STATE_PATH) return;
  try { writeFileSync(STATE_PATH, JSON.stringify(state, null, 2)); } catch { /* ignore */ }
};

const send = (message) => {
  try { process.stdout.write(JSON.stringify(message) + '\n'); } catch { /* ignore */ }
};
const reply = (id, result) => send({ id, result });
const replyError = (id, code, message) => send({ id, error: { code, message } });

let serverRequestId = 100000;
const serverRequests = new Map();
function requestClient(method, params, timeoutMs = 5000) {
  const id = serverRequestId++;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      serverRequests.delete(id);
      resolve(null);
    }, timeoutMs);
    timer.unref?.();
    serverRequests.set(id, (value) => { clearTimeout(timer); resolve(value); });
    send({ id, method, params });
  });
}

const noteRequest = (method, params) => {
  state.requests.push({ t: Date.now(), method, params });
  if (state.requests.length > 400) state.requests.splice(0, state.requests.length - 400);
};

const emitTurnCompleted = (thread, turn, status, error) => {
  if (turn.status !== 'inProgress') return;
  turn.status = status;
  if (error) turn.error = error;
  save();
  send({
    method: 'turn/completed',
    params: {
      threadId: thread.id,
      turn: { id: turn.id, status, ...(error ? { error } : {}) },
    },
  });
};

const emitItem = (thread, turn, item) => {
  turn.items.push(item);
  send({ method: 'item/completed', params: { threadId: thread.id, turnId: turn.id, item } });
};

function scheduleTurn(thread, turn, text) {
  send({ method: 'turn/started', params: { threadId: thread.id, turn: { id: turn.id, status: 'inProgress' } } });
  const finish = (status, error, answer) => {
    if (turn.status !== 'inProgress') return;
    if (typeof answer === 'string') emitItem(thread, turn, { type: 'agentMessage', phase: 'final_answer', text: answer });
    emitTurnCompleted(thread, turn, status, error);
  };
  if (MODE === 'quota') {
    setTimeout(() => finish('failed', { message: "You've hit your usage limit.", codexErrorInfo: 'usageLimitExceeded' }), DELAY);
    return;
  }
  if (MODE === 'turn-fail') {
    setTimeout(() => finish('failed', { message: 'fake internal error', codexErrorInfo: 'internalServerError' }), DELAY);
    return;
  }
  if (MODE === 'empty') {
    setTimeout(() => finish('completed'), DELAY);
    return;
  }
  if (MODE === 'slow') {
    setTimeout(() => finish('completed', null, `${PREFIX}${text}|history=${thread.turns.length - 1}`), 1500);
    return;
  }
  if (MODE === 'approval') {
    setTimeout(async () => {
      const response = await requestClient('item/commandExecution/requestApproval', {
        threadId: thread.id,
        turnId: turn.id,
        availableDecisions: ['accept', 'decline', 'cancel'],
        reason: 'fake approval request',
      });
      const decision = response?.decision ?? 'none';
      finish('completed', null, `${PREFIX}${text}|approval=${decision}`);
    }, 10);
    return;
  }
  if (MODE === 'files') {
    setTimeout(() => {
      emitItem(thread, turn, { type: 'fileChange', status: 'completed', changes: [{ path: 'src/app.js', kind: 'update' }] });
      emitItem(thread, turn, { type: 'commandExecution', command: 'npm test', exitCode: 0, status: 'completed' });
      finish('completed', null, `${PREFIX}${text}|history=${thread.turns.length - 1}`);
    }, DELAY);
    return;
  }
  setTimeout(() => finish('completed', null, `${PREFIX}${text}|history=${thread.turns.length - 1}`), DELAY);
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const text = line.trim();
  if (!text) return;
  let message;
  try { message = JSON.parse(text); } catch { return; }

  if (message.id !== undefined && message.method === undefined) {
    const handler = serverRequests.get(message.id);
    if (handler) {
      serverRequests.delete(message.id);
      handler(message.result ?? message.error ?? null);
    }
    return;
  }
  if (message.id === undefined || !message.method) return;
  const { id, method, params = {} } = message;
  noteRequest(method, params);

  switch (method) {
    case 'initialize':
      reply(id, { userAgent: 'fake-codex 0.0.0', codexHome: STATE_PATH || null, platformFamily: 'windows' });
      return;
    case 'initialized':
      return;
    case 'account/rateLimits/read':
      if (MODE === 'quota') {
        reply(id, {
          ordinaryUsageAllowed: false,
          rateLimits: {
            limitId: 'codex',
            planType: 'plus',
            primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) - 60 },
            secondary: { usedPercent: 100, windowDurationMins: 10080, resetsAt: QUOTA_RESET },
            credits: { hasCredits: false, balance: '0' },
          },
        });
      } else {
        reply(id, {
          ordinaryUsageAllowed: true,
          rateLimits: {
            limitId: 'codex',
            planType: 'plus',
            primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 3600 },
            secondary: { usedPercent: 5, windowDurationMins: 10080, resetsAt: QUOTA_RESET },
            credits: { hasCredits: false, balance: '0' },
          },
        });
      }
      return;
    case 'thread/start': {
      const thread = {
        id: `thr-${randomUUID()}`,
        cwd: params.cwd ?? null,
        sandbox: params.sandbox ?? null,
        approvalPolicy: params.approvalPolicy ?? null,
        ephemeral: params.ephemeral === true,
        model: params.model ?? null,
        turns: [],
      };
      state.threads[thread.id] = thread;
      save();
      reply(id, { thread });
      return;
    }
    case 'thread/resume': {
      const thread = state.threads[params.threadId];
      if (!thread) { replyError(id, -32600, `no rollout found for thread id ${params.threadId}`); return; }
      const holder = state.locks[params.threadId];
      if (holder && holder !== process.pid) { replyError(id, -32600, `thread ${params.threadId} already has an active writer`); return; }
      state.locks[params.threadId] = process.pid;
      save();
      reply(id, { thread });
      return;
    }
    case 'thread/read': {
      const thread = state.threads[params.threadId];
      if (!thread) { replyError(id, -32600, `no rollout found for thread id ${params.threadId}`); return; }
      reply(id, { thread });
      return;
    }
    case 'thread/list':
      reply(id, {
        data: Object.values(state.threads).map((thread) => ({
          id: thread.id,
          name: thread.name ?? null,
          status: { type: 'idle' },
          updatedAt: Math.floor(Date.now() / 1000),
        })),
        readStates: [],
        nextCursor: null,
      });
      return;
    case 'thread/loaded/list':
      reply(id, { data: Object.keys(state.locks) });
      return;
    case 'turn/start': {
      const thread = state.threads[params.threadId];
      if (!thread) { replyError(id, -32600, `no rollout found for thread id ${params.threadId}`); return; }
      const text = (params.input ?? [])
        .filter((block) => block?.type === 'text')
        .map((block) => block.text)
        .join('\n');
      const turn = { id: `turn-${randomUUID()}`, status: 'inProgress', text, items: [] };
      thread.turns.push(turn);
      save();
      reply(id, { turn: { id: turn.id, status: 'inProgress' } });
      setTimeout(() => scheduleTurn(thread, turn, text), 5);
      return;
    }
    case 'turn/interrupt': {
      const thread = state.threads[params.threadId];
      const turn = thread?.turns?.find((candidate) => candidate.id === params.turnId);
      if (!turn) { replyError(id, -32600, `turn not found: ${params.turnId}`); return; }
      emitTurnCompleted(thread, turn, 'interrupted');
      reply(id, {});
      return;
    }
    default:
      reply(id, {});
  }
});

const cleanup = () => {
  for (const [threadId, pid] of Object.entries(state.locks)) {
    if (pid === process.pid) delete state.locks[threadId];
  }
  save();
};
process.on('exit', cleanup);
process.on('SIGTERM', () => { cleanup(); process.exit(0); });
process.on('SIGINT', () => { cleanup(); process.exit(0); });
