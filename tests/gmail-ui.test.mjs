import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
let GmailSettings, gmailCallbackError;
before(async () => {
  const ui = await build({
    entryPoints: ['app/settings/settings-client.tsx'], bundle: true,
    platform: 'node', format: 'esm', write: false, jsx: 'automatic',
    plugins: [{ name: 'gmail-ui-harness', setup(b) {
      b.onResolve({ filter: /^react(?:\/jsx-runtime)?$|^@\/components\/ui\// }, args => ({ path: args.path, namespace: 'harness' }));
      b.onLoad({ filter: /.*/, namespace: 'harness' }, args => ({ loader: 'js', contents:
        args.path === 'react' ? 'export const useState=(v)=>globalThis.__gmailState(v),useRef=(v)=>({current:v}),useEffect=()=>{};'
          : args.path === 'react/jsx-runtime' ? 'export const jsx=(type,props)=>({type,props}),jsxs=jsx,Fragment="fragment";'
          : 'export const Button="button",Input="input",Label="label",Card="article",CardContent="div",CardHeader="header",CardTitle="h2",NativeSelect="select",NativeSelectOption="option";'
      }));
    } }],
  });
  ({ GmailSettings } = await import('data:text/javascript;base64,' + Buffer.from(ui.outputFiles[0].text).toString('base64')));
  const page = await build({ entryPoints: ['lib/gmail-callback-response.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
  ({ gmailCallbackError } = await import('data:text/javascript;base64,' + Buffer.from(page.outputFiles[0].text).toString('base64')));
});
const nodes = (tree, parents = []) => !tree || typeof tree !== 'object' ? []
  : Array.isArray(tree) ? tree.flatMap(node => nodes(node, parents))
    : [{ ...tree, parents }, ...nodes(tree.props.children, [...parents, tree.type])];
const text = tree => typeof tree === 'string' ? tree : !tree || typeof tree !== 'object' ? ''
  : Array.isArray(tree) ? tree.map(text).join('') : text(tree.props.children);
const render = (status, projectId) => {
  let index = 0;
  globalThis.__gmailState = value => [index++ === 0 ? status : value, () => {}];
  return nodes(GmailSettings({ projectId }));
};
test('managed Gmail has one visible connect action and carries project context without another client form', async () => {
  const previous = { fetch: globalThis.fetch, window: globalThis.window, hook: globalThis.__gmailState };
  const requests = [], locations = [];
  try {
    const id = 'p_00000000-0000-4000-8000-000000000001';
    const tree = render({ configured: true, managed: true, connected: false }, id);
    const connect = tree.filter(node => node.type === 'button' && text(node) === 'Connect Gmail');
    assert.equal(connect.length, 1);
    assert.equal(connect[0].props.disabled, false);
    assert.ok(!connect[0].parents.includes('details'));
    assert.ok(!tree.some(node => node.props?.name === 'clientSecret'));
    globalThis.window = { location: { assign: url => locations.push(url) } };
    globalThis.fetch = async (url, options) => {
      requests.push({ url, options });
      return Response.json({ url: 'https://accounts.google.com/example-fixture' });
    };
    connect[0].props.onClick();
    connect[0].props.onClick();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/gmail/connect?project=' + id);
    assert.equal(requests[0].options.method, 'POST');
    assert.equal(requests[0].options.headers['X-Gather-Request'], '1');
    assert.deepEqual(locations, ['https://accounts.google.com/example-fixture']);
  } finally {
    globalThis.fetch = previous.fetch;
    globalThis.window = previous.window;
    globalThis.__gmailState = previous.hook;
  }
});
test('loading and unconfigured Gmail cannot start authorization; legacy setup stays collapsed', () => {
  const previous = globalThis.__gmailState;
  try {
    for (const status of [null, { configured: false, managed: false, connected: false }]) {
      const tree = render(status);
      assert.equal(tree.find(node => node.type === 'button' && text(node) === 'Connect Gmail').props.disabled, true);
      assert.ok(tree.filter(node => node.type === 'details').every(node => !node.props.open));
    }
  } finally { globalThis.__gmailState = previous; }
});
test('OAuth recovery page escapes error text and never uses external assets or executable content', async () => {
  const response = gmailCallbackError('<script>alert("fixture")</script>&', 400, '/settings?project=main');
  const html = await response.text();
  assert.match(html, /&lt;script&gt;alert\(&quot;fixture&quot;\)&lt;\/script&gt;&amp;/);
  assert.doesNotMatch(html, /<script|<iframe|<img|<link/);
  assert.match(html, /href="\/settings\?project=main"/);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
});
