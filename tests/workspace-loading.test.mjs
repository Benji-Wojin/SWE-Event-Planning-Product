import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import '../legacy/navigation.js';

const source = readFileSync('legacy/hosted-store.js', 'utf8');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const state = { state: { event: {} }, identity: { actorId: 'jack', role: 'admin' }, projectId: 'new-project', demo: false, revision: 1, suggestions: [], exportState: {} };
function element(tag) {
  return { tag, hidden: false, style: {}, attributes: {}, children: [], listeners: {},
    setAttribute(k, v) { this.attributes[k] = v; },
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
  };
}
function start(response, { oldDocument = false, demo = false, search } = {}) {
  const boot = element('main'), shell = element('div'), body = element('body'), listeners = {};
  shell.hidden = !oldDocument;boot.attributes['aria-busy'] = 'true';
  body.classList = { toggle() {} };
  body.insertBefore = node => body.children.unshift(node);
  let reloads = 0, redirect;
  const inviteLabel = element('span');inviteLabel.textContent = 'Invitation draft';
  const document = {
    getElementById: id => id === 'workspaceBoot' ? oldDocument ? null : boot : shell,
    querySelectorAll: () => [], querySelector: selector => selector === '[data-invite-label]' ? inviteLabel : null, createElement: element, body,
  };
  const window = { GatherNavigation, top: { location: { replace(value) { redirect = value; } } }, addEventListener(type, fn) { listeners[type] = fn; } };
  const requests=[];
  const run = vm.runInNewContext(source, { window, document,
    location: { search: search ?? (demo ? '?demo=1&as=jack' : '?project=new-project'), origin: 'https://weft.example', reload() { reloads++; } },
    URL, URLSearchParams, structuredClone, fetch: (path,options) => { requests.push(path); return typeof response==='function'?response(options):response; },
  });
  return { boot: oldDocument ? body.children[0] : boot, shell, body, window, run, listeners,
    inviteLabel, requests, reloads: () => reloads, redirect: () => redirect };
}
const success = value => ({ ok: true, status: 200, json: async () => value });
const text = node => [node.textContent || '', ...node.children.map(text)].join(' ');

test('iframe reauthentication keeps only a valid real-project task review hint',async()=>{
  for(const [search,expected] of [
    ['?project=school&task=task-123&review=completion&guide=1&day=2032-02-29','/project?day=2032-02-29&guide=1&task=task-123&review=completion&project=school'],
    ['?project=school&task=task-123&review=amendment&review=completion','/project?task=task-123&project=school'],
    ['?project=school&review=completion','/project?project=school'],
    ['?demo=1&as=jack&task=task-123&review=amendment','/demo?as=jack&task=task-123'],
  ]){
    const {run,window,requests}=start({ok:false,status:401,json:async()=>({error:'Sign in again'})},{search});
    await run;
    const returnTo=new URL(window.top.location.href,'https://weft.example').searchParams.get('return_to');
    assert.equal(returnTo,expected);
    assert.equal(requests.length,1);
    assert.doesNotMatch(requests[0],/review=|task=/);
  }
});

test('prepared hosted HTML shows loading instead of demo identity or interactive shell', () => {
  execFileSync(process.execPath, ['scripts/prepare.mjs']);
  const html = readFileSync('public/workspace.html', 'utf8');
  assert.match(html, /id="workspaceBoot"[^>]+aria-busy="true"/);
  assert.match(html, /<p role="status">Loading project…<\/p>/);
  assert.match(html, /id="appShell" hidden/);
  assert.doesNotMatch(html, /Field Day 2026|event-symbol">FD/);
  assert.match(readFileSync('legacy/styles.css', 'utf8'), /\[hidden\]\{display:none!important\}/);
  const app = readFileSync('public/gather-assets/app.js', 'utf8');
  const initial=app.indexOf("navigate(initialTask?'tasks':navigation.initial());");
  const ready=app.indexOf("new Event('gather-workspace-ready')");
  const refresh=app.indexOf('if(window.GatherMode&&store.refresh)bindWorkspaceRefresh();');
  assert.ok(initial>=0&&initial<ready);
  assert.ok(ready<refresh,'the generated app starts refresh after rendering the authenticated workspace');
  assert.match(app,/function bindWorkspaceRefresh\(\)/);
});

function preparedRefresh(demo=false) {
  const app=readFileSync('public/gather-assets/app.js','utf8');
  const source=app.slice(app.indexOf('  async function refreshInbox('),app.indexOf('  let privateOriginalEpoch='));
  const events={},timers=new Map(),calls=[];
  const window={GatherMode:{demo},addEventListener(name,fn){events[name]=fn;}};
  const document={hidden:false,activeElement:null,addEventListener(name,fn){events[name]=fn;}};
  const ui={view:'tasks'},busyRunSheetRevisions=new Set();
  const backdrop={hidden:true}, notice={hidden:true}, inboxNotice={hidden:true};
  const store={async refresh(canApply){calls.push('request');return result|| (canApply()?{changed:true,suggestionsChanged:true}:{pending:true});}};
  let result;
  let next=0;
  vm.runInNewContext(source+'\nbindWorkspaceRefresh();',{
    store,ui,window,document,busyRunSheetRevisions,recoveryConflictPending:()=>false,showPendingUpdate(){calls.push('pending');},
    render(){calls.push('render');},paintNotifications(){calls.push('notifications');},
    refreshSuggestionSurfaces(){calls.push('suggestions');},toast(){calls.push('toast');},
    $:selector=>({'#dialogBackdrop':backdrop,'#workspaceSyncNotice':notice,'#inboxSyncNotice':inboxNotice})[selector],
    setInterval(callback,ms){const id=next++;timers.set(id,{callback,ms});return id;},
    clearInterval(id){timers.delete(id);},
  });
  return {events,timers,calls,window,document,ui,backdrop,notice,busyRunSheetRevisions,snapshotResult:value=>{result=value;}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('the generated refresh lifecycle fetches on focus, visible return, and its existing timer, without double polling after restore',async()=>{
  for(const demo of [false,true]){
    const {events,timers,calls,document}=preparedRefresh(demo);
    const [timer]=timers.values();
    assert.equal(timer.ms,demo?4000:20000);
    timer.callback();await tick();
    assert.deepEqual(calls.splice(0),['request','render','suggestions']);
    document.hidden=true;events.visibilitychange();events.focus();timer.callback();await tick();
    assert.deepEqual(calls,[]);
    document.hidden=false;events.visibilitychange();events.focus();await tick();
    assert.deepEqual(calls.splice(0),['request','render','suggestions'],'overlapping return events should share the in-flight refresh');
    events.pagehide();assert.equal(timers.size,0);
    events.pageshow({persisted:false});assert.equal(timers.size,0);
    events.pageshow({persisted:true});events.pageshow({persisted:true});await tick();
    assert.equal(timers.size,1);
    assert.deepEqual(calls,['request','render','suggestions']);
  }
});

test('restored passive refresh keeps edits intact and stops after access changes',async()=>{
  const {events,calls,window,document,ui,backdrop,notice,busyRunSheetRevisions}=preparedRefresh();
  backdrop.hidden=false;ui.dialogKind='task';
  events.focus();await tick();
  assert.deepEqual(calls.splice(0),['request','pending']);
  assert.equal(notice.hidden,false);
  backdrop.hidden=true;ui.reviewDirty=true;
  events['gather-tool-updated']();
  assert.deepEqual(calls.splice(0),['pending']);
  ui.reviewDirty=false;ui.pendingSave=true;
  events.focus();await tick();
  assert.deepEqual(calls,[]);
  ui.pendingSave=false;document.activeElement={matches:()=>true};
  events.focus();await tick();
  assert.deepEqual(calls.splice(0),['request','pending']);
  document.activeElement=null;events.focus();await tick();
  assert.deepEqual(calls.splice(0),['request','render','suggestions']);
  assert.equal(notice.hidden,true);
  events['gather-tool-updated']();
  assert.deepEqual(calls.splice(0),['render','suggestions']);
  ui.runSheet={revision:1};busyRunSheetRevisions.add(1);
  events.focus();await tick();
  assert.deepEqual(calls,[],'a passive read must not supersede an explicit run-sheet read');
  busyRunSheetRevisions.clear();ui.runSheet=null;
  window.GatherAccessLost=true;
  events.focus();events['gather-tool-updated']();await tick();
  assert.deepEqual(calls,[]);
});

test('a deferred tool render waits for edits even if the server already has the same revision',async()=>{
  const {events,calls,ui,backdrop,notice,snapshotResult}=preparedRefresh();
  snapshotResult({changed:false});
  backdrop.hidden=false;ui.dialogKind='task';
  events['gather-tool-updated']();
  assert.deepEqual(calls.splice(0),['pending']);
  events.focus();await tick();
  assert.deepEqual(calls.splice(0),['request','pending']);
  assert.equal(notice.hidden,false);
  backdrop.hidden=true;
  events.focus();await tick();
  assert.deepEqual(calls.splice(0),['request','render','suggestions']);
  assert.equal(notice.hidden,true);
  events.focus();await tick();
  assert.deepEqual(calls,['request'],'the deferred render happens only once');
});

test('open notifications allow normal refresh and drain a deferred tool update without closing the dialog',async()=>{
  const {events,calls,ui,document,backdrop,notice,snapshotResult}=preparedRefresh();
  backdrop.hidden=false;ui.dialogKind='notifications';
  const focusedReminder={matches:()=>false};
  document.activeElement=focusedReminder;
  events.focus();await tick();
  assert.deepEqual(calls.splice(0),['request','render','suggestions']);
  assert.equal(ui.dialogKind,'notifications');assert.equal(backdrop.hidden,false);
  assert.equal(notice.hidden,true);
  assert.equal(document.activeElement,focusedReminder);
  events['gather-tool-updated']();
  assert.deepEqual(calls.splice(0),['render','suggestions']);

  ui.reviewDirty=true;
  events['gather-tool-updated']();
  assert.deepEqual(calls.splice(0),['pending'],'notifications do not override a dirty review guard');
  assert.equal(ui.toolUpdatePending,true);
  ui.reviewDirty=false;snapshotResult({changed:false});
  events.focus();await tick();
  assert.deepEqual(calls.splice(0),['request','render','suggestions']);
  assert.equal(ui.toolUpdatePending,false);
  assert.equal(notice.hidden,true);
  events.focus();await tick();
  assert.deepEqual(calls.splice(0),['request'],'no extra repaint on an unchanged snapshot');
  assert.equal(ui.dialogKind,'notifications');assert.equal(backdrop.hidden,false);
});

test('shared updates repaint reminders on Private details without rebuilding the private view',async()=>{
  const {events,calls,ui,backdrop,notice}=preparedRefresh();
  ui.view='details';backdrop.hidden=false;ui.dialogKind='notifications';
  events.focus();await tick();
  assert.deepEqual(calls.splice(0),['request','notifications','suggestions']);
  assert.equal(ui.view,'details');assert.equal(ui.dialogKind,'notifications');
  assert.equal(backdrop.hidden,false);assert.equal(notice.hidden,true);
  events['gather-tool-updated']();
  assert.deepEqual(calls.splice(0),['notifications','suggestions']);

  ui.dialogKind='guest-agenda';
  events.focus();await tick();
  assert.deepEqual(calls.splice(0),['request','pending'],'a different open dialog still blocks applying the snapshot');
  events['gather-tool-updated']();
  assert.deepEqual(calls.splice(0),['pending']);
  assert.equal(ui.view,'details');assert.equal(backdrop.hidden,false);
});

test('slow snapshot and app download keep shell hidden until initial render completes', async () => {
  const pending = deferred(), h = start(pending.promise);
  assert.equal(h.shell.hidden, true);assert.equal(h.boot.hidden, false);
  pending.resolve(success(state));await h.run;
  const script = h.body.children.find(node => node.tag === 'script');assert.ok(script);
  assert.equal(h.shell.hidden, true, 'Fetching state alone is not a rendered workspace');
  h.listeners['gather-workspace-ready']();script.onload();
  assert.equal(h.shell.hidden, false);assert.equal(h.boot.hidden, true);
  assert.equal(h.boot.attributes['aria-busy'], 'false');
});

test('failed initial request shows escaped retry information without revealing shell', async () => {
  const h = start(Promise.resolve({ ok: false, status: 503, json: async () => ({ error: '<img src=x onerror=alert(1)>' }) }));
  await h.run;
  assert.equal(h.shell.hidden, true);assert.equal(h.boot.hidden, false);
  assert.equal(h.boot.attributes['aria-busy'], 'false');
  assert.match(text(h.boot), /Your plan could not be loaded/);
  const detail = h.boot.children[1];assert.equal(detail.textContent, '<img src=x onerror=alert(1)>');assert.equal(detail.innerHTML, undefined);
  const actions = h.boot.children[2].children;
  assert.equal(actions[1].href, '/');assert.match(actions[2].href, /return_to=/);
  actions[0].listeners.click();assert.equal(h.reloads(), 1);
  assert.equal(h.body.children.some(node => node.tag === 'script'), false);
});

test('failed app download or initialization gives a working retry screen', async () => {
  for (const event of ['onerror', 'onload']) {
    const h = start(Promise.resolve(success(state)));await h.run;
    h.body.children.find(node => node.tag === 'script')[event]();
    assert.equal(h.shell.hidden, true);assert.equal(h.boot.hidden, false);
    assert.match(text(h.boot), /Your plan could not be loaded/);
    h.boot.children[2].children[0].listeners.click();assert.equal(h.reloads(), 1);
  }
});

test('older open documents receive a loading screen and setup redirects never reveal shell', async () => {
  const old = start(Promise.resolve(success(state)), { oldDocument: true });await old.run;
  assert.match(text(old.boot), /Loading project/);assert.equal(old.shell.hidden, true);
  assert.ok(old.boot.children.some(node => node.tag === 'a' && node.href === '/' && node.target === '_top'), 'fallback loading screen has a Projects escape link');
  old.listeners['gather-workspace-ready']();assert.equal(old.shell.hidden, false);assert.equal(old.boot.hidden, true);
  const h = start(Promise.resolve(success({ ...state, setupRequired: true })));await h.run;
  assert.equal(h.redirect(), '/setup?project=new-project');assert.equal(h.shell.hidden, true);
  assert.equal(h.body.children.some(node => node.tag === 'script'), false);
});

test('sign-in retry keeps one valid day but never includes it in workspace API requests',async()=>{
  for(const [search,expected] of [
    ['?project=new-project&day=2032-02-29','2032-02-29'],
    ['?project=new-project&day=2032-02-30',null],
    ['?project=new-project&day=2032-02-29&day=2032-03-01',null],
  ]){
    const fixture=start(Promise.resolve({ok:false,status:401,json:async()=>({error:'Sign-in required'})}),{search});
    await fixture.run;
    const url=new URL(fixture.window.top.location.href,'https://weft.example');
    assert.equal(url.pathname,'/sign-in');
    const target=new URL(url.searchParams.get('return_to'),'https://weft.example');
    assert.equal(target.pathname,'/project');
    assert.equal(target.searchParams.get('project'),'new-project');
    assert.equal(target.searchParams.get('day'),expected);
    assert.deepEqual(fixture.requests,['/api/workspace?project=new-project']);
  }
});

test('a snapshot confirmation is a read-only check and never replaces the displayed workspace',async()=>{
  let checks=0;
  const fixture=start({ok:true,status:200,json:async()=>({...state,revision:++checks>2?2:1})});
  await fixture.run;
  const store=fixture.window.GatherStore.createStore();
  const newer=[];
  const record=revision=>newer.push(revision);
  assert.equal(store.getSnapshotRevision(),1);
  assert.equal(await store.confirmSnapshotRevision(0,record),false);
  assert.equal(checks,1);
  assert.equal(await store.confirmSnapshotRevision(1,record),true);
  assert.equal(await store.confirmSnapshotRevision(1,record),false);
  assert.deepEqual(newer,[1,2]);
  const pending=await store.refresh(()=>false);
  assert.equal(pending.pending,true);
  assert.equal(pending.newerRevision,2);
  assert.equal(store.getSnapshotRevision(),1);
  assert.deepEqual(fixture.requests,Array(4).fill('/api/workspace?project=new-project'));
});

test('a concurrent failed save makes confirmation inconclusive without reporting a newer revision',async()=>{
  const read=deferred(),started=deferred();
  let reads=0;
  const fixture=start(options=>{
    if(options.method==='POST')return {ok:false,status:400,json:async()=>({error:'Fictional save rejected'})};
    if(++reads===2){started.resolve();return read.promise;}
    return success(state);
  });
  await fixture.run;
  const store=fixture.window.GatherStore.createStore(),newer=[];
  const checking=store.confirmSnapshotRevision(1,value=>newer.push(value));
  await started.promise;
  await assert.rejects(store.addTask({title:'Fictional change'}),/Fictional save rejected/);
  read.resolve(success(state));
  assert.equal(await checking,false);
  assert.deepEqual(newer,[]);
  assert.equal(await store.confirmSnapshotRevision(1),true);
});

test('invite label matches hosted navigation while demo remains explicitly simulated', async () => {
  const hosted = start(Promise.resolve(success(state)));await hosted.run;
  assert.equal(hosted.inviteLabel.textContent, 'Invite people');
  const demo = start(Promise.resolve(success({...state,demo:true})),{demo:true});await demo.run;
  assert.equal(demo.inviteLabel.textContent, 'Invitation draft');
  const app=readFileSync('legacy/app.js','utf8');
  const action=app.slice(app.indexOf("if(action==='invite')"),app.indexOf("if(action==='copy-invite')"));
  assert.ok(action.indexOf("projectUrl('/team');return;") < action.indexOf("openDialog('Invitation draft'"));
  assert.match(readFileSync('legacy/styles.css','utf8'),/\.participant \[data-action="invite"\]/);
});
