import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import '../legacy/calendar.js';
import '../legacy/store.js';
import '../legacy/priorities.js';
import '../legacy/recovery-ui.js';

const source = readFileSync('legacy/app.js','utf8');
const id = 'fictional-task';

function sourceBlock(from,to){
  const start=source.indexOf(from),end=source.indexOf(to,start+from.length);
  assert.ok(start>=0&&end>start,'missing source block: '+from);
  return source.slice(start,end);
}

function fixture({hosted=true}={}){
  const ui={actor:'maya',view:'tasks',tab:'mine',dialogKind:'task',detailId:id};
  const window=hosted?{GatherMode:{projectId:'fictional-project'}}:{GatherMode:{demo:true}};
  const document={hidden:false,activeElement:null};
  const backdrop={hidden:false},dialog={isConnected:true,dataset:{}},title={isConnected:true};
  const calls=[],writes=[],frames=[];
  let revision=hosted?11:undefined,stale=false,known=0;
  let task={id,revision:5,owner:'maya',status:'todo'};
  let heading=title;
  function makeButton(){
    const attributes=new Map();
    return {isConnected:true,disabled:false,dataset:{action:'accept-task',id,revision:'5',
      ...(hosted?{workspaceRevision:'11'}:{})},
      closest:()=>dialog,focus:()=>calls.push(['focus','accept']),
      setAttribute:(key,value)=>attributes.set(key,value),removeAttribute:key=>attributes.delete(key),
      getAttribute:key=>attributes.get(key),matches:selector=>selector.includes('accept-task'),
    };
  }
  let button=makeButton();
  const context=vm.createContext({
    ui,window,document,
    $:selector=>({
      '#dialog':dialog,'#dialogBackdrop':backdrop,'#dialogTitle':heading,
    })[selector]??(selector.includes('accept-task')&&button.isConnected?button:null),
    $$:()=>[],
    requestAnimationFrame:fn=>frames.push(fn),
    hasUnsavedFields:()=>false,
    workspaceUpdatesPending:()=>stale,
    scheduleRevisionIsStale:value=>Number.isSafeInteger(value)&&value<known,
    recoveryConflictPending:value=>Number.isSafeInteger(value)&&value<known,
    showPendingUpdate:()=>{stale=true;calls.push(['warning']);},
    showRecoveryWriteConflict(value){known=value+1;stale=true;calls.push(['conflict',value]);},
    saveLock(root){
      assert.equal(root,dialog);
      assert.equal(ui.pendingSave,undefined);
      ui.pendingSave=true;
      return ()=>{delete ui.pendingSave;calls.push(['unlock']);};
    },
    store:{
      getState:()=>({tasks:task?[task]:[],members:[{id:'maya',active:true}]}),
      getSnapshotRevision:()=>revision,
      acceptTask(){assert.fail('Direct reviewed acceptance must use the existing revision-checked batch mutation');},
      acceptTasks(refs,actor){
        calls.push(['write']);
        return new Promise((resolve,reject)=>writes.push({refs,actor,reject,finish(){
          if(task)task={...task,acceptedAt:'2026-11-15T19:00:00Z',revision:task.revision+1};
          if(revision!==undefined)revision++;
          resolve(task?[{...task}]:[]);
        }}));
      },
    },
    render:()=>calls.push(['render']),
    taskDialog(...args){calls.push(['dialog',...args]);heading={...title};},
    focusTaskDialogControl:target=>calls.push(['focus',target===heading?'heading':'other']),
    toast:message=>calls.push(['toast',message]),
  });
  dialog.contains=el=>el===button||el===heading;
  dialog.querySelector=selector=>context.$(selector);
  vm.runInContext(
    sourceBlock('  function waitsForAcceptance(','  function isLiveTeammate(')+
    sourceBlock('  function acceptanceReviewPending(','  function paintAcceptanceRefresh(')+
    sourceBlock('  function taskAcceptanceButton(','  function canRefreshActivityReview('),context,
  );
  return {ui,window,document,backdrop,calls,writes,
    get button(){return button;}, get task(){return task;}, set task(value){task=value;},
    set revision(value){revision=value;},set stale(value){stale=value;},set known(value){known=value;},
    accept(opener=button){return context.acceptReviewedTask(opener);},
    checkNextUp(form,enabled,currentForm=form){
      const originalLookup=context.$;
      context.$=selector=>selector==='#nextUpForm'?currentForm:originalLookup(selector);
      context.submitForm=form;
      context.FormData=class { constructor(){return [['enabled',enabled]];} };
      const snippet=sourceBlock('    const data=Object.fromEntries(new FormData(form));','    const isSubmission=');
      try{
        return vm.runInContext('((form)=>{'+snippet+'return true;})(submitForm)',context);
      }finally{context.$=originalLookup;}
    },
    replaceButton(){button.isConnected=false;button=makeButton();},
    replaceHeading(){heading={...title};},
    flush(){for(const frame of frames.splice(0))frame();},
  };
}

function successes(f){
  return f.calls.filter(([kind,message])=>kind==='toast'&&/responsibility accepted/i.test(message));
}

test('direct acceptance submits the reviewed task revision once and redraws the same task only after success',async()=>{
  for(const hosted of [true,false]){
    const f=fixture({hosted});
    const pending=f.accept();
    assert.equal(f.writes.length,1);
    const [write]=f.writes;
    assert.deepEqual(JSON.parse(JSON.stringify(write.refs)),[{id,revision:5}]);
    assert.equal(write.actor,'maya');
    assert.equal(f.ui.pendingSave,true);
    assert.equal(f.task.acceptedAt,undefined);
    assert.deepEqual(f.calls.filter(([kind])=>['render','dialog','toast'].includes(kind)),[]);
    await f.accept();
    assert.equal(f.writes.length,1,'a second click never duplicates the pending acceptance');
    write.finish();
    await pending;
    f.flush();
    assert.equal(f.ui.pendingSave,undefined);
    assert.equal(f.calls.filter(([kind])=>kind==='render').length,1);
    const dialogs=f.calls.filter(([kind])=>kind==='dialog');
    assert.equal(dialogs.length,1);
    assert.deepEqual(dialogs[0].slice(1,-1),[id,'',false,true,'',undefined,''],
      'preserve task drafts and request the same dialog heading');
    assert.equal(dialogs[0].at(-1).readOnly,true,'do not trigger an automatic resource lookup');
    assert.equal(f.task.status,'todo','accepting responsibility does not complete work');
    assert.equal(successes(f).length,1);
  }
});

test('stale, ineligible, and noncurrent acceptance controls cannot write',async()=>{
  for(const condition of [
    'detached','replaced button','wrong dialog','hidden','other actor','other owner','accepted','done','reported',
    'verified','archived','deleted','wrong button task','wrong task revision','invalid task revision',
    'wrong workspace revision','missing hosted workspace revision',
    'sticky review','pending sync','known newer','lost access',
  ]){
    const f=fixture();
    const opener=f.button;
    switch(condition){
      case 'detached': opener.isConnected=false; break;
      case 'replaced button': f.replaceButton(); opener.isConnected=true; break;
      case 'wrong dialog': f.ui.detailId='another-task'; break;
      case 'hidden': f.backdrop.hidden=true; break;
      case 'other actor': f.ui.actor='dev'; break;
      case 'other owner': f.task.owner='dev'; break;
      case 'accepted': f.task.acceptedAt='accepted'; break;
      case 'done': f.task.status='done'; break;
      case 'reported': f.task.reportedAt='reported'; break;
      case 'verified': f.task.verifiedAt='verified'; break;
      case 'archived': f.task.archivedAt='archived'; break;
      case 'deleted': f.task=null; break;
      case 'wrong button task': opener.dataset.id='another-task'; break;
      case 'wrong task revision': f.task.revision=6; break;
      case 'invalid task revision': opener.dataset.revision='not-a-revision'; break;
      case 'wrong workspace revision': f.revision=12; break;
      case 'missing hosted workspace revision': delete opener.dataset.workspaceRevision; break;
      case 'sticky review': opener.dataset.reviewNeedsRefresh='true'; break;
      case 'pending sync': f.stale=true; break;
      case 'known newer': f.known=12; break;
      case 'lost access': f.window.GatherAccessLost=true; break;
    }
    await f.accept(opener);
    assert.equal(f.writes.length,0,condition);
    assert.equal(successes(f).length,0,condition);
  }
});

test('a 409 uses the attempted workspace revision and cannot announce or repeat acceptance',async()=>{
  const f=fixture(),pending=f.accept();
  f.revision=12;
  f.writes[0].reject(Object.assign(new Error('Fictional conflict'),{status:409}));
  await pending;
  assert.deepEqual(f.calls.filter(([kind])=>kind==='conflict'),[['conflict',11]]);
  assert.ok(f.calls.every(([kind])=>!['dialog','render'].includes(kind)));
  assert.equal(successes(f).length,0);
  assert.equal(f.button.dataset.reviewNeedsRefresh,'true');
  assert.equal(f.button.getAttribute('aria-disabled'),'true');
  await f.accept();
  assert.equal(f.writes.length,1,'the old review is not accepted again');
});

test('an unsuccessful or superseded acceptance does not redraw a different task or announce success',async()=>{
  for(const condition of ['offline','closed','other task','other actor','other project','lost access','replacement']){
    const f=fixture(),pending=f.accept();
    switch(condition){
      case 'closed': f.backdrop.hidden=true; break;
      case 'other task': f.ui.detailId='another-task'; break;
      case 'other actor': f.ui.actor='dev'; break;
      case 'other project': f.window.GatherMode.projectId='another-project'; break;
      case 'lost access': f.window.GatherAccessLost=true; break;
      case 'replacement': f.replaceButton();f.replaceHeading();break;
    }
    if(condition==='offline')f.writes[0].reject(new Error('Fictional offline failure'));
    else f.writes[0].finish();
    await pending;
    f.flush();
    assert.equal(f.ui.pendingSave,undefined,condition);
    assert.equal(f.calls.filter(([kind])=>kind==='dialog').length,0,condition);
    assert.equal(successes(f).length,0,condition);
  }
});

test('the same stale guard applies before an implicit Next up acceptance, not to an ordinary Next up change',()=>{
  const form={id:'nextUpForm',dataset:{id}};
  const stale=fixture();
  stale.revision=12;
  assert.equal(stale.checkNextUp(form,'true'),undefined);
  assert.equal(stale.button.dataset.reviewNeedsRefresh,'true');
  assert.deepEqual(stale.calls,[['warning']]);
  assert.equal(stale.checkNextUp(form,'false'),true,'removing a commitment does not accept it');
  const fresh=fixture();
  assert.equal(fresh.checkNextUp(form,'true'),true);
  assert.equal(fresh.checkNextUp(form,'true',{...form}),undefined,'detached form cannot accept the current task');
  fresh.replaceButton();
  fresh.button.dataset.id='different-task';
  assert.equal(fresh.checkNextUp(form,'true'),undefined);
  assert.deepEqual(fresh.calls,[]);
  const alreadyAccepted=fixture();
  alreadyAccepted.task.acceptedAt='accepted';
  alreadyAccepted.button.isConnected=false;
  assert.equal(alreadyAccepted.checkNextUp(form,'true'),true,'no acceptance CTA means no implicit acceptance gate');
  const missing=fixture();
  missing.button.isConnected=false;
  assert.equal(missing.checkNextUp(form,'true'),undefined,'an unaccepted task without its review control cannot commit');
});

test('real recovery markup embeds task and hosted workspace revision only on pending acceptance',()=>{
  const store=GatherStore.createStore({storage:null});
  const task=store.addTask({title:'Fictional task for acceptance',owner:'maya'});
  const recovery=GatherRecoveryUI.create({store,ui:{actor:'maya'},h:String,options:()=>'',dayLabel:String,member:id=>({name:id})});
  const response=(selected,workspaceRevision)=>recovery.responseMarkup(selected,false,false,workspaceRevision);
  const button=html=>html.match(/<button[^>]*data-action="accept-task"[^>]*>/)?.[0]||'';
  const hosted=button(response(task,11)),local=button(response(task));
  assert.ok(hosted.includes('data-id="'+task.id+'"'));
  assert.ok(hosted.includes('data-revision="'+task.revision+'"'));
  assert.match(hosted,/data-workspace-revision="11"/);
  assert.ok(local.includes('data-revision="'+task.revision+'"'));
  assert.doesNotMatch(local,/data-workspace-revision/);
  for(const changes of [{acceptedAt:'already accepted'},{reportedAt:'reported'},
    {verifiedAt:'verified'},{archivedAt:'archived'},{status:'done'}])
    assert.equal(button(response({...task,...changes},11)),'');
});
