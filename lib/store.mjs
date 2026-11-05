/**
 * Durable advisor state: one DSH session can own several Codex threads.
 *
 * A record keeps the active thread at the top level for compatibility with the
 * manager's existing call sites, plus a `threads` map for every alternate
 * thread, its own digest and its per-turn model/effort metadata.
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

const STATE_VERSION = 2;
const TURN_META_LIMIT = 50;

const clip = (value, max) => {
  const text = typeof value === 'string' ? value : String(value ?? '');
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - 20)) + '\n…[truncated]';
};

const nowIso = () => new Date().toISOString();

function trimTurnMeta(meta) {
  const entries = Object.entries(meta ?? {});
  if (entries.length <= TURN_META_LIMIT) return Object.fromEntries(entries);
  return Object.fromEntries(entries.slice(-TURN_META_LIMIT));
}

function labelFromAsk(ask) {
  const text = typeof ask === 'string' ? ask.replace(/\s+/g, ' ').trim() : '';
  if (!text) return 'Codex thread';
  return text.length > 52 ? `${text.slice(0, 51)}…` : text;
}

function threadFromActive(record) {
  if (!record?.threadId) return null;
  return {
    threadId: record.threadId,
    label: record.label ?? 'Codex thread',
    generation: record.generation ?? 1,
    cwd: record.cwd ?? null,
    model: record.model ?? null,
    effort: record.effort ?? null,
    createdAt: record.createdAt ?? record.boundAt ?? nowIso(),
    boundAt: record.boundAt ?? null,
    lastAskAt: record.lastAskAt ?? null,
    lastAnswerAt: record.lastAnswerAt ?? null,
    lastTurnId: record.lastTurnId ?? null,
    lastResumeError: record.lastResumeError ?? null,
    lastFailure: record.lastFailure ?? null,
    digest: record.digest ?? { asks: [], lastAnswer: '' },
    turnMeta: trimTurnMeta(record.turnMeta),
    activity: record.activity ?? null,
  };
}

function applyThread(record, thread) {
  record.threadId = thread.threadId;
  record.label = thread.label ?? 'Codex thread';
  record.generation = thread.generation ?? 1;
  record.cwd = thread.cwd ?? null;
  record.model = thread.model ?? null;
  record.effort = thread.effort ?? null;
  record.createdAt = thread.createdAt ?? record.createdAt ?? nowIso();
  record.boundAt = thread.boundAt ?? record.boundAt ?? null;
  record.lastAskAt = thread.lastAskAt ?? null;
  record.lastAnswerAt = thread.lastAnswerAt ?? null;
  record.lastTurnId = thread.lastTurnId ?? null;
  record.lastResumeError = thread.lastResumeError ?? null;
  record.lastFailure = thread.lastFailure ?? null;
  record.digest = thread.digest ?? { asks: [], lastAnswer: '' };
  record.turnMeta = trimTurnMeta(thread.turnMeta);
  record.activity = thread.activity ?? null;
  record.activeThreadId = thread.threadId;
}

function normalizeRecord(record) {
  if (!record || typeof record !== 'object') return null;
  if (!record.threads || typeof record.threads !== 'object') record.threads = {};
  if (!record.turnMeta || typeof record.turnMeta !== 'object') record.turnMeta = {};
  if (!record.digest || typeof record.digest !== 'object') record.digest = { asks: [], lastAnswer: '' };
  if (!Array.isArray(record.digest.asks)) record.digest.asks = [];
  if (typeof record.digest.lastAnswer !== 'string') record.digest.lastAnswer = '';
  if (!record.label) record.label = labelFromAsk(record.digest.asks.at(-1));
  if (!record.activeThreadId) record.activeThreadId = record.threadId ?? null;
  if (record.threadId) {
    record.threads[record.threadId] = threadFromActive(record);
    record.activeThreadId = record.threadId;
  }
  return record;
}

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
      if (!parsed || typeof parsed.threads !== 'object' || parsed.threads === null) {
        throw new Error(`unsupported state: ${parsed?.version}`);
      }
      if (parsed.version !== 1 && parsed.version !== STATE_VERSION) {
        throw new Error(`unsupported state version: ${parsed.version}`);
      }
      const threads = {};
      for (const [sessionId, record] of Object.entries(parsed.threads)) {
        const normalized = normalizeRecord(record);
        if (normalized) threads[sessionId] = normalized;
      }
      const migrated = parsed.version !== STATE_VERSION;
      this.state = { version: STATE_VERSION, bridge: parsed.bridge ?? null, threads };
      if (migrated) this.save();
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
    const record = this.state.threads[sessionId] ?? null;
    return normalizeRecord(record);
  }

  saveActive(record) {
    const active = threadFromActive(record);
    if (!active) return;
    record.threads = record.threads ?? {};
    record.threads[active.threadId] = active;
    record.activeThreadId = active.threadId;
  }

  bind(sessionId, thread, { cwd, model, effort, label, carryDigest = false } = {}) {
    if (!thread?.id) throw new Error('bind requires a thread with an id');
    const existing = this.get(sessionId);
    if (existing) this.saveActive(existing);
    const known = existing?.threads?.[thread.id] ?? null;
    if (known && existing.threadId !== thread.id) {
      applyThread(existing, known);
      existing.label = label ?? existing.label;
      existing.model = thread.model ?? model ?? existing.model;
      existing.effort = effort ?? existing.effort;
      existing.boundAt = nowIso();
      this.state.threads[sessionId] = existing;
      this.save();
      return existing;
    }
    const sameThread = existing?.threadId === thread.id;
    const now = nowIso();
    const record = existing ?? { threads: {} };
    record.threads = record.threads ?? {};
    record.threadId = thread.id;
    record.label = label ?? (sameThread ? record.label : labelFromAsk(''));
    record.generation = sameThread ? (record.generation ?? 1) : (record.generation ?? 0) + 1;
    record.cwd = thread.cwd ?? cwd ?? (sameThread ? record.cwd : null) ?? null;
    record.model = thread.model ?? model ?? (sameThread ? record.model : null) ?? null;
    record.effort = thread.effort ?? effort ?? (sameThread ? record.effort : null) ?? null;
    record.createdAt = sameThread ? (record.createdAt ?? now) : now;
    record.boundAt = now;
    if (!sameThread) {
      const carried = carryDigest ? existing?.digest : null;
      record.lastAskAt = carryDigest ? (existing?.lastAskAt ?? null) : null;
      record.lastAnswerAt = carryDigest ? (existing?.lastAnswerAt ?? null) : null;
      record.lastTurnId = carryDigest ? (existing?.lastTurnId ?? null) : null;
      record.lastFailure = carryDigest ? (existing?.lastFailure ?? null) : null;
      record.digest = carried
        ? { asks: [...(carried.asks ?? [])], lastAnswer: carried.lastAnswer ?? '' }
        : { asks: [], lastAnswer: '' };
      record.turnMeta = carryDigest ? { ...(existing?.turnMeta ?? {}) } : {};
      record.activity = carryDigest ? (existing?.activity ?? null) : null;
    }
    record.lastResumeError = null;
    record.activeThreadId = record.threadId;
    record.threads[record.threadId] = threadFromActive(record);
    this.state.threads[sessionId] = record;
    this.evict();
    this.save();
    return record;
  }

  switchThread(sessionId, threadId) {
    const record = this.get(sessionId);
    if (!record) return null;
    const target = record.threads?.[threadId];
    if (!target) return null;
    this.saveActive(record);
    applyThread(record, target);
    record.threads[threadId] = threadFromActive(record);
    this.state.threads[sessionId] = record;
    this.save();
    return record;
  }

  threads(sessionId) {
    const record = this.get(sessionId);
    if (!record) return [];
    this.saveActive(record);
    return Object.values(record.threads).map((thread) => ({
      threadId: thread.threadId,
      label: thread.label,
      model: thread.model,
      effort: thread.effort ?? null,
      createdAt: thread.createdAt,
      lastAskAt: thread.lastAskAt ?? null,
      lastAnswerAt: thread.lastAnswerAt ?? null,
      lastTurnId: thread.lastTurnId ?? null,
      turnCount: Object.keys(thread.turnMeta ?? {}).length,
      lastAsk: Array.isArray(thread.digest?.asks) ? thread.digest.asks.at(-1) ?? null : null,
      lastAnswer: thread.digest?.lastAnswer ?? null,
      activity: thread.activity ?? null,
      active: thread.threadId === record.activeThreadId,
    }));
  }

  update(sessionId, patch) {
    const record = this.get(sessionId);
    if (!record) return null;
    Object.assign(record, patch);
    this.saveActive(record);
    this.save();
    return record;
  }

  recordTurn(sessionId, { ask, answer, turnId, model, effort, activity } = {}) {
    const record = this.get(sessionId);
    if (!record) return null;
    if (turnId && record.lastTurnId === turnId) return record;
    record.lastTurnId = turnId ?? record.lastTurnId ?? null;
    record.lastAnswerAt = nowIso();
    if (typeof ask === 'string' && ask.trim() && !record.label?.trim()) record.label = labelFromAsk(ask);
    const digest = record.digest ?? { asks: [], lastAnswer: '' };
    if (typeof ask === 'string' && ask.trim()) digest.asks.push(clip(ask.trim(), 1200));
    const asks = digest.asks.slice(-6);
    let lastAnswer = typeof answer === 'string'
      ? clip(answer, Math.min(this.digestBytes, 2048))
      : (digest.lastAnswer ?? '');
    let brief = this.briefFrom({ asks, lastAnswer });
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
    if (turnId) {
      record.turnMeta = trimTurnMeta({
        ...(record.turnMeta ?? {}),
        [turnId]: {
          model: model ?? record.model ?? null,
          effort: effort ?? record.effort ?? null,
          askAt: record.lastAskAt ?? null,
          answerAt: record.lastAnswerAt,
        },
      });
    }
    if (effort) record.effort = effort;
    if (activity && typeof activity === 'object') record.activity = activity;
    this.saveActive(record);
    this.save();
    return record;
  }

  turnMeta(sessionId, threadId = null) {
    const record = this.get(sessionId);
    if (!record) return {};
    const target = threadId && record.threads?.[threadId] ? record.threads[threadId] : record;
    return target?.turnMeta ?? {};
  }

  brief(sessionId) {
    const record = this.get(sessionId);
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
        t: nowIso(),
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
