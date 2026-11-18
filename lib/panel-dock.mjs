/**
 * dsh-panel-dock is an optional dependency: it owns panel geometry, but this
 * plugin must render without it, so every touch point lives here.
 *
 *  - the pinned, immutable spec the install dialog offers;
 *  - the version that spec resolves to;
 *  - the never-downgrade rule: a user who already has a newer panel-dock must
 *    not have it replaced by this pin when they press Install.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const PANEL_DOCK_ID = 'dsh-panel-dock';
export const PANEL_DOCK_VERSION = '0.3.12';
export const PANEL_DOCK_SPEC = 'https://github.com/Awenforever/dsh-panel-dock/archive/refs/tags/v0.3.12.tar.gz';

function parseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(value ?? '').trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** -1 / 0 / 1 for a < b, equal, a > b; null when either side is unparseable. */
export function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

/**
 * Install only when the installed copy is older than the pin, or when its version
 * cannot be read (a broken install is repaired, a newer one is kept).
 */
export function needsInstall(installedVersion, target = PANEL_DOCK_VERSION) {
  if (installedVersion === null || installedVersion === undefined || installedVersion === '') return true;
  const order = compareVersions(installedVersion, target);
  if (order === null) return true;
  return order < 0;
}

/** Version of the panel-dock installed beside this plugin, or null. */
export function readInstalledVersion(modulesDir) {
  try {
    const manifest = JSON.parse(readFileSync(join(modulesDir, PANEL_DOCK_ID, 'package.json'), 'utf8'));
    return typeof manifest.version === 'string' ? manifest.version : null;
  } catch {
    return null;
  }
}
