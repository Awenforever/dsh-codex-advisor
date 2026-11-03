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
  log('info', { event: 'activated', stateDir, sandbox: config.sandbox, tools: ['codex_ask', 'codex_poll', 'codex_cancel', 'codex_status', 'codex_reset'] });
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
