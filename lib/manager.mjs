/**
 * Codex advisor manager + tool definitions.
 *
 * One app-server child per DSH Host, one persistent Codex thread per DSH
 * session, plus a durable binding so a DSH restart resumes the same thread.
 */
import { createRequire } from 'node:module';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { CodexAppServer } from './codex.mjs';

export const PLUGIN_VERSION = '0.2.0';
export const TOOL_NAMES = Object.freeze(['codex_ask', 'codex_poll', 'codex_cancel', 'codex_status', 'codex_reset']);

const DEFAULTS = Object.freeze({
  enabled: true,
  codexCommand: '',
  codexArgv: null,
  codexArgs: [],
  model: '',
  reasoningEffort: '',
  cwd: '',
  sandbox: 'workspace-write',
  approvalPolicy: 'never',
  defaultWaitSeconds: 180,
  maxWaitSeconds: 1800,
  turnTimeoutMs: 3600000,
  idleRecycleMs: 600000,
  maxConcurrentTurns: 1,
  maxThreads: 100,
  digestBytes: 4096,
  stateDir: '',
  promptSectionOrder: 137,
  quotaCheckTtlMs: 60000,
  env: {},
});

const SANDBOXES = new Set(['read-only', 'workspace-write']);
const APPROVALS = new Set(['never', 'on-request']);
const ENV_KEEP = [
  'PATH', 'PATHEXT', 'SystemRoot', 'WINDIR', 'ComSpec', 'TEMP', 'TMP',
  'USERPROFILE', 'HOME', 'LOCALAPPDATA', 'APPDATA', 'PROGRAMDATA',
  'CODEX_HOME', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy', 'LANG', 'LC_ALL',
];

export class AdvisorError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AdvisorError';
    this.code = code;
    this.details = details;
  }
}

export function resolveConfig(raw = {}) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AdvisorError('CODEX_BAD_CONFIG', 'plugin config must be an object');
  }
  const config = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    if (raw[key] !== undefined) config[key] = raw[key];
  }
  if (typeof config.enabled !== 'boolean') throw new AdvisorError('CODEX_BAD_CONFIG', 'enabled must be a boolean');
  if (typeof config.codexCommand !== 'string') throw new AdvisorError('CODEX_BAD_CONFIG', 'codexCommand must be a string');
  if (config.codexArgv !== null && (!Array.isArray(config.codexArgv) || config.codexArgv.some((part) => typeof part !== 'string' || !part))) {
    throw new AdvisorError('CODEX_BAD_CONFIG', 'codexArgv must be null or an array of non-empty strings');
  }
  if (!Array.isArray(config.codexArgs) || config.codexArgs.some((part) => typeof part !== 'string')) {
    throw new AdvisorError('CODEX_BAD_CONFIG', 'codexArgs must be an array of strings');
  }
  if (!SANDBOXES.has(config.sandbox)) throw new AdvisorError('CODEX_BAD_CONFIG', `sandbox must be one of ${[...SANDBOXES].join(', ')}`);
  if (!APPROVALS.has(config.approvalPolicy)) throw new AdvisorError('CODEX_BAD_CONFIG', `approvalPolicy must be one of ${[...APPROVALS].join(', ')}`);
  for (const key of ['defaultWaitSeconds', 'maxWaitSeconds', 'turnTimeoutMs', 'idleRecycleMs', 'maxConcurrentTurns', 'maxThreads', 'digestBytes', 'quotaCheckTtlMs']) {
    if (!Number.isFinite(config[key]) || config[key] < 0) throw new AdvisorError('CODEX_BAD_CONFIG', `${key} must be a non-negative number`);
  }
  if (config.maxWaitSeconds < config.defaultWaitSeconds) config.maxWaitSeconds = config.defaultWaitSeconds;
  if (typeof config.model !== 'string') throw new AdvisorError('CODEX_BAD_CONFIG', 'model must be a string');
  if (typeof config.reasoningEffort !== 'string') throw new AdvisorError('CODEX_BAD_CONFIG', 'reasoningEffort must be a string');
  config.reasoningEffort = config.reasoningEffort.trim();
  if (typeof config.cwd !== 'string') throw new AdvisorError('CODEX_BAD_CONFIG', 'cwd must be a string');
  if (typeof config.stateDir !== 'string') throw new AdvisorError('CODEX_BAD_CONFIG', 'stateDir must be a string');
  if (config.env === null || typeof config.env !== 'object' || Array.isArray(config.env)) {
    throw new AdvisorError('CODEX_BAD_CONFIG', 'env must be an object');
  }
  return config;
}

export function resolveCodexArgv(config) {
  if (Array.isArray(config.codexArgv) && config.codexArgv.length > 0) return [...config.codexArgv];
  const suffix = ['app-server', '--stdio', ...(config.codexArgs ?? [])];
  if (config.codexCommand) return [config.codexCommand, ...suffix];
  const searched = [];
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    const base = join(localAppData, 'OpenAI', 'Codex', 'bin');
    if (existsSync(base)) {
      const candidates = [];
      for (const entry of readdirSync(base)) {
        const candidate = join(base, entry, 'codex.exe');
        if (existsSync(candidate)) candidates.push(candidate);
      }
      candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
      if (candidates.length > 0) return [candidates[0], ...suffix];
      searched.push(join(base, '*', 'codex.exe'));
    } else {
      searched.push(base);
    }
  }
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, 'codex.exe');
    if (existsSync(candidate)) return [candidate, ...suffix];
    searched.push(candidate);
  }
  try {
    const require = createRequire(import.meta.url);
    const packagePath = require.resolve('@openai/codex/package.json');
    const manifest = require(packagePath);
    const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.codex;
    if (bin) return [join(dirname(packagePath), bin), ...suffix];
  } catch { /* optional fallback */ }
  throw new AdvisorError('CODEX_NOT_FOUND', 'Codex executable not found; set codexCommand or codexArgv in the plugin config', {
    searched: searched.slice(0, 20),
  });
}

export function buildSubprocessEnv(extra = {}) {
  const env = {};
  for (const key of ENV_KEEP) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return { ...env, ...(extra ?? {}) };
}

export function normalizeQuota(raw) {
  const rateLimits = raw?.rateLimits ?? raw ?? {};
  const primary = compactWindow(rateLimits.primary);
  const secondary = compactWindow(rateLimits.secondary);
  const exhausted = (secondary?.usedPercent ?? 0) >= 100 ? secondary
    : ((primary?.usedPercent ?? 0) >= 100 ? primary : null);
  return {
    allowed: raw?.ordinaryUsageAllowed !== false && exhausted === null,
    planType: rateLimits.planType ?? raw?.planType ?? null,
    primary,
    secondary,
    resetAt: exhausted?.resetAt ?? null,
    credits: rateLimits.credits ?? null,
  };
}

function compactWindow(window) {
  if (!window) return null;
  const resetsAt = typeof window.resetsAt === 'number' ? window.resetsAt : null;
  return {
    usedPercent: typeof window.usedPercent === 'number' ? window.usedPercent : null,
    windowDurationMins: typeof window.windowDurationMins === 'number' ? window.windowDurationMins : null,
    resetAt: resetsAt ? new Date(resetsAt * 1000).toISOString() : null,
  };
}

export function compactQuota(quota) {
  if (!quota) return null;
  return {
    allowed: quota.allowed !== false,
    planType: quota.planType ?? null,
    primary: quota.primary ?? null,
    secondary: quota.secondary ?? null,
    resetAt: quota.resetAt ?? null,
  };
}

export function mapResumeError(err) {
  const text = `${err?.message ?? ''}`.toLowerCase();
  if (text.includes('no rollout found') || text.includes('thread not found')) return 'CODEX_THREAD_NOT_FOUND';
  if (text.includes('active writer')) return 'CODEX_THREAD_BUSY';
  if (err?.code === 'TIMEOUT') return 'CODEX_TIMEOUT';
  if (err?.code === 'ABORTED') return 'CODEX_CANCELLED';
  return 'CODEX_RESUME_FAILED';
}

export function mapTurnError(error) {
  const info = error?.codexErrorInfo ?? error?.codex_error_info ?? null;
  const text = `${error?.message ?? ''}`.toLowerCase();
  if (info === 'usageLimitExceeded' || info === 'sessionBudgetExceeded') return 'CODEX_QUOTA_EXCEEDED';
  if (text.includes('usage limit') || text.includes('quota')) return 'CODEX_QUOTA_EXCEEDED';
  if (info === 'contextWindowExceeded') return 'CODEX_CONTEXT_EXCEEDED';
  if (info === 'serverOverloaded' || info === 'internalServerError') return 'CODEX_MODEL_UNAVAILABLE';
  if (info === 'unauthorized') return 'CODEX_NOT_LOGGED_IN';
  if (text.includes('not logged in') || text.includes('unauthorized')) return 'CODEX_NOT_LOGGED_IN';
  return 'CODEX_TURN_FAILED';
}

export function hintFor(code) {
  switch (code) {
    case 'CODEX_NOT_FOUND': return 'Install Codex or set codexCommand/codexArgv in the plugin config.';
    case 'CODEX_SPAWN_FAILED': return 'Check that the Codex executable runs in this Windows session.';
    case 'CODEX_INIT_FAILED': return 'Run `codex login` and retry; check events.ndjson for the initialize error.';
    case 'CODEX_NOT_LOGGED_IN': return 'Run `codex login` as the Windows user that runs DSH.';
    case 'CODEX_QUOTA_EXCEEDED': return 'Wait for the Codex quota reset time or use an account with available quota.';
    case 'CODEX_MODEL_UNAVAILABLE': return 'The model is overloaded; retry later.';
    case 'CODEX_THREAD_BUSY': return 'Another Codex client holds this thread; close it or wait for the idle recycle.';
    case 'CODEX_THREAD_NOT_FOUND': return 'The bridge starts a new thread automatically and re-briefs it from its digest.';
    case 'CODEX_TIMEOUT': return 'Call codex_poll with the returned turn_id, or codex_cancel to stop the turn.';
    case 'CODEX_CANCELLED': return 'The turn was cancelled.';
    case 'CODEX_NO_THREAD': return 'Call codex_ask first; it creates the advisor thread for this session.';
    case 'CODEX_BAD_ARGS': return 'Check the tool arguments.';
    case 'CODEX_CONTEXT_EXCEEDED': return 'Start a new thread with codex_reset and pass a compact brief.';
    case 'CODEX_APP_SERVER_EXITED': return 'The Codex process exited; retry the call (threads are resumed automatically).';
    default: return null;
  }
}

export class AdvisorManager {
  constructor({ ctx, config, store, logger, spawn, cwdResolver }) {
    this.ctx = ctx;
    this.config = config;
    this.store = store;
    this.logger = logger ?? (() => {});
    this.spawn = spawn;
    this.cwdResolver = cwdResolver;
    this.client = null;
    this.argv = null;
    this.quota = null;
    this.active = new Map();
    this.lastError = null;
    this.idleTimer = null;
    this.disposed = false;
  }

  log(level, data) {
    try { this.logger(level, data); } catch { /* ignore */ }
    if (level === 'warn' || level === 'error') {
      try { this.store.event(level, data?.event ?? 'log', data); } catch { /* ignore */ }
    }
  }

  assertAlive() {
    if (this.disposed) throw new AdvisorError('CODEX_DISPOSED', 'the Codex advisor plugin has been disposed');
  }

  sessionKey(exec) {
    const id = exec?.agent?.id;
    return typeof id === 'string' && id ? id : 'global';
  }

  async cwdFor(exec) {
    try {
      if (this.cwdResolver) {
        const value = await this.cwdResolver(exec);
        if (typeof value === 'string' && value) return value;
      }
    } catch (err) {
      this.log('warn', { event: 'cwd-resolve-failed', message: err?.message });
    }
    return this.config.cwd || process.cwd();
  }

  async ensureClient(signal) {
    this.assertAlive();
    if (!this.argv) this.argv = resolveCodexArgv(this.config);
    if (this.client && this.client.state !== 'exited' && this.client.state !== 'closed') {
      await this.client.ensureStarted({ signal });
      this.scheduleIdle();
      return this.client;
    }
    const client = new CodexAppServer({
      spawn: this.spawn,
      argv: this.argv,
      cwd: this.config.cwd || process.cwd(),
      env: buildSubprocessEnv(this.config.env),
      logger: (level, data) => this.log(level, data),
      onEvent: (event, data) => this.onClientEvent(event, data),
    });
    this.client = client;
    try {
      await client.ensureStarted({ signal });
    } catch (err) {
      const code = err?.code === 'SPAWN_FAILED' ? 'CODEX_SPAWN_FAILED'
        : err?.code === 'INIT_TIMEOUT' ? 'CODEX_INIT_FAILED'
          : err?.code === 'ABORTED' ? 'CODEX_CANCELLED'
            : err?.code === 'INIT_FAILED' ? 'CODEX_INIT_FAILED'
              : 'CODEX_INIT_FAILED';
      this.lastError = { code, message: err?.message ?? String(err) };
      this.log('error', { event: 'client-start-failed', code, message: err?.message, stderrTail: client.stderr?.slice(-1500) });
      throw new AdvisorError(code, err?.message ?? 'failed to start codex app-server', { stderrTail: client.stderr?.slice(-1500) ?? null });
    }
    this.scheduleIdle();
    return client;
  }

  onClientEvent(event, data) {
    if (event === 'started' || event === 'exited' || event === 'server-request') {
      this.store.event(event === 'exited' ? 'warn' : 'info', `client:${event}`, data ?? {});
    }
    if (event === 'exited') {
      this.lastError = { code: 'CODEX_APP_SERVER_EXITED', message: data?.stderrTail || 'codex app-server exited' };
    }
  }

  async preflightQuota(signal) {
    try {
      const client = await this.ensureClient(signal);
      const now = Date.now();
      if (this.quota && now - this.quota.at < this.config.quotaCheckTtlMs) {
        this.assertQuota(this.quota.value);
        return this.quota.value;
      }
      const raw = await client.rateLimits({ signal });
      const quota = normalizeQuota(raw);
      this.quota = { at: now, value: quota };
      this.assertQuota(quota);
      return quota;
    } catch (err) {
      if (err instanceof AdvisorError) throw err;
      this.log('warn', { event: 'quota-check-failed', message: err?.message });
      const cached = this.quota?.value ?? null;
      if (cached) this.assertQuota(cached);
      return cached;
    }
  }

  assertQuota(quota) {
    if (quota && quota.allowed === false) {
      throw new AdvisorError('CODEX_QUOTA_EXCEEDED', `Codex quota is exhausted${quota.resetAt ? `; it resets at ${quota.resetAt}` : ''}`, { quota });
    }
  }

  async ensureThread({ key, cwd, threadId, reset, signal }) {
    const client = await this.ensureClient(signal);
    const record = this.store.get(key);
    const target = threadId ?? record?.threadId ?? null;
    let recovered = false;
    if (target && reset !== true) {
      try {
        const thread = await client.resumeThread(target, { signal });
        const bound = this.store.bind(key, thread, { cwd });
        return { thread, record: bound, recovered: false, resumed: true };
      } catch (err) {
        const code = mapResumeError(err);
        if (code === 'CODEX_THREAD_BUSY') {
          throw new AdvisorError(code, `Codex thread ${target} is held by another writer (is it open in Codex Desktop?)`, {
            thread_id: target,
            cause: err?.message ?? null,
          });
        }
        if (code !== 'CODEX_THREAD_NOT_FOUND') {
          throw new AdvisorError(code, err?.message ?? 'thread/resume failed', { thread_id: target, cause: err?.message ?? null });
        }
        recovered = true;
        this.store.update(key, { lastResumeError: err?.message ?? null });
        this.log('warn', { event: 'thread-resume-failed', threadId: target, message: err?.message });
      }
    }
    const thread = await client.startThread({
      cwd,
      sandbox: this.config.sandbox,
      approvalPolicy: this.config.approvalPolicy,
      model: this.config.model || undefined,
      signal,
    });
    const bound = this.store.bind(key, thread, { cwd });
    return { thread, record: bound, recovered, resumed: false };
  }

  async ask(args, exec) {
    this.assertAlive();
    const message = typeof args?.message === 'string' ? args.message : '';
    if (!message.trim()) throw new AdvisorError('CODEX_BAD_ARGS', 'message must be a non-empty string');
    if (message.length > 65536) throw new AdvisorError('CODEX_BAD_ARGS', 'message must be at most 65536 characters');
    const key = this.sessionKey(exec);
    const waitSeconds = clampNumber(args?.wait_seconds, this.config.defaultWaitSeconds, 0, this.config.maxWaitSeconds);
    const brief = typeof args?.brief === 'string' ? args.brief.trim() : '';
    const reset = args?.reset === true;
    const explicitThread = typeof args?.thread_id === 'string' && args.thread_id.trim() ? args.thread_id.trim() : null;
    const cwd = await this.cwdFor(exec);
    const quota = await this.preflightQuota(exec?.signal);
    const client = await this.ensureClient(exec?.signal);
    const { thread, recovered, resumed } = await this.ensureThread({ key, cwd, threadId: explicitThread, reset, signal: exec?.signal });
    const active = client.activeTurns.get(thread.id);
    if (active) {
      throw new AdvisorError('CODEX_THREAD_BUSY', 'a turn is already running on this Codex thread', {
        thread_id: thread.id,
        turn_id: active.turnId,
      });
    }
    const parts = [];
    if (recovered) {
      const digest = this.store.brief(key);
      if (digest) parts.push(digest);
    }
    if (!resumed && brief) parts.push(brief);
    parts.push(message);
    const text = parts.join('\n\n');
    let session;
    try {
      session = await client.startTurn({
        threadId: thread.id,
        text,
        model: this.config.model || undefined,
        effort: this.config.reasoningEffort || undefined,
      });
    } catch (err) {
      throw mapTransportError(err);
    }
    this.active.set(thread.id, { key, session, startedAt: Date.now() });
    session.completion.then(() => {
      const current = this.active.get(thread.id);
      if (current?.session === session) this.active.delete(thread.id);
    });
    this.store.update(key, { lastAskAt: new Date().toISOString(), lastError: null });
    this.scheduleIdle();
    const waited = await waitForCompletion(session.completion, waitSeconds * 1000, exec?.signal);
    return this.finishTurn({ session, key, threadId: thread.id, waited, message, recovered, resumed, quota });
  }

  async finishTurn({ session, key, threadId, waited, message, recovered, resumed, quota }) {
    const base = {
      thread_id: threadId,
      turn_id: session.turnId ?? null,
      recovered: recovered ? 'new-thread' : 'same-thread',
    };
    if (waited.kind === 'timeout') {
      return {
        ...base,
        status: 'running',
        partial_answer: session.partialAnswer ?? null,
        notice: 'the turn is still running; call codex_poll with this turn_id to collect the answer',
        quota: compactQuota(quota ?? this.quota?.value ?? null),
      };
    }
    if (waited.kind === 'aborted') {
      await session.interrupt();
      await waitForCompletion(session.completion, 5000, null);
      return {
        ...base,
        status: 'cancelled',
        code: 'CODEX_CANCELLED',
        message: 'the DSH tool call was cancelled; turn/interrupt was sent',
        hint: hintFor('CODEX_CANCELLED'),
      };
    }
    const snapshot = waited.value ?? session.snapshot();
    const activity = activityOf(snapshot);
    if (snapshot.status === 'completed') {
      const answer = typeof snapshot.answer === 'string' ? snapshot.answer : '';
      if (!answer.trim()) {
        return {
          ...base,
          status: 'failed',
          code: 'CODEX_EMPTY_ANSWER',
          message: 'Codex completed the turn without a textual answer',
          activity,
          hint: 'Retry the request; if it repeats, ask Codex to answer with a short summary.',
        };
      }
      this.store.recordTurn(key, { ask: message, answer, turnId: snapshot.turnId });
      this.scheduleIdle();
      return {
        ...base,
        status: 'completed',
        answer,
        activity,
        quota: compactQuota(quota ?? this.quota?.value ?? null),
      };
    }
    if (snapshot.status === 'interrupted') {
      return {
        ...base,
        status: 'cancelled',
        code: 'CODEX_CANCELLED',
        message: 'Codex interrupted the turn',
        activity,
      };
    }
    const code = mapTurnError(snapshot.error);
    if (code === 'CODEX_QUOTA_EXCEEDED') this.quota = null;
    const error = new AdvisorError(code, snapshot.error?.message ?? 'Codex turn failed', {
      thread_id: threadId,
      turn_id: snapshot.turnId,
      activity,
      quota: code === 'CODEX_QUOTA_EXCEEDED' ? compactQuota(this.quota?.value ?? null) : undefined,
    });
    this.lastError = { code, message: error.message };
    this.log('warn', { event: 'turn-failed', code, threadId, turnId: snapshot.turnId, message: snapshot.error?.message });
    throw error;
  }

  async poll(args, exec) {
    this.assertAlive();
    const key = this.sessionKey(exec);
    const record = this.store.get(key);
    const threadId = typeof args?.thread_id === 'string' && args.thread_id ? args.thread_id : record?.threadId;
    if (!threadId) throw new AdvisorError('CODEX_NO_THREAD', 'no Codex thread is bound to this DSH session yet');
    const client = await this.ensureClient(exec?.signal);
    const session = client.activeTurns.get(threadId);
    const requestedTurn = typeof args?.turn_id === 'string' && args.turn_id ? args.turn_id : null;
    if (!session) {
      const same = !requestedTurn || requestedTurn === record?.lastTurnId;
      return {
        status: 'idle',
        thread_id: threadId,
        turn_id: record?.lastTurnId ?? null,
        answer: same ? (record?.digest?.lastAnswer ?? null) : null,
        notice: 'no turn is currently running on this thread',
      };
    }
    if (requestedTurn && session.turnId && requestedTurn !== session.turnId) {
      throw new AdvisorError('CODEX_TURN_NOT_FOUND', `turn ${requestedTurn} is not the active turn on this thread`, {
        thread_id: threadId,
        turn_id: session.turnId,
      });
    }
    const waitSeconds = clampNumber(args?.wait_seconds, Math.min(60, this.config.defaultWaitSeconds), 0, 600);
    const waited = await waitForCompletion(session.completion, waitSeconds * 1000, exec?.signal);
    return this.finishTurn({ session, key, threadId, waited, message: null, recovered: false, resumed: true, quota: this.quota?.value ?? null });
  }

  async cancel(args, exec) {
    this.assertAlive();
    const key = this.sessionKey(exec);
    const record = this.store.get(key);
    const threadId = typeof args?.thread_id === 'string' && args.thread_id ? args.thread_id : record?.threadId;
    if (!threadId) throw new AdvisorError('CODEX_NO_THREAD', 'no Codex thread is bound to this DSH session yet');
    const client = await this.ensureClient(exec?.signal);
    const session = client.activeTurns.get(threadId);
    if (!session) return { status: 'idle', thread_id: threadId, notice: 'no turn is currently running on this thread' };
    const turnId = session.turnId ?? null;
    await session.interrupt();
    const waited = await waitForCompletion(session.completion, 5000, null);
    const snapshot = waited.kind === 'completed' ? waited.value : session.snapshot();
    return {
      status: snapshot.status === 'interrupted' ? 'cancelled' : (snapshot.status ?? 'cancelled'),
      thread_id: threadId,
      turn_id: turnId,
      answer: snapshot.answer ?? null,
      notice: 'turn/interrupt was sent',
    };
  }

  async status(args, exec) {
    const key = this.sessionKey(exec);
    let quota = this.quota?.value ?? null;
    let loaded = null;
    try {
      if (this.client?.state === 'ready') {
        const raw = await withTimeout(this.client.rateLimits({}), 5000);
        quota = normalizeQuota(raw);
        this.quota = { at: Date.now(), value: quota };
      }
    } catch (err) {
      this.log('debug', { event: 'status-quota-failed', message: err?.message });
    }
    try {
      if (this.client?.state === 'ready') {
        const value = await withTimeout(this.client.loadedThreads({}), 5000);
        loaded = Array.isArray(value?.data) ? value.data : null;
      }
    } catch { /* optional */ }
    const record = this.store.get(key);
    return {
      status: 'ok',
      codex: {
        version: this.client?.version ?? null,
        userAgent: this.client?.userAgent ?? null,
        codexHome: this.client?.codexHome ?? null,
        state: this.client?.state ?? 'idle',
        argv: this.argv ?? null,
      },
      thread: record ? {
        thread_id: record.threadId,
        generation: record.generation,
        cwd: record.cwd,
        model: record.model,
        last_turn_id: record.lastTurnId,
        last_ask_at: record.lastAskAt,
        last_answer_at: record.lastAnswerAt,
      } : null,
      active_turn: this.client?.activeTurns.get(record?.threadId)
        ? { turn_id: this.client.activeTurns.get(record.threadId).turnId }
        : null,
      loaded_threads: loaded,
      quota: compactQuota(quota),
      last_error: this.lastError,
      state_dir: this.store.dir,
      config: {
        sandbox: this.config.sandbox,
        approvalPolicy: this.config.approvalPolicy,
        model: this.config.model || null,
        reasoningEffort: this.config.reasoningEffort || null,
        defaultWaitSeconds: this.config.defaultWaitSeconds,
        maxWaitSeconds: this.config.maxWaitSeconds,
        idleRecycleMs: this.config.idleRecycleMs,
      },
      tools: [...TOOL_NAMES],
    };
  }

  async reset(args, exec) {
    this.assertAlive();
    const key = this.sessionKey(exec);
    const cwd = await this.cwdFor(exec);
    await this.preflightQuota(exec?.signal).catch(() => null);
    const client = await this.ensureClient(exec?.signal);
    const existing = this.store.get(key);
    const thread = await client.startThread({
      cwd,
      sandbox: this.config.sandbox,
      approvalPolicy: this.config.approvalPolicy,
      model: this.config.model || undefined,
      signal: exec?.signal,
    });
    const record = this.store.bind(key, thread, { cwd });
    return {
      status: 'reset',
      old_thread_id: existing?.threadId ?? null,
      thread_id: thread.id,
      generation: record.generation,
      reason: typeof args?.reason === 'string' ? args.reason : null,
    };
  }

  scheduleIdle() {
    this.clearIdle();
    if (!this.config.idleRecycleMs) return;
    this.idleTimer = setTimeout(async () => {
      const client = this.client;
      if (!client) return;
      if (client.activeTurns.size > 0) { this.scheduleIdle(); return; }
      this.client = null;
      try { await client.close(); } catch { /* ignore */ }
      this.store.event('info', 'idle-recycle', { argv: this.argv?.[0] ?? null });
    }, this.config.idleRecycleMs);
    this.idleTimer.unref?.();
  }

  clearIdle() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clearIdle();
    for (const { session } of this.active.values()) {
      try { await session.interrupt(); } catch { /* ignore */ }
    }
    this.active.clear();
    const client = this.client;
    this.client = null;
    if (client) {
      try { await client.close(); } catch (err) { this.log('warn', { event: 'dispose-close-failed', message: err?.message }); }
    }
    try {
      this.store.setBridge({ pid: process.pid, stoppedAt: new Date().toISOString() });
    } catch { /* ignore */ }
  }
}

function mapTransportError(err) {
  if (err instanceof AdvisorError) return err;
  const text = `${err?.message ?? ''}`.toLowerCase();
  if (text.includes('no rollout found')) return new AdvisorError('CODEX_THREAD_NOT_FOUND', err?.message ?? 'thread not found', {});
  if (text.includes('active writer')) return new AdvisorError('CODEX_THREAD_BUSY', err?.message ?? 'thread busy', {});
  if (err?.code === 'TIMEOUT') return new AdvisorError('CODEX_TIMEOUT', err?.message ?? 'timed out', {});
  if (err?.code === 'ABORTED') return new AdvisorError('CODEX_CANCELLED', err?.message ?? 'aborted', {});
  return new AdvisorError('CODEX_TURN_START_FAILED', err?.message ?? 'turn/start failed', { cause: err?.message ?? null });
}

function activityOf(snapshot) {
  if (!snapshot) return null;
  const files = Array.isArray(snapshot.files) ? snapshot.files : [];
  const commands = Array.isArray(snapshot.commands) ? snapshot.commands : [];
  const declined = (snapshot.declinedApprovals ?? 0) + (snapshot.declinedItems ?? 0);
  if (files.length === 0 && commands.length === 0 && declined === 0) return null;
  return { files, commands, declined };
}

function clampNumber(value, fallback, min, max) {
  const number = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, number));
}

function waitForCompletion(promise, timeoutMs, signal) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
      resolve(value);
    };
    const onAbort = () => finish({ kind: 'aborted' });
    if (signal?.aborted) { onAbort(); return; }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => finish({ kind: 'timeout' }), Math.max(0, timeoutMs));
    timer.unref?.();
    promise.then((value) => finish({ kind: 'completed', value }));
  });
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
    timer.unref?.();
    promise.then((value) => { clearTimeout(timer); resolve(value); }, (err) => { clearTimeout(timer); reject(err); });
  });
}

export function usageSectionText(config) {
  return [
    '## Codex advisor (persistent thread)',
    '',
    'A Codex advisor thread is bound to this DSH session and persists across DSH restarts.',
    'Use it for a second opinion, plan review, mid-course correction, or final acceptance.',
    '',
    `- \`codex_ask\` sends one message to the bound thread (sandbox: ${config.sandbox}). The thread keeps the conversation; send only the new request.`,
    '- For a brand-new or reset thread, put the durable context in `brief`; afterwards just send the delta.',
    '- Do not paste large files: pass paths. The advisor reads the working directory itself.',
    '- Long turns: call `codex_ask` with a small `wait_seconds`; then `codex_poll` with the returned `turn_id`.',
    '- `codex_cancel` interrupts the running turn; `codex_reset` starts a new thread; `codex_status` shows health and quota.',
    '- The advisor may modify the working directory (workspace-write). Review `activity.files` and the resulting diff before accepting its work.',
  ].join('\n');
}

const RESULT_SCHEMA = { type: 'object', additionalProperties: true };

export function buildTools(manager) {
  const make = (definition) => ({
    ...definition,
    isConcurrencySafe: () => false,
    output: {
      schema: RESULT_SCHEMA,
      render: (_args, value) => renderToolResult(definition.name, value),
    },
  });

  return [
    make({
      name: 'codex_ask',
      description: [
        'Ask the persistent Codex advisor thread bound to this DSH session.',
        'The thread is reused across calls and across DSH restarts, and keeps its own conversation history.',
        'Send only the new request; use `brief` only when a new thread is created.',
        'Returns the final answer when it completes within `wait_seconds`; otherwise returns status=running with a turn_id for codex_poll.',
        'The advisor runs under the user\'s ChatGPT/Codex login and may modify the session working directory.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'The new request for the advisor. Do not repeat context the thread already has.' },
          wait_seconds: { type: 'integer', minimum: 0, maximum: 1800, default: 180, description: 'How long to wait for the final answer before returning a running turn.' },
          brief: { type: 'string', description: 'Durable context, used only when this call creates a new thread (first ask, reset, or recovery).' },
          thread_id: { type: 'string', description: 'Attach to an existing advisor thread instead of this session\'s binding.' },
          reset: { type: 'boolean', default: false, description: 'Start a new advisor thread and rebind this session.' },
        },
        required: ['message'],
      },
      timeoutMs: manager.config.maxWaitSeconds * 1000 + 30000,
      execute: (args, exec) => runTool(manager, 'ask', args, exec),
    }),
    make({
      name: 'codex_poll',
      description: 'Fetch the result of a running or finished Codex advisor turn. Waits up to wait_seconds; returns status=running if it is still working.',
      parameters: {
        type: 'object',
        properties: {
          thread_id: { type: 'string', description: 'Defaults to this session\'s bound thread.' },
          turn_id: { type: 'string', description: 'The turn to collect; defaults to the active turn.' },
          wait_seconds: { type: 'integer', minimum: 0, maximum: 600, default: 60 },
        },
      },
      timeoutMs: 600 * 1000 + 30000,
      execute: (args, exec) => runTool(manager, 'poll', args, exec),
    }),
    make({
      name: 'codex_cancel',
      description: 'Interrupt the running Codex advisor turn on this session\'s thread (sends turn/interrupt).',
      parameters: {
        type: 'object',
        properties: {
          thread_id: { type: 'string', description: 'Defaults to this session\'s bound thread.' },
          turn_id: { type: 'string', description: 'Optional expected turn id.' },
        },
      },
      timeoutMs: 60000,
      execute: (args, exec) => runTool(manager, 'cancel', args, exec),
    }),
    make({
      name: 'codex_status',
      description: 'Health and state of the Codex advisor: app-server state/version, bound thread, active turn, quota snapshot, last error.',
      parameters: { type: 'object', properties: {} },
      timeoutMs: 60000,
      execute: (args, exec) => runTool(manager, 'status', args, exec),
    }),
    make({
      name: 'codex_reset',
      description: 'Start a new Codex advisor thread for this DSH session (the old thread is kept in Codex, not deleted).',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Why a new thread is needed; recorded in diagnostics.' },
        },
      },
      timeoutMs: 120000,
      execute: (args, exec) => runTool(manager, 'reset', args, exec),
    }),
  ];
}

async function runTool(manager, method, args, exec) {
  try {
    return await manager[method](args ?? {}, exec);
  } catch (err) {
    if (err instanceof AdvisorError) {
      return {
        status: 'failed',
        code: err.code,
        message: err.message,
        hint: hintFor(err.code),
        ...(err.details ?? {}),
      };
    }
    return {
      status: 'failed',
      code: 'CODEX_INTERNAL',
      message: err?.message ?? String(err),
      hint: 'Check events.ndjson in the advisor state directory.',
    };
  }
}

export function renderToolResult(name, value) {
  if (!value || typeof value !== 'object') return [{ type: 'text', text: String(value ?? '') }];
  if (name === 'codex_status') return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
  const lines = [];
  lines.push(`status: ${value.status ?? 'unknown'}${value.code ? ` (${value.code})` : ''}`);
  if (value.thread_id) lines.push(`thread: ${value.thread_id}${value.turn_id ? `  turn: ${value.turn_id}` : ''}`);
  if (value.recovered === 'new-thread') lines.push('notice: the previous Codex thread could not be resumed; a new thread was started with a compact digest.');
  if (value.notice) lines.push(value.notice);
  if (typeof value.answer === 'string' && value.answer) {
    lines.push('', value.answer);
  } else if (typeof value.partial_answer === 'string' && value.partial_answer) {
    lines.push('', value.partial_answer);
  } else if (value.message) {
    lines.push('', value.message);
  }
  if (value.activity) {
    const files = value.activity.files ?? [];
    const commands = value.activity.commands ?? [];
    if (files.length > 0) {
      const paths = [...new Set(files.flatMap((file) => file.paths ?? []))].slice(0, 20);
      lines.push('', `files changed: ${paths.length > 0 ? paths.join(', ') : files.length}`);
    }
    if (commands.length > 0) lines.push(`commands run: ${commands.length}`);
    if (value.activity.declined) lines.push(`approvals declined: ${value.activity.declined}`);
  }
  if (value.quota?.resetAt) lines.push('', `quota reset: ${value.quota.resetAt}`);
  if (value.hint) lines.push('', `hint: ${value.hint}`);
  return [{ type: 'text', text: lines.join('\n') }];
}
