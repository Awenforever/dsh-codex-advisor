/**
 * Durable advisor state: DSH session id -> Codex thread binding, plus a small
 * digest used only when a thread can no longer be resumed.
 *
 * Files live under <DSH_HOME>/codex-advisor by default:
 *   state.json     atomic replacement (tmp + rename)
 *   events.ndjson  bounded diagnostic log
 */
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

const STATE_VERSION = 1;

const clip = (value, max) => {
  const text = typeof value === 'string' ? value : String(value ?? '');
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 20)) + '\n…[truncated]';
};

export class AdvisorStore {
  constructor({ dir, maxThreads = 100, digestBytes = 4096, eventsMaxBytes = 2 * 1024 * 1024, logger } = {}) {
    if (!dir) throw new Error('AdvisorStore requires dir');
    this.dir = dir;
    this.statePath = join(dir, 'state.json');
    this.eventsPath = join(dir, 'events.ndjson');
    this.maxThreads = maxThreads;
    this.digestBytes = digestBytes;
    this.eventsMaxBytes = eventsMaxBytes;
    this.log = logger ?? (() => {});
    this.state = { version: STATE_VERSION, bridge: null, threads: {} };
  }

  load() {
    try {
      mkdirSync(this.dir, { recursive: true });
      if (!existsSync(this.statePath)) return this.state;
      const parsed = JSON.parse(readFileSync(this.statePath, 'utf8'));
      if (parsed?.version !== STATE_VERSION || typeof parsed.threads !== 'object' || parsed.threads === null) {
        throw new Error(`unsupported state version: ${parsed?.version}`);
      }
      this.state = { version: STATE_VERSION, bridge: parsed.bridge ?? null, threads: parsed.threads };
    } catch (err) {
      this.log('warn', { event: 'state-load-failed', message: err?.message ?? String(err) });
      try {
        if (existsSync(this.statePath)) renameSync(this.statePath, `${this.statePath}.corrupt-${Date.now()}`);
      } catch { /* ignore */ }
      this.state = { version: STATE_VERSION, bridge: null, threads: {} };
    }
    return this.state;
  }

  save() {
    mkdirSync(this.dir, { recursive: true });
    const tmp = join(this.dir, `.state-${process.pid}-${randomUUID()}.tmp`);
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
    renameSync(tmp, this.statePath);
  }

  get(sessionId) {
    return this.state.threads[sessionId] ?? null;
  }

  bind(sessionId, thread, { cwd, model } = {}) {
    if (!thread?.id) throw new Error('bind requires a thread with an id');
    const existing = this.state.threads[sessionId] ?? null;
    const sameThread = existing?.threadId === thread.id;
    const now = new Date().toISOString();
    const record = {
      threadId: thread.id,
      generation: sameThread ? (existing.generation ?? 1) : (existing?.generation ?? 0) + 1,
      cwd: thread.cwd ?? cwd ?? existing?.cwd ?? null,
      model: thread.model ?? model ?? existing?.model ?? null,
      createdAt: sameThread ? (existing.createdAt ?? now) : now,
      boundAt: now,
      lastAskAt: existing?.lastAskAt ?? null,
      lastAnswerAt: existing?.lastAnswerAt ?? null,
      lastTurnId: sameThread ? (existing.lastTurnId ?? null) : null,
      lastResumeError: null,
      digest: existing?.digest ?? { asks: [], lastAnswer: '' },
    };
    this.state.threads[sessionId] = record;
    this.evict();
    this.save();
    return record;
  }

  update(sessionId, patch) {
    const record = this.state.threads[sessionId];
    if (!record) return null;
    Object.assign(record, patch);
    this.save();
    return record;
  }

  recordTurn(sessionId, { ask, answer, turnId } = {}) {
    const record = this.state.threads[sessionId];
    if (!record) return null;
    record.lastTurnId = turnId ?? record.lastTurnId ?? null;
    record.lastAnswerAt = new Date().toISOString();
    const digest = record.digest ?? { asks: [], lastAnswer: '' };
    if (typeof ask === 'string' && ask.trim()) digest.asks.push(clip(ask.trim(), 1200));
    const asks = digest.asks.slice(-6);
    let lastAnswer = typeof answer === 'string'
      ? clip(answer, Math.min(this.digestBytes, 2048))
      : (digest.lastAnswer ?? '');
    let brief = this.briefFrom({ asks, lastAnswer });
    // Prioritise the last answer: drop old asks first, then clip the answer.
    while (brief.length > this.digestBytes && asks.length > 0) {
      asks.shift();
      brief = this.briefFrom({ asks, lastAnswer });
    }
    if (brief.length > this.digestBytes) {
      const header = this.briefFrom({ asks: [], lastAnswer: '' }).length;
      lastAnswer = clip(lastAnswer, Math.max(80, this.digestBytes - header - 20));
    }
    digest.asks = asks;
    digest.lastAnswer = lastAnswer;
    record.digest = digest;
    this.save();
    return record;
  }

  brief(sessionId) {
    const record = this.state.threads[sessionId];
    return record?.digest ? this.briefFrom(record.digest) : '';
  }

  briefFrom(digest) {
    if (!digest) return '';
    const parts = [];
    if (Array.isArray(digest.asks) && digest.asks.length > 0) {
      parts.push('Recent requests from this DSH session:\n' + digest.asks.map((ask) => `- ${ask}`).join('\n'));
    }
    if (digest.lastAnswer) parts.push('Your last answer in this thread was:\n' + digest.lastAnswer);
    if (parts.length === 0) return '';
    return '[Recovered advisor context — the original Codex thread could not be resumed]\n\n' + parts.join('\n\n');
  }

  remove(sessionId) {
    if (!this.state.threads[sessionId]) return false;
    delete this.state.threads[sessionId];
    this.save();
    return true;
  }

  list() {
    return Object.entries(this.state.threads).map(([sessionId, record]) => ({ sessionId, ...record }));
  }

  setBridge(info) {
    this.state.bridge = { ...(this.state.bridge ?? {}), ...info };
    this.save();
  }

  evict() {
    const entries = Object.entries(this.state.threads);
    if (entries.length <= this.maxThreads) return;
    entries.sort(([, a], [, b]) => {
      const at = (record) => Date.parse(record.lastAskAt ?? record.boundAt ?? record.createdAt ?? 0) || 0;
      return at(a) - at(b);
    });
    const removeCount = entries.length - this.maxThreads;
    for (let i = 0; i < removeCount; i += 1) delete this.state.threads[entries[i][0]];
  }

  event(level, event, data = {}) {
    try {
      mkdirSync(this.dir, { recursive: true });
      this.rotateEvents();
      appendFileSync(this.eventsPath, JSON.stringify({
        t: new Date().toISOString(),
        level,
        event,
        ...data,
      }) + '\n');
    } catch (err) {
      this.log('warn', { event: 'event-write-failed', message: err?.message ?? String(err) });
    }
  }

  rotateEvents() {
    if (!existsSync(this.eventsPath)) return;
    const size = statSync(this.eventsPath).size;
    if (size < this.eventsMaxBytes) return;
    const previous = `${this.eventsPath}.1`;
    try { if (existsSync(previous)) unlinkSync(previous); } catch { /* ignore */ }
    try { renameSync(this.eventsPath, previous); } catch { /* ignore */ }
  }
}
