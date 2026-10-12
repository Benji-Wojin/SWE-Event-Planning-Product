import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {setImmediate} from 'node:timers/promises';
import '../legacy/guests.js';

const source=readFileSync('legacy/info-ui.js','utf8');
async function harness(uploadsAvailable){
  let snapshot={revision:1,uploadsAvailable,identity:{admin:true},guests:[],files:[]},poll;
  const dialogs=[],toasts=[],requests=[];
  const host={isConnected:true,innerHTML:'',listeners:{},contains:()=>false,addEventListener(event,fn){this.listeners[event]=fn;},querySelector:()=>({innerHTML:''})};
  const window={GatherGuests,GatherMode:{projectId:'fictional-project'}};
  vm.runInNewContext(source,{window,document:{hidden:false,activeElement:null},URLSearchParams,FormData,
    setInterval:fn=>{poll=fn;return 1;},clearInterval(){},
    fetch:async(url,options)=>{requests.push({url,options});return{ok:true,json:async()=>structuredClone(snapshot)};},
  });
  const ui=window.GatherInfoUI.create({h:value=>String(value),openDialog:(...args)=>dialogs.push(args),closeDialog(){},toast:value=>toasts.push(value),saveLock:()=>()=>{},isDialogOpen:()=>false});
  ui.mount(host);await setImmediate();
  const click=attrs=>host.listeners.click({target:{closest:()=>({dataset:Object.fromEntries(Object.entries(attrs).map(([key,value])=>[key.replace(/^data-/,'').replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase()),value])),hasAttribute:key=>Object.hasOwn(attrs,key)})}});
  return{host,dialogs,toasts,requests,click,change:next=>{snapshot={...snapshot,...next};},async poll(){poll();await setImmediate();}};
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
