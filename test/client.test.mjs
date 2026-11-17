import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);

test('client follows DSH theme tokens instead of a fixed light palette', () => {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  for (const token of [
    '--dsw-alias-link',
    '--dsw-alias-state-business-tertiary',
    '--dsw-alias-state-success-primary',
    '--dsw-alias-state-error-primary',
    '--dsw-alias-state-warn-primary',
    '--dsw-alias-bg-layer-1',
    '--dsw-alias-label-primary',
  ]) {
    assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing ${token}`);
  }
  assert.doesNotMatch(source, /--dsw-alias-brand-primary/);
  assert.match(source, /color-mix\(in srgb/);
  assert.doesNotMatch(source, /prefers-color-scheme/);
  assert.match(source, /Support boundary: verified against the latest dsh-multiview only/);
  for (const retired of ['rgba(37, 99, 235', 'rgba(100, 116, 139', 'rgba(254, 226, 226', '#bbf7d0', '#fecaca', '#166534', '#b91c1c']) {
    assert.equal(source.includes(retired), false, `light-only color remains: ${retired}`);
  }
  assert.match(source, /cardTitle: 'Codex Advisor'/);
  assert.match(source, /function AdvisorMark/);
  assert.match(source, /CHATGPT_MARK_PATH/);
  assert.match(source, /flex: '0 0 13px'/);
  assert.match(source, /width: 13,/);
  assert.match(source, /height: 13,/);
  assert.match(source, /viewBox: MARK_VIEWBOX/);
  assert.match(source, /translate\(2 2\) scale\(0\.833333\)/);
  assert.match(source, /strokeWidth: MARK_STROKE/);
  assert.match(source, /const MARK_SIZE = 12;/);
  assert.match(source, /const MARK_STROKE = 0\.9;/);
  assert.match(source, /fill: 'currentColor'/);
  assert.match(source, /const MARK_VIEWBOX = '0 0 24 24';/);
  assert.doesNotMatch(source, /CHATGPT_MARK_PARTS/);
  assert.doesNotMatch(source, /vectorEffect/);
  assert.match(source, /stroke: 'currentColor'/);
  assert.match(source, /fill: 'none'/);
  assert.match(source, /h\(AdvisorMark\)/);
  assert.match(source, /FOOTER_LAYOUT_CSS/);
  assert.match(source, /data-codex-advisor-footer/);
  assert.match(source, /data-codex-advisor-mount/);
  assert.match(source, /data-codex-advisor-card/);
  assert.match(source, /lineHeight: '13px'/);
  assert.match(source, /translateY\(-0\.15px\)/);
  assert.match(source, /dsh-codex-advisor:position/);
  assert.match(source, /function RightDockSeat/);
  assert.match(source, /function LeftDockSeat/);
  assert.match(source, /function measureRightDock/);
  // Cross-plugin stacking must not be "yield to anything below me": that is the
  // symmetric rule that makes two right docks chase each other downwards.
  assert.match(source, /const DOCK_ID = 'codex-advisor'/);
  assert.match(source, /const startsAbove = rect\.top < contentTop - 1/);
  assert.match(source, /const tiedAndEarlier = Math\.abs\(rect\.top - contentTop\) <= 1 && neighbourId < DOCK_ID/);
  assert.match(source, /if \(!startsAbove && !tiedAndEarlier\) continue/);
  assert.doesNotMatch(source, /if \(rect\.bottom > top\) top = /);
  assert.match(source, /shell\.overlay/);
  assert.match(source, /data-codex-advisor-position-toggle/);
  // The brand mark itself is the dock switch: no extra header control, and the
  // trailing status/model cluster keeps its space.
  assert.match(source, /const showSwitch = cardHovered \|\| markHovered/);
  assert.match(source, /showSwitch \? h\(DockMark/);
  assert.doesNotMatch(source, /dockButton/);
  assert.doesNotMatch(source, /flex: '0 0 18px'/);
  assert.match(source, /const showSwitch = cardHovered \|\| markHovered/);
  assert.doesNotMatch(source, /wideLayout/);
  assert.doesNotMatch(source, /dockButton/);
});

test('the screenshot harness keeps SVG camelCase attributes intact', () => {
  const harness = readFileSync(new URL('../scripts/shot-card.mjs', import.meta.url), 'utf8');
  // Kebab-casing viewBox renders as view-box, which silently drops the
  // viewport and clips the mark: the images then lie about the real card.
  assert.match(harness, /SVG_CAMEL/);
  assert.match(harness, /'viewBox'/);
  assert.match(harness, /SVG_CAMEL\.has\(key\)/);
});

test('client registers, renders, and resolves split-pane session focus', () => {
  const components = new Map();
  const elements = [];
  const React = {
    createElement(type, props, ...children) {
      const element = { type, props: props ?? {}, children };
      elements.push(element);
      return element;
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
    effect(fn) { fn(); },
    get() { return undefined; },
    locale: { register() {}, bind() { return t; } },
    slots: {
      inject(name, fn) { fn(); },
      register(options, component) {
        components.set(options.id, component);
        return () => {};
      },
    },
  };
  global.window = {
    __CODEX_ADVISOR_TEST__: true,
    __ModuleLoader__: {
      load({ factory }) {
        factory(() => React).apply(ctx);
      },
    },
  };

  require('../client.js');

  const card = components.get('codex-advisor-card');
  assert.equal(typeof card, 'function');
  assert.ok(card({ t }));

  const panel = components.get('codex-advisor');
  assert.equal(typeof panel, 'function');
  assert.ok(panel({ t }));

  const hooks = global.window.__codexAdvisorTest;
  assert.ok(hooks);

  const fakeElement = (name, parent, attrs = {}) => {
    const node = {
      nodeType: 1,
      name,
      parentElement: parent,
      attrs,
      contains(candidate) {
        for (let current = candidate; current; current = current.parentElement) {
          if (current === node) return true;
        }
        return false;
      },
      getAttribute(key) {
        return Object.prototype.hasOwnProperty.call(attrs, key) ? attrs[key] : null;
      },
    };
    return node;
  };
  const documentElement = fakeElement('documentElement', null);
  const body = fakeElement('body', documentElement);
  const shell = fakeElement('split-shell', body);
  const paneA = fakeElement('pane-a', shell, { 'aria-selected': 'true' });
  const composerA = fakeElement('composer-a', paneA);
  const markerA = fakeElement('marker-a', composerA);
  const targetA = fakeElement('target-a', paneA);
  const paneB = fakeElement('pane-b', shell);
  const composerB = fakeElement('composer-b', paneB);
  const markerB = fakeElement('marker-b', composerB);
  const targetB = fakeElement('target-b', paneB);
  const targetShared = fakeElement('shared-toolbar', shell);
  const probes = new Map([
    ['session-a', new Set([markerA])],
    ['session-b', new Set([markerB])],
  ]);
  assert.equal(hooks.resolveSessionForTarget(targetA, probes, { body, documentElement }), 'session-a');
  assert.equal(hooks.resolveSessionForTarget(targetShared, probes, { body, documentElement }), null);
  assert.equal(hooks.findExplicitFocusedSession(probes, { body, documentElement }), 'session-a');
  paneB.attrs['aria-selected'] = 'true';
  paneA.attrs['aria-selected'] = 'false';
  paneB.attrs['data-focused'] = 'true';
  assert.equal(hooks.findExplicitFocusedSession(probes, { body, documentElement }), 'session-b');
  paneA.attrs['data-focused'] = 'true';
  assert.equal(hooks.findExplicitFocusedSession(probes, { body, documentElement }), 'session-a');
  delete paneA.attrs['data-focused'];
  paneA.attrs['aria-selected'] = 'true';
  paneB.attrs['aria-selected'] = 'false';
  delete paneB.attrs['data-focused'];
  const probe = hooks.SessionProbe({ sessionId: 'session-a' });
  assert.equal(probe.type, 'span');
  assert.equal(probe.props['data-codex-advisor-session-probe'], 'session-a');
  assert.equal(probe.props.style.display, 'none');
  const listeners = new Map();
  const fakeDocument = {
    body,
    documentElement,
    activeElement: null,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type, target) {
      for (const listener of listeners.get(type) ?? []) listener({ target });
    },
  };
  global.document = fakeDocument;
  hooks.setActiveSession(null);
  const offA = hooks.registerSessionProbe('session-a', markerA);
  const offB = hooks.registerSessionProbe('session-b', markerB);
  assert.equal(hooks.getActiveSession(), 'session-a');
  fakeDocument.dispatch('pointerdown', targetA);
  assert.equal(hooks.getActiveSession(), 'session-a');
  fakeDocument.dispatch('pointerdown', targetB);
  assert.equal(hooks.getActiveSession(), 'session-b');
  fakeDocument.dispatch('pointerdown', targetShared);
  assert.equal(hooks.getActiveSession(), 'session-b');
  fakeDocument.dispatch('pointerdown', targetA);
  assert.equal(hooks.getActiveSession(), 'session-a');
  offA();
  assert.equal(hooks.getActiveSession(), 'session-b');
  offB();
  assert.equal(hooks.getActiveSession(), null);
  delete global.document;

  const flattenTypes = (node, out = []) => {
    if (node === null || node === undefined || typeof node === 'string') return out;
    if (Array.isArray(node)) {
      for (const child of node) flattenTypes(child, out);
      return out;
    }
    if (node.type) out.push(node.type);
    for (const child of node.children ?? []) flattenTypes(child, out);
    return out;
  };

  const markdown = hooks.renderMarkdown([
    '## Heading',
    '',
    '- **bold** and `code`',
    '',
    '> quoted',
    '',
    '```js',
    'const x = 1;',
    '```',
    '',
    '[link](https://example.com)',
  ].join('\n'));
  const markdownTypes = flattenTypes(markdown);
  for (const type of ['h2', 'ul', 'strong', 'code', 'blockquote', 'pre', 'a']) {
    assert.ok(markdownTypes.includes(type), `expected markdown element ${type}`);
  }

  const rawHtml = flattenTypes(hooks.renderInlineMarkdown('<script>alert(1)</script>'));
  assert.ok(!rawHtml.includes('script'));

  const unsafeLink = flattenTypes(hooks.renderInlineMarkdown('[x](javascript:alert(1))'));
  assert.ok(!unsafeLink.includes('a'));

  const rail = hooks.ThreadRail({
    threads: [
      { threadId: 'a', label: 'Alpha', model: 'gpt-6.1-sol', turnCount: 2, active: true },
      { threadId: 'b', label: 'Beta', model: 'gpt-6-luna', turnCount: 1, active: false },
    ],
    selectedId: 'b',
    onSelect() {},
  });
  assert.equal(rail.type, 'div');
  assert.equal(rail.children[1].props.role, 'tablist');
  assert.equal(flattenTypes(rail.children[1]).filter((type) => type === 'button').length, 2);

  const turn = {
    turn_id: 't1',
    status: 'completed',
    created_at: Date.now(),
    ask: '## Ask',
    answer: '```js\nconst x = 1;\n```',
    model: 'gpt-6-luna',
    effort: 'low',
  };
  assert.ok(hooks.TurnCard({ turn, t }));

  assert.ok(elements.length > 0);
  delete global.window;
});
