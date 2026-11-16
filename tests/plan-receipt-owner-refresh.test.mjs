import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync('legacy/app.js','utf8');
const project='fictional-project',actor='fictional-organizer',id='fictional-task';
const task={id,title:'Fictional task',owner:'',status:'todo',revision:4,note:'Saved context'};
const organizer={id:actor,role:'Organizer',name:'Fictional organizer',active:true};
const joined={id:'just-joined',role:'Teammate',name:'Fictional <teammate>',active:true};
const sample={id:'demo-card',role:'Teammate · example',name:'Fixture demo person',active:true};
const old={id:'former',role:'Former teammate',name:'Former fixture member',active:false};
const h=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);

function fragment(start,end){
  const from=source.indexOf(start),to=source.indexOf(end,from+start.length);
  assert.ok(from>=0&&to>from,start);
  return source.slice(from,to);
}

function fixture({kind='owner',initialTask=task,roster=[organizer,sample,old],demo=false}={}){
  let state={tasks:[structuredClone(initialTask),{...task,id:'another-task'}],members:structuredClone(roster)};
  let revision=20,isOwner=true,stale=false,completionDrafts=[],otherFields=[];
  const calls=[],reads=[],frames=[],pending=[];
  const ui={actor,view:'tasks',detailId:id,dialogKind:'task',pendingSave:false,syncing:false};
  const window={GatherMode:{projectId:project,demo},top:{location:{href:'unchanged'}}};
  const document={hidden:false,activeElement:null,body:{id:'body'}};
  const backdrop={hidden:false};
  const dialog={scrollTop:48,contains:node=>[title,form,ownerField,button,status,back,...otherFields].includes(node)};
  function node(id,attributes={}){
    const attrs={...attributes};
    return {id,isConnected:true,hidden:false,disabled:false,dataset:{},textContent:'',
      getAttribute:key=>attrs[key]??null,setAttribute(key,value){attrs[key]=String(value);},removeAttribute(key){delete attrs[key];},
      closest:()=>null,matches:()=>false,getClientRects(){return this.hidden?[]:[{}];},
      focus(){calls.push(['focus',id]);document.activeElement=this;},scrollIntoView(){calls.push(['scroll',id]);},
    };
  }
  function textField(name,value){return {tagName:'INPUT',name,type:'text',value,defaultValue:value};}
  const details={open:false};
  let title,button,status,back,form,ownerField,noteField,titleField,statusField,ownerLoad;
  function mount(t,choices){
    for(const oldNode of [title,button,status,back,form])if(oldNode)oldNode.isConnected=false;
    title=node('dialogTitle');
    const ownerReview=context.receiptOwnerReview(t,state);
    button=ownerReview?node('receiptOwnerChoicesRefresh'):null;
    status=ownerReview?node('receiptOwnerChoicesStatus'):null;
    back=node('planReceiptBack');back.dataset.action='return-to-plan-receipt';
    ownerField={...node('owner'),tagName:'SELECT',type:'select-one',name:'owner',value:t.owner,options:choices};
    ownerLoad=node('ownerLoad');
    noteField=textField('note',t.note);titleField=textField('title',t.title);
    statusField={tagName:'SELECT',type:'select-one',name:'status',value:t.status,
      options:['todo','done'].map(value=>({value,defaultSelected:value===t.status}))};
    form={...node('taskDetailForm'),dataset:{id:t.id,taskRevision:String(t.revision)},
      elements:{owner:ownerField,note:noteField,title:titleField,status:statusField},closest:()=>details,
      contains:field=>[ownerField,noteField,titleField,statusField].includes(field)};
    for(const field of Object.values(form.elements))field.form=form;
  }
  const notesForm={id:'commentForm'};
  const store={getState:()=>structuredClone(state),getSnapshotRevision:()=>revision,
    refresh(canApply,settings){
      reads.push(settings);
      return new Promise((resolve,reject)=>pending.push({reject,
        finish(next=state,{advance=1}={}){
          const nextRevision=revision+advance;
          if(!canApply(nextRevision,structuredClone(next))){resolve({changed:false,pending:true,newerRevision:nextRevision});return false;}
          if(advance){state=structuredClone(next);revision=nextRevision;}
          resolve({changed:advance>0,verified:true});return true;
        }}));
    },
    updateTask(){assert.fail('owner refresh must not save, assign, or create work');},
  };
  const context=vm.createContext({window,document,ui,store,h,URLSearchParams,
    isOrganizer:()=>isOwner,workspaceUpdatesPending:()=>stale,recoveryConflictPending:()=>stale,scheduleRevisionIsStale:()=>stale,
    guidedWorkspace:true,hiddenByClosedDisclosure:el=>el===button&&!details.open,
    dependencyInfo:(latest,next)=>({open:next.tasks.filter(item=>latest.fixtureRequires===item.id&&item.status!=='done')}),
    recovery:{ownerLoad:value=>`Advisory for ${value}`},
    taskCompletionDraftContext:()=>completionDrafts,
    rememberNewerSchedule:(_snapshot,newerRevision)=>calls.push(['pending-revision',newerRevision]),
    requestAnimationFrame:fn=>frames.push(fn),queueMicrotask:fn=>frames.push(fn),
    $:(selector,root)=>{
      switch(selector){
        case '#dialog':return dialog;
        case '#dialogBackdrop':return backdrop;
        case '#dialogTitle':return title;
        case '#taskDetailForm':return form;
        case 'select[name="owner"]':return ownerField;
        case '#planReceiptBack':return back;
        case '#receiptOwnerChoicesStatus':return status;
        case '#receiptOwnerChoicesRefresh':return button;
        case '[data-owner-load]':return ownerLoad;
      }
      return null;
    },
    $$:(selector,root)=>selector==='#dialog form'?[form,...(otherFields.length?[notesForm]:[])]:root===dialog?[...Object.values(form.elements),...otherFields]:
      root===form?Object.values(form.elements):root===notesForm?otherFields:[],
    focusTaskDialogControl(target,root){assert.equal(root,dialog);target.focus();},
    focusScheduleTarget(target){target?.focus();return !!target;},
    confirmCloseDialog:()=>true,confirmDiscard:()=>true,
    render(){calls.push(['render']);},
    taskDialog(...args){
      calls.push(['redraw',...args]);
      const current=state.tasks.find(task=>task.id===args[0]);
      assert.ok(current,'never try to reopen a deleted task');
      const drafts=args[2]?[]:context.taskDrafts(args[1]);
      const options=parseOptions(ownerOptions(current.owner));
      mount(current,options);
      for(const draft of drafts)if(draft.form===form.id)form.elements[draft.name].value=draft.value;
      document.activeElement=title;
    },
    closeDialog(){calls.push(['close']);backdrop.hidden=true;},
    toast:message=>calls.push(['toast',message]),showPendingUpdate:()=>calls.push(['pending']),
    formError:(_form,error)=>calls.push(['error',error.message]),
  });
  function parseOptions(markup){return Array.from(markup.matchAll(/<option value="([^"]*)"([^>]*)>([^<]*)<\/option>/g),
    ([,value,attrs,title])=>({value,defaultSelected:attrs.includes('selected'),title}));}
  vm.runInContext(fragment('  const options =','  const statusOptions =')+
    fragment('  function hasUnsavedFields(','  function confirmDiscard(')+
    fragment('  function taskDrafts(','  function completionDraftHasEdits(')+
    fragment('  function focusTaskOwnerEditor(','  function jumpFromNextUpToTimeline('),context);
  const ownerOptions=vm.runInContext('ownerOptions',context);
  if(kind)context.setPlanReceiptReturn(id,kind);
  mount(initialTask,parseOptions(ownerOptions(initialTask.owner)));
  details.open=true;
  document.activeElement=button;
  return {ui,window,document,backdrop,dialog,calls,reads,frames,pending,
    get state(){return state;},get form(){return form;},get button(){return button;},get status(){return status;},get title(){return title;},get back(){return back;},
    get owner(){return ownerField;},get ownerLoad(){return ownerLoad;},get note(){return noteField;},get details(){return details;},
    set organizer(value){isOwner=value;},set stale(value){stale=value;},set completionDrafts(value){completionDrafts=value;},
    editOther(){const field=textField('text','');field.form=notesForm;field.value='Draft commentary';otherFields=[field];},
    replaceForm(){form.isConnected=false;form={...form,isConnected:true};},
    latest({taskPatch={},members=[organizer,joined,sample,old],missing=false}={}){
      return {...structuredClone(state),members,tasks:missing?state.tasks.filter(item=>item.id!==id):state.tasks.map(item=>item.id===id?{...item,...taskPatch}:item)};
    },
    markup(){return context.receiptOwnerChoicesMarkup(state.tasks[0],state);},
    start(opener=button){return context.refreshReceiptOwnerChoices(opener);},
    flush(){for(const callback of frames.splice(0))callback();},
  };
}

const callsOf=(f,type)=>f.calls.filter(([name])=>name===type);

test('owner-choice refresh is a read-only control only on the exact active receipt owner review',async()=>{
  const eligible=fixture();
  assert.match(eligible.markup(),/id="receiptOwnerChoicesStatus"[^>]*role="status"/);
  assert.match(eligible.markup(),/type="button"[^>]*data-action="refresh-receipt-owner-choices"[^>]*aria-describedby="receiptOwnerChoicesStatus"/);
  assert.match(eligible.markup(),/never assigns work or saves your edits/);
  assert.ok(fixture({initialTask:{...task,owner:old.id}}).markup(),'an unavailable former owner still needs review');
  for(const f of [fixture({kind:null}),fixture({kind:'schedule'}),fixture({demo:true}),
    fixture({initialTask:{...task,owner:actor}}),fixture({initialTask:{...task,archivedAt:'2026-10-10'}}),
    fixture({initialTask:{...task,status:'done'}}),fixture({initialTask:{...task,reportedAt:'2026-10-10'}})]){
    assert.equal(f.markup(),'');
    await f.start();
    assert.equal(f.reads.length,0);
  }
  await eligible.start({...eligible.button});
  assert.equal(eligible.reads.length,0,'a disconnected lookalike control cannot issue the read');
});

test('one fresh read adds the joined teammate and keeps compatible unsaved details without assigning',async()=>{
  const f=fixture(),initialButton=f.button;
  f.note.value='Unsaved note about setup';
  f.owner.value=actor;
  const refresh=f.start();
  assert.equal(f.reads.length,1);
  assert.equal(f.reads[0].requireFresh,true);
  assert.equal(initialButton.getAttribute('aria-disabled'),'true');
  assert.match(f.status.textContent,/Checking/);
  await f.start();
  assert.equal(f.reads.length,1,'repeat activation does not queue a second read');
  assert.equal(f.calls.length,0,'never redraw while the GET is pending');
  assert.equal(f.pending[0].finish(f.latest()),true);
  await refresh;
  assert.equal(f.note.value,'Unsaved note about setup');
  assert.equal(f.owner.value,actor);
  assert.equal(f.ownerLoad.innerHTML,`Advisory for ${actor}`);
  assert.equal(f.state.tasks[0].owner,'');
  assert.equal(f.state.tasks[0].note,'Saved context');
  assert.match(f.owner.options.find(option=>option.value===joined.id).title,/Fictional &lt;teammate&gt;/);
  assert.ok(!f.owner.options.some(option=>option.value===old.id||option.value===sample.id));
  assert.match(f.status.textContent,/No assignment was saved/);
  assert.equal(callsOf(f,'redraw').length,1);
  f.flush();
  assert.equal(f.document.activeElement,f.owner);
  assert.equal(f.details.open,true);
  assert.equal(f.ui.syncing,false);
});

test('incompatible drafts are retained without applying or redrawing the new snapshot',async t=>{
  for(const [label,edit,latest,message] of [
    ['other form',f=>f.editOther(),f=>f.latest(),/other unsaved edits/],
    ['completion receipt recovery',f=>{f.note.value='draft';f.completionDrafts=[{}];},f=>f.latest(),/other unsaved edits/],
    ['concurrently modified task',f=>{f.note.value='draft';},f=>f.latest({taskPatch:{revision:5,title:'New saved title'}}),/task itself changed/],
    ['selected owner removed',f=>{f.owner.value=actor;},f=>f.latest({members:[{...organizer,active:false},joined]}),/owner you chose is no longer available/],
    ['required work unresolved',f=>{f.form.elements.status.value='done';},f=>f.latest({taskPatch:{fixtureRequires:'another-task'}}),/required work changed/],
  ])await t.test(label,async()=>{
    const f=fixture(),before=f.form;
    edit(f);
    const noteValue=f.note.value,ownerValue=f.owner.value,statusValue=f.form.elements.status.value,refresh=f.start();
    assert.equal(f.pending[0].finish(latest(f)),false);
    await refresh;
    assert.equal(f.form,before);
    assert.equal(f.note.value,noteValue);
    assert.equal(f.owner.value,ownerValue);
    assert.equal(f.form.elements.status.value,statusValue);
    assert.equal(f.state.tasks[0].revision,4);
    assert.equal(callsOf(f,'redraw').length,0);
    assert.match(f.status.textContent,message);
    assert.equal(f.button.getAttribute('aria-disabled'),null);
  });
});

test('a cleaned editor can accept an updated task without refocusing owner when no longer needed',async()=>{
  const f=fixture();
  const refresh=f.start();
  assert.equal(f.pending[0].finish(f.latest({taskPatch:{revision:5,owner:joined.id}})),true);
  await refresh;
  f.flush();
  assert.equal(f.form.dataset.taskRevision,'5');
  assert.equal(f.owner.value,joined.id);
  assert.equal(f.button,null);
  assert.equal(f.back.isConnected,true);
  assert.equal(f.document.activeElement,f.title);
  assert.match(callsOf(f,'toast')[0][1],/no longer needs an owner/);
});

test('deleted or archived task, revoked scope, and read failures do not redraw or redirect',async t=>{
  for(const [label,change] of [
    ['different account',f=>{f.ui.actor='different-organizer';}],
    ['different project',f=>{f.window.GatherMode.projectId='different-project';}],
    ['access lost',f=>{f.window.GatherAccessLost=true;}],
    ['different editor',f=>f.replaceForm()],
    ['closed editor',f=>{f.backdrop.hidden=true;}],
    ['closed owner disclosure',f=>{f.details.open=false;}],
  ])await t.test(label,async()=>{
    const f=fixture(),refresh=f.start();
    change(f);
    assert.equal(f.pending[0].finish(f.latest()),false);
    await refresh;
    assert.equal(callsOf(f,'render').length,0);
    assert.equal(callsOf(f,'redraw').length,0);
    assert.equal(f.window.top.location.href,'unchanged');
  });
  for(const latest of [f=>f.latest({missing:true}),f=>f.latest({taskPatch:{archivedAt:'2026-10-10'}})]){
    const f=fixture(),refresh=f.start();
    assert.equal(f.pending[0].finish(latest(f)),false);
    await refresh;
    assert.match(f.status.textContent,/no longer available.*Return to the plan handoff/);
    assert.equal(f.back.isConnected,true);
    assert.equal(callsOf(f,'redraw').length,0);
  }
  const f=fixture(),refresh=f.start();
  f.pending[0].reject(new Error('fictional temporary read failure'));
  await refresh;
  assert.match(f.status.textContent,/Could not refresh.*unchanged.*Try again/);
  assert.equal(f.button.getAttribute('aria-disabled'),null);
  assert.equal(callsOf(f,'redraw').length,0);
});

test('owner refresh does not pull focus back after it moves, including during the redraw frame',async()=>{
  for(const when of ['before read','after redraw']){
    const f=fixture(),refresh=f.start();
    if(when==='before read')f.document.activeElement=f.back;
    assert.equal(f.pending[0].finish(f.latest()),true);
    await refresh;
    if(when==='after redraw')f.document.activeElement=f.back;
    f.flush();
    assert.equal(callsOf(f,'focus').length,0);
    if(when==='after redraw')assert.equal(f.document.activeElement,f.back);
  }
});
