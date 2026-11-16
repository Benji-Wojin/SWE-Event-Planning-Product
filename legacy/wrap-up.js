(function(root) {
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  // Partition recorded task facts, never event dates, into mutually exclusive
  // groups. A legacy Done record that still requires verification is not final.
  const awaitingVerification=task=>!!(task.requiresVerification&&!task.verifiedAt&&(task.reportedAt||task.status==='done'));
  const inScope=(task,scope)=>!scope.mine||!!scope.actor&&task.owner===scope.actor;
  function groups(state,scope={}) {
    const tasks=state.tasks.filter(task=>!task.archivedAt&&inScope(task,scope));
    const result=[
      {key:'open',title:'Still open',help:'Check what still needs doing. Open a task to report progress, request help or agree the next step.',tasks:[]},
      {key:'verification',title:'Completion to verify',help:'Open each completion report and its evidence. Required organizer verification has not been recorded.',tasks:[]},
      {key:'completed',title:'Recorded completions',help:'These task records are marked complete, with required verification recorded where applicable. This is not independent proof of the outcome.',tasks:[]},
    ];
    for(const task of tasks) {
      result[awaitingVerification(task)?1:task.status==='done'?2:0].tasks.push(task);
    }
    return result;
  }
  const returned=task=>task.status!=='done'&&!task.reportedAt&&!!task.completionReview;
  const amended=task=>task.status==='done'&&!!task.verifiedAt&&!!task.completionEvidence&&task.completionEvidenceReviewAt!==task.verifiedAt;
  function openWorkKinds(state,{demo=false}={}) {
    const active=new Set(state.members.filter(member=>member.active!==false&&(demo||!member.role?.includes('· example'))).map(member=>member.id));
    const byId=new Map(state.tasks.map(task=>[task.id,task]));
    const result=new Map();
    for(const task of state.tasks){
      if(task.archivedAt||task.reportedAt||task.verifiedAt||task.status==='done'||returned(task))continue;
      if(!task.owner||!active.has(task.owner)){result.set(task.id,'owner-gap');continue;}
      if(task.status!=='blocked')continue;
      const required=(task.dependencies||[]).filter(link=>link.kind!=='related');
      if(required.length&&required.every(link=>{
        const target=byId.get(link.taskId);
        return target&&!target.archivedAt&&target.status==='done'&&(!target.requiresVerification||target.verifiedAt);
      }))result.set(task.id,'linked-results');
    }
    return result;
  }
  function markup(state,{h=escape,scope={},organizer=false,demo=false}={}) {
    const model=groups(state,scope),count=model.reduce((n,group)=>n+group.tasks.length,0);
    const archived=state.tasks.filter(task=>task.archivedAt&&inScope(task,scope));
    const name=id=>!id?'Unassigned':state.members.find(member=>member.id===id)?.name||'Unavailable owner';
    const owner=task=>name(task.owner)+(state.members.some(member=>member.id===task.owner&&member.active===false)?' · inactive':'');
    const attentionOwner=(task,kind)=>kind==='owner-gap'&&!demo&&state.members.some(member=>member.id===task.owner&&member.role?.includes('· example'))
      ?'Unavailable owner':owner(task);
    const attribution=(id,known,unknown)=>!id?unknown:state.members.some(member=>member.id===id)?known+' '+name(id):unknown+' by an unavailable member';
    const completedBy=task=>task.requiresVerification&&task.verifiedAt?attribution(task.verifiedBy,'Verified by','Verification recorded'):attribution(task.completedBy,'Completion recorded by','Completion recorded');
    const facts=(task,key)=>[owner(task),key==='verification'?'Awaiting organizer verification':key==='completed'?completedBy(task):({todo:'To do',progress:'In progress',blocked:'Blocked'})[task.status]||'Status not recognized',amended(task)?'Evidence amended after verification — open to review':returned(task)?'Completion changes requested':'',task.dueDate?'Preparation due '+task.dueDate:''].filter(Boolean).join(' · ');
    const reviewKind=(task,key)=>key==='verification'&&task.reportedAt?'completion':
      amended(task)?'amendment':returned(task)?'returned':'';
    const taskButton=(task,kind,attention='',description='')=>`<button type="button" class="text-button" data-action="wrap-review-task" data-id="${h(task.id)}" data-wrap-review-kind="${kind}"${attention?` data-wrap-attention="${attention}" aria-describedby="${description}"`:''}>${h(task.title)}</button>`;
    const decisions=[
      {kind:'returned',title:'Completion changes requested',tasks:model[0].tasks.filter(returned),
        copy:task=>!state.members.some(member=>member.id===task.owner&&member.active!==false)
          ? organizer?'Assign an active owner to revise.':'Ask the organizer to assign an active owner.'
          : task.owner===scope.actor?'Review requested changes before resubmitting.':'Waiting for the task owner to revise.'},
      {kind:'amendment',title:'Amended evidence awaiting review',tasks:model[2].tasks.filter(amended),
        copy:()=>organizer?'Review amended evidence. Original verification still stands.':'Awaiting organizer review. Original verification still stands.'},
    ].filter(item=>item.tasks.length);
    const shortcuts=(sections,heading,title)=>sections.length?`<section class="wrap-up-attention" aria-labelledby="${heading}"><h3 id="${heading}">${title}</h3><p>These are shortcuts to tasks already counted below.</p>${sections.map(({kind,title,tasks,copy})=>`<section aria-labelledby="wrap-attention-${kind}"><h4 id="wrap-attention-${kind}">${title} · ${tasks.length}</h4><ul>${tasks.map((task,index)=>{const description=`wrap-attention-${kind}-${index}`;return `<li>${taskButton(task,kind,kind,`wrap-attention-${kind} ${description}`)}<span id="${description}">${h(attentionOwner(task,kind))} · ${h(copy(task))}</span></li>`;}).join('')}</ul></section>`).join('')}</section>`:'';
    const openKinds=openWorkKinds(state,{demo});
    const openWork=[
      {kind:'owner-gap',title:'Needs an active owner',copy:()=>organizer?'Open the task to choose an owner. Assignment does not record acceptance.':'Ask the organizer to assign an active owner.'},
      {kind:'linked-results',title:'Review linked results',copy:task=>'Required linked work is complete. Review the results and check for other blockers. '+
        (organizer||task.owner===scope.actor?'This task stays blocked until you resume it or update its status.':'The owner or organizer can decide when to resume.')},
    ].map(item=>({...item,tasks:model[0].tasks.filter(task=>openKinds.get(task.id)===item.kind)})).filter(item=>item.tasks.length);
    const attention=shortcuts(decisions,'wrapUpAttentionHeading','Completion needs attention')+
      shortcuts(openWork,'wrapUpOpenWorkHeading','Open work needs attention');
    const notice=scope.mine?(archived.length?'No active tasks assigned to you.':'No tasks assigned to you.')+' This does not mean the whole event is finished.':
      archived.length?'No active tasks in this plan. Archived records remain below.':'No tasks in this plan. A blank task list does not certify that the event is finished.';
    const archiveStatus=task=>awaitingVerification(task)?'Verification was not recorded':
      task.status==='done'?completedBy(task):'Last status: '+(({todo:'To do',progress:'In progress',blocked:'Blocked'})[task.status]||'Not recorded');
    const history=archived.length?`<details class="wrap-up-group" data-wrap-group="archived" data-wrap-default="closed"><summary>Archived task records · ${archived.length}</summary><p class="muted">These records are kept for reference. They do not count toward this review or appear in reusable checklists.</p><ul>${archived.map(task=>`<li>${taskButton(task,'archived')}<span>${h(owner(task))} · ${h(archiveStatus(task))}</span></li>`).join('')}</ul></details>`:'';
    return `<section class="panel wrap-up-review" aria-labelledby="wrapUpReviewHeading" data-wrap-review data-wrap-actor="${h(scope.actor||'')}" data-wrap-scope="${scope.mine?'mine':'all'}"><h2 id="wrapUpReviewHeading" tabindex="-1">Review the task results</h2><p>Finish the work that still matters and review completion reports before recording lessons. Passing the event date does not complete a task or close the event.</p><div class="schedule-switch" role="group" aria-label="Task review scope"><button class="filter-tab ${scope.mine?'':'active'}" aria-pressed="${!scope.mine}" data-action="wrap-up-scope" data-id="all">All tasks</button><button class="filter-tab ${scope.mine?'active':''}" aria-pressed="${!!scope.mine}" data-action="wrap-up-scope" data-id="mine">My tasks</button></div><p class="eyebrow">${h(scope.mine?'My task review · '+name(scope.actor):'All task records')}</p><dl class="wrap-up-counts">${model.map(group=>`<div><dt>${h(group.title)}</dt><dd>${group.tasks.length}</dd></div>`).join('')}</dl><p class="muted">${count} ${count===1?'task':'tasks'} ${archived.length?'in the active review':'in this review'}. Task counts are not an event-success score.</p>${!count?`<p class="notice">${notice}</p>`:''}${attention}${model.map(group=>{const open=group.key!=='completed'&&group.tasks.length>0&&group.tasks.length<=10;return `<details class="wrap-up-group" data-wrap-group="${group.key}" data-wrap-default="${open?'open':'closed'}"${open?' open':''}><summary>${h(group.title)} · ${group.tasks.length}</summary><p class="muted">${h(group.help)}</p>${group.tasks.length?`<ul>${group.tasks.map(task=>`<li>${taskButton(task,reviewKind(task,group.key))}<span>${h(facts(task,group.key))}</span></li>`).join('')}</ul>`:'<p class="muted">None recorded in this scope.</p>'}</details>`;}).join('')}${history}<p class="muted">This review covers task records only. Check <button class="text-button" data-view="budget">Budget</button>, <button class="text-button" data-view="info">Event info</button> and <button class="text-button" data-view="details">Private details</button> separately where relevant. Opening a review changes no records and sends no messages.</p></section>`;
  }
  const reuseLimit=24; // Match the private starting plan import.
  const reusableTitle=value=>String(value??'').replace(/[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]+/g,' ').trim();
  function reusableTitles(state,scope={},{withIdentity=false}={}) {
    return groups(state,scope).flatMap(group=>group.tasks.map(task=>({title:reusableTitle(task.title),group:group.title,...(withIdentity?{id:task.id}:{})})))
      .filter(({title})=>title.length>0);
  }
  function reconcileReusableChoices(previousRows,nextRows,choices) {
    const indexById=rows=>{
      const map=new Map();
      rows.forEach(({id},index)=>{if(typeof id==='string'&&id)map.set(id,map.has(id)?-1:index);});
      return map;
    };
    const previous=indexById(previousRows),next=indexById(nextRows);
    const kept=[];
    for(const {index,title} of choices){
      const old=previousRows[index],nextIndex=next.get(old?.id),current=nextRows[nextIndex];
      if(current&&previous.get(old.id)===index&&current.title===old.title&&current.group===old.group)
        kept.push({index:nextIndex,title});
    }
    return {choices:kept.sort((a,b)=>a.index-b.index),cleared:choices.length-kept.length};
  }
  function reusableChecklist(rows,choices) {
    if(!choices.length||choices.length>reuseLimit)return '';
    const titles=new Map();
    for(const {index,title} of choices){
      const line=reusableTitle(title);
      if(!Number.isSafeInteger(index)||index<0||index>=rows.length||titles.has(index)||!line||line.length>180)return '';
      titles.set(index,line);
    }
    // The wrapper is stripped by the destination importer. A source title that
    // starts with its own number or checkmark still remains the literal title.
    return rows.flatMap((_,index)=>titles.has(index)?['- [ ] '+titles.get(index)]:[]).join('\n');
  }
  function reusableRows(rows,h=escape) {
    return rows.map(({title,group},index)=>`<div data-reuse-row><label class="check-field"><input type="checkbox" data-reuse-choice value="${index}"><span>${h(title)}<small class="muted">${h(group)}</small></span></label><label class="field reuse-checklist-title" data-reuse-edit hidden>Title to copy for item ${index+1}<input data-reuse-title maxlength="180" value="${h(title)}"></label></div>`).join('');
  }
  function reusablePicker(rows,{mine=false,h=escape}={}) {
    return `<p>Choose up to ${reuseLimit} tasks from ${mine?'My tasks':'All tasks'}. In your next event, open <strong>Build a plan → Paste a checklist</strong> and review the titles there before adding any shared tasks. If that event already has a plan handoff, open <strong>Draft another plan</strong> first.</p>
      <p class="muted">Only selected task titles are copied. You can remove event-specific details from the copy without editing the original tasks. No owners, dates, notes, links or completion records are carried over.</p>
      <p id="reuseChecklistWarning" class="notice" role="status" hidden></p>
      <p id="reuseChecklistRefreshStatus" role="status" class="muted"></p>
      <label class="field section-gap">Find a task title<input type="search" id="reuseChecklistSearch" aria-controls="reuseChecklistChoices"></label>
      <p id="reuseChecklistNoMatches" class="muted" role="status" hidden>No titles match your search. Your selection is kept.</p>
      <fieldset id="reuseChecklistChoices" class="reuse-checklist-choices" aria-describedby="reuseChecklistCount"><legend>Choose reusable tasks</legend>
      <div id="reuseChecklistRows">${reusableRows(rows,h)}</div></fieldset>
      <p id="reuseChecklistCount" role="status" class="muted">0 of ${reuseLimit} selected.</p>
      <label class="field section-gap">Checklist to paste<textarea id="reuseChecklistPreview" rows="7" readonly></textarea></label>`;
  }
  root.GatherWrapUp={groups,markup,openWorkKinds,awaitingVerification,reuseLimit,reusableTitles,reconcileReusableChoices,reusableChecklist,reusableRows,reusablePicker};
})(typeof window!=='undefined'?window:globalThis);
