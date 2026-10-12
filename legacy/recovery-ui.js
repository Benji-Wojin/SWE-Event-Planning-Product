(function(root){
  'use strict';
  function create({store,ui,h,options,dayLabel,member}) {
    const P=root.GatherPriorities;
    const state=()=>store.getState();
    const dateKey=(offset=0)=>root.GatherCalendar.dayKey(new Date(),state().event.timeZone,offset);
    const tomorrow=()=>dateKey(1);
    const taskLink=t=>'<button class="text-button" data-action="task" data-id="'+h(t.id)+'">'+h(t.title)+'</button>';
    function ownerLoad(owner) {
      if(!owner)return '';
      const tasks=state().tasks,next=P.nextUp(tasks,owner,new Date(),state().event.timeZone),others=tasks.filter(t=>t.owner===owner&&t.status!=='done'&&!next.some(n=>n.id===t.id));
      return '<div class="owner-load"><span>'+h(member(owner).name.split(' ')[0])+': '+next.length+'/3 next tasks · '+others.length+' other assignments</span>'+(next.length?'<details><summary>Current commitments</summary><ul>'+next.map(t=>'<li>'+h(t.title)+'</li>').join('')+'</ul></details>':'')+'</div>';
    }
    function nextUpPanel(s) {
      const now=new Date(),active=P.nextUp(s.tasks,ui.actor,now,s.event.timeZone),owned=P.rank(s.tasks,now,true,s.event.timeZone).filter(t=>t.owner===ui.actor);
      const suggested=owned.filter(t=>!t.nextUpAt&&P.actionable(t,s.tasks)).slice(0,Math.max(0,3-active.length));
      const empty=suggested.length?'Choose up to three tasks to work on next.':owned.length?'Nothing ready to start. Review your open tasks below.':'No open tasks assigned to you.';
      return '<section class="panel next-up-panel section-gap"><div class="panel-heading"><h2 class="section-title">Next up <span class="muted">'+active.length+'/3</span></h2></div><div class="next-up-list">'+active.map(t=>'<article>'+taskLink(t)+'<span class="muted">'+dayLabel(t.dueDate)+'</span></article>').join('')+(active.length?'':'<p class="muted">'+empty+'</p>')+(suggested.length?'<details class="next-up-suggestions"'+(active.length?'':' open')+'><summary>Suggested next tasks</summary>'+suggested.map(t=>'<article>'+taskLink(t)+'<span class="muted">Review to commit</span></article>').join('')+'</details>':'')+'</div></section>';
    }
    function nextUpControl(task) {
      const s=state();
      if(task.owner!==ui.actor||!P.actionable(task,s.tasks))return '';
      const active=P.nextUp(s.tasks,ui.actor,new Date(),s.event.timeZone);
      return '<form id="nextUpForm" data-id="'+h(task.id)+'" class="next-up-control"><input type="hidden" name="enabled" value="'+(!task.nextUpAt)+'">'+(task.nextUpAt?'<span>In your next '+active.length+' tasks</span><button class="text-button" type="submit">Remove from Next up</button>':(active.length>=3?'<label class="field">Swap with<select name="replaceTaskId" required>'+options([['','Choose a current commitment'],...active.map(t=>[t.id,t.title])],'')+'</select></label>':'')+'<button class="btn btn-secondary btn-small" type="submit">'+(active.length>=3?'Swap into Next up':'Commit to this next')+'</button>')+'</form>';
    }
    function recoveryMarkup(task,organizer) {
      const s=state(),request=P.pendingRequest(task),decision=P.decision(task,s.tasks,new Date(),s.event.timeZone),suggestion=P.suggestion(task,s);
      if(!request&&(!organizer||!decision))return '';
      let html='<section class="task-recovery section-gap"><h3>'+(request?(request.kind==='date'?'Date proposal':'Help requested'):h(decision.label))+'</h3>';
      if(request)html+='<p>'+h(request.note)+'</p>'+(request.kind==='date'?'<div class="date-proposal"><span>Current: '+dayLabel(task.dueDate)+'</span><strong>Proposed: '+dayLabel(request.proposedDate)+'</strong></div>':'')+'<p class="muted">'+(organizer?'From '+h(member(request.createdBy).name):'Awaiting the organizer. Your current plan is unchanged.')+'</p>';
      if(organizer) {
        const choices=[...(request?.kind==='date'?[['date','Approve or adjust the date']]:[['date','Agree a new date']]),['reassign','Reassign the task'],['scope','Reduce the scope'],['checkin','Keep plan · set a check-in']];
        const mode=request?.kind==='date'?'date':request?.kind==='help'||!task.owner?'reassign':'checkin';
        html+='<details class="recovery-suggestion"><summary>Suggested next step</summary><p>'+h(suggestion.text)+'</p>'+suggestion.targets.map(taskLink).join('')+'</details><form id="recoveryDecisionForm" data-id="'+h(task.id)+'"><input type="hidden" name="requestId" value="'+h(request?.id||'')+'"><label class="field">Next step<select name="action">'+options(choices,mode)+'</select></label><div data-decision="date" '+(mode==='date'?'':'hidden')+'><label class="field">New due date<input type="date" name="dueDate" value="'+h(request?.proposedDate||'')+'" '+(mode==='date'?'required':'')+'></label>'+(task.hardDeadline?'<label class="check-field"><input type="checkbox" name="confirmHardDeadline"> The vendor or external deadline has also changed</label>':'')+'</div><div data-decision="reassign" '+(mode==='reassign'?'':'hidden')+'><label class="field">New owner<select name="owner" '+(mode==='reassign'?'required':'')+'>'+options([['','Choose a teammate'],...s.members.filter(m=>m.id!==task.owner&&m.active!==false).map(m=>[m.id,m.name])],'')+'</select></label><div data-owner-load></div><p class="muted">The new owner will need to accept it.</p></div><div data-decision="scope" hidden><label class="field">Smaller required outcome<textarea name="scope" rows="2" maxlength="3000">'+h(task.scope||'')+'</textarea></label></div><label class="field">Decision for the owner<textarea name="note" required rows="2" maxlength="3000"></textarea></label><label class="field">Next check-in<input name="reviewAfter" type="date" required value="'+tomorrow()+'"></label><button class="btn btn-primary" type="submit">Confirm plan</button></form>';
      }
      return html+'</section>';
    }
    function responseMarkup(task,awaiting,completionBlocked=false) {
      const overdue=task.dueDate&&task.dueDate<dateKey();
      return '<section class="task-report section-gap"><h3>'+(overdue?'What’s next?':'Your update')+'</h3>'+nextUpControl(task)+'<form id="responseForm" data-id="'+h(task.id)+'"><label class="field">Update<select name="response">'+options([['progress','Share progress'],...(!awaiting&&!completionBlocked?[['completed','Report complete']]:[]),['blocked','Report blocked'],...(!awaiting?[['date','Propose a new date'],['help','Need someone else']]:[])],'progress')+'</select></label><label class="field" data-proposed-date hidden>Proposed date<input type="date" name="proposedDate"></label><label class="field"><span class="sr-only">What happened or what do you need?</span><textarea name="note" required rows="3" maxlength="3000" placeholder="Add a short update…"></textarea></label><button class="btn btn-primary" type="submit">Save update</button></form>'+(awaiting?'<p class="muted">New progress or a blocker replaces the pending completion report.</p>':'')+(!task.acceptedAt&&!awaiting?'<button class="text-button" data-action="accept-task" data-id="'+h(task.id)+'">Accept responsibility</button>':'')+'</section>';
    }
    function priorityMarkup(task,organizer) {
      const info=P.analyze(task,state().tasks,new Date(),state().event.timeZone),value=task.priority||'auto';
      const history=(task.deadlineHistory||[]).map(item=>'<li>'+dayLabel(item.from)+' → '+dayLabel(item.to)+' · '+h(member(item.actor).name)+'</li>').join('');
      return '<details class="task-priority priority-details"><summary>Priority &amp; history · '+h(P.labels[value])+'</summary>'+(organizer?'<form id="priorityForm" data-id="'+h(task.id)+'"><label class="field">Priority<select name="priority">'+options(Object.entries(P.labels),value)+'</select></label><label class="check-field"><input type="checkbox" name="essential" '+(task.essential?'checked':'')+'> Essential for the event</label><label class="check-field"><input type="checkbox" name="hardDeadline" '+(task.hardDeadline?'checked':'')+'> Fixed vendor or external deadline</label><button class="btn btn-secondary btn-small" type="submit">Save priority</button></form>':'')+'<p>Event risk and work that unblocks others come first. Lateness increases urgency, but does not always take the top spot.</p>'+(info?'<ul>'+info.factors.map(f=>'<li>'+h(f.label)+'</li>').join('')+'</ul>':'')+(history?'<h4>Deadline history</h4><p>Original: '+dayLabel(task.originalDueDate)+'</p><ul>'+history+'</ul>':'')+'</details>';
    }
    function syncResponse(form) {
      const date=form.elements.response.value==='date';form.querySelector('[data-proposed-date]').hidden=!date;form.elements.proposedDate.required=date;
      form.elements.proposedDate.disabled=!date;
      form.elements.proposedDate.min=dateKey();
    }
    function syncDecision(form) {
      const action=form.elements.action.value;
      for(const el of form.querySelectorAll('[data-decision]')){el.hidden=el.dataset.decision!==action;for(const input of el.querySelectorAll('input,select,textarea'))input.disabled=el.hidden;}
      form.elements.dueDate.required=action==='date';form.elements.owner.required=action==='reassign';form.elements.scope.required=action==='scope';
      form.elements.dueDate.min=dateKey();form.elements.reviewAfter.min=tomorrow();
      form.querySelector('[data-owner-load]').innerHTML=ownerLoad(form.elements.owner.value);
    }
    return {nextUpPanel,responseMarkup,recoveryMarkup,priorityMarkup,ownerLoad,syncResponse,syncDecision};
  }
  root.GatherRecoveryUI={create};
})(typeof window!=='undefined'?window:globalThis);
