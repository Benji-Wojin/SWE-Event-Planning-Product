import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import vm from 'node:vm';
let Welcome, PrivateBeta, FirstProjectIntro, ProjectsHome;
before(async () => {
  const directory = mkdtempSync(join(process.cwd(), 'work/intro-test-'));
  await build({ stdin: { contents: "export {Welcome} from './components/welcome';export {PrivateBeta} from './components/private-beta';export {FirstProjectIntro} from './components/projects/FirstProjectIntro';export {ProjectsHome} from './components/projects/ProjectsHome';", resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, outfile: join(directory, 'ui.mjs'), format: 'esm', platform: 'node', jsx: 'automatic', packages: 'external', loader: { '.css': 'empty' } });
  ({ Welcome, PrivateBeta, FirstProjectIntro, ProjectsHome } = await import(pathToFileURL(join(directory, 'ui.mjs'))));
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
  assert.match(html, /href="\/sign-in\?return_to=%2F"/);
  assert.doesNotMatch(html, /href="\/signup"|href="\/setup"/);
  assert.match(html, /mailto:support@weftplan.com\?subject=Weft%20beta%20access/);
  const denied = renderToStaticMarkup(createElement(PrivateBeta, { signedIn: true }));
  assert.match(denied, /This account does not have beta access yet/);
  assert.match(denied, /Use another account/); assert.doesNotMatch(denied, /Less chasing/);
});
test('first-project introduction explains setup, tasks and then inviting teammates with no automatic actions', () => {
  const html = renderToStaticMarkup(createElement(FirstProjectIntro, { onCreate() {} }));
  assert.match(html, /Create my first project/); assert.match(html, /Create your project[\s\S]*Add your first task[\s\S]*Explore and invite a teammate/);
  assert.match(html, /Nothing is sent or added by AI automatically/);
  assert.match(html, /private booking details/); assert.match(html, /<ol/);
  const setup = readFileSync('app/setup/page.tsx', 'utf8');
  assert.match(setup, /Creating it does not call AI or send invitations/);
  assert.match(readFileSync('components/welcome.css', 'utf8'), /prefers-reduced-motion:reduce/);
});
test('Projects resumes the exact visible project, while setup and ordinary navigation remain separate', () => {
  const projects = [{ id:'p_1', name:'Fictional & school', openTaskCount:0 }, { id:'p_2', name:'Other event', openTaskCount:1 }];
  const render = props => renderToStaticMarkup(createElement(ProjectsHome, {
    onCreate() {}, onOpen() {}, guideHref:'/guide', projects, ...props,
  }));
  const resumed = render({ resumeGuide:{ next:'task_created', projectId:'p_1' } });
  assert.match(resumed, /Step 2 of 5[\s\S]*Add a real task[\s\S]*Fictional &amp; school/);
  assert.match(resumed, /href="\/project\?project=p_1&amp;guide=1" aria-describedby="projects-resume-title">Resume guide/);
  assert.match(resumed, /Other event/);
  const setup = render({ projects:[], resumeGuide:{ next:'project_created', projectId:null } });
  assert.match(setup, /Step 1 of 5[\s\S]*Set up your event[\s\S]*href="\/guide"[^>]*>Resume guide/);
  assert.doesNotMatch(setup, /Guide me through my first project/);
  assert.match(setup, /Create my first project/);
  assert.doesNotMatch(render({ resumeGuide:null }), /Resume guide/);
  assert.doesNotMatch(render({ resumeGuide:{ next:'task_created', projectId:'p_missing' } }), /Resume guide/);
  assert.doesNotMatch(render({ isLoading:true, resumeGuide:{ next:'task_created', projectId:'p_1' } }), /Resume guide/);
});
test('first-project action keeps native button semantics and a wrapping 44px minimum target', () => {
  const html = renderToStaticMarkup(createElement(FirstProjectIntro, { onCreate() {} }));
  const action = html.match(/<button\b[^>]*>Create my first project[\s\S]*?<\/button>/)?.[0];
  assert.ok(action, 'The primary action must remain a native button');
  assert.match(action, /type="button"/);
  for (const token of ['h-auto', 'min-h-11', 'max-w-full', 'whitespace-normal']) {
    assert.ok(action.match(/class="([^"]*)"/)?.[1].split(/\s+/).includes(token), `Missing responsive target class: ${token}`);
  }
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
