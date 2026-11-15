#!/usr/bin/env node
/** Render 13px icon candidates next to the real dsh-loci Memory mark. */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const components = new Map();
const React = {
  createElement(type, props, ...children) { return { type, props: { ...(props ?? {}), children } }; },
  useState(initial) { return [initial, () => {}]; }, useEffect() {}, useLayoutEffect() {},
  useCallback(fn) { return fn; }, useMemo(fn) { return fn(); }, useRef(initial) { return { current: initial }; },
};
const t = (key) => key;
const ctx = { effect(fn){fn();}, get(){}, locale:{register(){},bind(){return t;}}, slots:{inject(n,f){f();},register(o,c){components.set(o.id,c);}} };
global.window = { __CODEX_ADVISOR_TEST__: true, __ModuleLoader__: { load({factory}) { factory(() => React).apply(ctx); } } };
require(join(process.cwd(), 'client.js'));
const hooks = global.window.__codexAdvisorTest;
const path = hooks.CHATGPT_MARK_PATH;
const memoryPath = 'M20 4c0 9-6.5 15-16 16 0 0 .5-7 4.5-11S20 4 20 4Z';
const memoryPath2 = 'M5 20 14 10';
const icon = (d, strokeWidth, transform = '', extra = '') => '<span class="mark">' +
  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none">' +
  (transform ? '<g transform="' + transform + '">' : '') +
  '<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="' + strokeWidth + '" stroke-linejoin="round" stroke-linecap="round" ' + extra + '/>' +
  (transform ? '</g>' : '') +
  '</svg></span>';
const memory = '<span class="mark"><svg width="13" height="13" viewBox="0 0 24 24" fill="none">' +
  '<path d="' + memoryPath + '" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' +
  '<path d="' + memoryPath2 + '" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg></span>';
const parts = path.split('M').slice(1);
const outer = 'M' + parts[0];
const simpleOuter = 'M12 3c1.6 0 3 .8 3.7 2.1 1.6-.2 3.2.5 4.1 1.8.9 1.3.7 3-.4 4.1 1 1.1 1.2 2.8.4 4.2-.8 1.4-2.4 2-3.9 1.6-.7 1.3-2.1 2.1-3.7 2.1s-3-.8-3.7-2.1c-1.5.4-3.1-.2-3.9-1.6-.8-1.4-.6-3.1.4-4.2-1.1-1.1-1.3-2.8-.4-4.1.9-1.3 2.5-2 4.1-1.8C9 3.8 10.4 3 12 3Z';
const simpleInner = 'M12 6.8 15.7 9v4.4L12 15.6l-3.7-2.2V9L12 6.8Z';
const iconPaths = (paths, widths, transform = '', extra = '') => '<span class="mark"><svg width="13" height="13" viewBox="0 0 24 24" fill="none">' +
  (transform ? '<g transform="' + transform + '">' : '') +
  paths.map((d, index) => '<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="' + widths[index] + '" stroke-linejoin="round" stroke-linecap="round" ' + extra + '/>').join('') +
  (transform ? '</g>' : '') +
  '</svg></span>';
const scaled = 'translate(2 2) scale(0.833333)';
const final = iconPaths(parts.slice(0, 3).map((part) => 'M' + part), ['2', '2', '2'], scaled);
const cells = [
  ['Memory', memory],
  ['Codex Advisor 13px', final],
  ['first3 · 2.0 explicit', iconPaths(parts.slice(0, 3).map((part) => 'M' + part), ['2.0', '2.0', '2.0'], scaled)],
  ['first3 · 2.25 explicit', iconPaths(parts.slice(0, 3).map((part) => 'M' + part), ['2.25', '2.25', '2.25'], scaled)],
  ['current 0.9 scaled', icon(path, '0.9', scaled)],
  ['full 1.2', icon(path, '1.2')],
];
const row = (theme, list = cells, scale = 1) => '<div class="theme ' + theme + '"><div class="label">' + theme.toUpperCase() + '</div><div class="row">' +
  list.map(([name, svg]) => '<div class="cell" style="width:' + (scale > 1 ? 120 : 88) + 'px"><span class="icon" style="flex:0 0 ' + (13 * scale) + 'px;width:' + (13 * scale) + 'px;height:' + (13 * scale) + 'px"><span style="display:block;transform:scale(' + scale + ');transform-origin:center">' + svg + '</span></span><span class="name">' + name + '</span></div>').join('') +
  '</div></div>';
const detail = [
  ['Memory', memory],
  ['current 0.9 scaled', icon(path, '0.9', scaled)],
  ['Codex Advisor 13px', final],
  ['first3 · 2.0 explicit', iconPaths(parts.slice(0, 3).map((part) => 'M' + part), ['2.0', '2.0', '2.0'], scaled)],
  ['first3 · 2.25 explicit', iconPaths(parts.slice(0, 3).map((part) => 'M' + part), ['2.25', '2.25', '2.25'], scaled)],
  ['first3 · 2.5 explicit', iconPaths(parts.slice(0, 3).map((part) => 'M' + part), ['2.5', '2.5', '2.5'], scaled)],
  ['first3 · 1.0 non-scaling', iconPaths(parts.slice(0, 3).map((part) => 'M' + part), ['1.0', '1.0', '1.0'], scaled, 'vector-effect="non-scaling-stroke"')],
];
const tokens = (values) => Object.entries(values).map(([k,v]) => k + ':' + v).join(';');
const html = '<!doctype html><html><head><meta charset="utf-8"><style>' +
  'html,body{margin:0;padding:0;font-family:-apple-system,"Segoe UI",system-ui,sans-serif;}' +
  'body{padding:14px;background:#f5f6f8;color:#111318;}' +
  '.theme{border-radius:12px;padding:10px 12px;margin-bottom:12px;}' +
  '.theme.light{background:#fff;color:#111318;' + tokens({'--dsw-alias-bg-layer-1':'#fff','--dsw-alias-label-primary':'#111318'}) + '}' +
  '.theme.dark{background:#111318;color:#f2f3f7;' + tokens({'--dsw-alias-bg-layer-1':'#1b1e24','--dsw-alias-label-primary':'#f2f3f7'}) + '}' +
  '.label{font-size:10px;opacity:.55;margin-bottom:7px;letter-spacing:.04em;}' +
  '.row{display:flex;gap:22px;align-items:flex-start;}' +
  '.cell{width:88px;display:flex;flex-direction:column;gap:6px;align-items:flex-start;}' +
  '.icon{display:inline-flex;align-items:center;justify-content:center;flex:0 0 13px;width:13px;height:13px;line-height:0;color:currentColor;}' +
  '.mark{display:flex;align-items:center;flex:0 0 13px;width:13px;height:13px;line-height:0;color:currentColor;}' +
  '.name{font-size:9px;line-height:1.35;color:currentColor;opacity:.65;}' +
  '</style></head><body>' + row('light') + row('dark') + row('light', detail, 4) + '</body></html>';
mkdirSync(join(process.cwd(), 'screenshots'), { recursive: true });
const page = join(process.cwd(), 'screenshots', '.codex-advisor-icon-compare.html');
writeFileSync(page, html, 'utf8');
console.log(JSON.stringify({ page }));
