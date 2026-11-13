import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../legacy/calendar.js';
import '../legacy/store.js';
import '../legacy/schedule-ui.js';

const now='2026-11-21T09:00:00Z';
const today='2026-11-21',yesterday='2026-11-20',tomorrow='2026-11-22';
const myToday={date:today,mine:true,actor:'maya'};
const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const scheduleUI=GatherScheduleUI.create({h,statusBadge:value=>'<span>'+h(value)+'</span>'});
const missingLocation='Location not set';
const missingEnd='No end time set';
const forbidden=/FICTIONAL-EVENT-LEVEL-VENUE|FICTIONAL-NOTE|FICTIONAL-COMMENT|FICTIONAL-GUEST|FICTIONAL-FILE|FICTIONAL-MESSAGE|FICTIONAL-PRIVATE-BOOKING/;

function fixture(){
  const store=GatherStore.createStore({storage:null,now:Date.parse(now)});
  store.completeSetup({name:'Fictional school festival',date:today,timeZone:'America/Los_Angeles',
    location:'FICTIONAL-EVENT-LEVEL-VENUE'});
  const add=(title,start,end,location,owner='maya')=>store.addTask({
    title,owner,note:'FICTIONAL-NOTE',eventActivity:true,schedule:{start,end,location},
  });
  const overnight=add('Fictional overnight welcome desk',yesterday+'T23:30',today+'T01:30','');
  const next=add('Fictional early greeting',today+'T02:00','','East <hall> & foyer');
  const both=add('Fictional later handoff',today+'T09:00','','');
  const complete=add('Fictional complete schedule',today+'T10:00',today+'T10:30','West hall');
  const other=add('Fictional other-team check',today+'T11:00','','','dev');
  const future=add('Fictional next-day cleanup',tomorrow+'T10:00',tomorrow+'T11:00','');
  const finished=add('Fictional finished room check',today+'T00:15','','');
  store.reportCompletion(finished.id,'Fictional room check done.','maya');
  store.addComment(overnight.id,'FICTIONAL-COMMENT','maya');
  const state={...store.getState(),guests:[{name:'FICTIONAL-GUEST'}],files:[{name:'FICTIONAL-FILE'}],
    messages:[{body:'FICTIONAL-MESSAGE'}],privateRecords:[{reference:'FICTIONAL-PRIVATE-BOOKING'}]};
  return {store,state,overnight,next,both,complete,other,future,finished};
}

function buttonRows(html,item,className){
  return Array.from(html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g))
    .filter(([,attributes])=>attributes.includes('data-id="'+item.id+'"')&&attributes.includes(className))
    .map(([,attributes,content])=>({attributes,content}));
}

function printRows(html,item){
  return Array.from(html.matchAll(/<tr>([\s\S]*?)<\/tr>/g),([,content])=>content)
    .filter(content=>content.includes('<th scope="row">'+h(item.title)));
}

function textRows(text,item){
  return text.split('\n\n').filter(block=>block.includes(' — '+item.title+'\n'));
}

function assertCues(row,{location=false,end=false,label=''}){
  assert.ok(row,label+' row is rendered');
  assert.equal(row.includes(missingLocation),location,label+' missing-location cue');
  assert.equal(row.includes(missingEnd),end,label+' missing-end cue');
}

test('the live clock and dated Timeline name missing details only on affected activities',()=>{
  const f=fixture(),before=structuredClone(f.state);
  const live=scheduleUI.clock(f.state,now,myToday,false);
  const timeline=scheduleUI.view(f.state,false,now,myToday);
  assert.equal(live.labels.get(f.overnight.id),'Scheduled now');
  assert.equal(live.labels.get(f.next.id),'Next');
  for(const [item,cues] of [[f.overnight,{location:true}],[f.next,{end:true}]]){
    const rows=buttonRows(live.markup,item,'schedule-focus-task');
    assert.equal(rows.length,1,item.title);
    assert.match(rows[0].attributes,/data-schedule-focus-day="2026-11-21"/);
    assertCues(rows[0].content,{...cues,label:item.title});
  }
  for(const [item,cues] of [[f.overnight,{location:true}],[f.next,{end:true}],
    [f.both,{location:true,end:true}],[f.complete,{}],[f.finished,{location:true,end:true}]]){
    const rows=buttonRows(timeline,item,'schedule-row');
    assert.equal(rows.length,1,item.title);
    assert.match(rows[0].attributes,/data-schedule-day="2026-11-21"/);
    assertCues(rows[0].content,{...cues,label:item.title});
  }
  assert.match(buttonRows(timeline,f.overnight,'schedule-row')[0].content,/Continues from Fri, Nov 20, 2026/);
  for(const output of [live.markup,timeline]){
    assert.match(output,/East &lt;hall&gt; &amp; foyer/);
    assert.doesNotMatch(output,/<hall>|Fictional other-team check|Fictional next-day cleanup/);
    assert.doesNotMatch(output,forbidden);
  }
  assert.deepEqual(f.state,before);
});

test('printed and text Run sheets give the same missing-detail cues without revealing event-level or private data',()=>{
  const f=fixture(),before=structuredClone(f.state);
  const model=scheduleUI.runSheetModel(f.state,now,myToday);
  const printed=scheduleUI.runSheetMarkup(model),text=scheduleUI.runSheetText(model);
  for(const [item,cues] of [[f.overnight,{location:true}],[f.next,{end:true}],
    [f.both,{location:true,end:true}],[f.complete,{}],[f.finished,{location:true,end:true}]]){
    const print=printRows(printed,item),plain=textRows(text,item);
    assert.equal(print.length,1,item.title);
    assert.equal(plain.length,1,item.title);
    assertCues(print[0],{...cues,label:'print: '+item.title});
    assertCues(plain[0],{...cues,label:'text: '+item.title});
  }
  assert.match(printed,/East &lt;hall&gt; &amp; foyer/);
  assert.match(text,/East <hall> & foyer/);
  for(const output of [printed,text]){
    assert.match(output,/My activities · Maya/);
    assert.match(output,/Continues from Fri, Nov 20, 2026/);
    assert.doesNotMatch(output,/Fictional other-team check|Fictional next-day cleanup|data-action|<form/);
    assert.doesNotMatch(output,forbidden);
  }
  assert.deepEqual(f.state,before);
});

test('the Run sheet cautions once per unresolved activity within scope, not once per missing field or carryover row',()=>{
  const f=fixture(),caution=count=>count+(count===1?' activity is':' activities are')+
    ' missing an end time or location. Confirm the missing details in the live Timeline before relying on this copy.';
  const render=scope=>scheduleUI.runSheetModel(f.state,now,scope);
  for(const [scope,count] of [[myToday,3],[{date:today},4],[{...myToday,date:''},4],
    [{...myToday,date:yesterday},1],[{...myToday,date:tomorrow},1]]){
    const model=render(scope),printed=scheduleUI.runSheetMarkup(model),text=scheduleUI.runSheetText(model);
    assert.deepEqual(model.cautions.filter(item=>item.includes('missing an end time or location')),[caution(count)]);
    for(const output of [printed,text])
      assert.equal(output.split(caution(count)).length,2,'one actionable caution per copy');
  }
  const allDates=render({...myToday,date:''});
  assert.equal(allDates.days.flatMap(day=>day.rows).filter(row=>row.title===f.overnight.title).length,2);
  assert.doesNotMatch(scheduleUI.runSheet(f.state,now,{...myToday,actor:'unassigned'}),
    /missing an end time or location/,'empty scope does not warn about other owners');
  const onlyHistory={...f.state,tasks:f.state.tasks.filter(task=>task.id===f.finished.id)};
  const model=scheduleUI.runSheetModel(onlyHistory,now,myToday);
  assert.doesNotMatch(scheduleUI.runSheetText(model),/missing an end time or location/);
  assertCues(textRows(scheduleUI.runSheetText(model),f.finished)[0],{location:true,end:true,label:'historical'});
});

test('legacy whitespace-only locations render as missing without substituting the event location',()=>{
  const f=fixture(),state=structuredClone(f.state);
  state.tasks=state.tasks.filter(task=>[f.overnight.id,f.next.id].includes(task.id));
  const overnight=state.tasks.find(task=>task.id===f.overnight.id);
  const next=state.tasks.find(task=>task.id===f.next.id);
  overnight.schedule.location=' \t\n ';
  const before=structuredClone(state);
  const model=scheduleUI.runSheetModel(state,now,myToday);
  const live=scheduleUI.clock(state,now,myToday,false).markup;
  const timeline=scheduleUI.view(state,false,now,myToday);
  const print=scheduleUI.runSheetMarkup(model),plain=scheduleUI.runSheetText(model);
  const details=scheduleUI.details(overnight,false,state.event,state.tasks);
  for(const row of [buttonRows(live,overnight,'schedule-focus-task')[0]?.content,
    buttonRows(timeline,overnight,'schedule-row')[0]?.content,printRows(print,overnight)[0],
    textRows(plain,overnight)[0],details]){
    assertCues(row,{location:true,label:'legacy overnight'});
    assert.doesNotMatch(row,forbidden);
  }
  assert.match(print,/2 activities are missing an end time or location/);
  const nextDetails=scheduleUI.details(next,false,state.event,state.tasks);
  assertCues(nextDetails,{end:true,label:'explicit location'});
  assert.match(nextDetails,/East &lt;hall&gt; &amp; foyer/);
  assert.doesNotMatch(nextDetails,/<hall>|FICTIONAL-EVENT-LEVEL-VENUE/);
  assert.deepEqual(state,before);
});
