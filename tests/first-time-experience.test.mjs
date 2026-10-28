import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import vm from 'node:vm';
let Welcome, PrivateBeta, FirstProjectIntro;
before(async () => {
  const directory = mkdtempSync(join(process.cwd(), 'work/intro-test-'));
  await build({ stdin: { contents: "export {Welcome} from './components/welcome';export {PrivateBeta} from './components/private-beta';export {FirstProjectIntro} from './components/projects/FirstProjectIntro';", resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, outfile: join(directory, 'ui.mjs'), format: 'esm', platform: 'node', jsx: 'automatic', external: ['react', 'react/jsx-runtime'], loader: { '.css': 'empty' } });
  ({ Welcome, PrivateBeta, FirstProjectIntro } = await import(pathToFileURL(join(directory, 'ui.mjs'))));
});
test('public landing introduces the product with real paths and an explicitly fictional illustration', () => {
  const html = renderToStaticMarkup(createElement(Welcome));
  assert.match(html, /Less chasing/); assert.match(html, /coming together/);
  assert.match(html, /Fictional example/); assert.match(html, /href="\/signup"/);
  assert.match(html, /id="how-it-works"/); assert.match(html, /href="#welcome-main"/);
  assert.match(html, /AI is optional/); assert.match(html, /does not send messages/);
  assert.doesNotMatch(html, /<form|<iframe|autoplay|Trusted by|200\+|Join your event/);
});
test('private-beta marketing preserves approval-only access, while signed-in denial stays clear', () => {
  const html = renderToStaticMarkup(createElement(PrivateBeta));
  assert.match(html, /Private beta/); assert.match(html, /approved beta testers/);
  assert.match(html, /href="\/signin-with-chatgpt\?return_to=%2F"/);
  assert.doesNotMatch(html, /href="\/signup"|href="\/setup"/);
  assert.match(html, /mailto:support@weftplan.com\?subject=Weft%20beta%20access/);
  const denied = renderToStaticMarkup(createElement(PrivateBeta, { signedIn: true }));
  assert.match(denied, /This account does not have beta access yet/);
  assert.match(denied, /Use another account/); assert.doesNotMatch(denied, /Less chasing/);
});
test('first-project introduction offers optional AI and no automatic invitations or mutation', () => {
  const html = renderToStaticMarkup(createElement(FirstProjectIntro, { onCreate() {} }));
  assert.match(html, /Create my first project/); assert.match(html, /optional AI draft/);
  assert.match(html, /Nothing is sent or added by AI automatically/);
  assert.match(html, /private booking details/); assert.match(html, /<ol/);
  const setup = readFileSync('app/setup/page.tsx', 'utf8');
  assert.match(setup, /Creating it does not call AI or send invitations/);
  assert.match(readFileSync('components/welcome.css', 'utf8'), /prefers-reduced-motion:reduce/);
});
test('expanded workspace tour is role-aware, dismissible and navigation-only', () => {
  for (const organizer of [true, false]) {
    let box, remembered = 0, removed = false;
    const navigations = [], listeners = {}, target = { getBoundingClientRect: () => ({ left: 20, top: 70, bottom: 100 }), closest: () => null, classList: { add() {}, remove() {} } };
    const document = { activeElement: { isConnected: true, focus() {} }, body: { append(value) { box = value; } }, querySelector: () => target, querySelectorAll: () => [], addEventListener(event, fn) { listeners[event] = fn; }, createElement() { return { style: {}, offsetHeight: 240, setAttribute() {}, innerHTML: '', querySelector: () => ({ focus() {} }), remove() { removed = true; } }; } };
    const context = vm.createContext({ document, window: { innerWidth: 390, innerHeight: 844, addEventListener() {} }, localStorage: { getItem: () => null, setItem() { remembered++; } }, fetch() { throw Error('Tour must not make requests'); } });
    vm.runInContext(readFileSync('legacy/planning-ui.js', 'utf8'), context);
    const tour = context.GatherPlanningUI.createTour({ navigate: view => { navigations.push(view); return true; }, isOrganizer: () => organizer, storageKey: 'fictional' });
    tour.start(); assert.match(box.innerHTML, /Welcome to Weft/);
    const copy = [box.innerHTML];
    while (!/data-tour="next"[^>]*>Done/.test(box.innerHTML)) { box.onclick({ target: { closest: () => ({ dataset: { tour: 'next' } }) } }); copy.push(box.innerHTML); assert.ok(copy.length < 10); }
    assert.ok(navigations.includes('timeline')); assert.ok(navigations.includes('info'));
    assert.equal(copy.some(text => text.includes('Ask Weft is coming soon')), organizer);
    assert.ok(copy.some(text => text.includes('recorded manually')));
    listeners.keydown({ key: 'Escape', preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(removed, true); assert.ok(remembered > 0);
  }
});
test('tour anchors ignore preserved hidden views and follow asynchronously resized event info', () => {
  let box, view, resize, observed, disconnected = 0, infoBottom = 100;
  const makeTarget = (hidden, bottom = () => 100) => ({
    closest: () => hidden ? {} : null,
    getBoundingClientRect: () => ({ left: hidden ? 0 : 90, top: 60, bottom: bottom(), width: hidden ? 0 : 200 }),
    classList: { add() { assert.equal(hidden, false); }, remove() {} },
  });
  const hiddenOverview = makeTarget(true), visibleHeading = makeTarget(false), eventInfo = makeTarget(false, () => infoBottom);
  const document = {
    activeElement: { isConnected: true, focus() {} },
    body: { append(value) { box = value; } },
    querySelectorAll(selector) {
      if (selector === '.tour-highlight') return [];
      if (selector === '#eventInfo') return [eventInfo];
      if (selector === '.page-heading') return [hiddenOverview, visibleHeading];
      return [visibleHeading];
    },
    addEventListener() {},
    createElement: () => ({ style: {}, offsetHeight: 240, setAttribute() {}, innerHTML: '', querySelector: () => ({ focus() {} }), remove() {} }),
  };
  const context = vm.createContext({
    document, window: { innerWidth: 1200, innerHeight: 900, addEventListener() {} },
    localStorage: { setItem() {} },
    ResizeObserver: class { constructor(callback) { resize = callback; } observe(target) { observed = target; } disconnect() { disconnected++; } },
  });
  vm.runInContext(readFileSync('legacy/planning-ui.js', 'utf8'), context);
  const tour = context.GatherPlanningUI.createTour({ navigate: next => { view = next; return true; }, isOrganizer: () => false, storageKey: 'fictional' });
  const next = () => box.onclick({ target: { closest: () => ({ dataset: { tour: 'next' } }) } });
  tour.start(); next(); next(); next();
  assert.equal(view, 'timeline'); assert.equal(observed, visibleHeading); assert.equal(box.style.left, '90px');
  next(); assert.equal(view, 'info'); assert.equal(observed, eventInfo); assert.equal(box.style.top, '112px');
  infoBottom = 200; resize(); assert.equal(box.style.top, '212px');
  const before = disconnected; tour.close(); assert.ok(disconnected > before);
});
