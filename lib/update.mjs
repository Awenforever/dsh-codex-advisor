/**
 * Read-only update check for the Codex advisor.
 *
 * The check uses the public GitHub tags API (no token, no install action) and
 * caches the result. The Client only uses it to show the version and a red dot;
 * upgrading stays a plugin-manager/user action.
 */
export const UPDATE_TTL_MS = 6 * 60 * 60 * 1000;
const REPO = 'Awenforever/dsh-codex-advisor';
let cache = null;

export function resetUpdateCache() {
  cache = null;
}

export async function checkForUpdate(currentVersion, {
  fetchImpl = globalThis.fetch,
  now = Date.now(),
  ttlMs = UPDATE_TTL_MS,
  signal = null,
  force = false,
} = {}) {
  if (!force && cache && cache.value.currentVersion === currentVersion && now - cache.at < ttlMs) return cache.value;
  if (typeof fetchImpl !== 'function') {
    return { currentVersion, latestVersion: null, updateAvailable: false, checkedAt: new Date(now).toISOString(), error: 'fetch-unavailable' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  timer.unref?.();
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${REPO}/tags?per_page=30`, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'dsh-codex-advisor',
      },
      signal: signal ?? controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const tags = Array.isArray(payload) ? payload.map((entry) => entry?.name).filter(isSemver) : [];
    const latestTag = tags.sort(compareSemver).at(-1) ?? null;
    const latestVersion = latestTag ? latestTag.replace(/^v/i, '') : null;
    const value = {
      currentVersion,
      latestVersion,
      updateAvailable: latestVersion ? compareVersions(latestVersion, currentVersion) > 0 : false,
      checkedAt: new Date(now).toISOString(),
      releaseUrl: latestTag ? `https://github.com/${REPO}/releases/tag/${latestTag}` : null,
    };
    cache = { at: now, value };
    return value;
  } catch (err) {
    return {
      currentVersion,
      latestVersion: null,
      updateAvailable: false,
      checkedAt: new Date(now).toISOString(),
      error: err?.message ?? String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

function isSemver(value) {
  return typeof value === 'string' && /^v?\d+\.\d+\.\d+$/.test(value);
}

function parts(value) {
  return String(value).replace(/^v/i, '').split('.').map((part) => Number.parseInt(part, 10) || 0);
}

function compareVersions(a, b) {
  const left = parts(a);
  const right = parts(b);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function compareSemver(a, b) {
  return compareVersions(a, b);
}
