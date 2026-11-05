import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdvisorStore } from '../lib/store.mjs';

test('bind, record turn, digest brief, reload', () => {
  const dir = mkdtempSync(join(tmpdir(), 'advisor-store-'));
  const store = new AdvisorStore({ dir, digestBytes: 2048 });
  store.load();
  const record = store.bind('sess-1', { id: 'thr-1', cwd: 'C:\\work', model: 'gpt' }, {});
  assert.equal(record.threadId, 'thr-1');
  assert.equal(record.generation, 1);
  store.recordTurn('sess-1', { ask: 'first question', answer: 'first answer', turnId: 'turn-1' });
  const brief = store.brief('sess-1');
  assert.match(brief, /first question/);
  assert.match(brief, /first answer/);

  const reloaded = new AdvisorStore({ dir, digestBytes: 2048 });
  reloaded.load();
  assert.equal(reloaded.get('sess-1').threadId, 'thr-1');
  assert.equal(reloaded.get('sess-1').lastTurnId, 'turn-1');

  const raw = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
  assert.equal(raw.threads['sess-1'].threadId, 'thr-1');
});

test('rebinding the same thread keeps the digest; a new thread increments generation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'advisor-store-'));
  const store = new AdvisorStore({ dir });
  store.load();
  store.bind('s', { id: 'thr-1' }, {});
  store.recordTurn('s', { ask: 'q1', answer: 'a1', turnId: 't1' });
  const same = store.bind('s', { id: 'thr-1' }, {});
  assert.equal(same.generation, 1);
  assert.equal(same.digest.asks.length, 1);
  const next = store.bind('s', { id: 'thr-2' }, {});
  assert.equal(next.generation, 2);
  assert.equal(next.threadId, 'thr-2');
  assert.equal(next.digest.asks.length, 0);
});

test('multiple threads keep independent digests and turn metadata', () => {
  const dir = mkdtempSync(join(tmpdir(), 'advisor-store-'));
  const store = new AdvisorStore({ dir });
  store.load();
  store.bind('s', { id: 'thr-a' }, { label: 'Alpha', model: 'gpt-6.1-sol' });
  store.recordTurn('s', {
    ask: 'alpha question',
    answer: 'alpha answer',
    turnId: 'ta',
    model: 'gpt-6.1-sol',
    effort: 'high',
  });
  store.bind('s', { id: 'thr-b' }, { label: 'Beta', model: 'gpt-6-astra' });
  store.recordTurn('s', {
    ask: 'beta question',
    answer: 'beta answer',
    turnId: 'tb',
    model: 'gpt-6-astra',
    effort: 'max',
  });

  const threads = store.threads('s');
  assert.equal(threads.length, 2);
  assert.equal(threads.find((thread) => thread.threadId === 'thr-a').lastAnswer, 'alpha answer');
  assert.equal(threads.find((thread) => thread.threadId === 'thr-b').model, 'gpt-6-astra');
  assert.equal(threads.find((thread) => thread.threadId === 'thr-b').active, true);

  const alpha = store.switchThread('s', 'thr-a');
  assert.equal(alpha.threadId, 'thr-a');
  assert.equal(alpha.label, 'Alpha');
  assert.equal(alpha.digest.lastAnswer, 'alpha answer');
  assert.equal(alpha.turnMeta.ta.effort, 'high');

  const switched = store.threads('s');
  assert.equal(switched.find((thread) => thread.threadId === 'thr-a').active, true);
  assert.equal(switched.find((thread) => thread.threadId === 'thr-b').lastAnswer, 'beta answer');
});

test('digest stays under the byte budget', () => {  const dir = mkdtempSync(join(tmpdir(), 'advisor-store-'));
  const store = new AdvisorStore({ dir, digestBytes: 300 });
  store.load();
  store.bind('s', { id: 'thr' }, {});
  for (let index = 0; index < 10; index += 1) {
    store.recordTurn('s', { ask: `question ${index} `.repeat(10), answer: `answer ${index} `.repeat(20), turnId: `t${index}` });
  }
  const brief = store.brief('s');
  assert.ok(brief.length <= 300 + 200, `brief too long: ${brief.length}`);
  assert.ok(brief.includes('answer 9'));
});

test('maxThreads evicts the oldest binding', () => {
  const dir = mkdtempSync(join(tmpdir(), 'advisor-store-'));
  const store = new AdvisorStore({ dir, maxThreads: 2 });
  store.load();
  for (const id of ['a', 'b', 'c']) {
    store.bind(id, { id: `thr-${id}` }, {});
    store.update(id, { lastAskAt: new Date(Date.now() + (id === 'a' ? 0 : id === 'b' ? 1000 : 2000)).toISOString() });
  }
  assert.equal(store.list().length, 2);
  assert.equal(store.get('a'), null);
  assert.ok(store.get('c'));
});
