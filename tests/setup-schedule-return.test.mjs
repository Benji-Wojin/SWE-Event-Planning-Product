import {before,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setImmediate} from 'node:timers/promises';
import vm from 'node:vm';
import {build} from 'esbuild';
import '../legacy/calendar.js';
import '../legacy/schedule-ui.js';

let ProjectSetup;
before(async()=>{
  const bundle=await build({entryPoints:['app/setup/setup-client.tsx'],bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',
    plugins:[{name:'setup-schedule-client',setup(b){
      b.onResolve({filter:/^react(?:\/jsx-runtime)?$|^@\/components\/|^@\/lib\/guided-tutorial-client$|^@\/legacy\/notifications\.cjs$/},
        args=>({path:args.path,namespace:'mock'}));
      b.onLoad({filter:/.*/,namespace:'mock'},args=>({loader:'js',contents:
        args.path==='react'?'export const useState=v=>globalThis.__setupHooks.state(v),useRef=v=>globalThis.__setupHooks.ref(v),useEffect=(f,d)=>globalThis.__setupHooks.effect(f,d);':
        args.path==='react/jsx-runtime'?'export const jsx=(type,props)=>({type,props}),jsxs=jsx,Fragment="fragment";':
        args.path==='@/lib/guided-tutorial-client'?'export async function observeTutorial(step){globalThis.__setupTutorial.push(step);}':
        args.path==='@/legacy/notifications.cjs'?'export const readReminderPreference=()=>false,writeReminderPreference=()=>true;':
        'export const Button="button",buttonVariants=()=>"button",Input="input",Label="label",Switch="switch",Card="article",CardContent="div",GuideStage="guide-stage";'
      }));
    }}],
  });
  ({ProjectSetup}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64')));
});

const project='p_12345678-1234-4234-8234-123456789abc', task='fictional-activity', zone='America/Los_Angeles';
const otherProject='p_98765432-1234-4234-8234-123456789abc';
const activity={id:task,title:'Fictional welcome briefing',eventActivity:true,status:'todo',schedule:null};
const taskList=[activity,{...activity,id:'different-activity',title:'Do not use this activity'}];
const snapshot=({projectId=project,actorId='fixture-organizer',role='admin',revision=6,tasks=taskList,timeZone=''}={})=>({projectId,revision,
  identity:{actorId,role,name:'Fictional organizer'},setupRequired:false,reminderScope:'fixture-reminders',state:{
    event:{name:'Fictional event',date:'',location:'',timeZone,guestCount:0,dietaryOutstanding:0,cateringDeadline:'',outdoor:false,transportNeeded:false},
    tasks:structuredClone(tasks),
  }});
const nodes=value=>value&&typeof value==='object'?(Array.isArray(value)?value.flatMap(nodes):[value,...nodes(value.props?.children)]):[];
const text=value=>value&&typeof value==='object'?(Array.isArray(value)?value.map(text).join(''):text(value.props?.children)):
  typeof value==='string'||typeof value==='number'?String(value):'';

async function harness({props={},initial=snapshot(),reply=()=>Response.json(snapshot({revision:7,timeZone:zone})),activeId}={}){
  const names=['fetch','window','document','__setupHooks','__setupTutorial'];
  const previous=Object.fromEntries(names.map(name=>[name,globalThis[name]]));
  const calls=[],nav=[],tutorial=[],focused=[],state=[];
  let effects=[],rendered,changed=true,index=0;
  const body={id:'body'},document={body,activeElement:activeId?{id:activeId}:body};
  const window={location:{assign:url=>nav.push(url)},addEventListener(){},removeEventListener(){},confirm(){return true;}};
  Object.assign(globalThis,{window,document,__setupTutorial:tutorial,__setupHooks:{
    state(initial){const id=index++;state[id]??={value:initial};return [state[id].value,next=>{
      const value=typeof next==='function'?next(state[id].value):next;
      if(!Object.is(value,state[id].value)){state[id].value=value;changed=true;}
    }];},
    ref(initial){const id=index++;return state[id]??={current:initial};},
    effect(fn,deps){const id=index++,old=state[id];
      if(!old||deps.some((dep,i)=>dep!==old.deps[i])){state[id]={deps,cleanup:old?.cleanup};effects.push(()=>{old?.cleanup?.();state[id].cleanup=fn();});}},
  }});
  globalThis.fetch=async(url,options)=>{
    const request={url,method:options.method,body:options.body?JSON.parse(options.body):undefined};
    calls.push(request);
    return request.method==='GET'?Response.json(initial):await reply(request);
  };
  function render(){
    index=0;changed=false;
    rendered=ProjectSetup({projectId:project,scheduleTask:task,resumeGuide:true,...props});
    for(const node of nodes(rendered).filter(node=>node.props?.ref)){
      const control={id:node.props.id??node.props.role};
      node.props.ref.current={...control,focus(){focused.push(control.id);document.activeElement=control;}};
    }
    const batch=effects;effects=[];batch.forEach(fn=>fn());
  }
  async function settle(){for(let round=0;round<8;round++){
    if(changed)render();await setImmediate();
  }if(changed)render();}
  const find=id=>nodes(rendered).find(node=>node.props?.id===id);
  const form=()=>nodes(rendered).find(node=>node.type==='form');
  await settle();
  return {calls,nav,tutorial,focused,find,form,settle,get tree(){return rendered;},
    label:()=>text(nodes(form()).find(node=>node.type==='button'&&node.props.type==='submit')),
    alert:()=>text(nodes(rendered).find(node=>node.props?.role==='alert')),
    async edit(value){find('setup-timeZone').props.onChange({target:{value}});await settle();},
    async submit(){await form().props.onSubmit({preventDefault(){}});await settle();},
    dispose(){state.forEach(entry=>entry?.cleanup?.());Object.assign(globalThis,previous);},
  };
}

test('eligible activity setup focuses the zone without stealing focus and waits for a scoped save before returning',async()=>{
  for(const resumeGuide of [true,false]){
    let release;
    const result=new Promise(resolve=>{release=resolve;});
    const f=await harness({props:{resumeGuide},activeId:resumeGuide?undefined:'existing-user-focus',reply:()=>result});
    try{
      assert.equal(f.label(),'Save & return to activity');
      assert.match(text(f.find('setup-schedule-return')),/Fictional welcome briefing.*won’t set a start time/);
      assert.match(f.find('setup-timeZone').props['aria-describedby'],/setup-schedule-return/);
      assert.deepEqual(f.focused,resumeGuide?['setup-timeZone']:[]);
      assert.deepEqual(f.tutorial,[],'a continuation does not record a first-project setup view');
      assert.equal(nodes(f.tree).find(node=>node.type==='a'&&text(node)==='Back to project')?.props.href,`/project?project=${project}`);
      await f.edit(zone);
      const save=f.submit();
      await f.settle();
      assert.deepEqual(f.nav,[],'waiting for a confirmed workspace response');
      const [load,write]=f.calls;
      for(const request of [load,write])assert.equal(request.url,`/api/workspace?project=${project}`);
      assert.equal(write.method,'POST');
      assert.equal(write.body.method,'completeSetup');
      assert.equal(write.body.revision,6);
      assert.equal(write.body.args[0].timeZone,zone);
      assert.equal(Object.hasOwn(write.body.args[0],'scheduleTask'),false);
      release(Response.json(snapshot({revision:7,timeZone:zone})));
      await save;
      assert.deepEqual(f.nav,[`/project?project=${project}&task=${task}${resumeGuide?'&guide=1':''}&review=schedule&from=plan-receipt`]);
      assert.equal(f.calls.length,2,'leaving setup neither edits the activity nor opens anything else');
    }finally{f.dispose();}
  }
});

test('a stale or unqualified activity cannot direct setup navigation to a task',async()=>{
  for(const tasks of [[],[{...activity,archivedAt:'2026-11-12T08:00:00Z'}],[{...activity,status:'done'}],
    [{...activity,schedule:{start:'2026-11-20T08:00',end:'',location:''}}],[{...activity,eventActivity:false}]]){
    const f=await harness({reply:()=>Response.json(snapshot({revision:7,timeZone:zone,tasks}))});
    try{
      await f.edit(zone);await f.submit();
      assert.deepEqual(f.nav,[`/project?project=${project}`]);
      assert.equal(f.calls.length,2);
    }finally{f.dispose();}
  }
  const ordinary=await harness({props:{scheduleTask:'nonexistent-activity'}});
  try{
    assert.equal(ordinary.label(),'Save & open project');
    assert.equal(ordinary.find('setup-schedule-return'),undefined);
    assert.deepEqual(ordinary.focused,[]);
    await ordinary.edit(zone);await ordinary.submit();
    assert.deepEqual(ordinary.nav,[`/project?project=${project}`]);
  }finally{ordinary.dispose();}
  const teammate=await harness({initial:snapshot({role:'member'})});
  try{
    assert.match(teammate.alert(),/Only the organizer/);
    assert.equal(teammate.form(),undefined);
    assert.deepEqual(teammate.nav,[]);
    assert.deepEqual(teammate.calls.map(call=>call.method),['GET']);
  }finally{teammate.dispose();}
});

test('a schedule hint never treats a different project snapshot as the source workspace',async()=>{
  const f=await harness({initial:snapshot({projectId:otherProject})});
  try{
    assert.match(f.alert(),/Could not confirm which project was loaded/);
    assert.equal(f.form(),undefined);
    assert.equal(f.find('setup-schedule-return'),undefined);
    assert.deepEqual(f.calls.map(call=>[call.method,call.url]),[['GET',`/api/workspace?project=${project}`]]);
    assert.deepEqual(f.nav,[]);
  }finally{f.dispose();}
});

test('an unconfirmed workspace save leaves the entered zone and does not navigate',async()=>{
  for(const [name,reply] of [
    ['changed actor',()=>Response.json(snapshot({actorId:'different-actor',revision:7,timeZone:zone}))],
    ['different project',()=>Response.json(snapshot({projectId:otherProject,revision:7,timeZone:zone}))],
    ['lost organizer role',()=>Response.json(snapshot({role:'member',revision:7,timeZone:zone}))],
    ['unchanged revision',()=>Response.json(snapshot({revision:6,timeZone:zone}))],
    ['changed zone',()=>Response.json(snapshot({revision:7,timeZone:'UTC'}))],
    ['conflict',()=>Response.json({error:'The project changed. Reload saved details.'},{status:409})],
  ]){
    const f=await harness({reply});
    try{
      await f.edit(zone);await f.submit();
      assert.deepEqual(f.nav,[],name);
      assert.equal(f.find('setup-timeZone').props.value,zone,name);
      assert.match(f.alert(),name==='conflict'?/project changed/i:/Could not confirm the event time zone/i,name);
      assert.deepEqual(f.calls.map(call=>call.method),['GET','POST'],name);
    }finally{f.dispose();}
  }
});

test('only the exact visible time-zone control in an eligible receipt task constructs a continuation URL',()=>{
  const source=readFileSync('legacy/app.js','utf8');
  const fragment=(first,last)=>{
    const start=source.indexOf(first),end=source.indexOf(last,start+first.length);
    assert.ok(start>=0&&end>start,first);return source.slice(start,end);
  };
  const actual=fragment('  function setPlanReceiptReturn(','  function focusPlanReceiptAfterSchedule(')+
    fragment('  function receiptZoneSetupHref(','  function memoryEditDialog(');
  for(const reason of ['guided','normal','other button','detached','closed modal','hidden control','closed disclosure','hidden page','named zone',
    'already scheduled','archived','completed','different receipt view','different project','owner intent','member','lost access']){
    const ui={view:'tasks',actor:'fixture-organizer',detailId:task,dialogKind:'task'};
    const window={GatherMode:{projectId:project,demo:false,projectUrl:path=>`${path}?project=${window.GatherMode.projectId}`},top:{location:{href:'unchanged'}}};
    const document={hidden:reason==='hidden page'};
    const state=snapshot().state;
    if(reason==='named zone')state.event.timeZone=zone;
    const dialog={},backdrop={hidden:false},h=String;
    const expected={isConnected:true,closest:()=>reason==='hidden control'?{}:null,getClientRects:()=>[{}]};
    let organizer=true;
    const opened=[];
    const context=vm.createContext({ui,window,document,store:{getState:()=>state},guidedWorkspace:reason==='guided',URLSearchParams,Intl,h,
      isOrganizer:()=>organizer,hiddenByClosedDisclosure:()=>reason==='closed disclosure',openDialog:(...args)=>opened.push(args),
      schedule:GatherScheduleUI.create({h,options:()=>'',statusBadge:h}),options:()=>'',
      $(selector,root){if(selector==='#dialog')return dialog;if(selector==='#dialogBackdrop')return backdrop;assert.equal(root,dialog);
        assert.equal(selector,'.task-schedule [data-action="event-context"]');return expected;},
    });
    vm.runInContext(actual,context);
    context.setPlanReceiptReturn(task,reason==='owner intent'?'owner':'schedule');
    if(reason==='detached')expected.isConnected=false;
    if(reason==='closed modal')backdrop.hidden=true;
    if(reason==='already scheduled')state.tasks[0].schedule={start:'2026-11-20T08:00',end:'',location:''};
    if(reason==='archived')state.tasks[0].archivedAt='2026-11-12T08:00:00Z';
    if(reason==='completed')state.tasks[0].status='done';
    if(reason==='different receipt view')ui.view='overview';
    if(reason==='different project')window.GatherMode.projectId=otherProject;
    if(reason==='member')organizer=false;
    if(reason==='lost access')window.GatherAccessLost=true;
    context.contextDialog(reason==='other button'?{...expected}:expected);
    assert.equal(window.top.location.href,
      ['guided','normal'].includes(reason)?`/setup?project=${project}&scheduleTask=${task}${reason==='guided'?'&guide=1':''}`:
      ['member','lost access'].includes(reason)?'unchanged':`/setup?project=${window.GatherMode.projectId}`, reason);
    assert.equal(opened.length,Number(reason==='member'),reason);
  }
});
