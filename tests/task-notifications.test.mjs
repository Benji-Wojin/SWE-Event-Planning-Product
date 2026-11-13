import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';

const browserModule = readFileSync(new URL('../legacy/notifications.cjs', import.meta.url), 'utf8');
const calendar = readFileSync(new URL('../legacy/calendar.js', import.meta.url), 'utf8');
function browser(storage) {
  const window = {};
  Object.defineProperty(window, 'localStorage', { get: () => storage() });
  runInNewContext(calendar, { window });
  runInNewContext(browserModule, { window });
  return window;
}

test('local preference is off by default and saves only an isolated opt-in', async () => {
  const result = await build({entryPoints:['lib/notification-scope.ts'], bundle:true, write:false, platform:'node', format:'esm'});
  const { notificationScope } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
  const account = 'google:fictional-account';
  const project = 'p_fictional';
  const scope = notificationScope(account, project);
  const anotherAccount = notificationScope('google:fictional-other', project);
  const anotherProject = notificationScope(account, 'p_other');
  assert.equal(notificationScope(account, project), scope);
  assert.equal(new Set([scope, anotherAccount, anotherProject]).size, 3);
  assert.match(scope, /^[a-f0-9]{64}$/);
  const values = new Map();
  const storage = {getItem: key => values.get(key), setItem: (key,value) => values.set(key,value), removeItem: key => values.delete(key)};
  const api = browser(() => storage).WeftNotifications;
  assert.equal(api.readReminderPreference(scope), false);
  assert.equal(api.writeReminderPreference(scope, true), true);
  assert.deepEqual([...values], [['weft-task-reminders:v1:' + scope, '1']]);
  assert.equal(browser(() => storage).WeftNotifications.readReminderPreference(scope), true);
  assert.equal(api.readReminderPreference(anotherAccount), false);
  assert.equal(api.readReminderPreference(anotherProject), false);
  assert.equal(api.writeReminderPreference(scope, false), true);
  assert.equal(values.size, 0);
  assert.equal(api.writeReminderPreference(account, true), false);
  assert.equal(values.size, 0);
});

test('unavailable browser storage fails closed and never claims a save', () => {
  const api = browser(() => { throw new Error('Storage unavailable'); }).WeftNotifications;
  const scope = 'b'.repeat(64);
  assert.equal(api.readReminderPreference(scope), false);
  assert.equal(api.writeReminderPreference(scope, true), false);
  assert.equal(api.writeReminderPreference(scope, false), false);
});

test('due reminders reflect only this account’s open assignments and the project calendar day', () => {
  const { GatherCalendar, WeftNotifications } = browser(() => null);
  const now = Date.parse('2026-11-12T05:30:00Z');
  const task = (id, dueDate, extra = {}) => ({ id, title: id, owner:'jack', status:'todo', dueDate, note:'unrelated task content', ...extra });
  const tasks = [
    task('tomorrow','2026-11-12'),
    task('today','2026-11-11'),
    task('other-account','2026-11-10',{owner:'maya'}),
    task('done','2026-11-10',{status:'done'}),
    task('no-date',''),
    task('blocked','2026-11-09',{status:'blocked'}),
    task('reported','2026-11-10',{reportedAt:'2026-11-10T00:00:00Z',requiresVerification:true}),
    task('archived','2026-11-10',{archivedAt:'2026-11-10T00:00:00Z'}),
  ];
  const pacific = GatherCalendar.dayKey(now, 'America/Los_Angeles');
  assert.equal(pacific, '2026-11-11');
  assert.deepEqual(JSON.parse(JSON.stringify(WeftNotifications.taskReminders(tasks, 'jack', pacific))), [
    { id:'blocked', title:'blocked', dueDate:'2026-11-09', overdue:true },
    { id:'today', title:'today', dueDate:'2026-11-11', overdue:false },
  ]);
  assert.deepEqual(Array.from(WeftNotifications.taskReminders(tasks, 'maya', pacific), r => r.id), ['other-account']);
  const nextDay = GatherCalendar.dayKey(now, 'America/New_York');
  assert.equal(nextDay, '2026-11-12');
  assert.deepEqual(Array.from(WeftNotifications.taskReminders(tasks, 'jack', nextDay), r => [r.id,r.overdue]), [
    ['blocked',true], ['today',true], ['tomorrow',false],
  ]);
});

test('returned completion reminders take precedence over due reminders and expose only the task identity', () => {
  const { WeftNotifications } = browser(() => { throw new Error('Projection must not access storage'); });
  const today='2026-11-12',review={at:'2026-11-11T00:00:00Z',note:'FICTIONAL_PRIVATE_REVIEW_REASON'};
  const task=(id,dueDate,extra={})=>({id,title:'Fictional '+id,owner:'maya',status:'progress',dueDate,note:'FICTIONAL_PRIVATE_TASK_NOTE',requiresVerification:true,...extra});
  const returned=(id,dueDate,extra)=>task(id,dueDate,{completionReview:review,...extra});
  const tasks=[
    task('ordinary-due','2026-11-10'),
    returned('future','2026-11-15'),
    returned('undated',''),
    returned('overdue','2026-11-09',{status:'blocked'}),
    returned('other-owner','2026-11-09',{owner:'dev'}),
    returned('done','2026-11-09',{status:'done'}),
    returned('archived','2026-11-09',{archivedAt:'2026-11-11T00:00:00Z'}),
    returned('resubmitted','2026-11-09',{reportedAt:'2026-11-12T00:00:00Z'}),
  ];
  const before=structuredClone(tasks);
  const project=(actor,date)=>JSON.parse(JSON.stringify(WeftNotifications.taskReminders(tasks,actor,date)));
  const expectedChanges=['future','overdue','undated'].map(id=>({id,title:'Fictional '+id,kind:'completion-changes'}));
  const reminders=project('maya',today);
  assert.deepEqual(reminders.slice(0,-1).sort((a,b)=>a.id.localeCompare(b.id)),expectedChanges);
  assert.deepEqual(reminders.at(-1),{id:'ordinary-due',title:'Fictional ordinary-due',dueDate:'2026-11-10',overdue:true});
  assert.equal(new Set(reminders.map(item=>item.id)).size,reminders.length);
  assert.deepEqual(project('maya','not-a-calendar-date').sort((a,b)=>a.id.localeCompare(b.id)),expectedChanges);
  assert.deepEqual(project('dev',today),[{id:'other-owner',title:'Fictional other-owner',kind:'completion-changes'}]);
  assert.deepEqual(project('',today),[]);
  assert.deepEqual(tasks,before);
});

test('the real notification dialog labels and links returned work without exposing feedback, and honors opt-out', () => {
  const app=readFileSync(new URL('../legacy/app.js',import.meta.url),'utf8');
  const scope='c'.repeat(64),local=new Map(),writes=[];
  const window=browser(()=>({getItem:key=>local.get(key),setItem:(key,value)=>{writes.push('set');local.set(key,value);},removeItem:key=>{writes.push('remove');local.delete(key);}}));
  window.GatherMode={demo:false};
  const due='2026-11-12';
  const tasks=[
    {id:'revision',owner:'maya',status:'progress',title:'Fictional <b>revision & recheck</b>',completionReview:{note:'FICTIONAL_PRIVATE_FEEDBACK'},note:'FICTIONAL_PRIVATE_PRIOR_REPORT'},
    {id:'ordinary',owner:'maya',status:'progress',title:'Fictional due work',dueDate:due},
    {id:'other',owner:'dev',status:'progress',title:'Fictional other-owner work',dueDate:due,completionReview:{note:'FICTIONAL_OTHER_FEEDBACK'}},
  ];
  const document={activeElement:null,createElement:()=>({get content(){return this.innerHTML;}})};
  const focus=node=>{document.activeElement=node;};
  const button={setAttribute(name,value){this[name]=value;}},count={},toggle={focus(){focus(this);}},status={};
  const list={innerHTML:'',rows:[],contains(node){return this.rows.includes(node);},replaceChildren(content){
    this.innerHTML=content;
    this.rows=[...content.matchAll(/<button\b([^>]+)>/g)].map(([,attributes])=>({
      dataset:{action:attributes.match(/data-action="([^"]+)"/)?.[1],id:attributes.match(/data-id="([^"]+)"/)?.[1]},
      hasAttribute:name=>attributes.includes(' '+name),focus(){focus(this);},
    }));
  }};
  const selectors={'#notificationButton':button,'[data-notification-count]':count,'[data-notification-items]':list,'[data-action="toggle-task-reminders"]':toggle,'.notification-status':status};
  const ui={actor:'maya'},dialog={};
  const testApi=runInNewContext(app.match(/^  const h = .*;$/m)[0]+app.slice(app.indexOf('  function reminderScope('),app.indexOf('  function captureScheduleDateDraft('))+'\n({paintNotifications,showNotifications,toggleTaskReminders})',{
    window,ui,$:selector=>selectors[selector],dateKey:()=>due,dayLabel:value=>value,
    store:{getState:()=>({tasks}),getReminderScope:()=>scope},
    document,focusable:node=>node.rows,
    openDialog:(title,body,_footer,_wide,kind)=>{dialog.title=title;dialog.body=body;ui.dialogKind=kind;},
  });
  testApi.showNotifications();
  assert.equal(dialog.title,'Notifications');
  assert.match(dialog.body,/returned completion reports/);
  assert.match(dialog.body,/No email or push/);
  assert.equal(button.hidden,false);
  assert.equal(count.hidden,true);
  assert.equal(button['aria-label'],'Notifications');
  assert.match(list.innerHTML,/Task reminders are off/);
  assert.doesNotMatch(list.innerHTML,/review-returned-completion|revision|due work/);
  assert.deepEqual(writes,[]);

  testApi.toggleTaskReminders();
  assert.equal(count.hidden,false);
  assert.equal(count.textContent,'2');
  assert.equal(button['aria-label'],'Notifications, 2 task reminders');
  assert.match(list.innerHTML,/data-action="review-returned-completion"[^>]*data-id="revision"/);
  assert.match(list.innerHTML,/data-action="task"[^>]*data-id="ordinary"/);
  assert.match(list.innerHTML,/Completion changes requested/);
  assert.match(list.innerHTML,/Due today/);
  assert.match(list.innerHTML,/Fictional &lt;b&gt;revision &amp; recheck&lt;\/b&gt;/);
  assert.doesNotMatch(list.innerHTML,/<b>|FICTIONAL_PRIVATE_|FICTIONAL_OTHER_|other-owner work/);
  assert.deepEqual(writes,['set']);

  const dueRow=list.rows.find(row=>row.dataset.id==='ordinary');
  dueRow.focus();
  tasks[1].completionReview={note:'FICTIONAL_NEW_FEEDBACK'};
  testApi.paintNotifications();
  assert.notEqual(document.activeElement,dueRow);
  assert.equal(document.activeElement,list.rows.find(row=>row.dataset.id==='ordinary'));
  assert.equal(document.activeElement.dataset.action,'review-returned-completion');
  tasks[1].reportedAt='2026-11-12T12:00:00Z';
  tasks[1].requiresVerification=true;
  testApi.paintNotifications();
  assert.equal(document.activeElement,toggle,'removed reminder returns focus to settings');
  assert.equal(count.textContent,'1');
  assert.deepEqual(writes,['set']);

  testApi.toggleTaskReminders();
  assert.match(list.innerHTML,/Task reminders are off/);
  assert.doesNotMatch(list.innerHTML,/data-action=/);
  assert.equal(count.hidden,true);
  assert.deepEqual(writes,['set','remove']);
  assert.equal(local.size,0);
});
