import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
let ResearchChat;
before(async () => {
  const bundle = await build({
    entryPoints: ['app/plan/research-chat.tsx'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    plugins: [
      {
        name: 'research-ui',
        setup(b) {
          b.onResolve(
            { filter: /^react(?:\/jsx-runtime)?$|^@\/components\/ui\// },
            (a) => ({ path: a.path, namespace: 'mock' }),
          );
          b.onLoad({ filter: /.*/, namespace: 'mock' }, (a) => ({
            loader: 'js',
            contents:
              a.path === 'react'
                ? 'export const useState=v=>globalThis.__researchHooks.state(v),useRef=v=>globalThis.__researchHooks.ref(v),useEffect=(fn,deps)=>globalThis.__researchHooks.effect(fn,deps);'
                : a.path === 'react/jsx-runtime'
                  ? 'export const jsx=(type,props)=>({type,props}),jsxs=jsx;'
                  : 'export const Button="button",Textarea="textarea",Label="label";',
          }));
        },
      },
    ],
  });
  ({ ResearchChat } = await import(
    'data:text/javascript;base64,' +
      Buffer.from(bundle.outputFiles[0].text).toString('base64')
  ));
});
const nodes = (n) =>
  !n || typeof n !== 'object'
    ? []
    : Array.isArray(n)
      ? n.flatMap(nodes)
      : [n, ...nodes(n.props?.children)];
const text = (n) =>
  n == null || typeof n === 'boolean'
    ? ''
    : typeof n !== 'object'
      ? String(n)
      : Array.isArray(n)
        ? n.map(text).join('')
        : text(n.props?.children);
const tick = () => new Promise((resolve) => setImmediate(resolve));
test('research UI sends nothing on mount, keeps rejected input, reconciles explicitly, and clears revoked results', async () => {
  const values = [],
    effects = [];
  let index = 0,
    dirty = false,
    sendFails = false,
    revoked = false,
    calls = [];
  globalThis.__researchHooks = {
    state(v) {
      const n = index++;
      if (!(n in values)) values[n] = v;
      return [values[n], (value) => (values[n] = value)];
    },
    ref(v) {
      const n = index++;
      return (values[n] ??= { current: v });
    },
    effect(fn) {
      const n = index++;
      if (!(n in values)) {
        values[n] = true;
        effects.push(fn);
      }
    },
  };
  const base = {
    configured: true,
    revision: 'r1',
    status: 'empty',
    query: '',
    answer: '',
    sources: [],
    retryAfter: 0,
  };
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (revoked)
      return Response.json({ error: 'Access changed' }, { status: 403 });
    if (options.method === 'POST') {
      assert.deepEqual(Object.keys(JSON.parse(options.body)).sort(), [
        'consent',
        'consentVersion',
        'query',
        'requestId',
        'revision',
      ]);
      if (sendFails) throw Error('Lost response');
    }
    return Response.json(base);
  };
  const render = () => {
    index = 0;
    return ResearchChat({
      query: 'project=main',
      locked: false,
      onDirty: (v) => (dirty = v),
      onBusy() {},
    });
  };
  const question = (tree) => nodes(tree).find((n) => n.type === 'textarea'),
    consent = (tree) => nodes(tree).find((n) => n.type === 'input'),
    form = (tree) => nodes(tree).find((n) => n.type === 'form');
  try {
    let tree = render();
    for (const effect of effects) effect();
    await tick();
    tree = render();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.method, 'GET');
    question(tree).props.onChange({
      target: { value: 'A public research question' },
    });
    tree = render();
    await form(tree).props.onSubmit({ preventDefault() {} });
    await tick();
    assert.equal(calls.length, 1);
    assert.equal(dirty, true);
    consent(tree).props.onChange({ target: { checked: true } });
    tree = render();
    sendFails = true;
    form(tree).props.onSubmit({ preventDefault() {} });
    await tick();
    tree = render();
    assert.equal(question(tree).props.value, 'A public research question');
    assert.equal(dirty, true);
    assert.match(text(tree), /Reload status before another search/);
    assert.equal(
      nodes(tree).find((n) => n.type === 'button' && n.props.type === 'submit')
        .props.disabled,
      true,
    );
    sendFails = false;
    base.status = 'ready';
    base.query = 'Earlier public question';
    base.answer = 'PRIVATE RESULT';
    base.sources = [
      {
        url: 'https://www.weather.gov/',
        title: 'Weather',
        host: 'www.weather.gov',
      },
    ];
    nodes(tree)
      .find((n) => n.type === 'button' && text(n) === 'Reload status')
      .props.onClick();
    await tick();
    tree = render();
    assert.match(text(tree), /PRIVATE RESULT/);
    assert.equal(question(tree).props.value, 'A public research question');
    revoked = true;
    nodes(tree)
      .find((n) => n.type === 'button' && text(n) === 'Reload status')
      .props.onClick();
    await tick();
    tree = render();
    assert.doesNotMatch(text(tree), /PRIVATE RESULT|Earlier public question/);
    assert.equal(
      nodes(tree).find((n) => n.type === 'button' && n.props.type === 'submit')
        .props.disabled,
      true,
    );
    assert.equal(calls.filter((c) => c.options.method === 'POST').length, 1);
  } finally {
    globalThis.fetch = oldFetch;
    delete globalThis.__researchHooks;
  }
});
