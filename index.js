/**
 * dsh-codex-advisor — persistent Codex advisor for DSH sessions.
 *
 * A Host-only Cordis plugin: one Codex app-server child, one persistent Codex
 * thread per DSH session, five tools, and a durable session -> thread binding.
 */
import os from 'node:os';
import { join } from 'node:path';
import {
  AdvisorManager,
  PLUGIN_VERSION,
  TOOL_NAMES,
  buildTools,
  resolveConfig,
  usageSectionText,
} from './lib/manager.mjs';
import { AdvisorStore } from './lib/store.mjs';
import { nodeSpawn } from './lib/spawn.mjs';

export const name = 'codex-advisor';
export const inject = ['tools'];

export function apply(ctx, rawConfig = {}) {
  const config = resolveConfig(rawConfig ?? {});
  if (!config.enabled) return;
  const logger = makeLogger(ctx);
  const log = (level, data) => {
    try {
      const fn = logger[level] ?? logger.info;
      fn?.(data);
    } catch { /* ignore */ }
  };

  const dshHome = process.env.DSH_HOME || join(os.homedir(), '.dsh');
  const stateDir = config.stateDir || join(dshHome, 'codex-advisor');
  const store = new AdvisorStore({
    dir: stateDir,
    maxThreads: config.maxThreads,
    digestBytes: config.digestBytes,
    logger: log,
  });
  try {
    store.load();
    store.setBridge({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      plugin: 'dsh-codex-advisor',
      version: PLUGIN_VERSION,
      sandbox: config.sandbox,
    });
    store.event('info', 'activate', { pid: process.pid, stateDir, sandbox: config.sandbox });
  } catch (err) {
    log('warn', { event: 'state-init-failed', message: err?.message ?? String(err) });
  }

  const subprocess = typeof ctx.get === 'function' ? ctx.get('subprocess') : ctx.subprocess;
  const spawn = typeof subprocess?.spawn === 'function' ? subprocess.spawn.bind(subprocess) : nodeSpawn();
  const workingDirectory = typeof ctx.get === 'function' ? ctx.get('workingDirectory') : ctx.workingDirectory;
  const cwdResolver = async (exec) => {
    try {
      if (workingDirectory?.ensure && exec?.agent) return await workingDirectory.ensure(exec.agent);
    } catch (err) {
      log('warn', { event: 'cwd-resolve-failed', message: err?.message ?? String(err) });
    }
    return config.cwd || process.cwd();
  };

  const manager = new AdvisorManager({ ctx, config, store, logger: log, spawn, cwdResolver });

  const tools = typeof ctx.get === 'function' ? ctx.get('tools') : ctx.tools;
  if (!tools || typeof tools.register !== 'function') {
    log('warn', { event: 'tools-service-missing' });
    return;
  }
  const disposers = [];
  registerWebRoutes(ctx, manager, disposers, log);
  for (const definition of buildTools(manager)) {
    try {
      const dispose = tools.register(definition);
      if (typeof dispose === 'function') disposers.push(dispose);
    } catch (err) {
      log('warn', { event: 'tool-register-failed', tool: definition.name, message: err?.message ?? String(err) });
    }
  }

  try {
    const systemPrompt = typeof ctx.get === 'function' ? ctx.get('systemPrompt') : ctx.systemPrompt;
    if (systemPrompt && typeof systemPrompt.section === 'function') {
      const dispose = systemPrompt.section({
        name: 'codex-advisor:usage',
        order: config.promptSectionOrder,
        text: usageSectionText(config),
      });
      if (typeof dispose === 'function') disposers.push(dispose);
    }
  } catch (err) {
    log('warn', { event: 'prompt-section-failed', message: err?.message ?? String(err) });
  }

  const dispose = async () => {
    for (const disposer of disposers.reverse()) {
      try { await disposer?.(); } catch { /* ignore */ }
    }
    await manager.dispose();
  };
  if (typeof ctx.on === 'function') {
    ctx.on('dispose', dispose);
  } else if (typeof process.once === 'function') {
    process.once('exit', () => { dispose().catch(() => {}); });
  }
  log('info', { event: 'activated', stateDir, sandbox: config.sandbox, tools: [...TOOL_NAMES] });
}

const JSON_HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
});

function registerWebRoutes(ctx, manager, disposers, log) {
  let webServer;
  try {
    webServer = typeof ctx.get === 'function' ? ctx.get('webServer') : ctx.webServer;
  } catch {
    webServer = null;
  }
  if (!webServer || typeof webServer.register !== 'function') {
    log('debug', { event: 'web-routes-unavailable' });
    return;
  }
  const register = (path, handler) => {
    try {
      const dispose = webServer.register({ kind: 'exact', path, handler });
      if (typeof dispose === 'function') disposers.push(dispose);
    } catch (err) {
      log('warn', { event: 'web-route-register-failed', path, message: err?.message ?? String(err) });
    }
  };
  register('/plugins/dsh-codex-advisor/ping', (request, response) => {
    writeJson(response, 200, { ok: true, version: PLUGIN_VERSION });
  });
  register('/plugins/dsh-codex-advisor/diag', (request, response) => {
    writeJson(response, 200, {
      ok: true,
      version: PLUGIN_VERSION,
      desktop: isDesktopHost(ctx),
      connection: Boolean(safeGet(ctx, 'connection')),
      argvTail: process.argv.slice(-5),
    });
  });
  register('/plugins/dsh-codex-advisor/snapshot', (request, response) => {
    if (!acceptReadRequest(ctx, request, response)) return;
    try {
      writeJson(response, 200, manager.snapshot({}, routeExec(request)));
    } catch (err) {
      writeJson(response, 500, { ok: false, code: 'CODEX_INTERNAL', message: err?.message ?? String(err) });
    }
  });
  register('/plugins/dsh-codex-advisor/history', async (request, response) => {
    if (!acceptReadRequest(ctx, request, response)) return;
    const query = queryOf(request);
    const threadId = query.searchParams.get('thread_id') || undefined;
    const limit = Number(query.searchParams.get('limit') ?? 5);
    try {
      const value = await manager.history({ thread_id: threadId, limit }, routeExec(request));
      writeJson(response, 200, value);
    } catch (err) {
      if (err?.code === 'CODEX_NO_THREAD') {
        writeJson(response, 200, {
          source: manager.sourceInfo(),
          status: 'empty',
          thread_id: null,
          model: null,
          effort: null,
          total_turns: 0,
          returned: 0,
          turns: [],
        });
        return;
      }
      writeJson(response, 500, { ok: false, code: err?.code ?? 'CODEX_INTERNAL', message: err?.message ?? String(err) });
    }
  });
}

function acceptReadRequest(ctx, request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    writeJson(response, 405, { error: 'method-not-allowed' }, { allow: 'GET, HEAD' });
    return false;
  }
  if (!isDesktopHost(ctx)) {
    let connection;
    try {
      connection = ctx.get('connection');
    } catch {
      connection = null;
    }
    if (connection && typeof connection.requestRejection === 'function') {
      let rejection;
      try {
        rejection = connection.requestRejection(request);
      } catch {
        rejection = 403;
      }
      if (rejection !== undefined && rejection !== null) {
        writeJson(response, rejection, { error: 'unauthorized' });
        return false;
      }
    }
  }
  if (request.method === 'HEAD') {
    response.writeHead(200, JSON_HEADERS);
    response.end();
    return false;
  }
  return true;
}

function routeExec(request) {
  return { agent: { id: queryOf(request).searchParams.get('session_id') || 'route' } };
}

function safeGet(ctx, key) {
  try {
    return typeof ctx.get === 'function' ? ctx.get(key) : ctx[key];
  } catch {
    return null;
  }
}

function queryOf(request) {
  try {
    return new URL(request.url || '/', 'http://localhost');
  } catch {
    return new URL('http://localhost/');
  }
}

function isDesktopHost(ctx) {
  try {
    if (ctx.get('desktopProfiles') || ctx.get('desktopPnpm')) return true;
  } catch {
    // fall through to process-shape detection
  }
  const argv = Array.isArray(process.argv) ? process.argv.join(' ').toLowerCase() : '';
  return argv.includes('dsh-desktop-host');
}

function writeJson(response, status, body, extraHeaders = {}) {
  response.writeHead(status, { ...JSON_HEADERS, ...extraHeaders });
  response.end(JSON.stringify(body));
}

function makeLogger(ctx) {
  const fallback = {
    debug: () => {},
    info: () => {},
    warn: (data) => { try { console.warn('[codex-advisor]', data); } catch { /* ignore */ } },
    error: (data) => { try { console.error('[codex-advisor]', data); } catch { /* ignore */ } },
  };
  try {
    const factory = ctx?.logger;
    const logger = typeof factory === 'function' ? factory('codex-advisor') : factory;
    if (!logger) return fallback;
    return {
      debug: (...args) => logger.debug?.(...args),
      info: (...args) => logger.info?.(...args),
      warn: (...args) => logger.warn?.(...args),
      error: (...args) => logger.error?.(...args),
    };
  } catch {
    return fallback;
  }
}

export default { name, inject, apply };
