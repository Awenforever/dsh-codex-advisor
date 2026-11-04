import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

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

  assert.ok(elements.length > 0);
  delete global.window;
});
