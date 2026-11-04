/**
 * Codex app-server client: one child process, one JSON-RPC connection, many
 * threads and turns. This module owns only the product methods the advisor
 * uses; it does not expose a generic request surface.
 */
import { JsonRpcClient, JsonRpcError } from './jsonrpc.mjs';

const CLIENT_INFO = Object.freeze({
  clientInfo: { name: 'dsh-codex-advisor', title: 'DSH Codex Advisor', version: '0.3.0' },
  capabilities: { experimentalApi: false, requestAttestation: false },
});

const APPROVAL_METHODS = new Set([
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
]);

export class CodexTransportError extends Error {
  constructor(message, { code = 'TRANSPORT', cause = null } = {}) {
    super(message);
    this.name = 'CodexTransportError';
    this.code = code;
    this.cause = cause;
  }
}

export class TurnSession {
  constructor({ threadId, rpc, onEvent }) {
    this.threadId = threadId;
    this.rpc = rpc;
    this.onEvent = onEvent ?? (() => {});
    this.turnId = null;
    this.observedTurnId = null;
    this.buffer = [];
    this.items = [];
    this.files = [];
    this.commands = [];
    this.declinedApprovals = 0;
    this.declinedItems = 0;
    this.serverRequests = [];
    this.finalAnswer = null;
    this.partialAnswer = null;
    this.unphasedAnswer = null;
    this.status = null;
    this.error = null;
    this.settled = false;
    this.startedAt = Date.now();
    this.completion = new Promise((resolve) => { this.resolveCompletion = resolve; });
  }

  handle(method, params) {
    if (!params || params.threadId !== this.threadId) return;
    if (method === 'turn/started') {
      if (this.turnId === null && params.turn?.id) this.observedTurnId = params.turn.id;
      return;
    }
    if (method === 'item/completed' || method === 'turn/completed') {
      if (this.turnId === null) {
        this.buffer.push([method, params]);
        return;
      }
      this.apply(method, params);
    }
  }

  setTurnId(turnId) {
    this.turnId = turnId;
    if (this.observedTurnId && this.observedTurnId !== turnId) {
      this.onEvent('warn', { event: 'turn-id-mismatch', observed: this.observedTurnId, returned: turnId });
    }
    const buffered = this.buffer.splice(0);
    for (const [method, params] of buffered) this.apply(method, params);
  }

  apply(method, params) {
    if (method === 'item/completed') {
      if (params.turnId !== this.turnId) return;
      this.recordItem(params.item ?? {});
      return;
    }
    const turn = params.turn ?? {};
    if (turn.id !== this.turnId) return;
    this.settle({
      status: turn.status ?? 'failed',
      error: turn.error ?? null,
    });
  }

  recordItem(item) {
    this.items.push({ type: item.type ?? null, phase: item.phase ?? null, status: item.status ?? null });
    if (item.type === 'agentMessage') {
      const text = typeof item.text === 'string' ? item.text : '';
      if (item.phase === 'final_answer') this.finalAnswer = text;
      else if (item.phase === 'partial_answer') this.partialAnswer = text;
      else if (item.phase === null || item.phase === undefined) this.unphasedAnswer = text;
      return;
    }
    if (item.type === 'fileChange') {
      const changes = Array.isArray(item.changes) ? item.changes
        : Array.isArray(item.diff) ? item.diff
          : Array.isArray(item.edits) ? item.edits : [];
      const paths = changes
        .map((change) => change?.path ?? change?.filePath ?? change?.file ?? change?.name)
        .filter((path) => typeof path === 'string' && path.length > 0);
      if (item.status === 'declined') this.declinedItems += 1;
      this.files.push({ status: item.status ?? null, paths });
      return;
    }
    if (item.type === 'commandExecution') {
      if (item.status === 'declined') this.declinedItems += 1;
      this.commands.push({
        command: typeof item.command === 'string' ? item.command : null,
        exitCode: typeof item.exitCode === 'number' ? item.exitCode : null,
        status: item.status ?? null,
      });
    }
  }

  noteServerRequest(method) {
    this.serverRequests.push(method);
    if (APPROVAL_METHODS.has(method) || method === 'item/permissions/requestApproval') {
      this.declinedApprovals += 1;
    }
  }

  settle({ status, error }) {
    if (this.settled) return;
    this.settled = true;
    this.status = status;
    this.error = error;
    this.resolveCompletion(this.snapshot());
  }

  fail(error) {
    if (this.settled) return;
    this.settled = true;
    this.status = 'failed';
    this.error = error ?? { message: 'turn failed' };
    this.resolveCompletion(this.snapshot());
  }

  snapshot() {
    return {
      threadId: this.threadId,
      turnId: this.turnId,
      status: this.status,
      error: this.error,
      answer: this.finalAnswer ?? this.partialAnswer ?? this.unphasedAnswer,
      files: this.files.slice(0, 50),
      commands: this.commands.slice(0, 50),
      declinedApprovals: this.declinedApprovals,
      declinedItems: this.declinedItems,
      serverRequests: this.serverRequests.slice(0, 20),
      elapsedMs: Date.now() - this.startedAt,
    };
  }

  async interrupt() {
    if (!this.turnId) return false;
    try {
      await this.rpc.request('turn/interrupt', { threadId: this.threadId, turnId: this.turnId }, { timeoutMs: 30000 });
      return true;
    } catch (err) {
      this.onEvent('warn', { event: 'turn-interrupt-failed', turnId: this.turnId, message: err?.message });
      return false;
    }
  }
}

export class CodexAppServer {
  constructor({ spawn, argv, cwd, env, logger, onEvent, initialize = CLIENT_INFO }) {
    if (typeof spawn !== 'function') throw new Error('CodexAppServer requires a spawn function');
    if (!Array.isArray(argv) || argv.length === 0) throw new Error('CodexAppServer requires argv');
    this.spawn = spawn;
    this.argv = argv;
    this.cwd = cwd;
    this.env = env;
    this.logger = logger ?? (() => {});
    this.onEvent = onEvent ?? (() => {});
    this.initializeParams = initialize;
    this.state = 'idle';
    this.proc = null;
    this.rpc = null;
    this.activeTurns = new Map();
    this.starting = null;
    this.closing = false;
    this.stderr = '';
    this.version = null;
    this.userAgent = null;
    this.codexHome = null;
    this.exit = null;
    this.declinedApprovals = 0;
    this.serverRequests = 0;
  }

  log(level, data) {
    try { this.logger(level, data); } catch { /* ignore */ }
  }

  emit(event, data) {
    try { this.onEvent(event, data); } catch { /* ignore */ }
  }

  async ensureStarted({ signal } = {}) {
    if (this.state === 'ready') return this;
    if (this.starting) return this.starting;
    this.starting = this.start({ signal }).finally(() => { this.starting = null; });
    return this.starting;
  }

  async start({ signal } = {}) {
    this.state = 'starting';
    this.exit = null;
    this.stderr = '';
    let handle;
    try {
      handle = await Promise.resolve(this.spawn({
        argv: this.argv,
        cwd: this.cwd,
        env: this.env,
        stdio: { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' },
        graceMs: 3000,
        signal,
      }));
    } catch (err) {
      this.state = 'idle';
      throw new CodexTransportError(`failed to spawn codex app-server: ${err?.message ?? err}`, { code: 'SPAWN_FAILED', cause: err });
    }
    if (!handle?.stdin || !handle?.stdout) {
      this.state = 'idle';
      throw new CodexTransportError('spawned codex app-server did not expose stdio pipes', { code: 'SPAWN_FAILED' });
    }
    this.proc = handle;
    handle.stderr?.on?.('data', (chunk) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-8192);
    });
    handle.done?.then?.(
      (outcome) => this.onExit(outcome),
      (err) => this.onExit({ error: err }),
    );
    this.rpc = new JsonRpcClient({
      stdin: handle.stdin,
      stdout: handle.stdout,
      onNotification: (method, params) => this.onNotification(method, params),
      onServerRequest: (method, params) => this.onServerRequest(method, params),
      onLog: (level, data) => this.log(level, data),
    });
    let init;
    try {
      init = await this.rpc.request('initialize', this.initializeParams, { timeoutMs: 120000, signal });
      this.rpc.notify('initialized');
    } catch (err) {
      this.state = 'idle';
      this.rpc.close();
      this.rpc = null;
      try { handle.terminate?.(); } catch { /* ignore */ }
      throw new CodexTransportError(`codex app-server initialize failed: ${err?.message ?? err}`, {
        code: err?.code === 'TIMEOUT' ? 'INIT_TIMEOUT' : 'INIT_FAILED',
        cause: err,
      });
    }
    this.userAgent = init?.userAgent ?? null;
    this.codexHome = init?.codexHome ?? null;
    this.version = parseVersion(this.userAgent);
    this.state = 'ready';
    this.log('info', { event: 'codex-app-server-started', version: this.version, codexHome: this.codexHome, pid: handle.pid ?? null });
    this.emit('started', { version: this.version, codexHome: this.codexHome, userAgent: this.userAgent });
    return this;
  }

  onExit(outcome) {
    this.exit = outcome ?? {};
    this.state = this.closing ? 'closed' : 'exited';
    this.log(this.closing ? 'info' : 'warn', {
      event: 'codex-app-server-exited',
      closing: this.closing,
      exitCode: this.exit?.exitCode ?? null,
      signal: this.exit?.signal ?? null,
      error: this.exit?.error?.message ?? null,
      stderrTail: this.stderr.slice(-1500),
    });
    this.emit('exited', { exit: this.exit, stderrTail: this.stderr.slice(-1500) });
    this.rpc?.close();
    for (const session of this.activeTurns.values()) {
      session.fail({ code: 'APP_SERVER_EXITED', message: 'codex app-server exited before the turn completed' });
    }
    this.activeTurns.clear();
  }

  onNotification(method, params) {
    const threadId = params?.threadId;
    if (method === 'turn/started' || method === 'item/completed' || method === 'turn/completed') {
      const session = threadId ? this.activeTurns.get(threadId) : undefined;
      if (session) session.handle(method, params);
      this.emit('notification', {
        method,
        threadId,
        turnId: params?.turnId ?? params?.turn?.id ?? null,
        itemType: params?.item?.type ?? null,
        itemPhase: params?.item?.phase ?? null,
        status: params?.turn?.status ?? null,
      });
      return;
    }
    this.emit('notification', { method, threadId: threadId ?? null });
  }

  onServerRequest(method, params) {
    this.serverRequests += 1;
    this.emit('server-request', { method, threadId: params?.threadId ?? null, turnId: params?.turnId ?? null });
    const threadId = params?.threadId;
    const session = threadId ? this.activeTurns.get(threadId) : undefined;
    session?.noteServerRequest?.(method);
    if (method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval') {
      this.declinedApprovals += 1;
      return chooseDecline(params);
    }
    if (method === 'item/permissions/requestApproval') {
      this.declinedApprovals += 1;
      return { permissions: {}, scope: 'turn' };
    }
    if (method === 'item/tool/requestUserInput') return { answers: {} };
    if (method === 'mcpServer/elicitation/request') return { action: 'decline', content: null, _meta: null };
    return {};
  }

  async startThread({ cwd, sandbox = 'workspace-write', approvalPolicy = 'never', model, signal } = {}) {
    const params = { cwd, ephemeral: false, approvalPolicy, sandbox };
    if (model) params.model = model;
    const result = await this.rpc.request('thread/start', params, { timeoutMs: 60000, signal });
    const thread = result?.thread;
    if (!thread?.id) throw new CodexTransportError('thread/start returned no thread id', { code: 'PROTOCOL' });
    return thread;
  }

  async resumeThread(threadId, { signal } = {}) {
    const result = await this.rpc.request('thread/resume', { threadId }, { timeoutMs: 60000, signal });
    const thread = result?.thread ?? result;
    if (!thread?.id) throw new CodexTransportError('thread/resume returned no thread id', { code: 'PROTOCOL' });
    return thread;
  }

  async startTurn({ threadId, text, model, effort }) {
    const session = new TurnSession({
      threadId,
      rpc: this.rpc,
      onEvent: (level, data) => this.log(level, data),
    });
    this.activeTurns.set(threadId, session);
    session.completion.then(() => {
      if (this.activeTurns.get(threadId) === session) this.activeTurns.delete(threadId);
    });
    try {
      const params = {
        threadId,
        input: [{ type: 'text', text, text_elements: [] }],
      };
      if (model) params.model = model;
      if (effort) params.effort = effort;
      const result = await this.rpc.request('turn/start', params, { timeoutMs: 60000 });
      const turnId = result?.turn?.id;
      if (!turnId) throw new CodexTransportError('turn/start returned no turn id', { code: 'PROTOCOL' });
      session.setTurnId(turnId);
      return session;
    } catch (err) {
      this.activeTurns.delete(threadId);
      session.fail({ code: 'TURN_START_FAILED', message: err?.message ?? 'turn/start failed' });
      throw err;
    }
  }

  async rateLimits({ signal } = {}) {
    return this.rpc.request('account/rateLimits/read', undefined, { timeoutMs: 30000, signal });
  }

  async readThread(threadId, { signal } = {}) {
    return this.rpc.request('thread/read', { threadId, includeTurns: true }, { timeoutMs: 30000, signal });
  }

  async loadedThreads({ signal } = {}) {
    return this.rpc.request('thread/loaded/list', {}, { timeoutMs: 15000, signal });
  }

  async listThreads({ limit = 20, signal } = {}) {
    return this.rpc.request('thread/list', { limit }, { timeoutMs: 30000, signal });
  }

  async close() {
    if (this.closing) return;
    this.closing = true;
    for (const session of this.activeTurns.values()) {
      session.fail({ code: 'CLOSED', message: 'codex app-server closed' });
    }
    this.activeTurns.clear();
    this.rpc?.close();
    this.rpc = null;
    try { this.proc?.stdin?.end?.(); } catch { /* ignore */ }
    try {
      const handle = this.proc;
      if (handle?.waitForExit) await handle.waitForExit();
      else await Promise.race([handle?.done, new Promise((resolve) => setTimeout(resolve, 3000))]);
    } catch { /* ignore */ }
    try { this.proc?.terminate?.(); } catch { /* ignore */ }
    this.proc = null;
    this.state = 'closed';
  }
}

function parseVersion(userAgent) {
  if (typeof userAgent !== 'string') return null;
  const match = userAgent.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/);
  return match ? match[1] : null;
}

function chooseDecline(params) {
  const available = params?.availableDecisions;
  if (Array.isArray(available)) {
    // Prefer decline: the turn can continue and explain the refusal. Cancel is
    // only used when the app-server offers no decline decision.
    if (available.includes('decline')) return { decision: 'decline' };
    if (available.includes('cancel')) return { decision: 'cancel' };
  }
  return { decision: 'decline' };
}
