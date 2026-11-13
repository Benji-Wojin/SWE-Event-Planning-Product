import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync('legacy/app.js','utf8');
const id='fictional-task';
const note='The entrance has two confirmed greeters.';
const links='https://example.com/fictional-route';
const chosen={name:'fictional-checklist.txt',size:20};

function fixture({editing=false}={}){
  const ui={actor:'maya',view:'tasks',detailId:id,dialogKind:'task',toolUpdatePending:true};
  const window={GatherMode:{projectId:'fictional-project'}},document={hidden:false};
  const formId=editing?'completionEvidenceForm':'responseForm';
  let revision=21,floor=22,task={id,owner:'maya',revision:4,status:'progress',requiresVerification:true,
    reportedAt:editing?'2026-11-13T16:00:00Z':''};
  let generation=1,blocked=false,organizer=false;
  const dialog={},backdrop={hidden:false},sync={hidden:false},calls=[],reads=[],frames=[];
  const sibling={id:'commentForm',dataset:{},isConnected:true,dirty:false};
  const state=()=>({tasks:task?[task]:[],demoGeneration:generation});
  function control(label,dataset={}){
    const attrs=new Map();
    return {name:label,dataset,isConnected:true,disabled:false,hidden:false,textContent:'',
      setAttribute:(key,value)=>attrs.set(key,value),getAttribute:key=>attrs.get(key),
      removeAttribute:key=>attrs.delete(key),focus:()=>calls.push(['focus',label]),
      closest:selector=>selector==='form'?form:dialog};
  }
  function formElement({current=false}={}){
    const inputs={
      response:control('response'),note:control('note'),completionNote:control('completion note'),completionLinks:control('links'),
      completionUpload:control('file'),completionFileIds:control('saved files'),
    };
    inputs.response.value=current?'progress':'completed';
    inputs.note.value=current?'':note;
    inputs.completionNote.value=current?'':note;
    inputs.completionLinks.value=current?'':links;
    inputs.completionUpload.files=current?[]:[chosen];
    inputs.completionFileIds.selectedOptions=current?[]:[{value:'historical_file',textContent:'Prior shared file'}];
    inputs.namedItem=name=>inputs[name];
    const notices=[];
    const form={...control('form',{id,revision:String(task?.revision),workspaceRevision:String(revision)}),
      id:formId,elements:inputs,dirty:!current,
      notices,prepend:notice=>notices.unshift(notice),
      querySelector:selector=>selector.includes('submit')?submit:null};
    if(!current){
      form.dataset.reviewNeedsRefresh='true';
      form.dataset.completionUploaded='true';
    }
    return form;
  }
  let title=control('heading'),button=control('refresh',{id}),status=control('status'),
    submit=control('submit'),form=formElement();
  const original=form;
  function replace({fresh=false}={}){
    title=control('new heading');
    button=control('new refresh',{id});
    status=control('new status');
    submit=control('new submit');
    form=formElement({current:fresh});
  }
  const context=vm.createContext({
    ui,window,document,
    $:selector=>({
      '#dialog':dialog,'#dialogTitle':title,'#dialogBackdrop':backdrop,'#workspaceSyncNotice':sync,
      ['#'+formId]:form,'#commentForm':sibling,
      '[data-action="refresh-completion-draft"]':button,'[data-completion-draft-status]':status,
      'button[type="submit"]':submit,
    })[selector]??null,
    $$:selector=>selector.includes('form')?[form,sibling]:[],
    isOrganizer:()=>organizer,
    dependencyInfo:()=>({open:blocked?[{}]:[]}),
    hasUnsavedFields:element=>!!element?.dirty,
    workspaceUpdatesPending:()=>!sync.hidden,
    scheduleRevisionIsStale:candidate=>candidate<floor,
    recoveryConflictPending:()=>false,
    rememberNewerSchedule(_snapshot,candidate){if(Number.isSafeInteger(candidate))floor=Math.max(floor,candidate);},
    store:{
      getState:state,getSnapshotRevision:()=>revision,
      reportCompletion(){assert.fail('Recovering a draft cannot submit completion');},
      setCompletionEvidence(){assert.fail('Recovering a draft cannot edit evidence');},
      refresh(canApply,options){
        return new Promise((resolve,reject)=>reads.push({
          canApply:(next,nextTask=task)=>canApply(next,{...state(),tasks:nextTask?[nextTask]:[]}),options,reject,
          finish({next=22,nextTask={...task,revision:5},nextGeneration=generation,result={changed:true,verified:true}}={}){
            if(!result.verified||result.pending){resolve(result);return;}
            const accepted=canApply(next,{...state(),demoGeneration:nextGeneration,tasks:nextTask?[nextTask]:[]});
            if(accepted){revision=next;task=nextTask;generation=nextGeneration;}
            resolve(accepted?result:{pending:true,newerRevision:next});
          },
        }));
      },
    },
    render:()=>calls.push(['render']),
    taskDialog(...args){calls.push(['dialog',...args]);replace({fresh:true});},
    responseDialog(...args){calls.push(['response',...args]);replace({fresh:true});},
    requestAnimationFrame:fn=>frames.push(fn),
    focusTaskDialogControl:element=>element?.focus(),
    closeDialog:()=>calls.push(['close']),
    toast:message=>calls.push(['toast',message]),
    formError:(element,error)=>calls.push(['error',element?.id,error.message]),
    recovery:{
      prepareCompletion(target){target.elements.response.value='completed';return true;},
      syncResponse(){},
    },
  });
  window.GatherCompletionUI={
    prepare(){assert.fail('Recovering a draft cannot upload a file');},
    captureDraft(target){
      calls.push(['capture',target]);
      return {note:(editing?target.elements.completionNote:target.elements.note).value,
        rawLinks:target.elements.completionLinks.value,fileIds:['historical_file'],file:chosen};
    },
    restoreDraft(target,draft){
      calls.push(['restore',target,draft]);
      target.elements.response.value='completed';
      (editing?target.elements.completionNote:target.elements.note).value=draft.note;
      target.elements.completionLinks.value=draft.rawLinks;
      target.elements.completionFileIds.selectedOptions=draft.fileIds.map(value=>({value}));
      return 'saved';
    },
  };
  document.createElement=tag=>control(tag);
  window.GatherCompletionUI.mount=target=>calls.push(['mount',target]);
  dialog.contains=element=>[form,sibling,title,button,status].includes(element);
  dialog.querySelector=context.$;
  dialog.querySelectorAll=context.$$;
  function run(from,to){
    const start=source.indexOf(from),end=source.indexOf(to,start+from.length);
    assert.ok(start>=0&&end>start,'missing source block: '+from);
    vm.runInContext(source.slice(start,end),context);
  }
  run('  function completionDraftCanSubmit(','  async function saveReviewedSubmission(');
  return {ui,window,document,backdrop,sync,reads,calls,original,sibling,context,
    get form(){return form;},get button(){return button;},get status(){return status;},
    get revision(){return revision;},get task(){return task;},
    set generation(value){generation=value;},set organizer(value){organizer=value;},
    set blocked(value){blocked=value;},set floor(value){floor=value;},
    refresh(opener=button){return context.refreshCompletionDraft(opener);},
    replace,flush(){for(const frame of frames.splice(0))frame();},
  };
}

const redrawn=f=>f.calls.filter(([kind])=>['render','dialog','restore'].includes(kind));

test('one verified read restores an eligible draft only to the same freshly rendered task, with no automatic submit',async()=>{
  const f=fixture(),oldButton=f.button,pending=f.refresh();
  assert.equal(f.reads.length,1);
  const [read]=f.reads;
  assert.equal(read.options.requireFresh,true);
  assert.equal(read.canApply(21),false,'never apply a revision below the observed freshness floor');
  assert.equal(read.canApply(22),true);
  assert.equal(oldButton.getAttribute('aria-disabled'),'true');
  await f.refresh();
  assert.equal(f.reads.length,1,'duplicate refresh cannot start another read');
  assert.deepEqual(redrawn(f),[]);
  read.finish();
  await pending;
  f.flush();
  assert.equal(f.revision,22);
  assert.equal(f.sync.hidden,true);
  assert.equal(f.ui.toolUpdatePending,false);
  assert.equal(oldButton.getAttribute('aria-disabled'),undefined);
  assert.equal(f.form.dataset.workspaceRevision,'22');
  assert.equal(f.form.dataset.revision,'5');
  assert.equal(f.form.dataset.reviewNeedsRefresh,undefined);
  assert.notEqual(f.form,f.original);
  assert.equal(f.form.elements.response.value,'completed');
  assert.equal(f.form.elements.note.value,note);
  assert.equal(f.form.elements.completionLinks.value,links);
  assert.deepEqual(f.form.elements.completionUpload.files,[]);
  assert.deepEqual(f.form.elements.completionFileIds.selectedOptions,[{value:'historical_file'}]);
  assert.equal(f.form.dataset.completionUploaded,undefined);
  const [,dialogCall,restore]=redrawn(f);
  assert.deepEqual(dialogCall.slice(1,-1),[id,'responseForm',false,true,'',undefined,'']);
  assert.equal(dialogCall.at(-1).readOnly,true);
  assert.equal(restore[1],f.form);
  assert.deepEqual(f.calls.filter(([kind])=>kind==='mount'),[['mount',f.form]]);
  assert.match(f.form.notices[0].textContent,/draft hasn’t been submitted/);
  assert.match(f.form.notices[0].textContent,/won’t be uploaded again/);
  assert.equal(f.form.notices[0].getAttribute('role'),'status');
  assert.deepEqual(f.calls.filter(([kind])=>kind==='focus'),[['focus','new heading']]);
});

test('lost, hidden, superseded and dirty sibling context never applies or restores a completion draft',async()=>{
  const dirty=fixture();
  dirty.sibling.dirty=true;
  await dirty.refresh();
  assert.equal(dirty.reads.length,0);
  assert.match(dirty.status.textContent,/unsaved|other edits/i);
  assert.equal(dirty.form.elements.note.value,note);
  for(const change of ['actor','view','project','access','generation','role','form','backdrop','hidden','sibling','response mode']){
    const f=fixture(),pending=f.refresh(),[read]=f.reads;
    if(change==='actor')f.ui.actor='jack';
    if(change==='view')f.ui.view='timeline';
    if(change==='project')f.window.GatherMode.projectId='different-project';
    if(change==='access')f.window.GatherAccessLost=true;
    if(change==='generation')f.generation=2;
    if(change==='role')f.organizer=true;
    if(change==='form')f.replace();
    if(change==='backdrop')f.backdrop.hidden=true;
    if(change==='hidden')f.document.hidden=true;
    if(change==='sibling')f.sibling.dirty=true;
    if(change==='response mode')f.form.elements.response.value='progress';
    assert.equal(read.canApply(22),false,change);
    read.finish();
    await pending;
    assert.equal(f.revision,21,change);
    assert.deepEqual(redrawn(f),[],change);
    assert.equal(f.original.elements.note.value,note);
    assert.equal(f.original.elements.completionLinks.value,links);
    assert.equal(f.ui.syncing,false);
    if(change==='form')assert.equal(f.status.textContent,'');
  }
});

test('a candidate reset demo cannot replace the old snapshot or recover the old task draft',async()=>{
  const f=fixture(),pending=f.refresh();
  f.reads[0].finish({nextGeneration:2});
  await pending;
  assert.equal(f.revision,21);
  assert.deepEqual(redrawn(f),[]);
  assert.equal(f.form,f.original);
  assert.equal(f.form.elements.note.value,note);
  assert.match(f.status.textContent,/demo was reset/i);
});

test('an already-loaded demo reset never checks or rebinds the previous generation draft',async()=>{
  const f=fixture();
  f.window.GatherMode.demo=true;
  f.form.dataset.completionDemoGeneration='1';
  f.generation=2;
  await f.refresh();
  assert.equal(f.reads.length,0);
  assert.equal(f.form,f.original);
  assert.match(f.status.textContent,/demo was reset/);
  assert.deepEqual(redrawn(f),[]);
});
test('a verified change that makes the latest task ineligible keeps the old draft on screen without restoring it',async()=>{
  for(const [reason,change,copy] of [
    ['new report',{reportedAt:'2026-11-13T17:00:00Z'},/report|already/i],
    ['done',{status:'done'},/completion|done/i],
    ['reassigned',{owner:'dev'},/owner|assigned/i],
    ['missing',null,/no longer|unavailable|deleted/i],
    ['required work',{},/required|blocked/i],
  ]){
    const f=fixture(),pending=f.refresh();
    if(reason==='required work')f.blocked=true;
    f.reads[0].finish({nextTask:change===null?null:{...f.task,revision:5,...change}});
    await pending;
    assert.equal(f.form,f.original,reason);
    assert.equal(f.revision,21,reason);
    assert.deepEqual(redrawn(f),[],reason);
    assert.equal(f.form.elements.note.value,note);
    assert.equal(f.form.elements.completionLinks.value,links);
    assert.equal(f.form.dataset.reviewNeedsRefresh,'true');
    assert.match(f.status.textContent,copy,reason);
  }
});

test('an ambiguous prior save or changed evidence revision does not unlock the earlier draft',async()=>{
  for(const scenario of ['unconfirmed report','changed evidence']){
    const f=fixture({editing:scenario==='changed evidence'});
    if(scenario==='unconfirmed report')f.form.dataset.completionSaveUnconfirmed='true';
    const pending=f.refresh();
    assert.equal(f.reads.length,1);
    f.reads[0].finish();
    await pending;
    assert.equal(f.revision,21);
    assert.equal(f.form,f.original);
    assert.deepEqual(redrawn(f),[]);
    assert.equal(f.form.dataset.reviewNeedsRefresh,'true');
    assert.match(f.status.textContent,/check|confirm|changed|review/i);
  }
});

test('unverified, failed and pending reads leave the current recovery draft locked',async()=>{
  for(const outcome of ['unverified','failure','pending']){
    const f=fixture(),pending=f.refresh(),[read]=f.reads;
    if(outcome==='failure')read.reject(new Error('Fictional refresh failure'));
    else read.finish({result:outcome==='unverified'?{changed:false}:{pending:true,newerRevision:24}});
    await pending;
    assert.equal(f.form,f.original);
    assert.equal(f.form.dataset.reviewNeedsRefresh,'true');
    assert.equal(f.revision,21);
    assert.deepEqual(redrawn(f),[]);
    assert.match(f.status.textContent,/could not|still|again/i);
  }
});

test('real restoration keeps links, selected files, and confirmed or ambiguous upload identity without uploading',async()=>{
  for(const prior of ['confirmed','ambiguous','browser-rejected']){
    const requests=[],window={GatherMode:{projectId:'fictional-project'}};
    const info={uploadsAvailable:true,revision:7};
    const uploaded={uploadedFileId:'verified_file',files:[{id:'verified_file'}]};
    vm.runInNewContext(readFileSync('legacy/completion-ui.js','utf8'),{
      window,URLSearchParams,AbortSignal,crypto:{randomUUID:()=>'fictional-receipt'},
      FormData:class{data={};set(key,value){this.data[key]=value;}},
      DataTransfer:class{files=[];items={add:file=>{if(prior==='browser-rejected')throw new Error('Unsupported transfer');this.files.push({...file});}};},
      async fetch(url,init){
        requests.push({url,init});
        if(requests.length===2&&prior!=='confirmed')throw new Error('Fictional lost response');
        return {ok:true,json:async()=>init.method==='POST'?uploaded:info};
      },
    });
    function draftForm({original=false}={}){
      const fileList={options:original?[{value:'historical_file',selected:true}]:[],
        get selectedOptions(){return this.options.filter(item=>item.selected);},
        set innerHTML(markup){this.options=Array.from(markup.matchAll(/<option value="([^"]+)"/g),([,value])=>({value}));},
      };
      const status={},rows={};
      return {dataset:{},elements:{
        note:{value:original?note:''},completionLinks:{value:original?' '+links+'\n':''},
        completionFileIds:fileList,completionUpload:{files:original?[chosen]:[]},
      },querySelector:selector=>selector==='[data-submission-files]'?rows:status};
    }
    const api=window.GatherCompletionUI,old=draftForm({original:true}),draft=api.captureDraft(old);
    const preparation=api.prepare(old,draft,chosen);
    if(prior!=='confirmed')await assert.rejects(preparation,/could not be confirmed/);
    else await preparation;
    const fresh=draftForm();
    const result=api.restoreDraft(fresh,draft);
    assert.equal(requests.length,2,'restoring a draft never starts a network request');
    assert.equal(fresh.elements.note.value,note);
    assert.equal(fresh.elements.completionLinks.value,' '+links+'\n');
    if(prior==='confirmed'){
      assert.equal(result,'saved');
      assert.deepEqual(fresh.elements.completionUpload.files,[]);
      assert.deepEqual(fresh.elements.completionFileIds.selectedOptions.map(option=>option.value),
        ['historical_file','verified_file']);
    }else if(prior==='browser-rejected'){
      assert.equal(result,'check-file');
      assert.deepEqual(fresh.elements.completionUpload.files,[]);
      assert.equal(api.restoreDraft(draftForm(),{...draft,file:undefined,attachmentRecovery:result}),'check-file');
    }else{
      assert.equal(result,'pending');
      const restoredFile=fresh.elements.completionUpload.files[0];
      assert.notEqual(restoredFile,chosen,'browser FileList may wrap the same selected file');
      assert.deepEqual(restoredFile,chosen);
      const prepared=await api.prepare(fresh,api.captureDraft(fresh),restoredFile);
      assert.equal(requests.length,3);
      assert.equal(requests[2].init.body.data.requestId,requests[1].init.body.data.requestId);
      assert.equal(requests[2].init.body.data.revision,requests[1].init.body.data.revision);
      assert.deepEqual(Array.from(prepared.fileIds),['historical_file','verified_file']);
    }
  }
});
