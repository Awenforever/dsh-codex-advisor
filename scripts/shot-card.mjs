#!/usr/bin/env node
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
const require = createRequire(import.meta.url);
const components = new Map();
const React = {
  createElement(type, props, ...children) {
    const value = Array.isArray(props) ? [...props] : { ...(props ?? {}) };
    value.children = children.length === 1 ? children[0] : children;
    return { type, props: value };
  },
  useState(initial) { return [initial, () => {}]; },
  useEffect() {},
  useLayoutEffect() {},
  useCallback(fn) { return fn; },
  useMemo(fn) { return fn(); },
  useRef(initial) { return { current: initial }; },
};
const t = (key) => key;
const ctx = {
  effect(fn) { fn(); }, get() { return undefined; },
  locale: { register() {}, bind() { return t; } },
  slots: { inject(name, fn) { fn(); }, register(options, component) { components.set(options.id, component); return () => {}; } },
};
global.window = { __CODEX_ADVISOR_TEST__: true, __ModuleLoader__: { load({ factory }) { factory(() => React).apply(ctx); } } };
require(join(process.cwd(), 'client.js'));
const hooks = global.window.__codexAdvisorTest;
if (!hooks) throw new Error('test hook missing');
const en = hooks.en;
const tr = (key) => (en?.[key] ?? key);
const camelToKebab = (name) => name.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
const unitless = new Set(['opacity', 'zIndex', 'fontWeight', 'lineHeight', 'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'order', 'WebkitLineClamp']);
const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function styleText(style) {
  if (!style || typeof style !== 'object') return '';
  return Object.entries(style).filter(([, value]) => value !== undefined && value !== null && value !== false).map(([key, value]) => {
    const name = camelToKebab(key);
    const text = typeof value === 'number' && !unitless.has(key) ? value + 'px' : String(value);
    return name + ':' + text;
  }).join(';');
}
function attrs(props) {
  return Object.entries(props ?? {}).filter(([key, value]) => key !== 'children' && key !== 'key' && key !== 'ref' && key !== 'style' && value !== undefined && value !== null && value !== false && !key.startsWith('on') && typeof value !== 'object').map(([key, value]) => {
    const name = /^(aria|data)-/.test(key) ? key : camelToKebab(key);
    return name + '="' + escape(value === true ? '' : value) + '"';
  }).join(' ');
}
function render(node) {
  if (node === null || node === undefined || node === false || node === true) return '';
  if (Array.isArray(node)) return node.map(render).join('');
  if (typeof node === 'string' || typeof node === 'number') return escape(node);
  if (typeof node.type === 'function') return render(node.type(node.props ?? {}));
  const tag = node.type;
  if (typeof tag !== 'string') return '';
  const style = styleText(node.props?.style);
  const allAttrs = [attrs(node.props), style ? 'style="' + escape(style) + '"' : ''].filter(Boolean).join(' ');
  return '<' + tag + (allAttrs ? ' ' + allAttrs : '') + '>' + render(node.props?.children) + '</' + tag + '>';
}
const card = components.get('codex-advisor-card');
if (!card) throw new Error('card component missing');
const cardHtml = render(card({ t: tr }));
const LIGHT = {
  '--dsw-alias-bg-base':'#ffffff','--dsw-alias-bg-layer-1':'#ffffff','--dsw-alias-bg-layer-2':'#f4f5f7',
  '--dsw-alias-border-l1':'#e4e6eb','--dsw-alias-label-primary':'#111318','--dsw-alias-label-secondary':'#6b7280',
  '--dsw-alias-brand-primary':'#4176e6','--dsw-alias-state-success-primary':'#1f9d55','--dsw-alias-state-warn-primary':'#c97b00','--dsw-alias-state-error-primary':'#d32f2f',
};
const DARK = {
  '--dsw-alias-bg-base':'#111318','--dsw-alias-bg-layer-1':'#1b1e24','--dsw-alias-bg-layer-2':'#242831',
  '--dsw-alias-border-l1':'#353a44','--dsw-alias-label-primary':'#f2f3f7','--dsw-alias-label-secondary':'#a2a8b5',
  '--dsw-alias-brand-primary':'#7aaaff','--dsw-alias-state-success-primary':'#4ade80','--dsw-alias-state-warn-primary':'#fbbf24','--dsw-alias-state-error-primary':'#f87171',
};
const vars = (tokens) => Object.entries(tokens).map(([key, value]) => key + ': ' + value + ';').join(' ');
const html = '<!doctype html><html><head><meta charset="utf-8"><style>' +
  'html,body{margin:0;padding:0;font-family:-apple-system,"Segoe UI",system-ui,sans-serif;}' +
  'body{padding:18px;background:#f7f7f8;color:#16161c;}' +
  '.themes{display:flex;gap:18px;align-items:flex-start;}' +
  '.theme{width:280px;padding:10px;border-radius:14px;}' +
  '.theme.light{background:#fff;color:#111318;' + vars(LIGHT) + '}' +
  '.theme.dark{background:#111318;color:#f2f3f7;' + vars(DARK) + '}' +
  '.theme > div[role="group"]{width:256px !important;box-sizing:border-box;}' +
  '.theme-label{font-size:11px;font-weight:600;margin-bottom:7px;opacity:.7;}' +
  '</style></head><body><div class="themes">' +
  '<div class="theme light"><div class="theme-label">DSH light</div>' + cardHtml + '</div>' +
  '<div class="theme dark"><div class="theme-label">DSH dark</div>' + cardHtml + '</div>' +
  '</div></body></html>';
const out = resolve(process.argv[2] ?? 'screenshots/codex-advisor-card-light-dark.png');
mkdirSync(dirname(out), { recursive: true });
const page = join(process.cwd(), 'screenshots', '.codex-advisor-card-preview.html');
writeFileSync(page, html, 'utf8');
console.log(JSON.stringify({ page, out }));
