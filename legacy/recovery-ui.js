(function(root){
  'use strict';
  const reviewLabels={completion:'Verify completion',amendment:'Review amended evidence',help:'Respond to help request',date:'Review proposed date'};
  const requestDecisionLabels={date:'Due date changed',reassign:'Task reassigned',scope:'Outcome reviewed',checkin:'Current plan kept'};
  function organizerReviews(tasks) {
    const time=value=>{const parsed=Date.parse(value||'');return Number.isFinite(parsed)?parsed:Number.MAX_SAFE_INTEGER;};
    return tasks.flatMap(task=>{
      if(task.archivedAt)return [];
      if(task.status==='done'){
        if(task.verifiedAt&&task.completionEvidence&&task.completionEvidenceReviewAt!==task.verifiedAt)
          return [{task,kind:'amendment',at:task.completionEvidence.at}];
        // A legacy Done record without a current report has nothing to verify here.
        if(!task.reportedAt)return [];
      }
      if(task.requiresVerification&&task.reportedAt&&!task.verifiedAt)
        return [{task,kind:'completion',at:task.reportedAt,waitingOnRequiredWork:root.GatherPriorities.unresolved(task,tasks).length>0}];
      if(task.status==='done')return [];
      const request=root.GatherPriorities.pendingRequest(task);
      return request&&(request.kind==='date'||request.kind==='help')?[{task,kind:request.kind,at:request.createdAt}]:[];
    }).sort((a,b)=>time(a.at)-time(b.at)||a.task.id.localeCompare(b.task.id));
  }
  function create({store,ui,h,options,dayLabel,member}) {
    const P=root.GatherPriorities;
    const state=()=>store.getState();
    const dateKey=(offset=0)=>root.GatherCalendar.dayKey(new Date(),state().event.timeZone,offset);
    const tomorrow=()=>dateKey(1);
    const taskLink=(t,{nextUp=false,request=false}={})=>'<button type="button" class="text-button" data-action="task"'+(nextUp?' data-next-up-origin="task"':'')+(request?' data-open-recovery':'')+' data-id="'+h(t.id)+'">'+h(t.title)+'</button>';
    function organizerReviewPanel(s,{expanded=false}={}) {
      const rows=organizerReviews(s.tasks),limit=5;
      if(!rows.length)return '';
      const members=new Map(s.members.map(person=>[person.id,person]));
      return `<section class="panel organizer-review" aria-labelledby="organizerReviewTitle">
        <div class="panel-heading"><h2 class="section-title" id="organizerReviewTitle">Waiting for your review <span class="muted">${rows.length}</span></h2></div>
        <p class="muted">Team requests and completion decisions, oldest first. Open a task to review it; nothing changes until you confirm a decision.</p>
        <ul id="organizerReviewList">${(expanded?rows:rows.slice(0,limit)).map(({task,kind,waitingOnRequiredWork})=>{
          const label=waitingOnRequiredWork?'Review required work':reviewLabels[kind],owner=members.get(task.owner);
          const status=waitingOnRequiredWork?'Verification waiting on required work':label;
          const ownership=owner?owner.name+(owner.active===false?' · inactive':''):task.owner?'Unavailable owner':'Unassigned';
          return `<li><button class="text-button" data-action="review-organizer-item" data-id="${h(task.id)}" data-review-kind="${kind}" aria-label="${h(label+': '+task.title)}">${h(task.title)}</button><span><strong>${status}</strong> · ${h(ownership)}</span></li>`;
        }).join('')}</ul>
        ${rows.length>limit?`<button class="text-button" data-action="expand-organizer-reviews" aria-expanded="${expanded}" aria-controls="organizerReviewList">${expanded?'Show fewer reviews':'Show all '+rows.length+' reviews'}</button>`:''}
      </section>`;
    }
    function ownerLoad(owner) {
      if(!owner)return '';
      const tasks=state().tasks,next=P.nextUp(tasks,owner,new Date(),state().event.timeZone),others=tasks.filter(t=>!t.archivedAt&&t.owner===owner&&t.status!=='done'&&!next.some(n=>n.id===t.id));
      return '<div class="owner-load"><span>'+h(member(owner).name.split(' ')[0])+': '+next.length+'/3 next tasks · '+others.length+' other assignments</span>'+(next.length?'<details><summary>Current commitments</summary><ul>'+next.map(t=>'<li>'+h(t.title)+'</li>').join('')+'</ul></details>':'')+'</div>';
    }
    function nextUpPanel(s,{overview=false}={}) {
      const changed=s.tasks.filter(task=>root.GatherScheduleUI?.pendingReconfirmation(task,ui.actor));
      const changeIds=new Set(changed.map(task=>task.id));
      const {active,returned,suggested,hasOwned}=P.personalNextUp(s.tasks,ui.actor,new Date(),s.event.timeZone,changeIds);
      const committed=new Set(active.map(t=>t.id));
      const alreadyShown=new Set([...active,...returned].map(task=>task.id));
      const requests=new Map(s.tasks.filter(task=>!task.archivedAt&&task.owner===ui.actor&&task.status!=='done'&&!(task.requiresVerification&&task.reportedAt&&!task.verifiedAt)).flatMap(task=>{
        const request=P.pendingRequest(task);
        return request?.createdBy===ui.actor?[[task.id,{task,request}]]:[];
      }));
      const waiting=[...requests.values()].filter(({task})=>!alreadyShown.has(task.id));
      const waitingLabel=request=>request.kind==='date'?'Date proposal awaiting review':'Help request awaiting review';
      const requestBadge=task=>requests.has(task.id)?' · '+waitingLabel(requests.get(task.id).request):'';
      const scheduleLink=(task,primary=false)=>'<button type="button" class="text-button" data-action="review-schedule-reconfirmation" data-next-up-origin="schedule-change" data-id="'+h(task.id)+'" aria-label="Review schedule change for '+h(task.title)+'">'+(primary?h(task.title):'Review schedule change')+'</button>';
      const personalRow=(task,{detail='',showDeadline=false,link,schedulePrimary=false}={})=>{
        const request=requests.get(task.id)?.request;
        const activity=root.GatherScheduleUI?.activitySummary(task,s.event.timeZone);
        const facts=activity?'<div class="next-up-activity"><span><strong>'+(activity.warning?'Saved activity time:':'Activity:')+'</strong> '+h(activity.timing)+'</span>'+
          (activity.location?'<span><strong>Location:</strong> '+h(activity.location)+'</span>':'')+
          (task.dueDate?'<span><strong>Prep due</strong> '+h(dayLabel(task.dueDate))+'</span>':'')+
          (activity.warning?'<span class="next-up-activity-warning"><strong>Check schedule:</strong> '+h(activity.warning)+'</span>':'')+'</div>':
          changeIds.has(task.id)?'<div class="next-up-activity"><span><strong>Activity:</strong> Not on the schedule</span></div>':'';
        const status=(showDeadline&&!activity?dayLabel(task.dueDate):detail);
        const label=status?h(status)+requestBadge(task):request?waitingLabel(request):'';
        const timeline=root.GatherScheduleUI?.personalTimelineDay(task,ui.actor)?
          '<button type="button" class="text-button" data-action="next-up-timeline" data-next-up-origin="timeline" data-id="'+h(task.id)+'" aria-label="Show in Timeline: '+h(task.title)+'">Show in Timeline</button>':'';
        const actions=(!schedulePrimary&&changeIds.has(task.id)?scheduleLink(task):'')+timeline;
        return '<article>'+(schedulePrimary?scheduleLink(task,true):link||taskLink(task,{nextUp:true,request:!!request}))+
          (label?'<span class="muted">'+label+'</span>':'')+facts+(actions?'<div class="next-up-schedule-action">'+actions+'</div>':'')+'</article>';
      };
      const waitingMarkup=waiting.length?'<section class="section-gap" aria-label="Requests awaiting organizer review"><h3>Waiting for the organizer</h3>'+
        waiting.map(({task})=>personalRow(task)).join('')+'</section>':'';
      const returnedMarkup=returned.length?'<section class="section-gap" aria-labelledby="returnedCompletionHeading"><h3 id="returnedCompletionHeading">Completion changes requested</h3><p class="muted">Open a task to review what the organizer asked you to change.</p>'+returned.map(t=>personalRow(t,{
        link:'<button type="button" class="text-button" data-action="review-returned-completion" data-next-up-origin="returned" data-id="'+h(t.id)+'">'+h(t.title)+'</button>',
        detail:'Review and revise'+(committed.has(t.id)?' · Committed':''),
      })).join('')+'</section>':'';
      const separateChanges=changed.filter(task=>!alreadyShown.has(task.id)&&!requests.has(task.id));
      const scheduleChanges=separateChanges.length?'<section class="section-gap" aria-label="Schedule changes to review"><h3>Schedule changes to review</h3><p class="muted">Review the new plan before accepting again. These activities don’t take a commitment slot.</p>'+
        separateChanges.map(task=>personalRow(task,{detail:'Needs acceptance again',schedulePrimary:true})).join('')+'</section>':'';
      const empty=suggested.length?'Choose up to three tasks to work on next.':hasOwned?(overview?'Nothing ready to start. Open My tasks to review blockers, reports or requests.':'Nothing ready to start. Review your open tasks below.'):'No open tasks assigned to you.';
      const heading=overview?'Your next steps':'Next up';
      const personalRoute=overview?'<button class="text-button" data-action="task-filter" data-filter="mine">View my tasks</button>':'';
      const help=overview?'<p class="muted">Your returned reports, commitments, and suggested tasks. Review a task to accept responsibility, share progress or report what’s done.</p>':'';
      const suggestions=suggested.length?'<details data-next-up-suggestions data-next-up-default="'+(active.length?'closed':'open')+'" class="next-up-suggestions"'+(active.length?'':' open')+'><summary data-next-up-origin="summary">Suggested next tasks</summary>'+suggested.map(t=>personalRow(t,{detail:t.acceptedAt?'Accepted · Not committed':'Review assignment'})).join('')+'</details>':'';
      return '<section class="panel next-up-panel section-gap" data-next-up-panel="'+(overview?'overview':'mine')+'" data-next-up-actor="'+h(ui.actor)+'"'+(overview?' aria-label="Your next steps"':'')+'><div class="panel-heading"><h2 class="section-title" data-next-up-heading tabindex="-1">'+heading+' <span class="muted">'+active.length+'/3'+(overview?' committed':'')+'</span></h2>'+personalRoute+'</div><div class="next-up-list">'+help+returnedMarkup+waitingMarkup+scheduleChanges+active.filter(t=>!P.changesRequested(t)).map(t=>personalRow(t,{showDeadline:true})).join('')+(active.length||(returned.length||waiting.length||separateChanges.length)&&!suggested.length?'':'<p class="muted">'+empty+'</p>')+suggestions+'</div></section>';
    }
    function nextUpControl(task) {
      const s=state();
      if(task.owner!==ui.actor||!P.actionable(task,s.tasks))return '';
      if(!task.acceptedAt&&!task.nextUpAt&&(task.reportedAt||task.verifiedAt||task.archivedAt))return '';
      const active=P.nextUp(s.tasks,ui.actor,new Date(),s.event.timeZone);
      const current=task.nextUpAt?'Committed to Next up · '+active.length+'/3':'Not committed to Next up';
      const acceptNotice=!task.acceptedAt&&!task.nextUpAt?'<p class="next-up-accept-note muted">Committing also accepts responsibility for this task.</p>':'';
      return '<form id="nextUpForm" data-id="'+h(task.id)+'" class="next-up-control"><input type="hidden" name="enabled" value="'+(!task.nextUpAt)+'"><span id="nextUpTaskState" tabindex="-1">'+current+'</span>'+acceptNotice+
        (task.nextUpAt?'<button class="text-button" type="submit">Remove from Next up</button>':(active.length>=3?'<label class="field">Swap with<select name="replaceTaskId" required>'+options([['','Choose a current commitment'],...active.map(t=>[t.id,t.title])],'')+'</select></label>':'')+'<button class="btn btn-secondary btn-small" type="submit">'+(active.length>=3?'Swap into Next up':'Commit to this next')+'</button>')+'</form>';
    }
    function recoveryReply(task,organizer) {
      // This is a historical response, not a projection of today's due date,
      // owner, outcome, or check-in. A newer request replaces the receipt.
      const latest=task.recoveryRequests?.at(-1);
      return !root.GatherAccessLost&&!P.pendingRequest(task)&&latest?.status==='resolved'&&['date','help'].includes(latest.kind)&&
        Object.hasOwn(requestDecisionLabels,latest.decision)&&(organizer||latest.createdBy===ui.actor)?latest:null;
    }
    function recoveryMarkup(task,organizer) {
      const s=state(),request=P.pendingRequest(task),decision=organizer?P.decision(task,s.tasks,new Date(),s.event.timeZone):null;
      const latest=recoveryReply(task,organizer);
      const reply=latest?'<section class="task-recovery section-gap" aria-labelledby="recoveryReplyHeading"><h3 id="recoveryReplyHeading" tabindex="-1">Organizer response</h3><p><strong>'+requestDecisionLabels[latest.decision]+'</strong> · '+(latest.kind==='date'?'Date proposal':'Help request')+'</p><p>'+h(latest.decisionNote)+'</p><p class="muted">This is the saved reply to the request. See Comments for the full decision and check-in.</p></section>':'';
      if(!request&&!decision)return reply;
      let html=reply+'<section class="task-recovery section-gap"><h3 id="recoveryRequestHeading" tabindex="-1">'+(request?(request.kind==='date'?'Date proposal':'Help requested'):h(decision.label))+'</h3>';
      if(request)html+='<p>'+h(request.note)+'</p>'+(request.kind==='date'?'<div class="date-proposal"><span>Current: '+dayLabel(task.dueDate)+'</span><strong>Proposed: '+dayLabel(request.proposedDate)+'</strong></div>':'')+'<p class="muted">'+(organizer?'From '+h(member(request.createdBy).name):'Awaiting the organizer. Your current plan is unchanged.')+'</p>';
      if(organizer) {
        const suggestion=P.suggestion(task,s);
        const choices=[...(request?.kind==='date'?[['date','Approve or adjust the date']]:[['date','Agree a new date']]),['reassign','Reassign the task'],['scope','Reduce the scope'],['checkin','Keep plan · set a check-in']];
        const mode=request?.kind==='date'?'date':request?.kind==='help'||!task.owner?'reassign':'checkin';
        html+='<details class="recovery-suggestion"><summary>Suggested next step</summary><p>'+h(suggestion.text)+'</p>'+suggestion.targets.map(taskLink).join('')+'</details><form id="recoveryDecisionForm" data-id="'+h(task.id)+'"><input type="hidden" name="requestId" value="'+h(request?.id||'')+'"><label class="field">Next step<select name="action">'+options(choices,mode)+'</select></label><div data-decision="date" '+(mode==='date'?'':'hidden')+'><label class="field">New due date<input type="date" name="dueDate" value="'+h(request?.proposedDate||'')+'" '+(mode==='date'?'required':'')+'></label>'+(task.hardDeadline?'<label class="check-field"><input type="checkbox" name="confirmHardDeadline"> The vendor or external deadline has also changed</label>':'')+'</div><div data-decision="reassign" '+(mode==='reassign'?'':'hidden')+'><label class="field">New owner<select name="owner" '+(mode==='reassign'?'required':'')+'>'+options([['','Choose a teammate'],...s.members.filter(m=>m.id!==task.owner&&m.active!==false).map(m=>[m.id,m.name])],'')+'</select></label><div data-owner-load></div><p class="muted">The new owner will need to accept it.</p></div><div data-decision="scope" hidden><label class="field">Smaller required outcome<textarea name="scope" rows="2" maxlength="3000">'+h(task.scope||'')+'</textarea></label><p class="muted">A different outcome clears acceptance and Next up so the owner can reconfirm. Current progress stays unchanged.</p></div><label class="field">Decision for the owner<textarea name="note" required rows="2" maxlength="3000"></textarea></label><label class="field">Next check-in<input name="reviewAfter" type="date" required value="'+tomorrow()+'"></label><button class="btn btn-primary" type="submit">Confirm plan</button></form>';
      }
      return html+'</section>';
    }
    function responseMarkup(task,awaiting,completionBlocked=false,workspaceRevision) {
      const overdue=task.dueDate&&task.dueDate<dateKey();
      const revising=P.changesRequested(task);
      const requestHint=awaiting?'':'<p class="muted" data-recovery-request-hint hidden>The organizer will review this. The agreed plan stays in place.'+
        (P.pendingRequest(task)?' A changed request replaces the current one.':'')+'</p>';
      const reviewed=' data-revision="'+h(task.revision)+'"'+
        (Number.isSafeInteger(workspaceRevision)?' data-workspace-revision="'+workspaceRevision+'"':'');
      const accept=!task.acceptedAt&&!awaiting&&!task.reportedAt&&!task.verifiedAt&&!task.archivedAt&&task.status!=='done'
        ? '<button type="button" class="text-button" data-action="accept-task" data-id="'+h(task.id)+'" data-revision="'+h(task.revision)+'"'+
          (Number.isSafeInteger(workspaceRevision)?' data-workspace-revision="'+workspaceRevision+'"':'')+'>'+
          (root.GatherScheduleUI?.pendingReconfirmation(task,task.owner)?'Accept responsibility again':'Accept responsibility')+'</button>' : '';
      return '<section class="task-report section-gap"><h3>'+(revising?'Revised completion report':overdue?'What’s next?':'Your update')+'</h3>'+nextUpControl(task)+'<form id="responseForm" data-id="'+h(task.id)+'"'+reviewed+(revising?' data-revising-completion="true"':'')+'>'+(!awaiting&&!completionBlocked&&!revising?'<button type="button" class="btn btn-secondary" data-action="prepare-completion">Report complete</button><p class="muted">Add a completion note and, optionally, a file or link. Nothing is submitted until you confirm.</p>':'')+'<label class="field">Update<select name="response">'+options([['progress','Share progress'],...(!awaiting&&!completionBlocked?[['completed',revising?'Report revised completion':'Report complete']]:[]),['blocked','Report blocked'],...(!awaiting?[['date','Propose a new date'],['help','Ask for help']]:[])],'progress')+'</select></label><label class="field" data-proposed-date hidden>Proposed date<input type="date" name="proposedDate"></label>'+requestHint+'<label class="field"><span data-response-note-label>What happened or what do you need?</span><textarea name="note" required rows="3" maxlength="3000" placeholder="Add a short update…"></textarea></label><div data-completion-only hidden><p class="muted">Explain how the result meets Done when, if an outcome is recorded. You can optionally add a file or link below. Submitting does not replace organizer verification.</p>'+(root.GatherCompletionUI?.fields()||'')+'</div><button class="btn btn-primary" type="submit">Save update</button></form>'+(awaiting?'<p class="muted">New progress or a blocker replaces the pending completion report.</p>':'')+accept+'</section>';
    }
    function priorityMarkup(task,organizer) {
      const info=P.analyze(task,state().tasks,new Date(),state().event.timeZone),value=task.priority||'auto';
      const history=(task.deadlineHistory||[]).map(item=>'<li>'+dayLabel(item.from)+' → '+dayLabel(item.to)+' · '+h(member(item.actor).name)+'</li>').join('');
      return '<details class="task-priority priority-details"><summary>Priority &amp; history · '+h(P.labels[value])+'</summary>'+(organizer?'<form id="priorityForm" data-id="'+h(task.id)+'"><label class="field">Priority<select name="priority">'+options(Object.entries(P.labels),value)+'</select></label><label class="check-field"><input type="checkbox" name="essential" '+(task.essential?'checked':'')+'> Essential for the event</label><label class="check-field"><input type="checkbox" name="hardDeadline" '+(task.hardDeadline?'checked':'')+'> Fixed vendor or external deadline</label><button class="btn btn-secondary btn-small" type="submit">Save priority</button></form>':'')+'<p>Event risk and work that unblocks others come first. Lateness increases urgency, but does not always take the top spot.</p>'+(info?'<ul>'+info.factors.map(f=>'<li>'+h(f.label)+'</li>').join('')+'</ul>':'')+(history?'<h4>Deadline history</h4><p>Original: '+dayLabel(task.originalDueDate)+'</p><ul>'+history+'</ul>':'')+'</details>';
    }
    function syncResponse(form) {
      const response=form.elements.response.value,date=response==='date',help=response==='help';form.querySelector('[data-proposed-date]').hidden=!date;form.elements.proposedDate.required=date;
      if(form.dataset)form.dataset.responseMode=response;
      form.elements.proposedDate.disabled=!date;
      form.elements.proposedDate.min=dateKey();
      const evidence=form.querySelector('[data-completion-only]');if(evidence){evidence.hidden=form.elements.response.value!=='completed';for(const input of evidence.querySelectorAll('input,select,textarea,button'))input.disabled=evidence.hidden;}
      const hint=form.querySelector('[data-recovery-request-hint]');if(hint)hint.hidden=!date&&!help;
      const completing=response==='completed',label=form.querySelector('[data-response-note-label]'),submit=form.querySelector('button[type="submit"]');
      if(label)label.textContent=completing?'Completion note · what was done?':'What happened or what do you need?';
      if(submit)submit.textContent=completing?(form.dataset?.revisingCompletion==='true'?'Submit revised completion':'Submit completion'):date?'Send date proposal':help?'Send help request':'Save update';
    }
    function prepareCompletion(form) {
      if(!form||![...form.elements.response.options].some(option=>option.value==='completed'))return false;
      form.elements.response.value='completed';syncResponse(form);
      form.elements.note.focus();return true;
    }
    function syncDecision(form) {
      const action=form.elements.action.value;
      for(const el of form.querySelectorAll('[data-decision]')){el.hidden=el.dataset.decision!==action;for(const input of el.querySelectorAll('input,select,textarea'))input.disabled=el.hidden;}
      form.elements.dueDate.required=action==='date';form.elements.owner.required=action==='reassign';form.elements.scope.required=action==='scope';
      form.elements.dueDate.min=dateKey();form.elements.reviewAfter.min=tomorrow();
      form.querySelector('[data-owner-load]').innerHTML=ownerLoad(form.elements.owner.value);
    }
    return {nextUpPanel,organizerReviewPanel,responseMarkup,recoveryMarkup,recoveryReply,priorityMarkup,ownerLoad,syncResponse,prepareCompletion,syncDecision};
  }
  root.GatherRecoveryUI={create,organizerReviews};
})(typeof window!=='undefined'?window:globalThis);
