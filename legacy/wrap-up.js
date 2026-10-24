(function(root) {
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // Partition recorded task facts, never event dates, into mutually exclusive
  // groups. A legacy Done record that still requires verification is not final.
  function groups(state,scope={}) {
    const tasks=scope.mine?state.tasks.filter(task=>!!scope.actor&&task.owner===scope.actor):state.tasks;
    const result=[
      {key:'open',title:'Still open',help:'Check what still needs doing. Open a task to report progress, request help or agree the next step.',tasks:[]},
      {key:'verification',title:'Completion to verify',help:'Open each completion report and its evidence. Required organizer verification has not been recorded.',tasks:[]},
      {key:'completed',title:'Recorded completions',help:'These task records are marked complete, with required verification recorded where applicable. This is not independent proof of the outcome.',tasks:[]},
    ];
    for(const task of tasks) {
      const pending=task.requiresVerification&&!task.verifiedAt&&(task.reportedAt||task.status==='done');
      result[pending?1:task.status==='done'?2:0].tasks.push(task);
    }
    return result;
  }
  function markup(state,{h=escape,scope={}}={}) {
    const model=groups(state,scope),count=model.reduce((n,group)=>n+group.tasks.length,0);
    const name=id=>!id?'Unassigned':state.members.find(member=>member.id===id)?.name||'Unavailable owner';
    const owner=task=>name(task.owner)+(state.members.some(member=>member.id===task.owner&&member.active===false)?' · inactive':'');
    const attribution=(id,known,unknown)=>!id?unknown:state.members.some(member=>member.id===id)?known+' '+name(id):unknown+' by an unavailable member';
    const completedBy=task=>task.requiresVerification&&task.verifiedAt?attribution(task.verifiedBy,'Verified by','Verification recorded'):attribution(task.completedBy,'Completion recorded by','Completion recorded');
    const facts=(task,key)=>[owner(task),key==='verification'?'Awaiting organizer verification':key==='completed'?completedBy(task):({todo:'To do',progress:'In progress',blocked:'Blocked'})[task.status]||'Status not recognized',key==='completed'&&task.verifiedAt&&task.completionEvidence&&task.completionEvidenceReviewAt!==task.verifiedAt?'Evidence amended after verification — open to review':'',task.dueDate?'Preparation due '+task.dueDate:''].filter(Boolean).join(' · ');
    return `<section class="panel wrap-up-review" aria-label="Task close-out review"><h2>Review the task results</h2><p>Finish the work that still matters and review completion reports before recording lessons. Passing the event date does not complete a task or close the event.</p><div class="schedule-switch" role="group" aria-label="Task review scope"><button class="filter-tab ${scope.mine?'':'active'}" aria-pressed="${!scope.mine}" data-action="wrap-up-scope" data-id="all">All tasks</button><button class="filter-tab ${scope.mine?'active':''}" aria-pressed="${!!scope.mine}" data-action="wrap-up-scope" data-id="mine">My tasks</button></div><p class="eyebrow">${h(scope.mine?'My task review · '+name(scope.actor):'All task records')}</p><dl class="wrap-up-counts">${model.map(group=>`<div><dt>${h(group.title)}</dt><dd>${group.tasks.length}</dd></div>`).join('')}</dl><p class="muted">${count} ${count===1?'task':'tasks'} in this review. Task counts are not an event-success score.</p>${!count?`<p class="notice">${scope.mine?'No tasks assigned to you. This does not mean the whole event is finished.':'No tasks in this plan. A blank task list does not certify that the event is finished.'}</p>`:''}${model.map(group=>`<details class="wrap-up-group"${group.key!=='completed'&&group.tasks.length&&group.tasks.length<=10?' open':''}><summary>${h(group.title)} · ${group.tasks.length}</summary><p class="muted">${h(group.help)}</p>${group.tasks.length?`<ul>${group.tasks.map(task=>`<li><button class="text-button" data-action="task" data-id="${h(task.id)}">${h(task.title)}</button><span>${h(facts(task,group.key))}</span></li>`).join('')}</ul>`:'<p class="muted">None recorded in this scope.</p>'}</details>`).join('')}<p class="muted">This review covers task records only. Check <button class="text-button" data-view="budget">Budget</button>, <button class="text-button" data-view="info">Event info</button> and <button class="text-button" data-view="details">Private details</button> separately where relevant. Opening a review changes no records and sends no messages.</p></section>`;
  }
  root.GatherWrapUp={groups,markup};
})(typeof window!=='undefined'?window:globalThis);
