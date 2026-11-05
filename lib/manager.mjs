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

export const PLUGIN_VERSION = '0.6.0';
export const TOOL_NAMES = Object.freeze(['codex_ask', 'codex_poll', 'codex_cancel', 'codex_status', 'codex_history', 'codex_reset']);

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

const MODEL_CHOICES = Object.freeze([
  'gpt-6-astra',
  'gpt-6.1-sol',
  'gpt-6.1-terra',
  'gpt-6-luna',
]);
const EFFORT_CHOICES = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
const PURPOSE_CHOICES = Object.freeze([
  'architecture',
  'plan',
  'review',
  'accept',
  'implement',
  'debug',
  'verify',
  'routine',
  'explore',
  'general',
]);
const PURPOSE_POLICY = Object.freeze({
  architecture: { model: 'gpt-6-astra', effort: 'max' },
  plan: { model: 'gpt-6-astra', effort: 'high' },
  review: { model: 'gpt-6-astra', effort: 'max' },
  accept: { model: 'gpt-6-astra', effort: 'max' },
  implement: { model: 'gpt-6.1-sol', effort: 'high' },
  debug: { model: 'gpt-6.1-sol', effort: 'high' },
  verify: { model: 'gpt-6-luna', effort: 'medium' },
  routine: { model: 'gpt-6-luna', effort: 'low' },
  explore: { model: 'gpt-6.1-sol', effort: 'high' },
  general: { model: 'gpt-6.1-sol', effort: 'medium' },
});
const DEFAULT_NEW_MODEL = 'gpt-6.1-sol';
const ENGLISH_DIRECTIVE = 'Advisor language: answer in English. The DSH agent or user may write in Chinese; keep the answer itself in English. Follow the requested task, not the language.';
function policyFor(purpose) {
  return PURPOSE_POLICY[purpose] ?? null;
}

function modelForNewThread(args, config) {
  const policy = policyFor(args?.purpose);
  const requested = typeof args?.model === 'string' && args.model.trim() ? args.model.trim() : null;
  return requested || policy?.model || (config.model || '').trim() || DEFAULT_NEW_MODEL;
}

function effortForTurn(args, config, fallback = null) {
  const requested = typeof args?.effort === 'string' && args.effort.trim() ? args.effort.trim() : null;
  if (requested) return requested;
  const policy = policyFor(args?.purpose);
  return policy?.effort || fallback || (config.reasoningEffort || '').trim() || 'medium';
}

function newThreadLabel(args, message) {
  const requested = typeof args?.label === 'string' ? args.label.trim() : '';
  if (requested) return clipText(requested, 80);
  const text = typeof message === 'string' ? message.replace(/\s+/g, ' ').trim() : '';
  return text ? clipText(text, 52) : 'Codex thread';
}

function findThread(threads, selector) {
  const value = typeof selector === 'string' ? selector.trim() : '';
  if (!value) return null;
  const exact = threads.find((thread) => thread.threadId === value);
  if (exact) return exact;
  const lower = value.toLowerCase();
  return threads.find((thread) => String(thread.label ?? '').toLowerCase() === lower)
    ?? threads.find((thread) => String(thread.label ?? '').toLowerCase().includes(lower))
    ?? null;
}

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
    case 'CODEX_THREAD_NOT_FOUND': return 'Use codex_status to list the labeled threads; a missing bound thread is replaced automatically with a re-briefed thread.';
    case 'CODEX_THREAD_MODEL_PINNED': return 'A model is fixed for the lifetime of its thread; start a new thread with new_thread=true to use a different model. Change only effort on an existing thread.';
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

  sourceInfo() {
    return {
      kind: 'codex-advisor',
      transport: 'codex-app-server',
      plugin: 'dsh-codex-advisor',
      version: PLUGIN_VERSION,
      model: this.config.model || null,
      effort: this.config.reasoningEffort || null,
    };
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

  async ensureThread({ key, cwd, threadId, reset, signal, model, effort, label }) {
    const client = await this.ensureClient(signal);
    const record = this.store.get(key);
    const target = threadId ?? record?.threadId ?? null;
    let recovered = false;
    let recoveryBrief = '';
    if (target && reset !== true) {
      try {
        const thread = await client.resumeThread(target, { signal, developerInstructions: ENGLISH_DIRECTIVE });
        const bound = this.store.bind(key, thread, {
          cwd,
          model: record?.model ?? model,
          effort: effort ?? record?.effort,
          label: record?.label ?? label,
        });
        return { thread, record: bound, recovered: false, resumed: true, recoveryBrief: '' };
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
        recoveryBrief = this.store.brief(key);
        this.store.update(key, { lastResumeError: err?.message ?? null });
        this.log('warn', { event: 'thread-resume-failed', threadId: target, message: err?.message });
      }
    }
    const thread = await client.startThread({
      cwd,
      sandbox: this.config.sandbox,
      approvalPolicy: this.config.approvalPolicy,
      model: model ?? record?.model ?? (this.config.model || undefined),
      developerInstructions: ENGLISH_DIRECTIVE,
      signal,
    });
    const bound = this.store.bind(key, thread, {
      cwd,
      model: model ?? record?.model ?? this.config.model,
      effort: effort ?? record?.effort ?? this.config.reasoningEffort,
      label: label ?? record?.label,
      carryDigest: recovered,
    });
    return { thread, record: bound, recovered, resumed: false, recoveryBrief };
  }

  async ask(args, exec) {
    this.assertAlive();
    const message = typeof args?.message === 'string' ? args.message : '';
    if (!message.trim()) throw new AdvisorError('CODEX_BAD_ARGS', 'message must be a non-empty string');
    if (message.length > 65536) throw new AdvisorError('CODEX_BAD_ARGS', 'message must be at most 65536 characters');
    const purpose = typeof args?.purpose === 'string' && args.purpose.trim() ? args.purpose.trim() : null;
    if (purpose && !PURPOSE_CHOICES.includes(purpose)) {
      throw new AdvisorError('CODEX_BAD_ARGS', `purpose must be one of ${PURPOSE_CHOICES.join(', ')}`);
    }
    const requestedModel = typeof args?.model === 'string' && args.model.trim() ? args.model.trim() : null;
    if (requestedModel && !MODEL_CHOICES.includes(requestedModel)) {
      throw new AdvisorError('CODEX_BAD_ARGS', `model must be one of ${MODEL_CHOICES.join(', ')}`);
    }
    const requestedEffort = typeof args?.effort === 'string' && args.effort.trim() ? args.effort.trim() : null;
    if (requestedEffort && !EFFORT_CHOICES.includes(requestedEffort)) {
      throw new AdvisorError('CODEX_BAD_ARGS', `effort must be one of ${EFFORT_CHOICES.join(', ')}`);
    }
    const key = this.sessionKey(exec);
    const waitSeconds = clampNumber(args?.wait_seconds, this.config.defaultWaitSeconds, 0, this.config.maxWaitSeconds);
    const brief = typeof args?.brief === 'string' ? args.brief.trim() : '';
    const reset = args?.reset === true;
    const newThread = reset || args?.new_thread === true;
    const selector = typeof args?.thread === 'string' && args.thread.trim() ? args.thread.trim()
      : (typeof args?.thread_id === 'string' && args.thread_id.trim() ? args.thread_id.trim() : null);
    if (newThread && selector) {
      throw new AdvisorError('CODEX_BAD_ARGS', 'thread/thread_id cannot be combined with new_thread');
    }
    const cwd = await this.cwdFor(exec);
    const quota = await this.preflightQuota(exec?.signal);
    const client = await this.ensureClient(exec?.signal);

    let record = this.store.get(key);
    const threads = this.store.threads(key);
    let selectedThreadId = null;
    if (selector) {
      const selected = findThread(threads, selector);
      if (!selected) {
        throw new AdvisorError('CODEX_THREAD_NOT_FOUND', `no Codex thread matches "${selector}"`, {
          threads: threads.map((thread) => ({ thread_id: thread.threadId, label: thread.label, model: thread.model })),
        });
      }
      selectedThreadId = selected.threadId;
      if (selected.threadId !== record?.threadId) {
        record = this.store.switchThread(key, selected.threadId);
      }
    }

    let model;
    let effort;
    let label;
    const creatingThread = newThread || !record?.threadId;
    if (creatingThread) {
      model = modelForNewThread({ model: requestedModel, purpose }, this.config);
      effort = effortForTurn({ effort: requestedEffort, purpose }, this.config, this.config.reasoningEffort);
      label = newThreadLabel(args, message);
    } else {
      const activeModel = record?.model || (this.config.model || '').trim() || DEFAULT_NEW_MODEL;
      if (requestedModel && requestedModel !== activeModel) {
        throw new AdvisorError('CODEX_THREAD_MODEL_PINNED', `this Codex thread uses ${activeModel}; start a new thread to switch model`, {
          thread_id: record?.threadId ?? null,
          current_model: activeModel,
          requested_model: requestedModel,
          hint: 'Use codex_ask with new_thread=true (and a label/purpose) for the new model; keep effort changes on the existing thread.',
        });
      }
      model = activeModel;
      effort = effortForTurn({ effort: requestedEffort, purpose }, this.config, this.config.reasoningEffort);
      label = record?.label ?? null;
    }

    const { thread, recovered, resumed, recoveryBrief } = await this.ensureThread({
      key,
      cwd,
      threadId: selectedThreadId ?? undefined,
      reset: newThread,
      signal: exec?.signal,
      model,
      effort,
      label,
    });
    const boundModel = this.store.get(key)?.model ?? model;
    const active = client.activeTurns.get(thread.id);
    if (active) {
      throw new AdvisorError('CODEX_THREAD_BUSY', 'a turn is already running on this Codex thread', {
        thread_id: thread.id,
        turn_id: active.turnId,
      });
    }
    const parts = [];
    if (recovered) {
      const digest = recoveryBrief || this.store.brief(key);
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
        model: boundModel || undefined,
        effort: effort || undefined,
      });
    } catch (err) {
      throw mapTransportError(err);
    }
    this.active.set(thread.id, { key, session, startedAt: Date.now() });
    session.completion.then((snapshot) => {
      const current = this.active.get(thread.id);
      if (current?.session !== session) return;
      this.active.delete(thread.id);
      try {
        this.persistCompletion(key, message, snapshot ?? session.snapshot(), boundModel, effort);
      } catch (err) {
        this.log('warn', { event: 'persist-completion-failed', threadId: thread.id, message: err?.message });
      }
    }).catch((err) => {
      this.log('warn', { event: 'completion-rejected', threadId: thread.id, message: err?.message });
    });
    this.store.update(key, { lastAskAt: new Date().toISOString(), lastError: null, effort });
    this.scheduleIdle();
    const waited = await waitForCompletion(session.completion, waitSeconds * 1000, exec?.signal);
    return this.finishTurn({
      session, key, threadId: thread.id, waited, message, recovered, resumed, quota,
      model: boundModel, effort,
    });
  }

  persistCompletion(key, message, snapshot, model, effort) {
    if (!snapshot) return;
    const activity = activityOf(snapshot);
    if (snapshot.status === 'completed') {
      const answer = typeof snapshot.answer === 'string' ? snapshot.answer : '';
      if (!answer.trim()) {
        this.store.update(key, {
          lastFailure: {
            status: 'failed',
            code: 'CODEX_EMPTY_ANSWER',
            message: 'Codex completed the turn without a textual answer',
            at: new Date().toISOString(),
          },
          activity,
        });
        return;
      }
      this.store.update(key, { lastFailure: null });
      this.store.recordTurn(key, { ask: message, answer, turnId: snapshot.turnId, model, effort, activity });
      this.scheduleIdle();
      return;
    }
    if (snapshot.status === 'interrupted' || snapshot.status === 'cancelled') {
      this.store.update(key, {
        lastFailure: {
          status: 'cancelled',
          code: 'CODEX_CANCELLED',
          message: 'Codex interrupted the turn',
          at: new Date().toISOString(),
        },
        activity,
      });
      return;
    }
    if (snapshot.status === 'failed') {
      const code = mapTurnError(snapshot.error);
      if (code === 'CODEX_QUOTA_EXCEEDED') this.quota = null;
      this.store.update(key, {
        lastFailure: {
          status: 'failed',
          code,
          message: snapshot.error?.message ?? 'Codex turn failed',
          at: new Date().toISOString(),
        },
        activity,
      });
    }
  }

  async finishTurn({ session, key, threadId, waited, message, recovered, resumed, quota, model = null, effort = null }) {
    const record = this.store.get(key);
    const turnModel = model ?? record?.model ?? null;
    const turnEffort = effort ?? record?.effort ?? this.config.reasoningEffort ?? null;
    const base = {
      source: this.sourceInfo(),
      thread_id: threadId,
      turn_id: session.turnId ?? null,
      model: turnModel,
      effort: turnEffort,
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
      this.store.update(key, {
        lastFailure: {
          status: 'cancelled',
          code: 'CODEX_CANCELLED',
          message: 'the DSH tool call was cancelled',
          at: new Date().toISOString(),
        },
      });
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
        this.store.update(key, {
          lastFailure: {
            status: 'failed',
            code: 'CODEX_EMPTY_ANSWER',
            message: 'Codex completed the turn without a textual answer',
            at: new Date().toISOString(),
          },
          activity,
        });
        return {
          ...base,
          status: 'failed',
          code: 'CODEX_EMPTY_ANSWER',
          message: 'Codex completed the turn without a textual answer',
          activity,
          hint: 'Retry the request; if it repeats, ask Codex to answer with a short summary.',
        };
      }
      this.store.update(key, { lastFailure: null });
      this.store.recordTurn(key, { ask: message, answer, turnId: snapshot.turnId, model: turnModel, effort: turnEffort, activity });
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
      this.store.update(key, {
        lastFailure: {
          status: 'cancelled',
          code: 'CODEX_CANCELLED',
          message: 'Codex interrupted the turn',
          at: new Date().toISOString(),
        },
        activity,
      });
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
    this.store.update(key, {
      lastFailure: {
        status: 'failed',
        code,
        message: snapshot.error?.message ?? 'Codex turn failed',
        at: new Date().toISOString(),
      },
      activity,
    });
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
        source: this.sourceInfo(),
        status: 'idle',
        thread_id: threadId,
        turn_id: record?.lastTurnId ?? null,
        answer: same ? (record?.digest?.lastAnswer ?? null) : null,
        last_failure: record?.lastFailure ?? null,
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
    if (!session) return { source: this.sourceInfo(), status: 'idle', thread_id: threadId, notice: 'no turn is currently running on this thread' };
    const turnId = session.turnId ?? null;
    await session.interrupt();
    const waited = await waitForCompletion(session.completion, 5000, null);
    const snapshot = waited.kind === 'completed' ? waited.value : session.snapshot();
    return {
      source: this.sourceInfo(),
      status: snapshot.status === 'interrupted' ? 'cancelled' : (snapshot.status ?? 'cancelled'),
      thread_id: threadId,
      turn_id: turnId,
      answer: snapshot.answer ?? null,
      notice: 'turn/interrupt was sent',
    };
  }

  snapshot(args, exec) {
    const key = this.sessionKey(exec);
    const record = this.store.get(key);
    const threads = this.store.threads(key);
    const source = this.sourceInfo();
    if (!record) {
      return {
        source,
        status: 'empty',
        thread_id: null,
        active_thread_id: null,
        threads,
        label: null,
        model: this.config.model || null,
        effort: this.config.reasoningEffort || null,
        asks: 0,
        last_ask_at: null,
        last_ask: null,
        last_answer_at: null,
        last_answer: null,
        last_failure: null,
        last_activity: null,
      };
    }
    const digest = record.digest ?? {};
    return {
      source,
      status: record.lastAnswerAt ? 'ready' : 'bound',
      thread_id: record.threadId,
      active_thread_id: record.threadId,
      threads,
      label: record.label ?? null,
      model: record.model ?? this.config.model ?? null,
      effort: record.effort ?? this.config.reasoningEffort ?? null,
      asks: Array.isArray(digest.asks) ? digest.asks.length : 0,
      last_ask_at: record.lastAskAt ?? null,
      last_ask: Array.isArray(digest.asks) && digest.asks.length > 0 ? clipText(digest.asks.at(-1), 500) : null,
      last_answer_at: record.lastAnswerAt ?? null,
      last_answer: typeof digest.lastAnswer === 'string' ? clipText(digest.lastAnswer, 400) : null,
      last_failure: record.lastFailure
        ? { ...record.lastFailure, message: clipText(record.lastFailure.message, 300) }
        : null,
      last_activity: record.activity ?? null,
    };
  }

  async history(args, exec) {
    this.assertAlive();
    const key = this.sessionKey(exec);
    const record = this.store.get(key);
    const threads = this.store.threads(key);
    const selector = typeof args?.thread === 'string' && args.thread.trim() ? args.thread.trim()
      : (typeof args?.thread_id === 'string' && args.thread_id.trim() ? args.thread_id.trim() : null);
    const selected = selector ? findThread(threads, selector) : (record ? threads.find((thread) => thread.threadId === record.threadId) : null);
    if (!selected) {
      if (selector) {
        throw new AdvisorError('CODEX_THREAD_NOT_FOUND', `no Codex thread matches "${selector}"`, {
          threads: threads.map((thread) => ({ thread_id: thread.threadId, label: thread.label, model: thread.model })),
        });
      }
      throw new AdvisorError('CODEX_NO_THREAD', 'no Codex thread is bound to this DSH session yet');
    }
    const threadId = selected.threadId;
    const limit = clampNumber(args?.limit, 5, 1, 20);
    const client = await this.ensureClient(exec?.signal);
    let raw;
    try {
      raw = await client.readThread(threadId, { signal: exec?.signal });
    } catch (err) {
      const code = mapResumeError(err);
      throw new AdvisorError(code, err?.message ?? 'thread/read failed', { thread_id: threadId, cause: err?.message ?? null });
    }
    const thread = raw?.thread ?? raw ?? {};
    const turnMeta = this.store.turnMeta(key, threadId);
    const allTurns = Array.isArray(thread.turns) ? thread.turns : [];
    const turns = allTurns.slice(-limit).map((turn) => summarizeTurn(turn, turnMeta));
    this.scheduleIdle();
    const lastMeta = Object.values(turnMeta).at(-1) ?? null;
    return {
      source: this.sourceInfo(),
      thread_id: threadId,
      active_thread_id: record?.threadId ?? null,
      threads,
      label: selected.label ?? null,
      model: selected.model ?? thread.model ?? this.config.model ?? null,
      effort: lastMeta?.effort ?? selected.effort ?? this.config.reasoningEffort ?? null,
      total_turns: allTurns.length,
      returned: turns.length,
      turns,
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
    const threads = this.store.threads(key);
    return {
      source: this.sourceInfo(),
      status: 'ok',
      threads,
      active_thread_id: record?.threadId ?? null,
      codex: {
        version: this.client?.version ?? null,
        userAgent: this.client?.userAgent ?? null,
        codexHome: this.client?.codexHome ?? null,
        state: this.client?.state ?? 'idle',
        argv: this.argv ?? null,
      },
      thread: record ? {
        thread_id: record.threadId,
        label: record.label ?? null,
        generation: record.generation,
        cwd: record.cwd,
        model: record.model,
        effort: record.effort ?? null,
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
    const model = modelForNewThread(args, this.config);
    const effort = effortForTurn(args, this.config, this.config.reasoningEffort);
    const label = newThreadLabel(args, typeof args?.reason === 'string' ? args.reason : 'New Codex thread');
    const thread = await client.startThread({
      cwd,
      sandbox: this.config.sandbox,
      approvalPolicy: this.config.approvalPolicy,
      model: model || undefined,
      signal: exec?.signal,
    });
    const record = this.store.bind(key, thread, { cwd, model, effort, label });
    return {
      source: this.sourceInfo(),
      status: 'reset',
      old_thread_id: existing?.threadId ?? null,
      thread_id: thread.id,
      label,
      model,
      effort,
      generation: record.generation,
      threads: this.store.threads(key),
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

function summarizeTurn(turn, turnMeta = null) {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  const asks = [];
  const answers = [];
  const commands = [];
  const files = [];
  for (const item of items) {
    const type = String(item?.type ?? item?.itemType ?? '').toLowerCase();
    if (type.includes('usermessage') || type.includes('user_message')) {
      const text = itemText(item);
      if (text) asks.push(text);
    } else if (type.includes('agentmessage') || type.includes('agent_message')) {
      const text = itemText(item);
      if (text) answers.push(text);
    } else if (type.includes('commandexecution') || type.includes('command_execution')) {
      commands.push({
        command: clipText(item?.command ?? item?.cmd ?? '', 500),
        status: item?.status ?? null,
        exit_code: item?.exitCode ?? item?.exit_code ?? null,
      });
    } else if (type.includes('filechange') || type.includes('file_change')) {
      files.push(...itemPaths(item));
    }
  }
  const fallbackAsk = typeof turn?.text === 'string' ? turn.text : '';
  const meta = turn?.id && turnMeta ? turnMeta[turn.id] ?? null : null;
  return {
    turn_id: turn?.id ?? null,
    status: turn?.status ?? null,
    created_at: turn?.createdAt ?? turn?.startedAt ?? turn?.created_at ?? null,
    model: meta?.model ?? null,
    effort: meta?.effort ?? null,
    ask: asks.length > 0 ? clipText(asks.at(-1), 1000) : (fallbackAsk ? clipText(fallbackAsk, 1000) : null),
    answer: answers.length > 0 ? clipText(answers.at(-1), 2000) : null,
    error: typeof turn?.error === 'string'
      ? clipText(turn.error, 1000)
      : (turn?.error?.message ? clipText(turn.error.message, 1000) : null),
    commands,
    files: [...new Set(files)],
  };
}

function itemText(item) {
  if (typeof item?.text === 'string') return item.text;
  const content = item?.content;
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === 'string' ? part : (part?.text ?? ''))).filter(Boolean).join('\n');
  }
  return '';
}

function itemPaths(item) {
  const paths = [];
  if (Array.isArray(item?.paths)) paths.push(...item.paths);
  if (typeof item?.path === 'string') paths.push(item.path);
  if (Array.isArray(item?.changes)) {
    for (const change of item.changes) {
      if (typeof change === 'string') paths.push(change);
      else if (change?.path) paths.push(change.path);
    }
  }
  return paths.filter((path) => typeof path === 'string' && path);
}

function clipText(value, max) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}…` : text;
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
    '## Codex advisor (multi-thread)',
    '',
    'Codex is a complementary reasoning partner, not a second DSH. Use it where an independent plan, hard architecture review, or final acceptance adds real value.',
    'A DSH session can own several persistent, labeled Codex threads. The active thread is the default.',
    '',
    'Thread lifecycle:',
    '- Continue the active thread for the same objective, iterative implementation, debugging the same area, or follow-up on the same work.',
    '- Start a new thread only for a materially different aspect, a fresh high-stakes review, or a task that needs a different model class. Do not start a thread per message; one thread per coherent aspect.',
    '- Use `label` for a human-readable topic. Use `codex_status` to see labeled threads; use `thread` to continue one; `codex_history` reads it without switching.',
    '',
    'Model and effort:',
    '- A model is fixed for a thread. Choose it at creation from the task, not the message length: `gpt-6-astra` for the hardest/highest-stakes or novel work; `gpt-6.1-sol` for complex implementation/debugging; `gpt-6.1-terra` for balanced work; `gpt-6-luna` for routine verification.',
    '- A short message can be a hard architecture decision; a long message can be routine. Judge importance and ambiguity, not size.',
    '- Effort can change on every ask (`low`, `medium`, `high`, `xhigh`, `max`, `ultra`). Raise it for hard decisions and lower it for straightforward verification.',
    '- To change model, create a new thread; do not repeatedly switch models inside one coherent advisor conversation.',
    '',
    'Usage:',
    `- \`codex_ask\` sends one message (sandbox: ${config.sandbox}); send only the delta. Use \`purpose\` when model/effort are omitted.`,
    '- For a new thread, put durable context in `brief`; afterwards send deltas.',
    '- Do not paste large files: pass paths. The advisor reads the working directory itself.',
    '- Long turns: call `codex_ask` with a small `wait_seconds`, then `codex_poll` with the returned `turn_id`.',
    '- `codex_cancel` interrupts; `codex_status` shows health/quota/threads; `codex_history` returns turns with per-turn model/effort.',
    '- Answers are in English. When you use a `codex_*` result, label it explicitly as **Codex advisor** and include its thread/turn; never present Codex\'s answer as your own.',
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
        'Ask a persistent Codex advisor thread for this DSH session.',
        'A DSH session can own several labeled Codex threads; the active one is used by default. Continue a thread for related work; start a new thread only for a genuinely different aspect, a fresh high-stakes review, or a different model class. Do not create a thread per message.',
        'A model is fixed for the thread lifetime. Choose it when starting a thread by task difficulty and importance, not by message length: gpt-6-astra for the hardest/highest-stakes work, gpt-6.1-sol for complex implementation/debugging, gpt-6.1-terra for balanced work, gpt-6-luna for routine verification. Effort can change on every ask.',
        'Send only the new request; use `brief` when creating a thread. Answers are in English.',
        'Returns the final answer within `wait_seconds`; otherwise status=running with a turn_id for codex_poll.',
        'The advisor runs under the user\'s ChatGPT/Codex login and may modify the session working directory.',
        'This is external Codex output; attribute it explicitly when you use it.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: 'The new request for the advisor. Do not repeat context the thread already has.' },
          wait_seconds: { type: 'integer', minimum: 0, maximum: 1800, default: 180, description: 'How long to wait for the final answer before returning a running turn.' },
          brief: { type: 'string', description: 'Durable context for a newly created thread (new_thread/reset/recovery).' },
          thread: { type: 'string', description: 'Continue an existing Codex thread by its label (or id). Defaults to the active thread. Cannot be combined with new_thread.' },
          thread_id: { type: 'string', description: 'Exact existing thread id, when known. Prefer thread labels.' },
          new_thread: { type: 'boolean', default: false, description: 'Create a new Codex thread for a materially different aspect or a different model. Keep one thread per coherent aspect.' },
          label: { type: 'string', description: 'Human-readable label for a new thread; defaults to a short form of message.' },
          model: {
            type: 'string',
            enum: [...MODEL_CHOICES],
            description: 'Model for a new thread only; omitted uses purpose policy or config. Naming a different model on an existing thread is rejected.',
          },
          effort: {
            type: 'string',
            enum: [...EFFORT_CHOICES],
            description: 'Reasoning effort for this turn; may change between turns on the same thread. Omitted uses purpose policy or config.',
          },
          purpose: {
            type: 'string',
            enum: [...PURPOSE_CHOICES],
            description: 'Task intent used to choose a sensible model/effort when they are omitted; not based on message length.',
          },
          reset: { type: 'boolean', default: false, description: 'Deprecated alias for new_thread=true.' },
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
      description: 'Health and state of the Codex advisor: app-server, labeled threads, active thread, quota, last error.',
      parameters: { type: 'object', properties: {} },
      timeoutMs: 60000,
      execute: (args, exec) => runTool(manager, 'status', args, exec),
    }),
    make({
      name: 'codex_history',
      description: [
        'Read a Codex advisor thread history: turns, asks, final answers, commands and file changes.',
        'Use it to show exactly which parts came from Codex; forward the source field as provenance.',
        'Per-turn model/effort metadata is included when available. Returns the last `limit` turns.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          thread: { type: 'string', description: 'Thread label (or id) to read; defaults to the active thread.' },
          thread_id: { type: 'string', description: 'Exact thread id, when known.' },
          limit: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
        },
      },
      timeoutMs: 60000,
      execute: (args, exec) => runTool(manager, 'history', args, exec),
    }),
    make({
      name: 'codex_reset',
      description: 'Start a new Codex advisor thread for this DSH session (the old thread is kept and labeled). Prefer codex_ask with new_thread=true for normal new aspects.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Why a new thread is needed; recorded in diagnostics and used as the label fallback.' },
          label: { type: 'string', description: 'Human-readable label for the new thread.' },
          model: { type: 'string', enum: [...MODEL_CHOICES], description: 'Model for the new thread; omitted uses purpose policy or config.' },
          effort: { type: 'string', enum: [...EFFORT_CHOICES], description: 'Default effort for the new thread.' },
          purpose: { type: 'string', enum: [...PURPOSE_CHOICES], description: 'Task intent used to choose model/effort when omitted.' },
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
        source: manager.sourceInfo(),
        status: 'failed',
        code: err.code,
        message: err.message,
        hint: hintFor(err.code),
        ...(err.details ?? {}),
      };
    }
    return {
      source: manager.sourceInfo(),
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
  if (name === 'codex_history') return [{ type: 'text', text: renderHistory(value) }];
  const lines = [];
  if (value.source) {
    const src = value.source;
    lines.push(`source: ${src.kind ?? 'codex-advisor'} (external Codex)  plugin: ${src.plugin ?? 'dsh-codex-advisor'} ${src.version ?? ''}`.trim());
    if (src.model || src.effort) lines.push(`model: ${src.model ?? 'default'}  effort: ${src.effort ?? 'default'}`);
  }
  lines.push(`status: ${value.status ?? 'unknown'}${value.code ? ` (${value.code})` : ''}`);
  if (value.last_failure) {
    lines.push(`last failure: ${value.last_failure.code ?? 'unknown'} - ${value.last_failure.message ?? ''}`.trim());
  }
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

function renderHistory(value) {
  const source = value.source ?? {};
  const lines = [];
  lines.push(`source: ${source.kind ?? 'codex-advisor'} (external Codex)  plugin: ${source.plugin ?? 'dsh-codex-advisor'} ${source.version ?? ''}`.trim());
  lines.push(`thread: ${value.thread_id ?? 'unknown'}  model: ${value.model ?? source.model ?? 'default'}  effort: ${value.effort ?? source.effort ?? 'default'}`);
  lines.push(`turns: ${value.returned ?? 0}/${value.total_turns ?? value.returned ?? 0}`);
  for (const turn of value.turns ?? []) {
    lines.push('', `- ${turn.turn_id ?? 'turn'} [${turn.status ?? 'unknown'}]`);
    if (turn.ask) lines.push(`  ask: ${turn.ask}`);
    if (turn.answer) lines.push(`  answer: ${turn.answer}`);
    if (turn.commands?.length) {
      lines.push(`  commands: ${turn.commands.map((command) => `${command.command}${command.status ? ` (${command.status})` : ''}`).join(' | ')}`);
    }
    if (turn.files?.length) lines.push(`  files: ${turn.files.join(', ')}`);
  }
  return lines.join('\n');
}
