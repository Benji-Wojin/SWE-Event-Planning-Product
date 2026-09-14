  function inboxView(s) {
    const groups=GatherInbox.conversations(s);
    const group=groups.find(g=>g.messages.some(m=>m.id===ui.messageId))||groups.find(g=>g.key===ui.conversationKey)||groups[0];
    const selected=group?.messages.find(m=>m.id===ui.messageId)||group?.pending[0]||group?.latest;
    ui.messageId=selected?.id||'';ui.conversationKey=group?.key||'';
    return pageHeading('','Email inbox','Grouped by task',`<button class="btn btn-primary" data-action="paste-email">${icon('plus')} Add email</button>`)+`
      <div class="inbox-utilities"><span>${groups.length} conversations · ${pending(s).length} emails need review</span><button class="text-button" data-action="refresh-inbox">Check for updates</button><a class="text-button" href="/mail" target="_top">Gmail imports</a><details class="inbox-demo"><summary>Try sample replies</summary><div class="inline"><button class="btn btn-secondary btn-small" data-action="sample-reply" data-step="pending">Buses awaiting deposit</button><button class="btn btn-secondary btn-small" data-action="sample-reply" data-step="confirmed">Booking confirmed</button></div></details></div>
      <div id="inboxSyncNotice" class="notice" role="status" hidden></div>
      <div class="conversation-layout section-gap"><nav class="conversation-list" aria-label="Task conversations">${groups.map(g=>`<button class="conversation-button ${g.key===group?.key?'selected':''}" data-action="select-conversation" data-id="${h(g.key)}" aria-current="${g.key===group?.key?'true':'false'}"><span class="conversation-type">${g.task?'TASK':'NEEDS A TASK'}</span><strong>${h(g.title)}</strong><span class="conversation-preview">${h(g.latest.subject)}</span><span class="conversation-counts"><span>${g.messages.length} ${g.messages.length===1?'email':'emails'}</span><span class="${g.pending.length?'review-count':'review-clear'}">${g.pending.length?g.pending.length+' to review':'Up to date'}</span></span></button>`).join('')||empty('No conversations yet.','Add an email and choose its task.')}</nav>
      ${group?`<section class="task-conversation"><header class="conversation-heading"><div><h2>${h(group.title)}</h2><p>${group.task?`${statusBadge(group.task.status)} <span>${h(member(group.task.owner).name)} · ${dayLabel(group.task.dueDate)}</span>`:'Choose a task for these emails.'}</p></div>${group.task?`<button class="btn btn-secondary btn-small" data-action="task" data-id="${h(group.taskId)}">Open task</button>`:''}</header><div class="conversation-workspace">
        <section class="conversation-history" aria-label="Emails for this task"><div class="conversation-section-heading"><h3>Email history</h3><span>Newest first</span></div>${group.messages.map(m=>`<article class="conversation-email ${m.id===selected.id?'selected':''}"><button class="conversation-email-select" data-action="select-message" data-id="${h(m.id)}" aria-pressed="${m.id===selected.id}"><span class="conversation-email-meta"><strong>${h(m.sender)}</strong><time datetime="${h(m.receivedAt)}">${timeLabel(m.receivedAt)}</time></span><span class="conversation-email-subject">${h(m.subject)}</span><span class="email-review-state">${m.appliedTaskId?'Accepted':m.ignoredAt?'Set aside':'Needs review'}</span>${m.id!==selected.id?`<span class="conversation-preview">${h(m.body.slice(0,120))}</span>`:''}</button>${m.id===selected.id?`<div class="conversation-email-body">${h(m.body)}</div>${m.sourceType==='gmail-reviewed'?`<div class="source-privacy-note">Organizer-approved summary. <button class="text-button" data-action="private-original" data-id="${h(m.externalId.slice(7))}">View private Gmail original</button><div id="privateOriginal" hidden></div></div>`:''}`:''}</article>`).join('')}<button class="text-button add-conversation-email" data-action="paste-email">${icon('plus')} Add email</button></section>
        <aside class="conversation-review" aria-label="Review proposed task change">${emailReader(selected,s)}</aside>
      </div></section>`:`<section class="panel">${empty('No email selected.','')}</section>`}</div>`;
  }
  const changeNames={title:'Task name',owner:'Owner',status:'Status',dueDate:'Due date',note:'Progress note',category:'Category'};
  function changeValue(key,value) {
    const text=h(key==='owner'?member(value).name:key==='status'?(statuses[value]||'Not set'):key==='dueDate'?dayLabel(value):value||'Not set');
    return key==='note'?`<div class="diff-note">${text}</div>`:text;
  }
  function changePreview(message,s,values=message.suggested) {
    const diff=GatherInbox.changes(message,s,values);
    return `<div class="change-summary-heading"><span class="eyebrow">${diff.isNew?'CREATE A TASK':'BEFORE YOU ACCEPT'}</span><h3>${diff.isNew?'New task':diff.changed.length?`${diff.changed.length} ${diff.changed.length===1?'field will':'fields will'} change`:'No task fields will change'}</h3>${!diff.isNew?`<p>Task: ${h(diff.current?.title||'Select a task')}</p>`:''}</div>
      ${diff.changed.length?`<table class="change-table"><thead><tr><th scope="col">Field</th><th scope="col">${diff.isNew?'Before':'Current'}</th><th scope="col">${diff.isNew?'New task':'After accepting'}</th></tr></thead><tbody>${diff.changed.map(f=>`<tr><th scope="row">${changeNames[f.key]}</th><td>${diff.isNew?'—':changeValue(f.key,f.before)}</td><td>${changeValue(f.key,f.after)}</td></tr>`).join('')}</tbody></table>`:'<p class="change-noop">Accepting will attach this email as a source; no field values change.</p>'}
      ${diff.unchanged.length?`<p class="unchanged-fields">Unchanged: ${diff.unchanged.map(f=>changeNames[f.key].toLowerCase()).join(', ')}.</p>`:''}
      ${diff.waitsForVerification?'<p class="verification-explanation">Completion is reported, not verified. This task will remain in progress until the organizer verifies it.</p>':diff.reportsCompletion&&!diff.current?.verifiedAt?'<p class="verification-explanation">This records a completion report from the email, not independent verification.</p>':''}
      ${diff.current&&diff.after.owner!==diff.current.owner?'<p class="verification-explanation">Changing the owner resets their acceptance; the new owner will need to acknowledge the task.</p>':''}`;
  }
  function emailReader(m,s) {
    if(m.ignoredAt)return `<div class="review-result"><span class="eyebrow">SET ASIDE</span><h3>No task changes made</h3><p>Email kept in history.</p></div>`;
    if(m.appliedTaskId) {
      const fields=Object.keys(changeNames).filter(key=>m.approved?.[key]!==undefined&&(!m.before||String(m.before[key]??'')!==String(m.approved[key]??'')));
      return `<div class="review-result"><h3>Accepted</h3><p>Recorded by ${h(member(m.appliedBy).name)} · ${timeLabel(m.appliedAt)}</p>${fields.length?`<table class="change-table"><thead><tr><th>Field</th><th>Before</th><th>Accepted</th></tr></thead><tbody>${fields.map(key=>`<tr><th scope="row">${changeNames[key]}</th><td>${m.before?changeValue(key,m.before[key]):'—'}</td><td>${changeValue(key,m.approved[key])}</td></tr>`).join('')}</tbody></table>`:'<p>Email attached. No task fields changed.</p>'}<p class="unchanged-fields">Saved changes; the task may have newer updates.</p></div>`;
    }
    const p=m.suggested||{},current=p.mode==='update'?s.tasks.find(t=>t.id===p.taskId):null;
    const stale=current&&p.baseRevision!==current.revision;
    const older=current&&s.messages.some(item=>item.appliedTaskId===current.id&&item.receivedAt>m.receivedAt);
    return `<form class="proposal-form" id="emailReviewForm" data-id="${h(m.id)}"><div id="changePreview" aria-live="polite">${changePreview(m,s)}</div>
      <div class="proposal-explanation"><strong>Reason</strong><p>${h(p.reason||'Check these changes against the email.')}</p></div>
      ${stale?'<div class="warning-note stale-proposal">The task changed since this suggestion. Refresh the comparison before accepting.</div>':''}
      <input type="hidden" name="expectedRevision" value="${h(p.baseRevision||0)}">
      <details class="proposal-edit" ${p.mode==='new'?'open':''}><summary>Edit proposed changes</summary><div class="form-grid">
      <label class="field">Action<select name="mode" id="emailMode">${options([['update','Update an existing task'],['new','Create a new task']],p.mode||'new')}</select></label>
      <label class="field" id="existingTaskField" ${p.mode==='update'?'':'hidden'}>Task<select name="taskId" id="emailTask" ${p.mode==='update'?'required':''}>${options([['','Choose a task…'],...s.tasks.map(t=>[t.id,t.title])],p.taskId||'')}</select></label>
      <label class="field full-width">Task name<input name="title" required maxlength="200" value="${h(p.title||m.subject)}"></label>
      <label class="field">Owner<select name="owner">${ownerOptions(p.owner||'')}</select></label>
      <label class="field">Status<select name="status">${statusOptions(p.status||'todo')}</select></label>
      <label class="field">Due date<input type="date" name="dueDate" value="${h(p.dueDate||'')}"></label>
      <label class="field">Category<input name="category" maxlength="80" value="${h(p.category||current?.category||'Guest care')}"></label>
      <label class="field full-width">Progress note<textarea name="note" rows="4" maxlength="5000">${h(p.note||'')}</textarea></label></div></details>
      ${older?'<label class="check-field conflict-approval"><input name="confirmConflict" type="checkbox" required> This email is older than an accepted update. I intend to apply it anyway.</label>':''}
      <div class="proposal-actions"><button class="btn btn-primary" type="submit" ${stale?'disabled':''}>${p.mode==='new'?'Accept & create task':'Accept changes'}</button><button type="button" class="btn btn-secondary" data-action="ignore-message" data-id="${h(m.id)}">Set aside</button></div>
      <button type="button" class="text-button refresh-comparison" data-action="refresh-proposal" data-id="${h(m.id)}">Refresh comparison & discard edits</button>
      <p class="proposal-footnote">Nothing changes until you accept.</p></form>`;
  }
  function updateChangePreview() {
    const form=$('#emailReviewForm');if(!form)return;
    const s=store.getState(),message=s.messages.find(m=>m.id===form.dataset.id);if(!message)return;
    const values=Object.fromEntries(new FormData(form));
    $('#changePreview').innerHTML=changePreview(message,s,values);
    const current=values.mode==='update'?s.tasks.find(t=>t.id===values.taskId):null;
    const submit=$('button[type="submit"]',form);
    submit.disabled=!!ui.savingProposal||!!(values.mode==='update'&&(!current||Number(values.expectedRevision)!==current.revision));
    const conflict=$('.conflict-approval',form);if(conflict){conflict.hidden=values.mode!=='update';const checkbox=$('input',conflict);checkbox.disabled=values.mode!=='update';checkbox.required=values.mode==='update';}
    const warning=$('.stale-proposal',form);if(warning)warning.hidden=values.mode!=='update';
    submit.textContent=values.mode==='new'?'Accept & create task':'Accept changes';
  }
  async function refreshInbox(manual=false) {
    if(!store.refresh||ui.syncing||document.hidden||ui.view!=='inbox')return;
    ui.syncing=true;
    try {
      const result=await store.refresh(()=>ui.view==='inbox'&&!ui.reviewDirty&&$('#dialogBackdrop').hidden&&!ui.savingProposal);
      if(result.changed){render();if(manual)toast('Conversation history updated.');}
      else if(result.pending){const banner=$('#inboxSyncNotice');if(banner){banner.hidden=false;banner.textContent='New updates are available. Your edited proposal is unchanged. Use “Refresh comparison” to discard edits and load the latest task before accepting.';}}
      else if(manual)toast('You have the latest conversation history.');
    } catch(error) {if(manual)toast(error.message);}
    finally {ui.syncing=false;}
  }

  let privateOriginalEpoch=0;
  function clearPrivateOriginal(){privateOriginalEpoch++;const panel=$('#privateOriginal');if(panel){panel.replaceChildren();panel.hidden=true;}}
  async function showPrivateOriginal(id){
    const panel=$('#privateOriginal');if(!panel)return;
    if(!panel.hidden){clearPrivateOriginal();return;}
    const ticket=++privateOriginalEpoch;panel.hidden=false;panel.textContent='Loading private original…';
    try{
      const response=await fetch('/api/gmail/original?id='+encodeURIComponent(id),{credentials:'same-origin',cache:'no-store'}),data=await response.json();
      if(ticket!==privateOriginalEpoch||document.hidden||!panel.isConnected)return;
      if(!response.ok)throw new Error(data.error||'Could not open the private original.');
      panel.innerHTML=`<strong>${h(data.subject)}</strong><p>${h(data.sender)} · ${timeLabel(data.receivedAt)}</p><div class="private-original-body">${h(data.body)}</div><p>Private text preview. Never included in the shared plan or export. Attachments are not imported.</p>`;
    }catch(error){if(ticket===privateOriginalEpoch&&panel.isConnected)panel.textContent=error.message;}
  }
