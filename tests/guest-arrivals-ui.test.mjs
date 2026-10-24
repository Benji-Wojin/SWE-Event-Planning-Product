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
  let failure=null,delay=null,closed=0,errorNode=null;
  const requests=[],dialogs=[],toasts=[],listNode={innerHTML:''},reload={listeners:{},addEventListener(e,fn){this.listeners[e]=fn;}};
  const form={dataset:{},listeners:{},closest:()=>form,addEventListener(e,fn){this.listeners[e]=fn;},querySelector(s){return s==='.form-error'?errorNode:reload;},prepend(n){errorNode=n;}};
  const host={isConnected:true,innerHTML:'',listeners:{},contains:()=>false,addEventListener(e,fn){this.listeners[e]=fn;},querySelector:()=>listNode};
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
  const ui=window.GatherInfoUI.create({h:escape,openDialog:(...args)=>dialogs.push(args),closeDialog(){closed++;},toast:v=>toasts.push(v),isDialogOpen:()=>false,
    saveLock(){form.dataset.saving='1';return()=>{delete form.dataset.saving;};}});
  ui.mount(host);await setImmediate();
  const click=attrs=>host.listeners.click({target:{closest:()=>({dataset:Object.fromEntries(Object.entries(attrs).map(([k,v])=>[k.replace(/^data-/,'').replace(/-([a-z])/g,(_,l)=>l.toUpperCase()),v])),hasAttribute:k=>Object.hasOwn(attrs,k)})}});
  const change=(attribute,value,checked=false)=>host.listeners.change({target:{value,checked,hasAttribute:k=>k===attribute}});
  return{host,listNode,dialogs,toasts,requests,click,change,form,reload,get closed(){return closed;},get error(){return errorNode?.textContent;},setFailure(v){failure=v;},setDelay(v){delay=v;},submit:()=>form.listeners.submit({preventDefault(){},stopPropagation(){},submitter:{}})};
}
const guest=(extra={})=>({id:'guest-a',name:'Fictional <Guest>',attendance:'attending',type:'attendee',email:'',phone:'',group:'',notes:'',...extra});

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
  release();await pending;assert.equal(h.closed,1);assert.equal(h.form.dataset.saving,undefined);
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
test('conflict preserves the arrival review and offers reload without replaying a mutation',async()=>{
  const h=await harness([guest()]);h.click({'data-info-arrival':'guest-a'});h.setFailure('Event info changed. Reload it and review.');await h.submit();
  assert.equal(h.closed,0);assert.match(h.error,/Reload it and review/);assert.equal(h.requests.length,2);
  h.reload.listeners.click();await setImmediate();assert.equal(h.closed,1);assert.equal(h.requests.length,3);
  assert.equal(h.requests.at(-1).options.method,'GET');assert.equal(h.requests.filter(r=>r.options.method==='POST').length,1);
});
