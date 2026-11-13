import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync('legacy/app.js', 'utf8');
const excerpt = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to);
};

function fixture() {
  const calls = [];
  function node(tagName, name, attributes = {}) {
    return { tagName, name, dataset: {}, children: [], parentElement: null, className: '', hidden: false, inert: false, disabled: false,
      isConnected: true, tabIndex: 0, rect: { top: 150, bottom: 195 },
      get classList() { return { contains: value => this.className.split(' ').includes(value) }; },
      getClientRects() { return this.noRects ? [] : [this.rect]; },
      getBoundingClientRect() { return this.rect; },
      getAttribute(key) { return key === 'aria-pressed' ? String(this.pressed) : null; },
      contains(other) { for (let item = other; item; item = item.parentElement) if (item === this) return true; return false; },
      closest(selector) { for (let item = this; item; item = item.parentElement) if (item.matches(selector)) return item; return null; },
      matches(selector) { return selector.split(',').some(part => match(this, part)); },
      focus(options) { document.activeElement = this; calls.push(['focus', this.name, options?.preventScroll]); },
      scrollIntoView(options) { calls.push(['scroll', this.name, options.block, options.inline, options.behavior]); },
      ...attributes,
    };
  }
  function match(el, selector) {
    switch (selector) {
      case '[hidden]': return el.hidden;
      case '[inert]': return el.inert;
      case ':disabled': return el.disabled;
    }
    if (selector.startsWith('#')) return el.id === selector.slice(1);
    if (selector.startsWith('.')) return el.classList.contains(selector.slice(1));
    if (selector.startsWith('[')) return [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)].every(([, key, value]) => {
      if (key === 'aria-pressed') return String(el.pressed) === value;
      const property = key.replace(/^data-/, '').replace(/-([a-z])/g, (_whole, c) => c.toUpperCase());
      return value === undefined ? property in el.dataset : el.dataset[property] === value;
    });
    return el.tagName.toLowerCase() === selector.toLowerCase();
  }
  function append(parent, ...children) {
    for (const child of children) { child.parentElement = parent; parent.children.push(child); }
    return parent;
  }
  const descendants = root => root.children.flatMap(child => [child, ...descendants(child)]);
  const document = node('DOCUMENT', 'document'), root = node('MAIN', 'view');
  const topbar = node('HEADER', 'topbar', { className: 'topbar', rect: { top: 0, bottom: 75 } });
  const panel = node('SECTION', 'schedule', { className: 'schedule-panel' });
  const heading = node('H2', 'schedule heading', { id: 'schedulePanelHeading', tabIndex: -1 });
  const date = node('INPUT', 'date filter', { id: 'scheduleDate' });
  const scope = node('BUTTON', 'selected scope', { dataset: { action: 'schedule-scope', id: 'mine' }, pressed: true });
  append(document, topbar, root); append(root, panel); append(panel, heading, date, scope);
  const ui = { view: 'timeline', timelineMode: 'schedule', scheduleMine: true, actor: 'maya' };
  const queryAll = (selector, container = document) => descendants(container).filter(el => el.matches(selector));
  const ctx = vm.createContext({ document, ui, window: { innerHeight: 800,
    scrollBy: options => calls.push(['scroll window', options.top, options.behavior]) },
    $: (selector, container) => queryAll(selector, container)[0] || null,
    $$: queryAll, restoreNextUpFocus: () => false,
  });
  vm.runInContext(excerpt('  function hiddenByClosedDisclosure(', '  function skipToContent(') +
    excerpt('  function restoreFocus(', '  function sameNextUpPanel('), ctx);
  const row = (name, id, day, attributes = {}) => node('BUTTON', name, { className: 'schedule-row', dataset: { action: 'task', id, scheduleDay: day }, ...attributes });
  const card = (name, id, day, reviewKind, attributes = {}) => node('BUTTON', name, { className: 'schedule-focus-task',
    dataset: { action: reviewKind ? 'review-organizer-item' : 'task', id, scheduleFocusDay: day, ...(reviewKind ? { reviewKind } : {}) }, ...attributes });
  const restore = previous => ctx.restoreScheduleFocus(previous, root);
  return { append, calls, restore, ctx, root, panel, heading, date, scope, ui, row, card };
}

test('Timeline focus leaves an already-visible activity in place and reveals offscreen targets below the sticky header', () => {
  for (const [rect, delta] of [[{ top: 150, bottom: 195 }, 0], [{ top: 56, bottom: 102 }, -358.5],
    [{ top: 780, bottom: 825 }, 365], [{ top: 50, bottom: 750 }, -37.5]]) {
    const f = fixture();
    const current = f.row('arrival', 'arrival', '2026-11-20', { rect });
    f.append(f.panel, current);
    assert.equal(f.restore(f.row('old arrival', 'arrival', '2026-11-20', { isConnected: false })), true);
    assert.deepEqual(f.calls, [['focus', 'arrival', true], ...(delta ? [['scroll window', delta, 'instant']] : [])]);
  }
});

test('an unusually tall activity reveals its beginning rather than centering below the sticky bar', () => {
  const f = fixture();
  const current = f.card('tall card', 'arrival', '2026-11-20', 'completion', { rect: { top: 50, bottom: 850, height: 800 } });
  f.append(f.panel, current);
  assert.equal(f.restore(f.card('old tall card', 'arrival', '2026-11-20', 'completion', { isConnected: false })), true);
  assert.deepEqual(f.calls, [['focus', 'tall card', true], ['scroll window', -33, 'instant']]);
});

test('an overlap summary or edit field scrolls only inside the dialog and stays below its sticky heading', () => {
  const f=fixture(),titleBottom=192;
  f.ctx.$=(selector)=>selector==='.dialog-header'?{getBoundingClientRect:()=>({bottom:titleBottom})}:null;
  vm.runInContext(excerpt('  function focusTaskDialogControl(', '  function timelineOverlapIntent('),f.ctx);
  for(const [top,bottom,expected] of [[230,274,500],[160,204,460],[640,684,542],[150,680,450]]){
    const dialog={scrollTop:500,getBoundingClientRect:()=>({top:120,bottom:650})};
    const target={focus(options){assert.equal(options.preventScroll,true);f.ctx.document.activeElement=this;},
      getBoundingClientRect:()=>({top,bottom,height:bottom-top})};
    f.ctx.focusTaskDialogControl(target,dialog);
    assert.equal(dialog.scrollTop,expected);
  }
  assert.deepEqual(f.calls,[],'the underlying page does not scroll');
});

test('an exact review card wins; a changed review falls back to that activity’s dated row, never another card', () => {
  const f = fixture(), day = '2026-11-20', id = 'arrival';
  const old = f.card('old completion', id, day, 'completion', { isConnected: false });
  const exact = f.card('completion review', id, day, 'completion');
  const changed = f.card('evidence review', id, day, 'amendment');
  const generic = f.card('generic activity card', id, day);
  const current = f.row('dated arrival row', id, day);
  const external = f.card('out of schedule', id, day, 'completion');
  f.append(f.root, external); f.append(f.panel, changed, generic, current, exact);
  assert.equal(f.restore(old), true);
  assert.deepEqual(f.calls.splice(0), [['focus', 'completion review', true]]);
  exact.inert = true;
  assert.equal(f.restore(old), true);
  assert.deepEqual(f.calls, [['focus', 'dated arrival row', true]]);
});

test('teammate review cards with the same task action do not switch to a different kind of review', () => {
  const f=fixture(),day='2026-11-20',id='arrival';
  const review=(name,kind)=>f.card(name,id,day,undefined,{dataset:{action:'task',id,scheduleFocusDay:day,scheduleFocusKind:kind}});
  const otherReview=review('amendment','amendment');
  const current=f.row('dated row',id,day);
  f.append(f.panel,otherReview,current);
  assert.equal(f.restore(review('old completion','completion')),true);
  assert.deepEqual(f.calls,[['focus','dated row',true]]);
});

test('a rebuilt overnight activity prefers the same day, then another date for that activity only', () => {
  const f = fixture(), start = '2026-11-20', later = '2026-11-21';
  const same = f.row('continuation', 'overnight', later), original = f.row('original date', 'overnight', start);
  f.append(f.panel, f.row('unrelated continuation', 'other', later), original, same);
  assert.equal(f.restore(f.row('old continuation', 'overnight', later, { isConnected: false })), true);
  assert.deepEqual(f.calls.splice(0), [['focus', 'continuation', true]]);
  same.hidden = true;
  assert.equal(f.restore(f.card('old overnight review', 'overnight', later, 'completion', { isConnected: false })), true);
  assert.deepEqual(f.calls, [['focus', 'original date', true]]);
});

test('missing work focuses the selected scope or schedule heading, not unrelated controls or date inputs', () => {
  const f = fixture(), previous = f.row('removed activity', 'removed', '2026-11-20', { isConnected: false });
  f.append(f.panel, f.row('different activity', 'different', '2026-11-20'));
  assert.equal(f.restore(previous), true);
  assert.deepEqual(f.calls.splice(0), [['focus', 'selected scope', true]]);
  f.scope.inert = true;
  assert.equal(f.restore(previous), true);
  assert.deepEqual(f.calls.splice(0), [['focus', 'schedule heading', true]]);
  f.ui.view = 'tasks';
  assert.equal(f.restore(previous), false);
  assert.deepEqual(f.calls, []);
});

test('closing a Timeline task dialog restores through the schedule rather than generic task matching', () => {
  const f=fixture(), backdrop={hidden:false,dataset:{},classList:{remove(){}}};
  const dialog={replaceChildren(){}},shell={inert:true},opener=f.card('old review','task','2026-11-20','completion');
  const current=f.row('current dated row','task','2026-11-20');
  f.append(f.panel,current);
  f.ui.lastFocus=opener;
  f.ui.dialogKind='task';
  const query=f.ctx.$;
  Object.assign(f.ctx,{
    store:{},restoreViewFocus:()=>{throw Error('Unexpected generic view matching');},
    restoreFocus:()=>{throw Error('Unexpected generic focus matching');},
    $:(selector,root)=>root?query(selector,root):({'#dialogBackdrop':backdrop,'#dialog':dialog,'#appShell':shell,'#viewRoot':f.root}[selector]||query(selector)),
  });
  f.ctx.document.body={style:{}};
  vm.runInContext(excerpt('  function closeDialog(', '  function openOrganizerReview(')+'closeDialog();',f.ctx);
  assert.deepEqual(f.calls,[['focus','current dated row',true]]);
  assert.equal(f.ui.lastFocus,null);
  assert.equal(shell.inert,false);
});
