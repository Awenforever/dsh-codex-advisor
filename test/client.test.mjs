import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);

test('client follows DSH theme tokens instead of a fixed light palette', () => {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  for (const token of [
    '--dsw-alias-link',
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
  for (const retired of ['rgba(37, 99, 235', 'rgba(100, 116, 139', 'rgba(254, 226, 226', '#bbf7d0', '#fecaca', '#166534', '#b91c1c']) {
    assert.equal(source.includes(retired), false, `light-only color remains: ${retired}`);
  }
});

test('client registers and renders the card and panel without a session', () => {
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
