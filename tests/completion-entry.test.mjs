import {test} from 'node:test';
import assert from 'node:assert/strict';
import '../legacy/calendar.js';
import '../legacy/store.js';
import '../legacy/priorities.js';
import '../legacy/completion-ui.js';
import '../legacy/recovery-ui.js';
const store=GatherStore.createStore({storage:null});
const ui=GatherRecoveryUI.create({store,ui:{actor:'maya'},h:String,options:rows=>rows.map(([v,l])=>`<option value="${v}">${l}</option>`).join(''),dayLabel:String,member:id=>({name:id})});
test('completion evidence has a visible entry point only when reporting is allowed',()=>{
  const task=store.getState().tasks.find(t=>t.id==='dietary');
  const html=ui.responseMarkup(task,false,false);
  assert.match(html,/>Report complete<\/button>/);assert.doesNotMatch(html,/evidence/i);assert.match(html,/Nothing is submitted until you confirm/);assert.match(html,/name="completionLinks"/);
  assert.doesNotMatch(ui.responseMarkup(task,true,false),/data-action="prepare-completion"/);
  assert.doesNotMatch(ui.responseMarkup(task,false,true),/data-action="prepare-completion"/);
});
test('opening completion preserves the note, reveals evidence and never submits or changes tasks',()=>{
  const before=store.exportState(),label={},submit={},date={},inputs=[{disabled:true}],evidence={hidden:true,querySelectorAll:()=>inputs},fields={open:false};let focused=0;
  const form={elements:{response:{value:'progress',options:[{value:'progress'},{value:'completed'}]},proposedDate:{},note:{value:'My existing draft',focus:()=>focused++}},querySelector:selector=>({'[data-proposed-date]':date,'[data-completion-only]':evidence,'[data-response-note-label]':label,'button[type="submit"]':submit,'.completion-fields':fields})[selector]};
  assert.equal(ui.prepareCompletion(form),true);assert.equal(evidence.hidden,false);assert.equal(inputs[0].disabled,false);assert.equal(focused,1);
  assert.equal(form.elements.note.value,'My existing draft');assert.equal(submit.textContent,'Submit completion');assert.match(label.textContent,/Completion note/);assert.equal(store.exportState(),before);
  form.elements.response.value='progress';ui.syncResponse(form);assert.equal(evidence.hidden,true);assert.equal(inputs[0].disabled,true);assert.equal(submit.textContent,'Save update');
  form.elements.response.options=[{value:'progress'}];assert.equal(ui.prepareCompletion(form),false);assert.equal(focused,1);assert.equal(store.exportState(),before);
});
