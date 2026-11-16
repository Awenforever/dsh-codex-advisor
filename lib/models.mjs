/**
 * Model-family routing helpers.
 *
 * Policy describes a family (astra/sol/terra/luna), not a pinned version.
 * At thread creation the manager resolves the family against Codex's
 * model/list response, preferring the newest visible version. The static
 * names below are fallbacks for an unavailable or empty model catalog.
 */
export const MODEL_FAMILIES = Object.freeze(['astra', 'sol', 'terra', 'luna']);

export const FALLBACK_MODEL = Object.freeze({
  astra: 'gpt-6-astra',
  sol: 'gpt-6.1-sol',
  terra: 'gpt-6.1-terra',
  luna: 'gpt-6-luna',
});

export const STATIC_MODEL_CHOICES = Object.freeze(Object.values(FALLBACK_MODEL));
export const MODEL_CHOICES = Object.freeze([...STATIC_MODEL_CHOICES, ...MODEL_FAMILIES]);

const MODEL_RE = /^gpt-(\d+(?:\.\d+)*)-(astra|sol|terra|luna)$/i;

export function parseModelId(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  const match = MODEL_RE.exec(text);
  if (!match) return null;
  return { id: text, version: match[1], family: match[2].toLowerCase() };
}

export function normalizeFamily(value) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (MODEL_FAMILIES.includes(text)) return text;
  return parseModelId(value)?.family ?? null;
}

export function compareModelVersions(left, right) {
  const a = String(left ?? '').split('.').map((part) => Number(part) || 0);
  const b = String(right ?? '').split('.').map((part) => Number(part) || 0);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function catalogIds(catalog) {
  if (!Array.isArray(catalog)) return [];
  return catalog
    .map((entry) => (typeof entry === 'string' ? entry : entry?.id))
    .filter((id) => typeof id === 'string' && id.trim())
    .map((id) => id.trim());
}

export function latestModelForFamily(catalog, family) {
  const wanted = normalizeFamily(family);
  if (!wanted) return null;
  let best = null;
  for (const entry of Array.isArray(catalog) ? catalog : []) {
    const id = typeof entry === 'string' ? entry : entry?.id;
    if (entry && typeof entry === 'object' && entry.hidden === true) continue;
    const parsed = parseModelId(id);
    if (!parsed || parsed.family !== wanted) continue;
    if (!best || compareModelVersions(parsed.version, best.version) > 0) best = parsed;
  }
  return best?.id ?? null;
}

export function resolveFamilyModel(family, catalog) {
  return latestModelForFamily(catalog, family) ?? FALLBACK_MODEL[normalizeFamily(family)] ?? null;
}

export function isKnownModel(value, catalog = []) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return false;
  if (MODEL_FAMILIES.includes(text.toLowerCase())) return true;
  if (STATIC_MODEL_CHOICES.includes(text)) return true;
  return catalogIds(catalog).includes(text);
}

export function resolveRequestedModel(value, catalog = []) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  if (MODEL_FAMILIES.includes(text.toLowerCase())) return resolveFamilyModel(text, catalog);
  return text;
}

export function catalogFromResponse(response) {
  const data = Array.isArray(response) ? response : response?.data;
  if (!Array.isArray(data)) return [];
  return data
    .filter((entry) => entry && typeof entry === 'object' && typeof entry.id === 'string')
    .map((entry) => ({ ...entry, id: entry.id.trim() }))
    .filter((entry) => entry.id);
}

export function latestByFamily(catalog) {
  const result = {};
  for (const family of MODEL_FAMILIES) result[family] = latestModelForFamily(catalog, family) ?? FALLBACK_MODEL[family];
  return result;
}
