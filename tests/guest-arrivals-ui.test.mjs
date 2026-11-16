import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import '../legacy/guests.js';

const source=readFileSync('legacy/info-ui.js','utf8');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function harness(guests,{demo=false}={}) {
  let snapshot={revision:7,identity:{actor:'server-actor',admin:false},uploadsAvailable:false,guests:structuredClone(guests),files:[]};
  let failure=null,delay=null,closed=0,form,reply,readDelay=null;
  const requests=[],dialogs=[],toasts=[],focused=[],listNode={innerHTML:''};
  const document={hidden:false,activeElement:null,getElementById:()=>form,createElement:tag=>control(tag)};
  function control(name,attrs={}) {
    return {listeners:{},dataset:{},attributes:{},children:[],textContent:'',isConnected:true,hidden:false,disabled:false,
      getAttribute(key){return this.attributes[key]??null;},setAttribute(key,value){this.attributes[key]=value;},removeAttribute(key){delete this.attributes[key];},
      addEventListener(e,fn){this.listeners[e]=fn;},focus(){if(!this.disabled){document.activeElement=this;focused.push(name);}},
      append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},
      contains(el){return this===el||this.children.some(child=>child?.contains?.(el));},
      ...attrs};
  }
  const search={value:'',focus(){focused.push('search');}},typeControl={value:''},arrivalControl={value:''},clear={hidden:true},status={textContent:''};
  const newForm=markup=>{
    const reload=control('reload'), confirm=control('confirm');
    const retryMarkup=markup.match(/<button\b[^>]*\bdata-arrival-retry\b[^>]*>/)?.[0];
    const retry=control('retry',{hidden:!!retryMarkup?.match(/\shidden(?:\s|>)/)});
    const next=control('form',{reload,confirm,retry,closest:()=>next,
      querySelector(s){return s==='.form-error'?this.error:s==='button[type="submit"]'?confirm:
        s==='[data-arrival-reload]'?reload:s==='[data-arrival-retry]'&&retryMarkup?retry:null;},
      prepend(n){this.error=n;}});
    return next;
  };
  const host={isConnected:true,innerHTML:'',listeners:{},contains:()=>false,addEventListener(e,fn){this.listeners[e]=fn;},
    querySelector(selector){return ({
      '[data-info-search]':search,'[data-info-type]':typeControl,'[data-info-arrival-filter]':arrivalControl,
      '[data-info-clear-filters]':clear,'[data-info-guest-results]':status,'[data-info-list]':listNode,
    })[selector];},
    querySelectorAll(selector){return selector==='[data-info-arrival]'?[...this.innerHTML.matchAll(/data-info-arrival="([^"]+)"/g)]
      .map(([,id])=>({dataset:{infoArrival:id},focus(){focused.push(id);}})):[];}};
  const window={GatherGuests,GatherMode:{projectId:'fictional-arrivals',...(demo?{demo:true,actor:'server-actor'}:{})}};
  vm.runInNewContext(source,{window,document,URLSearchParams,FormData,crypto,AbortSignal,AbortController,
    setInterval:()=>1,clearInterval(){},fetch:async(url,options)=>{
      requests.push({url,options});
      const waiting=options.method==='POST'?delay:readDelay;
      if(waiting)await waiting;
      const scripted=await reply?.(options.method,structuredClone(snapshot),options);
      if(scripted?.network)throw new TypeError('Fixture connection closed');
      if(scripted)return {ok:scripted.status<400,status:scripted.status,json:async()=>{
        if(scripted.malformed)throw new SyntaxError('Fixture response is not valid JSON');
        return scripted.body;
      }};
      if(options.method==='POST'){
        if(failure)return{ok:false,status:409,json:async()=>({error:failure})};
        const input=JSON.parse(options.body);const guest=snapshot.guests.find(g=>g.id===input.id);
        guest.arrival=input.arrived?{at:'2026-10-23T19:00:00Z',actor:'server-actor',name:'Signed-in teammate'}:null;
        snapshot.revision++;
      }
      return{ok:true,status:200,json:async()=>structuredClone(snapshot)};
    }});
  function dismiss(){if(form)form.isConnected=false;form=null;}
  const ui=window.GatherInfoUI.create({h:escape,openDialog:(...args)=>{dismiss();dialogs.push(args);form=newForm(args[1]);},closeDialog(){closed++;dismiss();},toast:v=>toasts.push(v),isDialogOpen:()=>!!form,
    saveLock(){const locked=form;locked.dataset.saving='1';locked.reload.disabled=true;locked.confirm.disabled=true;locked.retry.disabled=true;
      return()=>{delete locked.dataset.saving;locked.reload.disabled=false;locked.confirm.disabled=false;locked.retry.disabled=false;};}});
  ui.mount(host);await setImmediate();
  const click=attrs=>host.listeners.click({target:{closest:()=>({dataset:Object.fromEntries(Object.entries(attrs).map(([k,v])=>[k.replace(/^data-/,'').replace(/-([a-z])/g,(_,l)=>l.toUpperCase()),v])),hasAttribute:k=>Object.hasOwn(attrs,k)})}});
  const change=(attribute,value,checked=false)=>host.listeners.change({target:{value,checked,hasAttribute:k=>k===attribute}});
  const input=value=>{search.value=value;host.listeners.input({target:{value,hasAttribute:k=>k==='data-info-search'}});};
  return{host,listNode,dialogs,toasts,focused,requests,click,change,input,search,typeControl,arrivalControl,clear,status,window,dismiss,ui,
    get form(){return form;},get reload(){return form.reload;},get retry(){return form.querySelector('[data-arrival-retry]');},
    get posts(){return requests.filter(row=>row.options.method==='POST');},get reads(){return requests.filter(row=>row.options.method==='GET');},
    get closed(){return closed;},get error(){return form?.error?.textContent;},setFailure(v){failure=v;},setDelay(v){delay=v;},setReadDelay(v){readDelay=v;},setReply(fn){reply=fn;},
    remote(update){update(snapshot);snapshot.revision++;},submit(current=form){return current.listeners.submit({preventDefault(){},stopPropagation(){},submitter:current.confirm,currentTarget:current});},
    retryOriginal(){const target=form.retry;return target.listeners.click({preventDefault(){},stopPropagation(){},currentTarget:target});}};
}
const guest=(extra={})=>({id:'guest-a',name:'Fictional <Guest>',attendance:'attending',type:'attendee',email:'',phone:'',group:'',notes:'',...extra});

test('guest lookup announces filtered counts and clear resets criteria without leaving the archived list or requesting data',async()=>{
  const h=await harness([
    guest({name:'José de la Cruz',phone:'(415) 555-0142'}),
    guest({id:'guest-b',name:'Sam Park'}),
    guest({id:'guest-c',name:'Former guest',type:'vendor',archivedAt:'archived'}),
  ]);
  assert.match(h.host.innerHTML,/data-info-guest-results role="status">2 active guests shown/);
  for(const query of ['jose cruz','4155550142']){
    h.input(query);assert.match(h.listNode.innerHTML,/guest-a/);assert.doesNotMatch(h.listNode.innerHTML,/guest-b/);
    assert.equal(h.status.textContent,'1 active guest shown.');assert.equal(h.clear.hidden,false);
  }
  h.change('data-info-archived','',true);
  h.typeControl.value='attendee';h.change('data-info-type','attendee');
  h.arrivalControl.value='arrived';h.change('data-info-arrival-filter','arrived');
  assert.equal(h.status.textContent,'0 archived guests shown.');
  h.click({'data-info-clear-filters':''});
  assert.deepEqual([h.search.value,h.typeControl.value,h.arrivalControl.value],['','','']);
  assert.equal(h.status.textContent,'1 archived guest shown.');
  assert.equal(h.clear.hidden,true);
  assert.equal(h.focused.at(-1),'search');
  assert.match(h.listNode.innerHTML,/guest-c/);
  assert.doesNotMatch(h.listNode.innerHTML,/guest-a|data-info-arrival="/);
  assert.equal(h.requests.length,1,'search and filter changes are local');
});
test('arrival summary and filters distinguish RSVP, record state and archived history with escaped names',async()=>{
  const h=await harness([guest(),guest({id:'guest-b',name:'Other guest',attendance:'unknown',arrival:{at:'2026-10-23T19:00:00Z',name:'<Recorder>'}}),guest({id:'guest-c',archivedAt:'archived',arrival:{at:'2026-10-23T19:00:00Z',name:'Recorder'}})]);
  assert.match(h.host.innerHTML,/1 arrival record<\/strong>/);assert.match(h.host.innerHTML,/1 RSVP attending · 2 guest records/);
  assert.match(h.host.innerHTML,/not a live headcount or a release\/safeguarding system/);
  assert.match(h.host.innerHTML,/RSVP response/);assert.match(h.host.innerHTML,/Arrival record/);
  assert.match(h.host.innerHTML,/&lt;Guest&gt;/);assert.match(h.host.innerHTML,/&lt;Recorder&gt;/);
  h.change('data-info-arrival-filter','waiting');assert.match(h.listNode.innerHTML,/guest-a/);assert.doesNotMatch(h.listNode.innerHTML,/guest-b/);
  h.change('data-info-arrival-filter','arrived');assert.match(h.listNode.innerHTML,/guest-b/);assert.doesNotMatch(h.listNode.innerHTML,/guest-a/);
  h.change('data-info-archived','',true);assert.match(h.host.innerHTML,/guest-c/);assert.doesNotMatch(h.host.innerHTML,/data-info-arrival="guest-c"/);
});
test('opening arrival review is read-only and explicit submit is locked, revision-bound and identity-free',async()=>{
  const h=await harness([guest({type:'vendor',group:'Catering <tent>',email:'fixture+<vendor>@example.test'}),
    guest({id:'guest-b',group:'Different party',email:'decoy@example.test'})]);
  h.click({'data-info-arrival':'guest-a'});
  assert.equal(h.requests.length,1);assert.match(h.dialogs[0][1],/Confirm arrival/);assert.match(h.dialogs[0][1],/RSVP response: attending/);
  assert.match(h.dialogs[0][1],/Fictional &lt;Guest&gt;/);
  assert.match(h.dialogs[0][1],/vendor · Catering &lt;tent&gt; · fixture\+&lt;vendor&gt;@example\.test/);
  assert.doesNotMatch(h.dialogs[0][1],/Different party|decoy@example\.test|<tent>/);
  let release;h.setDelay(new Promise(resolve=>{release=resolve;}));
  const pending=h.submit();await h.submit();assert.equal(h.requests.filter(r=>r.options.method==='POST').length,1);
  const input=JSON.parse(h.requests.at(-1).options.body);
  assert.deepEqual(Object.keys(input).sort(),['action','arrived','id','requestId','revision']);
  assert.equal(input.action,'arrival');assert.equal(input.arrived,true);assert.equal(input.revision,7);assert.equal(input.id,'guest-a');
  assert.equal(h.requests.at(-1).url,'/api/info?project=fictional-arrivals');
  const form=h.form;
  release();await pending;assert.equal(h.closed,1);assert.equal(form.dataset.saving,undefined);
  assert.deepEqual(h.focused,['guest-a']);
  assert.deepEqual(h.toasts,['Arrival recorded. RSVP response unchanged.']);
  assert.match(h.host.innerHTML,/Arrival recorded/);
});
test('undo review discloses that clearing is correction, not departure, and preserves RSVP',async()=>{
  const h=await harness([guest({arrival:{at:'2026-10-23T19:00:00Z',actor:'server-actor',name:'Recorder'}})]);
  h.click({'data-info-arrival':'guest-a'});assert.match(h.dialogs[0][1],/does not record a departure/);
  assert.match(h.dialogs[0][1],/Clear arrival record/);await h.submit();
  assert.equal(JSON.parse(h.requests.at(-1).options.body).arrived,false);
  assert.match(h.host.innerHTML,/No arrival recorded/);assert.match(h.host.innerHTML,/1 RSVP attending/);
});
test('conflict preserves the arrival review and reload never reverses the completed intent',async()=>{
  const h=await harness([guest()]);h.click({'data-info-arrival':'guest-a'});h.setFailure('Event info changed. Reload it and review.');await h.submit();
  assert.equal(h.closed,0);assert.match(h.error,/Review the latest record/);assert.equal(h.requests.length,2);
  assert.equal(h.form.confirm.disabled,true);assert.deepEqual(h.focused,['reload']);
  await h.submit();assert.equal(h.requests.length,2);
  h.remote(snapshot=>{snapshot.guests[0].arrival={at:'2026-10-23T19:00:00Z',actor:'other-volunteer',name:'Other volunteer'};});
  await h.reload.listeners.click();assert.equal(h.closed,0);assert.equal(h.requests.length,3);
  assert.equal(h.requests.at(-1).options.method,'GET');assert.equal(h.requests.filter(r=>r.options.method==='POST').length,1);
  assert.match(h.dialogs.at(-1)[1],/Other volunteer/);
  assert.match(h.dialogs.at(-1)[1],/already matches the change/);
  assert.match(h.dialogs.at(-1)[1],/This review is read-only/);
  assert.doesNotMatch(h.dialogs.at(-1)[1],/Clear this record if/);
  assert.equal(h.dialogs.at(-1)[5],true,'updated review starts at the heading');
  assert.equal(h.form.confirm.hidden,true);
  h.setFailure(null);
  h.remote(snapshot=>{snapshot.guests[0].arrival=null;});
  await h.reload.listeners.click();
  assert.match(h.dialogs.at(-1)[1],/No arrival recorded/);
  assert.match(h.dialogs.at(-1)[1],/read-only/i);
  assert.equal(h.form.confirm.hidden,true,'a stale already-matched review stays read-only even if the status later reverses');
  await h.submit();
  assert.equal(h.requests.filter(r=>r.options.method==='POST').length,1,'repeated refresh does not turn a read-only review into a write');
  assert.deepEqual(h.toasts,[]);
});
test('a still-needed arrival requires a fresh confirmation at the new revision and restores filtered focus to search',async()=>{
  const h=await harness([guest(),guest({id:'guest-b',name:'Second guest'})]);
  h.change('data-info-arrival-filter','waiting');
  h.click({'data-info-arrival':'guest-a'});
  h.setFailure('conflict');await h.submit();
  const old=JSON.parse(h.requests.at(-1).options.body);
  h.remote(snapshot=>{snapshot.guests[1].arrival={at:'2026-10-23T19:00:00Z',actor:'other-volunteer',name:'Other volunteer'};});
  await h.reload.listeners.click();
  assert.match(h.dialogs.at(-1)[1],/Latest guest record loaded/);
  assert.equal(h.requests.filter(r=>r.options.method==='POST').length,1);
  h.setFailure(null);await h.submit();
  const next=JSON.parse(h.requests.at(-1).options.body);
  assert.equal(next.revision,8);
  assert.equal(next.arrived,true);
  assert.notEqual(next.requestId,old.requestId);
  assert.equal(h.focused.at(-1),'search');
});
test('an archived guest closes the old review after the read and never replays the write',async()=>{
  const h=await harness([guest()]);
  h.click({'data-info-arrival':'guest-a'});
  h.remote(snapshot=>{snapshot.guests[0].archivedAt='2026-10-23T19:00:00Z';});
  await h.reload.listeners.click();
  assert.equal(h.closed,1);
  assert.equal(h.requests.filter(r=>r.options.method==='POST').length,0);
  assert.match(h.toasts.at(-1),/no longer on the active guest list/);
  assert.equal(h.focused.at(-1),'search');
});

const byServer={at:'2026-10-23T20:00:00Z',actor:'server-actor',name:'Signed-in teammate'};
const byVolunteer={at:'2026-10-23T21:00:00Z',actor:'other-volunteer',name:'Other volunteer'};
const methods=h=>h.requests.map(row=>row.options.method);
const payload=row=>JSON.parse(row.options.body);

test('network, invalid acknowledgments and retryable statuses leave arrival unconfirmed instead of announcing success',async()=>{
  for(const [name,reply] of [
    ['failed network',()=>({network:true})],
    ['malformed JSON',()=>({status:200,malformed:true})],
    ['missing snapshot fields',()=>({status:200,body:{revision:8,guests:[guest({arrival:byServer})]}})],
    ['nonnewer revision',snapshot=>({status:200,body:{...snapshot,guests:[guest({arrival:byServer})]}})],
    ['408',()=>({status:408,body:{error:'Timed out'}})],
    ['429',()=>({status:429,body:{error:'Try later'}})],
    ['503',()=>({status:503,body:{error:'Temporary failure'}})],
  ]){
    const h=await harness([guest()]);
    h.setReply((method,snapshot)=>method==='POST'?reply(snapshot):undefined);
    h.click({'data-info-arrival':'guest-a'});
    assert.ok(h.retry?.hidden,name);
    await h.submit();
    assert.equal(h.closed,0,name);
    assert.equal(h.form.confirm.disabled||h.form.confirm.hidden,true,name);
    assert.equal(h.retry?.hidden,false,name);
    assert.ok(h.reload.listeners.click,name);
    assert.match(h.error,/confirm|review/i,name);
    assert.deepEqual(h.toasts,[],name);
    assert.match(h.host.innerHTML,/No arrival recorded/,name);
    await h.submit();
    assert.deepEqual(methods(h),['GET','POST'],name);
  }
});

test('retry in a real project preserves the original request, but a divergent latest record is read-only',async()=>{
  const h=await harness([guest({arrival:byServer})]);
  h.click({'data-info-arrival':'guest-a'});
  h.setReply(method=>method==='POST'?{network:true}:undefined);
  await h.submit();
  assert.equal(h.retry.hidden,false);
  assert.equal(payload(h.posts[0]).arrived,false);
  h.remote(snapshot=>{snapshot.guests[0].arrival=byVolunteer;});
  h.setReply((method,snapshot)=>method==='POST'?{status:200,body:snapshot}:undefined);
  await h.retryOriginal();
  assert.deepEqual(methods(h),['GET','POST','POST']);
  assert.equal(h.posts[1].url,h.posts[0].url);
  assert.equal(h.posts[1].options.body,h.posts[0].options.body,'retry sends the same guest, intent, revision and request ID');
  assert.deepEqual(h.toasts,[],'a newer arrival is not an acknowledgment that the clear succeeded');
  assert.match(h.dialogs.at(-1)[1],/Other volunteer/);
  assert.match(h.dialogs.at(-1)[1],/read-only/i);
  assert.equal(h.form.confirm.disabled||h.form.confirm.hidden,true);
  assert.ok(!h.retry||h.retry.hidden);
  await h.submit();
  assert.equal(h.posts.length,2,'a divergent current record cannot be cleared by the old confirmation');
});

test('Review latest record after uncertainty is GET-only and cannot repeat even a still-needed arrival',async()=>{
  for(const demo of [false,true]){
    const h=await harness([guest()],{demo});
    h.click({'data-info-arrival':'guest-a'});
    h.setReply(method=>method==='POST'?{status:200,body:{}}:undefined);
    await h.submit();
    assert.equal(Boolean(h.retry&&!h.retry.hidden),!demo);
    h.remote(snapshot=>{snapshot.guests[0].name='Current guest spelling';});
    await h.reload.listeners.click();
    assert.deepEqual(methods(h),['GET','POST','GET']);
    assert.match(h.dialogs.at(-1)[1],/Current guest spelling/);
    assert.match(h.dialogs.at(-1)[1],/read-only/i);
    assert.equal(h.form.confirm.disabled||h.form.confirm.hidden,true);
    assert.deepEqual(h.toasts,[]);
    await h.reload.listeners.click();
    await h.submit();
    assert.deepEqual(methods(h),['GET','POST','GET','GET']);
  }
});

test('a definitive retry rejection is not proof of failure, and a malformed read cannot unlock the review',async()=>{
  const h=await harness([guest()]);
  h.click({'data-info-arrival':'guest-a'});
  h.setReply(method=>method==='POST'?{network:true}:undefined);
  await h.submit();
  assert.equal(h.retry.hidden,false);
  h.setReply(method=>method==='POST'?{status:409,body:{error:'Event info changed'}}:{status:200,body:{revision:8}});
  await h.retryOriginal();
  assert.equal(h.posts[1].options.body,h.posts[0].options.body);
  assert.equal(h.retry.hidden,true,'only an uncertain retry offers another exact replay');
  await h.retryOriginal();
  await h.reload.listeners.click();
  assert.deepEqual(methods(h),['GET','POST','POST','GET']);
  assert.equal(h.dialogs.length,1,'a malformed read cannot replace the old review');
  assert.equal(h.form.confirm.disabled,true);
  assert.deepEqual(h.toasts,[]);

  h.setReply(null);
  await h.reload.listeners.click();
  assert.match(h.dialogs.at(-1)[1],/read-only/i);
  await h.submit();
  assert.deepEqual(methods(h),['GET','POST','POST','GET','GET']);
  assert.deepEqual(h.toasts,[]);
});

test('a definitive conflict does not recapture a clear against a replaced arrival',async()=>{
  for(const different of [{actor:'other-volunteer'},{at:'2026-10-23T22:00:00Z'}]){
    const h=await harness([guest({arrival:byServer})]);
    h.click({'data-info-arrival':'guest-a'});
    h.setFailure('Event info changed');
    await h.submit();
    assert.equal(payload(h.posts[0]).arrived,false);
    assert.ok(!h.retry||h.retry.hidden,'a definitive conflict never offers a replay');
    h.remote(snapshot=>{snapshot.guests[0].arrival={...byServer,...different,name:'Later record'};});
    await h.reload.listeners.click();
    assert.match(h.dialogs.at(-1)[1],/Later record/);
    assert.match(h.dialogs.at(-1)[1],/read-only/i);
    assert.equal(h.form.confirm.disabled||h.form.confirm.hidden,true);
    await h.submit();
    assert.deepEqual(methods(h),['GET','POST','GET']);
    assert.deepEqual(h.toasts,[]);

    h.setFailure(null);
    h.dismiss();
    h.click({'data-info-arrival':'guest-a'});
    assert.equal(h.form.confirm.hidden,false,'reopening the current record allows an intentional later correction');
    await h.submit();
    assert.deepEqual(methods(h),['GET','POST','GET','POST']);
    assert.equal(payload(h.posts[1]).arrived,false);
    assert.equal(payload(h.posts[1]).revision,8);
    assert.notEqual(payload(h.posts[1]).requestId,payload(h.posts[0]).requestId);
  }
});

test('a different signed-in identity cannot acknowledge or supply a guest arrival review',async()=>{
  for(const method of ['GET','POST'])for(const changed of [{actor:'different-fixture-actor'},{admin:true}]){
    const h=await harness([guest()]);
    h.click({'data-info-arrival':'guest-a'});
    h.setReply((requested,snapshot)=>requested===method?{status:200,body:{...snapshot,revision:8,
      identity:{...snapshot.identity,...changed},guests:[guest({name:'Other identity record',arrival:byServer})]}}:undefined);
    if(method==='POST')await h.submit();
    else await h.reload.listeners.click();
    assert.deepEqual(methods(h),['GET',method]);
    assert.equal(h.dialogs.length,1);
    assert.equal(h.closed,1);
    assert.match(h.host.innerHTML,/project identity changed/i);
    assert.doesNotMatch(h.host.innerHTML,/Other identity record|Arrival recorded/);
    assert.deepEqual(h.toasts,[]);
  }
});

test('late arrivals and review responses cannot publish after cancel or a project change',async()=>{
  for(const request of ['GET','POST'])for(const interrupt of ['cancel','project']){
    const h=await harness([guest()]);
    h.click({'data-info-arrival':'guest-a'});
    const original=h.form;
    let finish;
    const waiting=new Promise(resolve=>{finish=resolve;});
    if(request==='POST')h.setDelay(waiting);
    else h.setReadDelay(waiting);
    const pending=request==='POST'?h.submit():h.reload.listeners.click();
    assert.equal(h.requests.at(-1).options.method,request);
    h.remote(snapshot=>{snapshot.guests[0].arrival=byVolunteer;});
    if(interrupt==='cancel')h.dismiss();
    else h.window.GatherMode.projectId='other-fictional-project';
    finish();
    await pending;
    assert.equal(h.dialogs.length,1,`${request}: no late review reopens`);
    assert.equal(h.closed,0,`${request}: no late close of any dialog`);
    assert.match(h.host.innerHTML,/No arrival recorded/,`${request}: no publish of superseded snapshot`);
    assert.deepEqual(h.toasts,[]);
    if(interrupt==='project'){
      await h.submit(original);
      await original.reload.listeners.click();
      assert.deepEqual(methods(h),['GET',request],'old-scope controls cannot send or reload');
    }
  }
});
