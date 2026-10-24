import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
let WrittenDraftActions, writtenDraftArtifact;
before(async () => {
  const result = await build({
    entryPoints: {
      chat: 'app/plan/task-chat.tsx',
      artifact: 'lib/written-draft.ts',
    },
    outdir: 'unused',
    write: false,
    bundle: true,
    platform: 'node',
    format: 'esm',
    jsx: 'automatic',
    plugins: [
      {
        name: 'export-ui',
        setup(b) {
          b.onResolve(
            { filter: /^react(?:\/jsx-runtime)?$|^@\/components\/ui\// },
            (a) => ({ path: a.path, namespace: 'fixture' }),
          );
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, (a) => ({
            loader: 'js',
            contents:
              a.path === 'react'
                ? 'export const useState=v=>globalThis.__exportHooks.state(v),useRef=v=>globalThis.__exportHooks.ref(v),useEffect=(f,d)=>globalThis.__exportHooks.effect(f,d);'
                : a.path === 'react/jsx-runtime'
                  ? 'export const jsx=(type,props)=>({type,props}),jsxs=jsx,Fragment="fragment";'
                  : 'export const Button="button",Textarea="textarea",Label="label";',
          }));
        },
      },
    ],
  });
  const load = async (name) =>
    import(
      'data:text/javascript;base64,' +
        Buffer.from(
          result.outputFiles.find((f) => f.path.endsWith('/' + name + '.js'))
            .text,
        ).toString('base64')
    );
  ({ WrittenDraftActions } = await load('chat'));
  ({ writtenDraftArtifact } = await load('artifact'));
});
const work = {
  kind: 'written_draft',
  title: 'Fictional school volunteer briefing',
  content:
    'Welcome, volunteers.\nArrive at [time to confirm].\nReview the accessible entrance route with the organizer.',
};
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
function harness() {
  const values = [],
    effects = [];
  let cursor = 0;
  const previous = globalThis.__exportHooks;
  globalThis.__exportHooks = {
    state(v) {
      const i = cursor++;
      if (!(i in values)) values[i] = v;
      return [values[i], (next) => (values[i] = next)];
    },
    ref(v) {
      const i = cursor++;
      return (values[i] ??= { current: v });
    },
    effect(fn, deps) {
      const i = cursor++;
      if (
        !values[i] ||
        JSON.stringify(values[i].deps) !== JSON.stringify(deps)
      ) {
        values[i]?.cleanup?.();
        values[i] = { deps };
        effects.push(() => (values[i].cleanup = fn()));
      }
    },
  };
  return {
    render(w = work, locked = false) {
      cursor = 0;
      const tree = WrittenDraftActions({ work: w, locked });
      while (effects.length) effects.shift()();
      return tree;
    },
    close() {
      for (const v of values) v?.cleanup?.();
      globalThis.__exportHooks = previous;
    },
  };
}
const button = (tree, label) =>
  nodes(tree).find((n) => n.type === 'button' && text(n) === label);
function clipboard(writeText) {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: writeText ? { clipboard: { writeText } } : {},
  });
  return () =>
    old
      ? Object.defineProperty(globalThis, 'navigator', old)
      : delete globalThis.navigator;
}
test('artifact preserves complete Unicode text and placeholders with a bounded safe text filename', () => {
  const content =
    '舞会と記念日\n[time to confirm]\n<script>literal text</script>\n' +
    'x'.repeat(5800);
  const draft = writtenDraftArtifact({
    ...work,
    title: '../../Équipe / 校内: brief?.html',
    content,
  });
  assert.equal(draft.filename, 'weft-equipe-brief-html.txt');
  assert.ok(draft.text.includes(content));
  assert.match(draft.text, /no task was marked complete/);
  assert.match(draft.text, /review facts and placeholders/);
  assert.ok(
    writtenDraftArtifact({ ...work, title: '学校の計画' }).filename.endsWith(
      '.txt',
    ),
  );
  for (const bad of [
    null,
    {},
    [],
    { ...work, kind: 'cannot_execute' },
    { ...work, kind: 'none' },
    { ...work, title: '' },
    { ...work, content: '' },
    { ...work, title: 'x'.repeat(181) },
    { ...work, content: 'x'.repeat(6001) },
    { ...work, history: 'DO NOT EXPORT' },
  ])
    assert.equal(writtenDraftArtifact(bad), null);
});
test('copy is explicit, uses only the written artifact and blocks duplicate pending writes', async () => {
  let calls = [],
    finish;
  const restore = clipboard(async (value) => {
      calls.push(value);
      await new Promise((r) => (finish = r));
    }),
    h = harness();
  try {
    let tree = h.render();
    assert.equal(calls.length, 0);
    assert.match(text(tree), /not shared with your team/);
    const copy = button(tree, 'Copy draft');
    const pending = copy.props.onClick();
    await copy.props.onClick();
    assert.equal(calls.length, 1);
    assert.equal(calls[0], writtenDraftArtifact(work).text);
    tree = h.render();
    assert.equal(button(tree, 'Copying…').props.disabled, true);
    finish();
    await pending;
    await new Promise((r) => setImmediate(r));
    tree = h.render();
    assert.match(text(tree), /Draft copied/);
    assert.ok(!button(tree, 'Copy draft').props.disabled);
  } finally {
    h.close();
    restore();
  }
});
test('clipboard rejection or absence is honest and leaves download available', async () => {
  for (const writer of [
    undefined,
    async () => {
      throw Error('Denied');
    },
  ]) {
    const restore = clipboard(writer),
      h = harness();
    try {
      const tree = h.render();
      await button(tree, 'Copy draft').props.onClick();
      await new Promise((r) => setImmediate(r));
      const after = h.render();
      assert.match(text(after), /Copy is unavailable/);
      assert.doesNotMatch(text(after), /Draft copied/);
      assert.equal(
        button(after, 'Download draft (.txt)').props.disabled,
        false,
      );
    } finally {
      h.close();
      restore();
    }
  }
});
test('download creates only a plain-text local blob, clicks once, removes the anchor and revokes the URL', async () => {
  const oldDoc = globalThis.document,
    oldCreate = URL.createObjectURL,
    oldRevoke = URL.revokeObjectURL,
    oldTimer = globalThis.setTimeout;
  const blobs = [],
    anchors = [],
    revoked = [],
    timers = [];
  let clicked = 0,
    removed = 0,
    appended = 0;
  globalThis.document = {
    body: { appendChild: () => appended++ },
    createElement(tag) {
      assert.equal(tag, 'a');
      const anchor = {
        click() {
          clicked++;
        },
        remove() {
          removed++;
        },
      };
      anchors.push(anchor);
      return anchor;
    },
  };
  URL.createObjectURL = (blob) => {
    blobs.push(blob);
    return 'blob:fictional-draft';
  };
  URL.revokeObjectURL = (url) => revoked.push(url);
  globalThis.setTimeout = (fn, ms) => {
    timers.push({ fn, ms });
  };
  const h = harness();
  try {
    let tree = h.render();
    assert.equal(blobs.length, 0);
    button(tree, 'Download draft (.txt)').props.onClick();
    tree = h.render();
    assert.equal(clicked, 1);
    assert.equal(appended, 1);
    assert.equal(removed, 1);
    assert.equal(blobs[0].type, 'text/plain;charset=utf-8');
    assert.equal(await blobs[0].text(), writtenDraftArtifact(work).text);
    assert.equal(anchors[0].href, 'blob:fictional-draft');
    assert.equal(anchors[0].download, writtenDraftArtifact(work).filename);
    assert.match(text(tree), /Download requested/);
    assert.equal(timers[0].ms, 1000);
    timers[0].fn();
    assert.deepEqual(revoked, ['blob:fictional-draft']);
  } finally {
    h.close();
    globalThis.document = oldDoc;
    URL.createObjectURL = oldCreate;
    URL.revokeObjectURL = oldRevoke;
    globalThis.setTimeout = oldTimer;
  }
});
test('locked or non-written responses cannot copy or download', async () => {
  let calls = 0;
  const restore = clipboard(async () => calls++),
    h = harness();
  try {
    const tree = h.render(work, true);
    assert.ok(button(tree, 'Copy draft').props.disabled);
    assert.ok(button(tree, 'Download draft (.txt)').props.disabled);
    await button(tree, 'Copy draft').props.onClick();
    button(tree, 'Download draft (.txt)').props.onClick();
    assert.equal(calls, 0);
    assert.equal(h.render({ ...work, kind: 'cannot_execute' }), null);
  } finally {
    h.close();
    restore();
  }
});
test('a late copy cannot label a replacement draft or unmounted view as copied', async () => {
  for (const mode of ['replace', 'unmount']) {
    let finish;
    const restore = clipboard(() => new Promise((r) => (finish = r))),
      h = harness();
    try {
      const tree = h.render();
      button(tree, 'Copy draft').props.onClick();
      const next = { ...work, content: 'A new private draft.' };
      if (mode === 'replace') {
        assert.doesNotMatch(text(h.render(next)), /Draft copied|Copying/);
      } else h.close();
      finish();
      await new Promise((r) => setImmediate(r));
      if (mode === 'replace') {
        assert.doesNotMatch(text(h.render(next)), /Draft copied|Copying/);
        const returned = h.render(work);
        assert.doesNotMatch(text(returned), /Draft copied|Copying/);
        assert.equal(button(returned, 'Copy draft').props.disabled, false);
      }
    } finally {
      h.close();
      restore();
    }
  }
});
