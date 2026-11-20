import test from 'node:test';
import assert from 'node:assert/strict';
import { quotaSummary, quotaWindows } from '../lib/quota.mjs';

test('rate-limit windows map by duration, not by slot name', () => {
  // Codex has swapped primary/secondary between builds; the duration is the fact.
  const out = quotaWindows({
    primary: { usedPercent: 5, windowDurationMins: 10080 },
    secondary: { usedPercent: 10, windowDurationMins: 300 },
  });
  assert.equal(out.fiveHour.windowDurationMins, 300);
  assert.equal(out.weekly.windowDurationMins, 10080);
  assert.equal(out.fiveHour.remainingPercent, 90);
});

test('the border is a fuel gauge, so numbers are remaining and clamped', () => {
  const out = quotaWindows({
    primary: { usedPercent: 0, windowDurationMins: 300 },
    secondary: { usedPercent: 250, windowDurationMins: 10080 },
  });
  assert.equal(out.fiveHour.remainingPercent, 100);
  assert.equal(out.weekly.remainingPercent, 0);
  assert.equal(out.weekly.known, true);
});

test('missing numbers are unknown rather than zero', () => {
  const out = quotaSummary({ primary: { windowDurationMins: 300 }, secondary: null });
  assert.equal(out.fiveHour.known, false);
  assert.equal(out.fiveHour.remainingPercent, null);
  assert.equal(out.weekly.known, false);
});

test('a single window is not drawn twice', () => {
  const out = quotaSummary({ primary: { usedPercent: 40, windowDurationMins: 300 } });
  assert.equal(out.fiveHour.remainingPercent, 60);
  assert.equal(out.weekly.known, false);
});

test('no quota data never blocks and never invents numbers', () => {
  const out = quotaSummary(null);
  assert.equal(out.allowed, true);
  assert.equal(out.fiveHour.known, false);
  assert.equal(out.weekly.known, false);
});
