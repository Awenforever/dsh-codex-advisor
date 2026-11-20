/**
 * Codex reports two rolling rate-limit windows: a short one (five hours) and a
 * weekly one. The card draws them as the two arcs of one rounded border, so the
 * mapping from window -> arc lives here, in one place, rather than being
 * guessed again in the client.
 *
 * Everything below is expressed as **remaining** headroom, not consumed quota:
 * the border is a fuel gauge, so a full arc means "nothing spent yet".
 */

const FIVE_HOUR_MAX_MINS = 360;
const WEEKLY_MIN_MINS = 1000;

function remainingOf(window) {
  const used = typeof window?.usedPercent === 'number' ? window.usedPercent : null;
  if (used === null) return null;
  return Math.min(100, Math.max(0, 100 - used));
}

function compactWindow(window) {
  const remaining = remainingOf(window);
  return {
    known: remaining !== null,
    usedPercent: typeof window?.usedPercent === 'number' ? window.usedPercent : null,
    remainingPercent: remaining,
    resetAt: window?.resetAt ?? null,
    windowDurationMins: typeof window?.windowDurationMins === 'number' ? window.windowDurationMins : null,
  };
}

function pickWindow(quota, matches, fallback) {
  const candidates = [quota?.primary, quota?.secondary].filter(Boolean);
  return candidates.find((window) => typeof window.windowDurationMins === 'number' && matches(window.windowDurationMins))
    ?? fallback
    ?? null;
}

/**
 * Split a normalized quota into the two arcs. Duration decides the role; only
 * when Codex omits durations do we fall back to the documented primary (short)
 * / secondary (weekly) ordering.
 */
export function quotaWindows(quota) {
  const fiveHour = pickWindow(quota, (mins) => mins <= FIVE_HOUR_MAX_MINS, quota?.primary);
  const weekly = pickWindow(quota, (mins) => mins >= WEEKLY_MIN_MINS, quota?.secondary);
  // A single-window account must not draw the same numbers twice.
  const shared = fiveHour !== null && fiveHour === weekly;
  return {
    fiveHour: compactWindow(fiveHour),
    weekly: compactWindow(shared ? null : weekly),
  };
}

/** Everything the card, the tool, and the tests need, in one shape. */
export function quotaSummary(quota) {
  const windows = quotaWindows(quota);
  return {
    allowed: quota?.allowed !== false,
    planType: quota?.planType ?? null,
    resetAt: quota?.resetAt ?? null,
    fiveHour: windows.fiveHour,
    weekly: windows.weekly,
  };
}
