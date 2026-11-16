import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import vm from 'node:vm';
import '../legacy/guests.js';

const source = readFileSync('legacy/info-ui.js', 'utf8');
const actor = 'fictional-member', pollId = 'fictional-date-poll';
const dates = ['2026-12-08','2026-12-10','2026-12-12'], [a,b,c] = dates;
const entity = { '&':'amp', '<':'lt', '>':'gt', '"':'quot', "'":'#39' };
const h = value => String(value??'').replace(/[&<>"']/g, ch=>`&${entity[ch]};`);
const decode = value => value.replace(/&(amp|lt|gt|quot|#39);/g,(_,part)=>Object.keys(entity).find(ch=>entity[ch]===part));
const own = (answers, patch={}) => ({actor, name:'Fictional member', at:'2026-11-12T19:00:00Z',
  answers:Object.entries(answers).filter(([, availability])=>availability).map(([date,availability])=>({date,availability})), ...patch});
const poll = (answers={},patch={}) => ({id:pollId,title:'Fictional planning dates',timeZone:'America/Los_Angeles',createdName:'Fictional organizer',
  closedAt:'',dates:[...dates],responses:[own(answers),own({[a]:'available'},{actor:'other-fixture-member',name:'Different voter'})],...patch});

function makeDocument() {
  const document={hidden:false,activeElement:null};
  function element(tag, attributes={}) {
    const el={ tagName:tag.toUpperCase(), attributes:Object.entries(attributes).map(([name,value])=>({name,value})),
      dataset:Object.fromEntries(Object.entries(attributes).filter(([name])=>name.startsWith('data-'))
        .map(([name,value])=>[name.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase()),value])),
      children:[],listeners:{},isConnected:true,disabled:Object.hasOwn(attributes,'disabled'),hidden:Object.hasOwn(attributes,'hidden'),
      name:attributes.name??'',id:attributes.id??'',value:attributes.value??'',selected:Object.hasOwn(attributes,'selected'),
      addEventListener(type,listener){this.listeners[type]=listener;},
      contains(node){return this===node||this.children.some(child=>child.contains(node));},
      matches(selector){return selector.split(',').some(term=>{
        if(term.trim()===':disabled')return this.disabled;
        const match=term.trim().match(/^(?:#([\w-]+)|([\w-]+)|\.([\w-]+))?((?:\[[^\]]+\])*)$/);
        if(!match)return false;
        const [,id,name,cls,attrs]=match;
        return (!id||this.id===id)&&(!name||this.tagName===name.toUpperCase())&&
          (!cls||this.className?.split(/\s+/).includes(cls))&&
          Array.from(attrs.matchAll(/\[([\w-]+)(?:=(?:"([^"]*)"|([^\]]+)))?\]/g)).every(([,key,quoted,unquoted])=>
            this.hasAttribute(key)&&((quoted??unquoted)===undefined||this.getAttribute(key)===(quoted??unquoted)));
      });},
      querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);},
      querySelector(selector){return this.querySelectorAll(selector)[0]??null;},
      closest(selector){for(let node=this;node;node=node.parentElement)if(node.matches(selector))return node;return null;},
      hasAttribute(key){return key==='hidden'?this.hidden:key==='disabled'?this.disabled:this.getAttribute(key)!==null;},
      getAttribute(key){return this.attributes.find(attribute=>attribute.name===key)?.value??null;},
      setAttribute(key,value){const attr=this.attributes.find(attribute=>attribute.name===key);if(attr)attr.value=String(value);else this.attributes.push({name:key,value:String(value)});},
      removeAttribute(key){this.attributes=this.attributes.filter(attribute=>attribute.name!==key);},
      append(...items){for(const item of items)if(typeof item==='object'){item.parentElement=this;this.children.push(item);}else this.rawText+=String(item);},
      prepend(item){item.parentElement=this;this.children.unshift(item);},
      replaceChildren(...items){this.children.forEach(detach);this.children=[];this.rawText='';this.append(...items);},
      focus(){if(this.isConnected&&!this.disabled)document.activeElement=this;},
      getClientRects(){return this.isConnected&&!this.hidden?[{}]:[];},
      rawText:'', className:attributes.class??'',
      get textContent(){return this.rawText+this.children.map(item=>item.textContent).join('');},
      set textContent(value){this.replaceChildren();this.rawText=String(value??'');},
      get innerHTML(){return this.html??'';},
      set innerHTML(value){this.replaceChildren();this.html=value;parse(this,String(value));},
    };
    if(tag==='select') {
      Object.defineProperty(el,'options',{get:()=>el.children});
      Object.defineProperty(el,'selectedOptions',{get:()=>el.children.filter(option=>option.value===el.value)});
    }
    return el;
  }
  function detach(el){el.isConnected=false;el.children.forEach(detach);if(document.activeElement===el)document.activeElement=document.body;}
  function parse(root,markup){
    const parents=[root];
    for(const match of markup.matchAll(/<(\/?)([a-z][a-z0-9-]*)([^>]*)>|([^<]+)/gi)){
      const [,close,name,attrs,text]=match;
      if(text!==undefined){parents.at(-1).rawText+=decode(text);continue;}
      if(close){
        const index=parents.findLastIndex(node=>node.tagName===name.toUpperCase());
        if(index>0){
          const parent=parents[index];
          if(name==='select')parent.value=(parent.children.find(option=>option.selected)||parent.children[0])?.value??'';
          parents.length=index;
        }
        continue;
      }
      const attributes=Object.fromEntries(Array.from(attrs.matchAll(/([\w-]+)(?:="([^"]*)")?/g),([,key,value])=>[key,decode(value??'')]));
      const el=element(name,attributes);
      parents.at(-1).append(el);
      if(!['input','img','hr','br'].includes(name))parents.push(el);
    }
  }
  document.body=element('body');document.activeElement=document.body;
  document.createElement=tag=>element(tag);
  document.createTextNode=text=>String(text);
  return {document,element,detach};
}

async function harness(opening={}, {demo=false}={}) {
  const {document,element,detach}=makeDocument();
  const host=element('div',{id:'eventInfo'}), requests=[], notices=[], dialogs=[];
  document.body.append(host);
  let snapshot={revision:7,identity:{actor,admin:false,name:'Fictional member'},guests:[],files:[],datePolls:[poll(opening)]};
  let form, dialogRoot, closed=0, post, read, delay;
  const window={GatherGuests,GatherMode:{projectId:'fictional-dates',...(demo?{demo:true,actor}:{})}};
  document.getElementById=id=>form?.id===id?form:dialogRoot?.id===id?dialogRoot:host.id===id?host:null;
  class FormData extends Map {constructor(current){super(current.querySelectorAll('select').filter(el=>el.name&&!el.disabled).map(el=>[el.name,el.value]));}}
  const response=(status,body,malformed=false)=>({ok:status<400,status,json:async()=>{
    if(malformed)throw new SyntaxError('Fixture received invalid JSON');
    return structuredClone(body);
  }});
  vm.runInNewContext(source,{window,document,URLSearchParams,FormData,AbortSignal,AbortController,crypto,setTimeout,clearTimeout,
    setInterval:()=>1,clearInterval(){},requestAnimationFrame:fn=>fn(),fetch:async(url,options)=>{
      const request={method:options.method,url,body:options.body,signal:options.signal};requests.push(request);
      if(delay)await delay;
      const override=request.method==='POST'?post:read;
      const scripted=typeof override==='function'?override(request,snapshot):override;
      if(scripted==='network')throw new TypeError('Fixture connection reset');
      if(scripted)return response(scripted.status,scripted.body??{error:'Fictional request failed'},scripted.malformed);
      if(request.method==='POST'){
        const body=JSON.parse(request.body);
        assert.equal(body.action,'respondDatePoll');
        assert.equal(body.id,pollId);
        const current=snapshot.datePolls.find(p=>p.id===body.id);
        if(!current||current.closedAt||snapshot.revision!==body.revision)return response(409,{error:'Event info changed.'});
        current.responses=current.responses.filter(item=>item.actor!==actor);
        if(body.answers.length)current.responses.push({...own({}),answers:body.answers});
        snapshot.revision++;
      }
      return response(200,snapshot);
    }});
  function dismiss(){if(dialogRoot)detach(dialogRoot);dialogRoot=null;form=null;}
  const ui=window.GatherInfoUI.create({h, openDialog:(title,markup)=>{
    dismiss();dialogs.push([title,markup]);dialogRoot=element('div',{id:'dialog'});dialogRoot.innerHTML=markup;
    form=dialogRoot.querySelector('#datePollForm');
    assert.ok(form);
    const named=form.querySelectorAll('select').filter(el=>el.name).map(el=>[el.name,el]);
    form.elements=Object.assign(Object.fromEntries(named),{namedItem:name=>form?.querySelector(`[name="${name}"]`)??null});
  },closeDialog(){closed++;dismiss();},isDialogOpen:()=>!!form,toast:text=>notices.push(text),
  saveLock(current){const owner=current.tagName==='FORM'?current:current.querySelector('form');owner.dataset.saving='true';
    const controls=owner.querySelectorAll('button,select').map(control=>[control,control.disabled]);
    controls.forEach(([control])=>{control.disabled=true;});
    return ()=>{delete owner.dataset.saving;controls.forEach(([control,disabled])=>{control.disabled=disabled;});};
  }});
  ui.mount(host);await setImmediate();
  function clickHost(selector){const button=host.querySelector(selector);assert.ok(button,selector);return host.listeners.click({target:button});}
  clickHost('[data-info-tab="dates"]');clickHost(`[data-info-poll-vote="${pollId}"]`);
  const event=target=>({target,currentTarget:target,submitter:target.querySelector('button[type="submit"]'),preventDefault(){},stopPropagation(){}});
  return {window,host,notices,dialogs,requests,dismiss,
    get form(){return form;},get closed(){return closed;},get posts(){return requests.filter(row=>row.method==='POST');},
    get reads(){return requests.filter(row=>row.method==='GET');},get values(){return Object.fromEntries(dates.map(date=>[date,form?.elements.namedItem(date)?.value]));},
    get notice(){return form?.querySelector('[data-poll-notice]')?.textContent??'';},
    control(selector){return form?.querySelector(selector)??null;},
    setPost(override){post=override;},setRead(override){read=override;},setDelay(value){delay=value;},
    update(answers,patch={}){snapshot={...snapshot,revision:snapshot.revision+1,datePolls:[poll(answers,patch)]};},
    draft(changes){for(const [date,value] of Object.entries(changes)){const control=form.elements.namedItem(date);assert.ok(control,date);control.value=value;
      control.listeners.change?.(event(control));form.listeners.change?.(event(control));}},
    choose(date,value){const options=form.querySelectorAll('select[data-poll-choice]');
      const control=options.find(el=>el.dataset.pollChoice===date)||options.find(el=>el.name.endsWith(date))||(options.length===1?options[0]:null);
      assert.ok(control,date);control.value=value;control.listeners.change?.(event(control));form.listeners.change?.(event(control));},
    submit(original=form){return original.listeners.submit(event(original));},
    click(selector){const control=this.control(selector);assert.ok(control,selector);return (control.listeners.click||form.listeners.click)?.(event(control));},
  };
}

const review='[data-poll-review]', apply='[data-poll-apply]', retry='[data-poll-retry]';
const payload = request => JSON.parse(request.body);
const methods = fixture => fixture.requests.map(row=>row.method);
const actionable = el => !!el&&!el.disabled&&!el.hidden&&el.getAttribute('aria-disabled')!=='true'&&!el.closest('[hidden]');

test('a definitive conflict merges non-overlapping responses in place and only explicit Save writes the revised draft',async()=>{
  const f=await harness({[a]:'available',[b]:'maybe',[c]:'unavailable'}), originalForm=f.form;
  f.draft({[a]:'maybe',[c]:''});
  const draft=f.values;
  f.update({[a]:'available',[b]:'unavailable',[c]:'unavailable'});
  await f.submit();
  assert.deepEqual(f.values,draft);
  assert.deepEqual(methods(f),['GET','POST']);
  assert.equal(f.posts[0].url,'/api/info?project=fictional-dates');
  assert.equal(payload(f.posts[0]).revision,7);
  assert.equal(actionable(f.control(retry)),false);
  assert.ok(actionable(f.control(review)));
  await f.submit();
  assert.equal(f.posts.length,1);

  await f.click(review);
  assert.equal(f.form,originalForm,'review stays on the exact unsaved form');
  assert.deepEqual(methods(f),['GET','POST','GET']);
  assert.deepEqual(f.values,{[a]:'maybe',[b]:'unavailable',[c]:''});
  assert.equal(f.form.querySelectorAll('select[data-poll-choice]').length,0);
  assert.deepEqual(f.notices,[]);
  await f.submit();
  assert.deepEqual(methods(f),['GET','POST','GET','POST']);
  const saved=payload(f.posts[1]);
  assert.equal(saved.revision,8);
  assert.notEqual(saved.requestId,payload(f.posts[0]).requestId);
  assert.deepEqual(saved.answers,[{date:a,availability:'maybe'},{date:b,availability:'unavailable'}]);
  assert.equal(f.closed,1);
});

test('overlapping date edits require an explicit choice and never auto-save a cleared date',async()=>{
  const f=await harness({[a]:'available',[b]:'maybe',[c]:''});
  f.draft({[a]:'',[b]:'available'});
  const draft=f.values;
  f.update({[a]:'maybe',[b]:'maybe',[c]:'available'});
  await f.submit();
  await f.click(review);
  assert.deepEqual(f.values,draft,'overlap review does not silently change the draft before Apply');
  const choices=f.form.querySelectorAll('select[data-poll-choice]');
  assert.equal(choices.length,1);
  assert.equal(choices[0].value,'','neither saved nor draft is selected by default');
  await f.submit();
  await f.click(apply);
  assert.deepEqual(methods(f),['GET','POST','GET']);
  assert.deepEqual(f.values,draft);
  f.choose(a,'draft'); // Explicitly keep the intentional blank.
  await f.click(apply);
  assert.deepEqual(methods(f),['GET','POST','GET']);
  assert.deepEqual(f.values,{[a]:'',[b]:'available',[c]:'available'});
  await f.submit();
  assert.deepEqual(payload(f.posts[1]).answers,[{date:b,availability:'available'},{date:c,availability:'available'}]);
});

test('editing the draft after a choice was shown invalidates the old choice instead of applying it',async()=>{
  const f=await harness({[a]:'available'});
  f.draft({[a]:'maybe',[b]:'unavailable'});
  f.update({[a]:'unavailable',[c]:'maybe'});
  await f.submit();
  await f.click(review);
  f.choose(a,'saved');
  f.draft({[a]:''});
  await f.click(apply);
  assert.equal(f.values[a],'');
  assert.equal(f.values[b],'unavailable');
  assert.ok(f.form.querySelectorAll('select[data-poll-choice]').every(el=>el.value===''));
  await f.submit();
  assert.equal(f.posts.length,1,'stale conflict choices cannot authorize Save');
  f.choose(a,'draft');
  await f.click(apply);
  assert.equal(f.values[c],'maybe');
  assert.equal(f.posts.length,1);
});

test('ambiguous save pins the same real request, while an unmatched read preserves and blocks the newer draft',async()=>{
  for(const demo of [false,true]){
    const f=await harness({[a]:'available'},{demo});
    f.draft({[a]:'maybe',[b]:'unavailable'});
    f.setPost('network');
    await f.submit();
    const [original]=f.posts;
    f.draft({[b]:'available'});
    const newer=f.values;
    await f.submit();
    assert.equal(f.posts.length,1);
    assert.equal(actionable(f.control(retry)),!demo);
    f.update({[a]:'available',[c]:'maybe'});
    await f.click(review);
    assert.deepEqual(f.values,newer);
    assert.equal(f.closed,0);
    assert.deepEqual(methods(f),['GET','POST','GET']);
    assert.deepEqual(f.notices,[]);
    await f.submit();
    assert.equal(f.posts.length,1);
    if(!demo){
      f.setPost({status:503});
      await f.click(retry);
      assert.equal(f.posts.length,2);
      assert.equal(f.posts[1].body,original.body);
      assert.equal(f.posts[1].url,original.url);
      assert.deepEqual(f.values,newer);
    }
  }
});

test('after uncertainty only a matching newer response unlocks later edits, without sending them',async()=>{
  const f=await harness({[a]:'available',[b]:'maybe'});
  f.draft({[a]:'',[b]:''});
  f.setPost({status:200,malformed:true});
  await f.submit();
  const original=payload(f.posts[0]);
  assert.deepEqual(original.answers,[]);
  assert.equal(f.closed,0);
  f.draft({[c]:'maybe'});
  f.update({}, {responses:[own({[a]:'available',[b]:'maybe'},{actor:'other-fixture-member'})]});
  f.setRead((_request,snapshot)=>({status:200,body:{...snapshot,revision:7}}));
  await f.click(review);
  assert.deepEqual(methods(f),['GET','POST','GET']);
  assert.match(f.notice,/don.t confirm/i);
  assert.deepEqual(f.values,{[a]:'',[b]:'',[c]:'maybe'});
  await f.submit();
  assert.equal(f.posts.length,1);

  f.setRead(null);
  await f.click(review);
  assert.deepEqual(methods(f),['GET','POST','GET','GET']);
  assert.match(f.notice,/match your earlier submission/i);
  assert.deepEqual(f.values,{[a]:'',[b]:'',[c]:'maybe'});
  assert.equal(actionable(f.control(retry)),false);
  assert.deepEqual(f.notices,[]);
  f.setPost(null);
  await f.submit();
  const replacement=payload(f.posts[1]);
  assert.notEqual(replacement.requestId,original.requestId);
  assert.equal(replacement.revision,8);
  assert.deepEqual(replacement.answers,[{date:c,availability:'maybe'}]);
});

test('malformed saved answers cannot confirm a submitted clear or unlock the next draft',async()=>{
  for(const [label,responses] of [
    ['missing availability',[own({}, {answers:[{date:a}]})]],
    ['duplicate answer date',[own({}, {answers:[{date:a,availability:'maybe'},{date:a,availability:'available'}]})]],
    ['duplicate voter response',[own({}),own({[a]:'available'})]],
  ]){
    const f=await harness({[a]:'available'});
    const form=f.form,listBefore=f.host.innerHTML;
    f.draft({[a]:''});
    f.update({}, {responses});
    f.setPost((_request,snapshot)=>({status:200,body:snapshot}));
    await f.submit();
    assert.deepEqual(payload(f.posts[0]).answers,[],label);
    assert.equal(f.form,form,label);
    assert.equal(f.closed,0,label);
    assert.equal(f.form.dataset.pollUnconfirmed,'true',label);
    assert.equal(f.host.innerHTML,listBefore,label);
    f.draft({[c]:'maybe'});
    const draft=f.values;
    await f.click(review);
    assert.match(f.notice,/Could not check the latest responses/i,label);
    assert.equal(f.form.dataset.pollUnconfirmed,'true',label);
    assert.deepEqual(f.values,draft,label);
    assert.equal(f.host.innerHTML,listBefore,label);
    assert.deepEqual(f.notices,[],label);
    await f.submit();
    assert.deepEqual(methods(f),['GET','POST','GET'],label);
  }
});

test('closed poll, changed dates, and failed review reads cannot reset or send an existing draft',async()=>{
  for(const issue of ['closed','changed dates','read failure']){
    const f=await harness({[a]:'available'});
    f.draft({[a]:'maybe',[b]:'unavailable'});
    const draft=f.values;
    f.update({[a]:'available'},issue==='closed'?{closedAt:'2026-11-24T21:00:00Z'}:
      issue==='changed dates'?{dates:[a,b,'2026-12-15']} : {});
    if(issue==='read failure')f.setRead({status:503});
    await f.submit();
    const original=f.form;
    await f.click(review);
    assert.equal(f.form,original,issue);
    assert.deepEqual(f.values,draft,issue);
    assert.deepEqual(methods(f),['GET','POST','GET'],issue);
    assert.equal(actionable(f.control(apply)),false,issue);
    assert.equal(actionable(f.control(retry)),false,issue);
    assert.deepEqual(f.notices,[],issue);
    await f.submit();
    assert.equal(f.posts.length,1,issue);
  }
});

test('late review responses cannot republish a dismissed or switched project’s draft',async()=>{
  for(const interrupt of ['dismiss','project switch']){
    const f=await harness({[a]:'available'});
    f.draft({[a]:'maybe'});
    const draft=f.values;
    f.update({[a]:'available',[b]:'maybe'});
    await f.submit();
    const form=f.form;
    const listBefore=f.host.innerHTML;
    let finish;
    f.setDelay(new Promise(resolve=>{finish=resolve;}));
    const pending=f.click(review);
    assert.deepEqual(methods(f),['GET','POST','GET']);
    if(interrupt==='dismiss')f.dismiss();
    else f.window.GatherMode.projectId='different-fictional-project';
    finish();await pending;
    assert.equal(f.dialogs.length,1);
    assert.equal(f.host.innerHTML,listBefore,'the late read does not redraw the list');
    assert.deepEqual(f.notices,[]);
    if(interrupt==='project switch'){
      assert.deepEqual(f.values,draft);
      await f.submit(form);
      assert.equal(f.posts.length,1);
    }
  }
});
