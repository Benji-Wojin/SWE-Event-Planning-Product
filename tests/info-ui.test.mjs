import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {setImmediate} from 'node:timers/promises';
import '../legacy/guests.js';

const source=readFileSync('legacy/info-ui.js','utf8');
async function harness(uploadsAvailable,extra={}){
  let snapshot={revision:1,uploadsAvailable,identity:{admin:true},guests:[],files:[],...extra},poll,failure=null,closed=0,deferNext=false,resolvePending,dialogKind='',focused=0;
  const dialogs=[],toasts=[],requests=[];
  const host={isConnected:true,innerHTML:'',listeners:{},contains:()=>false,addEventListener(event,fn){this.listeners[event]=fn;},querySelector:()=>({innerHTML:'',focus(){focused++;}})};
  const window={GatherGuests,GatherMode:{projectId:'fictional-project'}};
  vm.runInNewContext(source.replace('return { markup, mount };','return { markup, mount, submit };'),{window,document:{hidden:false,activeElement:null},URLSearchParams,FormData,
    setInterval:fn=>{poll=fn;return 1;},clearInterval(){},
    fetch:async(url,options)=>{
      requests.push({url,options});
      const saved=structuredClone(snapshot),denied=failure;
      const response=denied?{ok:false,status:denied.status,json:async()=>({error:denied.message})}:{ok:true,json:async()=>saved};
      if(deferNext){deferNext=false;return new Promise(resolve=>{resolvePending=()=>resolve(response);});}
      return response;
    },
  });
  const ui=window.GatherInfoUI.create({h:value=>String(value),openDialog:(...args)=>{dialogs.push(args);dialogKind='info';},closeDialog(){closed++;dialogKind='';},toast:value=>toasts.push(value),saveLock:()=>()=>{},isDialogOpen:kind=>kind?dialogKind===kind:!!dialogKind});
  ui.mount(host);await setImmediate();
  const click=attrs=>host.listeners.click({target:{closest:()=>({dataset:Object.fromEntries(Object.entries(attrs).map(([key,value])=>[key.replace(/^data-/,'').replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase()),value])),hasAttribute:key=>Object.hasOwn(attrs,key)})}});
  return{host,dialogs,toasts,requests,click,ui,openEditor:kind=>{dialogKind=kind;},get closed(){return closed;},get focused(){return focused;},defer(){deferNext=true;},async resolve(){resolvePending();await setImmediate();},fail:status=>{failure={status,message:'Access or load denied'};},recover(){failure=null;},change:next=>{snapshot={...snapshot,...next};},async poll(){poll();await setImmediate();}};
}

test('unconfigured or unknown storage hides upload while keeping guest entry and CSV import usable',async()=>{
  for(const available of [false,undefined]){
    const h=await harness(available);
    assert.match(h.host.innerHTML,/data-info-import/);assert.match(h.host.innerHTML,/data-info-add/);
    h.click({'data-info-tab':'files'});
    assert.doesNotMatch(h.host.innerHTML,/data-info-upload/);
    assert.match(h.host.innerHTML,/File uploads are unavailable/);
    h.click({'data-info-upload':''});
    assert.deepEqual(h.dialogs,[]);assert.deepEqual(h.toasts,['File uploads are unavailable.']);
    assert.equal(h.requests.length,1);assert.equal(h.requests[0].options.method,'GET');
    h.click({'data-info-tab':'guests'});
    assert.match(h.host.innerHTML,/data-info-import/);assert.doesNotMatch(h.host.innerHTML,/File uploads are unavailable/);
  }
});

test('storage capability changes update Files without requiring guest data revision changes',async()=>{
  const h=await harness(false);h.click({'data-info-tab':'files'});
  h.change({uploadsAvailable:true});await h.poll();
  assert.match(h.host.innerHTML,/data-info-upload/);assert.doesNotMatch(h.host.innerHTML,/File uploads are unavailable/);
  h.change({uploadsAvailable:false});await h.poll();
  assert.doesNotMatch(h.host.innerHTML,/data-info-upload/);assert.match(h.host.innerHTML,/File uploads are unavailable/);
});
test('date availability distinguishes missing responses, preserves poll zone and offers only own response controls',async()=>{
  const poll={id:'date-poll',title:'Fictional dates',timeZone:'Asia/Tokyo',dates:['2028-03-02','2028-03-04'],createdAt:'2027-12-01T00:00:00Z',createdName:'Organizer',closedAt:'',responses:[{actor:'me',name:'Teammate',answers:[{date:'2028-03-02',availability:'available'}]}]};
  const h=await harness(false,{identity:{admin:false,actor:'me'},datePolls:[poll]});h.click({'data-info-tab':'dates'});
  assert.match(h.host.innerHTML,/Date availability/);assert.match(h.host.innerHTML,/Asia\/Tokyo/);assert.match(h.host.innerHTML,/1 can attend/);assert.match(h.host.innerHTML,/No response for this date/);assert.match(h.host.innerHTML,/Edit my availability/);
  assert.doesNotMatch(h.host.innerHTML,/data-info-new-poll|data-info-poll-close/);assert.match(h.host.innerHTML,/No event date, activity time or task changes automatically/);
  h.change({revision:2,datePolls:[{...poll,closedAt:'2028-01-01'}]});await h.poll();assert.doesNotMatch(h.host.innerHTML,/data-info-poll-vote/);assert.match(h.host.innerHTML,/Closed/);assert.equal(h.requests.every(row=>row.options.method==='GET'),true);
});

test('background membership denial clears all Event info views and cannot remount cached private data',async()=>{
  for(const status of [401,403,404]) for(const tab of ['guests','files','dates']){
    const h=await harness(true,{guests:[GatherGuests.normalize({name:'Private guest'})],files:[{id:'file',name:'Private file',size:1,updatedName:'Owner',updatedAt:'2026-01-01'}],datePolls:[{id:'poll',title:'Private poll',dates:['2028-03-02','2028-03-04'],timeZone:'UTC',createdName:'Owner',createdAt:'2026-01-01',closedAt:'',responses:[]}]});
    h.click({'data-info-tab':tab});assert.match(h.host.innerHTML,/Private/);
    h.fail(status);await h.poll();
    assert.doesNotMatch(h.host.innerHTML,/Private|data-info-add|data-info-upload|data-info-new-poll|data-info-poll-vote/);
    assert.match(h.host.innerHTML,/role="alert"/);assert.match(h.host.innerHTML,/data-info-refresh/);
    const target={...h.host,innerHTML:'Loading',listeners:{}};h.ui.mount(target);
    assert.equal(target.innerHTML,'Loading','cached private state must not render during a new request');
    await setImmediate();assert.doesNotMatch(target.innerHTML,/Private/);
    h.recover();await h.poll();assert.match(target.innerHTML,/Private/,'fresh authorized read can recover at the same revision');
  }
});

test('a failed manual refresh does not retain a cache that reappears on navigation',async()=>{
  const h=await harness(false,{guests:[GatherGuests.normalize({name:'Private guest'})]});
  h.fail(500);h.click({'data-info-refresh':''});await setImmediate();assert.match(h.host.innerHTML,/role="alert"/);
  const target={...h.host,innerHTML:'Loading',listeners:{}};h.ui.mount(target);assert.equal(target.innerHTML,'Loading');await setImmediate();
  assert.doesNotMatch(target.innerHTML,/Private guest/);
});

test('access denied while saving closes the editor and removes old private data without replay',async()=>{
  for(const status of [401,403,404]){
    const h=await harness(false,{guests:[GatherGuests.normalize({name:'Private guest'})]});
    h.openEditor('info');
    const form={dataset:{},closest(){return this;},querySelector:()=>({textContent:''})};
    await h.ui.submit(form,{preventDefault(){},stopPropagation(){}},async()=>{throw Object.assign(new Error('Access denied'),{status});});
    assert.equal(h.closed,1);assert.equal(h.focused,1);assert.doesNotMatch(h.host.innerHTML,/Private guest/);assert.match(h.host.innerHTML,/role="alert"/);
    assert.equal(h.requests.length,1,'denied save is not automatically retried');
  }
});

test('same-revision identity changes update date-poll permissions and own-response controls',async()=>{
  const poll={id:'poll',title:'Dates',dates:['2028-03-02','2028-03-04'],timeZone:'UTC',createdName:'Owner',createdAt:'2026-01-01',closedAt:'',responses:[{actor:'owner',name:'Owner',answers:[]}]};
  const h=await harness(false,{identity:{admin:true,actor:'owner'},datePolls:[poll]});h.click({'data-info-tab':'dates'});
  assert.match(h.host.innerHTML,/data-info-new-poll/);assert.match(h.host.innerHTML,/Edit my availability/);
  h.change({identity:{admin:false,actor:'member'}});await h.poll();
  assert.doesNotMatch(h.host.innerHTML,/data-info-new-poll|data-info-poll-close/);assert.match(h.host.innerHTML,/Record my availability/);
});

test('an older authorized read cannot restore private data after a save denial',async()=>{
  const h=await harness(false,{guests:[GatherGuests.normalize({name:'Private guest'})]});
  h.defer();await h.poll();
  const form={dataset:{},closest(){return this;},querySelector:()=>({textContent:''})};
  await h.ui.submit(form,{preventDefault(){},stopPropagation(){}},async()=>{throw Object.assign(new Error('Access denied'),{status:404});});
  await h.resolve();assert.doesNotMatch(h.host.innerHTML,/Private guest/);assert.match(h.host.innerHTML,/Access denied/);
});

test('temporary background errors do not discard saved data and conflicts keep the editor open',async()=>{
  const h=await harness(false,{guests:[GatherGuests.normalize({name:'Private guest'})]});
  h.fail(503);await h.poll();assert.match(h.host.innerHTML,/Private guest/);
  const message={textContent:''},form={dataset:{},closest(){return this;},querySelector:()=>message};
  await h.ui.submit(form,{preventDefault(){},stopPropagation(){}},async()=>{throw Object.assign(new Error('Review latest changes'),{status:409});});
  assert.equal(h.closed,0);assert.equal(message.textContent,'Review latest changes');assert.match(h.host.innerHTML,/Private guest/);
});

test('a delayed denial closes only the Event info editor opened while the read was pending',async()=>{
  for(const kind of ['info','task']) for(const status of [401,403,404]){
    const h=await harness(false,{guests:[GatherGuests.normalize({name:'Private guest'})]});
    h.fail(status);h.defer();await h.poll();h.openEditor(kind);await h.resolve();
    assert.equal(h.closed,kind==='info'?1:0);assert.equal(h.focused,kind==='info'?1:0);assert.doesNotMatch(h.host.innerHTML,/Private guest/);
  }
});

test('a delayed changed-identity response invalidates only an owned editor',async()=>{
  for(const kind of ['info','task']){
    const h=await harness(false,{identity:{admin:true,actor:'owner'}});
    h.change({identity:{admin:false,actor:'member'}});h.defer();await h.poll();h.openEditor(kind);await h.resolve();
    assert.equal(h.closed,kind==='info'?1:0);assert.equal(h.toasts.length,kind==='info'?1:0);
  }
});
