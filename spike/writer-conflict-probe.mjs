#!/usr/bin/env node
/**
 * M0 follow-up: can two app-server processes load the same Codex thread?
 * No turn/start, so no model quota is consumed.
 *
 * Usage: node writer-conflict-probe.mjs <threadId> [codexExe]
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
  new Date().toISOString().replace(/[:.]/g, '-') + '-writer');
mkdirSync(RUN_DIR, { recursive: true });
const OUT = join(RUN_DIR, 'writer.json');

if (!THREAD_ID) { console.error('usage: node writer-conflict-probe.mjs <threadId> [codexExe]'); process.exit(2); }

const log = (event, data = {}) =>
  appendFileSync(join(RUN_DIR, 'probe.ndjson'), JSON.stringify({ t: new Date().toISOString(), event, ...data }) + '\n');

class Client {
  constructor(label) { this.label = label; this.pending = new Map(); this.nextId = 1; }
  start() {
    this.proc = spawn(CODEX, ['app-server', '--stdio'], {
      cwd: CWD, env: process.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.rl = createInterface({ input: this.proc.stdout, crlfDelay: Infinity });
    this.rl.on('line', (line) => {
      if (!line.trim()) return;
      let msg; try { msg = JSON.parse(line); } catch { return; }
      if (msg.id !== undefined && msg.method === undefined) {
        const p = this.pending.get(msg.id); if (!p) return; this.pending.delete(msg.id);
        if (msg.error) { const e = new Error(msg.error.message ?? 'rpc'); e.code = msg.error.code; p.reject(e); }
        else p.resolve(msg.result);
      } else if (msg.id !== undefined && msg.method) {
        let result = {};
        if (msg.method.endsWith('requestApproval')) result = { decision: 'decline' };
        else if (msg.method === 'item/tool/requestUserInput') result = { answers: {} };
        else if (msg.method === 'mcpServer/elicitation/request') result = { action: 'decline', content: null, _meta: null };
        else if (msg.method === 'item/permissions/requestApproval') result = { permissions: {}, scope: 'turn' };
        this.write({ id: msg.id, result });
      }
    });
  }
  write(obj) { this.proc.stdin.write(JSON.stringify(obj) + '\n'); }
  notify(method, params) { const m = { method }; if (params !== undefined) m.params = params; this.write(m); }
  request(method, params, timeoutMs = 30000) {
    const id = this.nextId++;
    const msg = { id, method }; if (params !== undefined) msg.params = params;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(Object.assign(new Error(`${method} timed out`), { code: 'TIMEOUT' })); }, timeoutMs);
      this.pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      this.write(msg);
    });
  }
  async init() {
    await this.request('initialize', {
      clientInfo: { name: 'dsh-codex-advisor-spike-writer', title: 'DSH Codex Advisor Spike', version: '0.0.1' },
      capabilities: { experimentalApi: false, requestAttestation: false },
    });
    this.notify('initialized');
  }
  async close() {
    try { this.proc.stdin.end(); } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 800));
    try { this.proc.kill(); } catch { /* ignore */ }
  }
}

async function main() {
  const result = { threadId: THREAD_ID, startedAt: new Date().toISOString(), steps: [] };
  const step = (name, data) => { result.steps.push({ name, ...data }); console.log(name, JSON.stringify(data).slice(0, 400)); };

  const a = new Client('A');
  a.start();
  await a.init();
  try {
    const ra = await a.request('thread/resume', { threadId: THREAD_ID }, 60000);
    step('A.resume', { id: ra?.thread?.id, ok: true });
  } catch (err) {
    step('A.resume.error', { code: err.code, message: err.message });
  }

  const b = new Client('B');
  b.start();
  await b.init();
  try {
    const rb = await b.request('thread/resume', { threadId: THREAD_ID }, 60000);
    step('B.resume.while-A-loaded', { id: rb?.thread?.id, ok: true });
  } catch (err) {
    step('B.resume.while-A-loaded.error', { code: err.code, message: err.message });
  }

  // Read-only second view while A still holds the thread.
  try {
    const r = await b.request('thread/read', { threadId: THREAD_ID, includeTurns: true }, 20000);
    step('B.thread.read', { id: r?.thread?.id, turnCount: r?.thread?.turns?.length ?? null });
  } catch (err) {
    step('B.thread.read.error', { code: err.code, message: err.message });
  }

  await b.close();
  await a.close();
  result.finishedAt = new Date().toISOString();
  writeFileSync(OUT, JSON.stringify(result, null, 2));
  console.log('OUT ' + OUT);
}

main().catch((err) => {
  console.error('FATAL', err);
  writeFileSync(OUT, JSON.stringify({ error: err.message, stack: err.stack }, null, 2));
  process.exitCode = 1;
});
