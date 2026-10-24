import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const app = readFileSync('legacy/app.js', 'utf8');
const source = app.slice(
  app.indexOf('  function skipToContent()'),
  app.indexOf('  function restoreFocus('),
);
function fixture() {
  const calls = [],
    ui = { pendingSave: false },
    window = {};
  const makeTarget = (name) => ({
    style: {},
    closest: () => null,
    getClientRects: () => [{}],
    setAttribute: (...args) => calls.push([name, 'attribute', ...args]),
    focus: (options) => calls.push([name, 'focus', { ...options }]),
    scrollIntoView: (options) => calls.push([name, 'scroll', { ...options }]),
  });
  const root = { ...makeTarget('root'), closest: () => null };
  let headings = [makeTarget('heading')];
  const dialog = { hidden: true },
    sidebar = { classList: { contains: () => false } },
    toolbar = { getBoundingClientRect: () => ({ height: 72 }) };
  const context = {
    ui,
    window,
    tour: { close: (options) => calls.push(['tour', { ...options }]) },
    $: (selector, scope) =>
      selector === '#viewRoot'
        ? root
        : selector === '#dialogBackdrop'
          ? dialog
          : selector === '#sidebar'
            ? sidebar
            : selector === '.topbar'
              ? toolbar
              : scope === root
                ? headings[0]
                : null,
    $$: (selector, scope) =>
      selector === 'h1' && scope === root ? headings : [],
  };
  const skip = vm.runInNewContext(source + '\nskipToContent;', context);
  return {
    skip,
    calls,
    root,
    dialog,
    sidebar,
    ui,
    window,
    toolbar,
    target: makeTarget,
    headings(value) {
      headings = value;
    },
    noHeading() {
      headings = [];
    },
  };
}

test('workspace skip link precedes navigation and survives the prepared hosted shell', () => {
  execFileSync(process.execPath, ['scripts/prepare.mjs']);
  for (const file of ['legacy/index.html', 'public/workspace.html']) {
    const html = readFileSync(file, 'utf8');
    assert.match(
      html,
      /<a class="workspace-skip-link" href="#viewRoot" data-action="skip-content">Skip to content<\/a>/,
    );
    assert.ok(
      html.indexOf('id="appShell"') <
        html.indexOf('class="workspace-skip-link"'),
    );
    assert.ok(
      html.indexOf('class="workspace-skip-link"') <
        html.indexOf('id="sidebar"'),
    );
    assert.match(html, /id="viewRoot" tabindex="-1"/);
  }
  const css = readFileSync('legacy/styles.css', 'utf8');
  assert.match(
    css,
    /\.workspace-skip-link\{[^}]*position:fixed[^}]*transform:translateY/,
  );
  assert.match(css, /\.workspace-skip-link:focus\{transform:translateY\(0\)\}/);
  assert.match(css, /#viewRoot h1\[tabindex="-1"\]\{scroll-margin-top:100px\}/);
});

test('skip focuses the current heading without routing, saving or discarding any fields', () => {
  const f = fixture();
  assert.equal(f.skip(), true);
  assert.deepEqual(f.calls, [
    ['tour', { restoreFocus: false }],
    ['heading', 'attribute', 'tabindex', '-1'],
    ['heading', 'focus', { preventScroll: true }],
    ['heading', 'scroll', { block: 'start', behavior: 'instant' }],
  ]);
  const handler = app.slice(
    app.indexOf("  document.addEventListener('click',async event=>{"),
    app.indexOf('    if(el.dataset.view)'),
  );
  assert.match(
    handler,
    /if\(el\.dataset\.action==='skip-content'\)\{event\.preventDefault\(\);skipToContent\(\);return;\}/,
  );
  assert.doesNotMatch(
    source,
    /navigation\.|location\.|store\.|confirmDiscard|closeDialog|innerHTML/,
  );
});

test('empty views have a stable fallback; blocked surfaces never steal focus', () => {
  const fallback = fixture();
  fallback.noHeading();
  assert.equal(fallback.skip(), true);
  assert.ok(
    fallback.calls.some((call) => call[0] === 'root' && call[1] === 'focus'),
  );
  for (const block of [
    (f) => {
      f.ui.pendingSave = true;
    },
    (f) => {
      f.window.GatherAccessLost = true;
    },
    (f) => {
      f.root.closest = () => ({});
    },
    (f) => {
      f.dialog.hidden = false;
    },
    (f) => {
      f.sidebar.classList.contains = () => true;
    },
  ]) {
    const f = fixture();
    block(f);
    assert.equal(f.skip(), false);
    assert.deepEqual(f.calls, []);
  }
});

test('a retained hidden Overview heading never replaces the current visible view target', () => {
  const f = fixture();
  const hidden = {
    ...f.target('hidden-overview'),
    closest: () => ({ hidden: true }),
  };
  const inert = { ...f.target('inert-view'), closest: () => ({ inert: true }) };
  const noBox = { ...f.target('undisplayed'), getClientRects: () => [] };
  f.headings([hidden, inert, noBox, f.target('current-view')]);
  assert.equal(f.skip(), true);
  assert.ok(
    f.calls.some((call) => call[0] === 'current-view' && call[1] === 'focus'),
  );
  assert.ok(
    !f.calls.some((call) =>
      ['hidden-overview', 'inert-view', 'undisplayed'].includes(call[0]),
    ),
  );
});

test('skip clearance follows the wrapping toolbar height instead of obscuring phone focus', () => {
  for (const height of [72, 153.390625, 260]) {
    const f = fixture();
    f.toolbar.getBoundingClientRect = () => ({ height });
    const heading = f.target('current-view');
    f.headings([heading]);
    assert.equal(f.skip(), true);
    assert.equal(heading.style.scrollMarginTop, `${Math.ceil(height) + 16}px`);
  }
  const f = fixture();
  f.noHeading();
  f.skip();
  assert.equal(f.root.style.scrollMarginTop, '88px');
});
