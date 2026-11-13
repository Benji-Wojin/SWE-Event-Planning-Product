import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { setImmediate } from 'node:timers/promises';
import '../legacy/guests.js';

const source=readFileSync('legacy/info-ui.js','utf8');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function harness(guests) {
  let snapshot={revision:7,identity:{admin:false},uploadsAvailable:false,guests:structuredClone(guests),files:[]};
  let failure=null,delay=null,closed=0,form;
  const requests=[],dialogs=[],toasts=[],focused=[],listNode={innerHTML:''};
  const search={value:'',focus(){focused.push('search');}},typeControl={value:''},arrivalControl={value:''},clear={hidden:true},status={textContent:''};
  const newForm=()=>{
    const reload={listeners:{},addEventListener(e,fn){this.listeners[e]=fn;},setAttribute(){},removeAttribute(){},focus(){if(!this.disabled)focused.push('reload');}};
    const confirm={};
    const next={dataset:{},listeners:{},reload,confirm,closest:()=>next,addEventListener(e,fn){this.listeners[e]=fn;},
      querySelector(s){return s==='.form-error'?this.error:s==='button[type="submit"]'?confirm:reload;},prepend(n){this.error=n;}};
    return next;
  };
  const host={isConnected:true,innerHTML:'',listeners:{},contains:()=>false,addEventListener(e,fn){this.listeners[e]=fn;},
    querySelector(selector){return ({
      '[data-info-search]':search,'[data-info-type]':typeControl,'[data-info-arrival-filter]':arrivalControl,
      '[data-info-clear-filters]':clear,'[data-info-guest-results]':status,'[data-info-list]':listNode,
    })[selector];},
    querySelectorAll(selector){return selector==='[data-info-arrival]'?[...this.innerHTML.matchAll(/data-info-arrival="([^"]+)"/g)]
      .map(([,id])=>({dataset:{infoArrival:id},focus(){focused.push(id);}})):[];}};
  const window={GatherGuests,GatherMode:{projectId:'fictional-arrivals'}};
  vm.runInNewContext(source,{window,document:{hidden:false,activeElement:null,getElementById:()=>form,createElement:()=>({setAttribute(){},textContent:''})},URLSearchParams,FormData,crypto,
    setInterval:()=>1,clearInterval(){},fetch:async(url,options)=>{
      requests.push({url,options});if(options.method==='POST'){
        if(delay)await delay;
        if(failure)return{ok:false,status:409,json:async()=>({error:failure})};
        const input=JSON.parse(options.body);const guest=snapshot.guests.find(g=>g.id===input.id);
        guest.arrival=input.arrived?{at:'2026-10-23T19:00:00Z',actor:'server-actor',name:'Signed-in teammate'}:null;
        snapshot.revision++;
      }
      return{ok:true,json:async()=>structuredClone(snapshot)};
    }});
  const ui=window.GatherInfoUI.create({h:escape,openDialog:(...args)=>{dialogs.push(args);form=newForm();},closeDialog(){closed++;form=null;},toast:v=>toasts.push(v),isDialogOpen:()=>!!form,
    saveLock(){const locked=form;locked.dataset.saving='1';locked.reload.disabled=true;locked.confirm.disabled=true;
      return()=>{delete locked.dataset.saving;locked.reload.disabled=false;locked.confirm.disabled=false;};}});
  ui.mount(host);await setImmediate();
  const click=attrs=>host.listeners.click({target:{closest:()=>({dataset:Object.fromEntries(Object.entries(attrs).map(([k,v])=>[k.replace(/^data-/,'').replace(/-([a-z])/g,(_,l)=>l.toUpperCase()),v])),hasAttribute:k=>Object.hasOwn(attrs,k)})}});
  const change=(attribute,value,checked=false)=>host.listeners.change({target:{value,checked,hasAttribute:k=>k===attribute}});
  const input=value=>{search.value=value;host.listeners.input({target:{value,hasAttribute:k=>k==='data-info-search'}});};
  return{host,listNode,dialogs,toasts,focused,requests,click,change,input,search,typeControl,arrivalControl,clear,status,get form(){return form;},get reload(){return form.reload;},
    get closed(){return closed;},get error(){return form?.error?.textContent;},setFailure(v){failure=v;},setDelay(v){delay=v;},
    remote(update){update(snapshot);snapshot.revision++;},submit:()=>form.listeners.submit({preventDefault(){},stopPropagation(){},submitter:{}})};
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
  const h=await harness([guest()]);h.click({'data-info-arrival':'guest-a'});
  assert.equal(h.requests.length,1);assert.match(h.dialogs[0][1],/Confirm arrival/);assert.match(h.dialogs[0][1],/RSVP response: attending/);
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
  const h=await harness([guest({arrival:{at:'2026-10-23T19:00:00Z',name:'Recorder'}})]);
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
  h.remote(snapshot=>{snapshot.guests[0].arrival={at:'2026-10-23T19:00:00Z',name:'Other volunteer'};});
  await h.reload.listeners.click();assert.equal(h.closed,0);assert.equal(h.requests.length,3);
  assert.equal(h.requests.at(-1).options.method,'GET');assert.equal(h.requests.filter(r=>r.options.method==='POST').length,1);
  assert.match(h.dialogs.at(-1)[1],/Other volunteer/);
  assert.match(h.dialogs.at(-1)[1],/already matches the change/);
  assert.match(h.dialogs.at(-1)[1],/This review is read-only/);
  assert.doesNotMatch(h.dialogs.at(-1)[1],/Clear this record if/);
  assert.equal(h.dialogs.at(-1)[5],true,'updated review starts at the heading');
  assert.equal(h.form.confirm.hidden,true);
  h.setFailure(null);await h.reload.listeners.click();await h.submit();
  assert.equal(h.requests.filter(r=>r.options.method==='POST').length,1,'repeated refresh does not turn a record into a clear');
});
test('a still-needed arrival requires a fresh confirmation at the new revision and restores filtered focus to search',async()=>{
  const h=await harness([guest(),guest({id:'guest-b',name:'Second guest'})]);
  h.change('data-info-arrival-filter','waiting');
  h.click({'data-info-arrival':'guest-a'});
  h.setFailure('conflict');await h.submit();
  const old=JSON.parse(h.requests.at(-1).options.body);
  h.remote(snapshot=>{snapshot.guests[1].arrival={at:'2026-10-23T19:00:00Z',name:'Other volunteer'};});
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
