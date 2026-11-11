import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/store.js';
import '../legacy/planning-ui.js';
const {graph,readiness,graphMarkup}=GatherPlanningUI;
const make=(id,dependencies=[],status='todo')=>({id,title:id,category:'Program',status,dependencies});
const link=(taskId,kind='dependency')=>({taskId,kind});

test('sidebar accepts only its exact same-origin frame and validates message fields',()=>{
  const source={},frame={contentWindow:source},origin='https://example.com';
  const message=(data,extra={})=>GatherPlanningUI.sidebarMessage({source,origin,data:{type:'weft-plan-sidebar',...data},...extra},frame,origin);
  assert.equal(message({event:'applied'},{source:{}}),null);
  assert.equal(message({event:'applied'},{origin:'https://other.example'}),null);
  assert.equal(message({event:'state',dirty:'true',busy:false}),null);
  assert.equal(message({event:'height',height:Infinity}),null);
  assert.equal(message({event:'height',height:-30}).height,240);
  assert.equal(message({event:'height',height:9000}).height,1600);
  assert.equal(message({event:'state',dirty:true,busy:false}).dirty,true);
  assert.equal(message({event:'generate'}),null,'messages cannot request provider or database mutations');
});
test('Ask Weft popup retains its frame and draft state across close/reopen; background feed never blocks navigation',()=>{
  const elements=new Map(),listeners=[],created=[];let applied=0;
  const element=tag=>({tag,style:{},dataset:{},contentWindow:{postMessage(){}},children:[],append(...children){this.children.push(...children);for(const child of children)if(child.id)elements.set(child.id,child);},setAttribute(){},showModal(){this.open=true;},close(){this.open=false;}});
  const slot=element('div');elements.set('planningSidebarSlot',slot);
  const context=vm.createContext({location:{origin:'https://example.com'},document:{body:element('body'),getElementById:id=>elements.get(id),createElement:tag=>{const e=element(tag);created.push(e);return e;}},window:{addEventListener:(type,fn)=>{if(type==='message')listeners.push(fn);},confirm:()=>{throw Error('Background checks must not ask to navigate.');}}});
  vm.runInContext(readFileSync('legacy/planning-ui.js','utf8'),context);
  const popup=context.GatherPlanningUI.createAgentPopup({getUrl:()=>'/plan?mode=assistant',onApplied:()=>applied++});popup.open();const dialog=created.find(e=>e.tag==='dialog'),frame=created.find(e=>e.tag==='iframe');dialog.close();popup.open();assert.equal(created.filter(e=>e.tag==='iframe').length,1);assert.equal(dialog.open,true);
  listeners[0]({origin:'https://wrong.example',source:frame.contentWindow,data:{type:'weft-plan-sidebar',event:'state',dirty:true,busy:true}});assert.equal(popup.unsaved(),false);
  listeners[0]({origin:'https://example.com',source:frame.contentWindow,data:{type:'weft-plan-sidebar',event:'state',dirty:true,busy:false}});assert.equal(popup.unsaved(),true);
  listeners[0]({origin:'https://example.com',source:frame.contentWindow,data:{type:'weft-plan-sidebar',event:'applied'}});assert.equal(applied,1);
  const sidebar=context.GatherPlanningUI.createSidebar({getUrl:()=>'/plan?mode=suggestions',notify(){throw Error('Must not block');},onApplied(){}});sidebar.open('suggestions',true);
  const feed=elements.get('planningSidebarFrame');listeners[1]({origin:'https://example.com',source:feed.contentWindow,data:{type:'weft-plan-sidebar',event:'state',dirty:false,busy:true}});assert.equal(sidebar.canLeave(),true);assert.equal(sidebar.unsaved(),false);
});

test('sidebar hide/reopen keeps one review frame and guards unsaved or in-flight navigation',()=>{
  const elements=new Map(),listeners={},notifications=[];let applied=0,confirmations=0,allow=false,appended=0;
  const button={focus(){}},actions={hidden:false,querySelector:()=>button};
  elements.set('planningSidebarActions',actions);
  const slot={hidden:true,querySelector:()=>button,append(frame){elements.set(frame.id,frame);appended++;}};
  elements.set('planningSidebarSlot',slot);
  const context=vm.createContext({location:{origin:'https://example.com'},document:{getElementById:id=>elements.get(id),createElement:()=>({style:{},dataset:{},contentWindow:{},remove(){elements.delete(this.id);}})},window:{addEventListener:(type,fn)=>listeners[type]=fn,confirm:()=>{confirmations++;return allow;}}});
  vm.runInContext(readFileSync('legacy/planning-ui.js','utf8'),context);
  const sidebar=context.GatherPlanningUI.createSidebar({getUrl:()=>'/plan?project=one&mode=suggestions&embed=1',onApplied:()=>applied++,notify:value=>notifications.push(value)});
  sidebar.open();const frame=elements.get('planningSidebarFrame');
  assert.match(frame.src,/project=one/);assert.equal(actions.hidden,true);
  const send=data=>listeners.message({origin:'https://example.com',source:frame.contentWindow,data:{type:'weft-plan-sidebar',...data}});
  send({event:'state',dirty:true,busy:false});assert.equal(sidebar.unsaved(),true);
  assert.equal(sidebar.canLeave(),false);assert.equal(confirmations,1);
  sidebar.hide();sidebar.open();assert.equal(appended,1,'hide and reopen must not restart or discard the review');
  send({event:'state',dirty:false,busy:true});assert.equal(sidebar.canLeave(),false);assert.equal(confirmations,1);assert.equal(notifications.length,1);
  send({event:'applied'});assert.equal(applied,1);
  send({event:'state',dirty:true,busy:false});allow=true;assert.equal(sidebar.canLeave(),true);
  sidebar.reset();assert.equal(sidebar.unsaved(),false);
  sidebar.open('assistant');assert.equal(appended,2);const assistantFrame=elements.get('planningSidebarFrame');
  assert.equal(assistantFrame.dataset.mode,'assistant');assert.equal(assistantFrame.title,'Create tasks with Weft');
  send({event:'applied'});assert.equal(applied,1,'messages from the replaced frame are ignored');
  listeners.message({origin:'https://example.com',source:assistantFrame.contentWindow,data:{type:'weft-plan-sidebar',event:'state',dirty:true,busy:false}});
  allow=false;sidebar.open('suggestions');assert.equal(elements.get('planningSidebarFrame'),assistantFrame,'switching tools guards unsaved chat input');
});

test('workspace navigation keeps the suggestions document mounted and hides it accessibly',()=>{
  const elements=new Map();
  const node=()=>({children:[],dataset:{},style:{},hidden:false,inert:false,
    contains(child){return child===this||this.children.some(n=>n.contains?.(child));},
    append(...children){this.children.push(...children);for(const child of children)if(child.id)elements.set(child.id,child);},
    replaceChildren(...children){this.children=children;},
    set innerHTML(markup){this.markup=markup;this.children=[];},get innerHTML(){return this.markup||'';},
    querySelector(){return null;},
  });
  const root=node(),slot=node();elements.set('planningSidebarSlot',slot);
  const context=vm.createContext({location:{origin:'https://example.com'},
    document:{getElementById:id=>elements.get(id),createElement:tag=>tag==='template'?{content:{querySelector:()=>null}}:node()},
    window:{addEventListener(){},confirm(){throw Error('No automatic-feed confirmation');}}});
  vm.runInContext(readFileSync('legacy/planning-ui.js','utf8'),context);
  const sidebar=context.GatherPlanningUI.createSidebar({getUrl:()=>'/plan?mode=suggestions&embed=1',onApplied(){},notify(){}});
  sidebar.render(root,'Overview','overview');
  const [overview,other]=root.children;overview.append(slot);
  sidebar.open('suggestions',true);const frame=elements.get('planningSidebarFrame');
  assert.ok(root.contains(frame));
  sidebar.render(root,'Tasks','tasks');
  assert.ok(root.contains(frame),'the iframe is not detached or reparented');
  assert.equal(overview.hidden,true);assert.equal(overview.inert,true);
  assert.equal(other.hidden,false);assert.equal(other.inert,false);
  sidebar.render(root,'Overview refreshed','overview');
  assert.equal(root.children[0],overview);assert.equal(elements.get('planningSidebarFrame'),frame);
  assert.ok(root.contains(frame));assert.equal(overview.hidden,false);assert.equal(overview.inert,false);
  assert.equal(other.hidden,true);assert.equal(other.inert,true);assert.equal(other.children.length,0);
  assert.equal(sidebar.canLeave(),true);
  const source=readFileSync('legacy/app.js','utf8');
  assert.match(source,/if\(window.GatherMode&&isOrganizer\(\)\)planSidebar\.render\(\$\('#viewRoot'\),markup,ui.view\)/);
});

test('map places prerequisites before dependents and represents shared parents once',()=>{
  const tasks=[make('quote'),make('deposit',[link('quote')]),make('program',[link('quote')]),make('open',[link('deposit'),link('program')])];
  const map=graph(tasks);
  assert.equal(map.nodes.length,4);assert.equal(map.edges.length,4);
  assert.ok(map.positions.get('quote').x<map.positions.get('deposit').x);
  assert.ok(map.positions.get('deposit').x<map.positions.get('open').x);
  assert.equal(map.cycles,false);
});
test('related links never gate readiness or force a required sequence',()=>{
  const tasks=[make('menu'),make('invites',[link('menu','related')])];
  assert.equal(readiness(tasks[1],tasks).open.length,0);
  assert.equal(readiness(tasks[1],tasks).related.length,1);
  const map=graph(tasks);assert.equal(map.positions.get('menu').x,map.positions.get('invites').x);
  assert.match(graphMarkup(tasks,tasks),/map-edge-related/);
  tasks[0].owner='maya';assert.match(graphMarkup(tasks,tasks,'',[{id:'maya',name:'Maya Example'}]),/Maya Example/);
});
test('link map aligns paired tasks and separates unrelated groups even with interleaved input',()=>{
  const tasks=[make('solo'),make('a'),make('b'),make('b-next',[link('b')]),make('a-next',[link('a')]),make('a-related',[link('a','related')])];
  const {positions}=graph(tasks);
  assert.ok(Math.abs(positions.get('a').y-positions.get('a-next').y)<166);
  assert.equal(positions.get('b').y,positions.get('b-next').y);
  assert.ok(positions.get('b').y>positions.get('a-related').y);
  assert.ok(positions.get('solo').y>positions.get('b').y);
  assert.deepEqual(graph(tasks).positions,positions);
});
test('deleting a task requires the organizer and exact revision, removes links, and preserves other tasks',()=>{
  const store=GatherStore.createStore({storage:null});
  const task=store.addTask({title:'Fictional duplicate to delete',owner:'maya'});
  const other=store.addTask({title:'Fictional dependent'});
  store.addDependency(other.id,{taskId:task.id,reason:'Needs a decision',kind:'dependency'});
  store.saveDraft(task.id,'Private fictional follow-up');
  const before=store.getState(), current=before.tasks.find(t=>t.id===task.id);
  assert.throws(()=>store.deleteTask(task.id,current.revision,'maya'),/Only the organizer/);
  assert.throws(()=>store.deleteTask(task.id,current.revision+1),/task changed/);
  assert.deepEqual(store.getState(),before);
  assert.deepEqual(store.deleteTask(task.id,current.revision),{id:task.id});
  const after=store.getState(), remaining=after.tasks.find(t=>t.id===other.id);
  assert.ok(!after.tasks.some(t=>t.id===task.id));
  assert.ok(!after.drafts.some(draft=>draft.taskId===task.id));
  assert.equal(remaining.status,'todo');
  assert.equal(remaining.dependencies.length,0);
  assert.match(remaining.comments.at(-1).text,/deleted task/);
  assert.ok(after.activity.some(entry=>entry.type==='deleted'&&entry.taskId===''));
});
test('readiness accounts for verification, unavailable links and explicit resume',()=>{
  const approval={...make('approval',[],'done'),requiresVerification:true};
  const task=make('finish',[link('approval')],'blocked');
  assert.equal(readiness(task,[approval,task]).open.length,1);
  approval.verifiedAt='2030-01-01';assert.equal(readiness(task,[approval,task]).label,'Ready to resume');
  assert.equal(readiness(task,[task]).open.length,1);
  assert.equal(readiness(make('unrelated',[],'blocked'),[]).label,'Blocked · review update');
});
test('focused and searched maps include connection context, escape content and bound large or cyclic imports',()=>{
  const tasks=[make('<img onerror=alert(1)>'),make('child',[link('<img onerror=alert(1)>')]),make('other')];
  const focused=graph(tasks,[],'child');assert.equal(focused.nodes.length,2);
  const html=graphMarkup(tasks,[tasks[1]]);assert.ok(!html.includes('<img'));assert.match(html,/&lt;img/);
  assert.equal(graph([make('a',[link('b')]),make('b',[link('a')])]).cycles,true);
  assert.ok(graph(Array.from({length:1000},(_,i)=>make('task'+i))).nodes.length<=200);
});
test('owners can correct link meaning with an explanation without changing status or deleting tasks',()=>{
  const store=GatherStore.createStore({storage:null});
  const parent=store.addTask({title:'Prepare invitations',owner:'dev'}),other=store.addTask({title:'Choose menu',owner:'maya'});
  store.addDependency(parent.id,{taskId:other.id,reason:'Initial proposed link'},'dev');
  const count=store.getState().tasks.length;
  assert.throws(()=>store.reportCompletion(parent.id,'Ready','dev'),/required work/);
  store.setDependencyKind(parent.id,{taskId:other.id,kind:'related',reason:'The invitation design does not require the menu.'},'dev');
  let t=store.getState().tasks.find(t=>t.id===parent.id);
  assert.equal(t.status,'todo');assert.equal(t.dependencies[0].kind,'related');
  assert.equal(store.getState().tasks.length,count);assert.equal(t.comments.at(-1).kind,'dependency-reviewed');
  store.reportCompletion(parent.id,'Invitations ready','dev');
  assert.equal(store.getState().tasks.find(t=>t.id===parent.id).status,'done');
});
test('relationship review rejects cycles, forged fields, blank explanations and unauthorized owners atomically',()=>{
  const store=GatherStore.createStore({storage:null}),a=store.addTask({title:'A',owner:'dev'}),b=store.addTask({title:'B',owner:'maya'});
  store.addDependency(a.id,{taskId:b.id,kind:'related'},'dev');
  store.addDependency(b.id,{taskId:a.id},'jack');
  const before=store.exportState();
  for(const [data,actor] of [
    [{taskId:b.id,kind:'dependency',reason:'Cycle'},'dev'],
    [{taskId:b.id,kind:'related',reason:'   '},'dev'],
    [{taskId:b.id,kind:'related',reason:'Reason',owner:'maya'},'dev'],
    [{taskId:b.id,kind:'related',reason:'Reason'},'maya'],
  ]){assert.throws(()=>store.setDependencyKind(a.id,data,actor));assert.equal(store.exportState(),before);}
});
test('general requests are related; explicit causal requests remain required',()=>{
  for(const [note,kind] of [['Could Maya review the seating plan?','related'],['Maya needs to review the seating plan before I can continue.','dependency']]){
    const store=GatherStore.createStore({storage:null}),task=store.addTask({title:'Prepare welcome',owner:'dev',status:'progress'});
    store.updateTask(task.id,{status:'progress',note},'dev');
    const suggestion=store.getState().tasks.find(t=>t.id===task.id).handoffs.find(h=>h.status==='pending');
    assert.equal(suggestion.kind,kind);
    const created=store.resolveHandoff(task.id,suggestion.id,{action:'create',title:suggestion.title,owner:''},'dev');
    assert.equal(store.getState().tasks.find(t=>t.id===task.id).dependencies.find(l=>l.taskId===created.id).kind,kind);
  }
});
