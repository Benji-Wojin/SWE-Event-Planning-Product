  function inboxView(s) {
    const groups=GatherInbox.conversations(s);
    const active=groups.find(g=>g.messages.some(m=>m.id===ui.messageId))||groups.find(g=>g.key===ui.conversationKey);
    const selected=active?.messages.find(m=>m.id===ui.messageId)||active?.pending[0]||active?.latest;
    ui.messageId=selected?.id||'';ui.conversationKey=active?.key||'';
    return pageHeading('','Email briefing','',isOrganizer()?`<button class="btn btn-primary" data-action="paste-email">${icon('plus')} Add email</button>`:'')+`
      <div class="briefing-tools"><span>${groups.filter(g=>g.pending.length).length} tasks need review</span><button class="text-button" data-action="refresh-inbox">Refresh</button>${isOrganizer()?`<details><summary>Sources & setup</summary><div class="inline">${window.GatherMode?.demo?'<button class="text-button" data-action="demo-email">Demo email setup</button>':'<a class="text-button" href="/mail" target="_top">Private Gmail imports</a>'}<button class="text-button" data-action="sample-reply" data-step="pending">Sample: deposit pending</button><button class="text-button" data-action="sample-reply" data-step="confirmed">Sample: booking confirmed</button></div></details>`:''}</div>
      <div id="inboxSyncNotice" class="notice" role="status" hidden></div>
      <div class="briefing-feed section-gap">${groups.map(g=>{
        const expanded=g.key===active?.key,b=GatherInbox.briefing(g,s,expanded?selected:undefined),m=b.message;
        return `<article class="briefing-card ${expanded?'expanded':''}">
          <header class="briefing-card-heading"><div><span class="briefing-label ${b.pending?'needs-review':''}">${h(b.label)}</span><h2>${h(g.title)}</h2></div><span class="briefing-count">${g.pending.length?g.pending.length+' to review':'Reviewed'}</span></header>
          <p class="briefing-attribution">${h(m.sender)} · ${timeLabel(m.receivedAt)}${b.historical?' · Historical email':''}</p>
          <p class="briefing-summary">${h(b.summary)}</p>
          <div class="briefing-next"><span>Suggested next step</span><p>${h(b.next)}</p></div>
          <div class="briefing-actions"><button class="btn ${b.pending?'btn-primary':'btn-secondary'} btn-small" data-action="${expanded?'close-briefing':'select-conversation'}" data-id="${h(g.key)}" aria-expanded="${expanded}" aria-controls="briefing-${h(g.key)}">${expanded?'Close review':b.pending?'Review suggestion':'View history'}</button>${g.task?`<button class="text-button" data-action="task" data-id="${h(g.taskId)}">Open task</button><span class="muted">${h(member(g.task.owner).name)} · Due ${dayLabel(g.task.dueDate)}</span>`:''}</div>
          <div id="briefing-${h(g.key)}" class="briefing-review" ${expanded?'':'hidden'}>${expanded?`<div class="briefing-review-heading"><h3>${b.pending?'Review suggestion':'Saved decision'}</h3><span>${h(m.sender)} · ${timeLabel(m.receivedAt)}</span></div>${b.stale&&b.historical?'<p class="warning-note">The task also changed since this proposal. Refresh the comparison before accepting.</p>':''}${emailReader(m,s)}`:''}</div>
          <details class="briefing-sources"><summary>Source emails (${g.messages.length})</summary><p class="muted">Summaries use selected email text and rule-based suggestions. Review the source for full context.</p>${g.messages.map(source=>`<article class="briefing-source"><div class="inline"><strong>${h(source.sender)}</strong><time>${timeLabel(source.receivedAt)}</time><span>${source.appliedTaskId?'Accepted':source.ignoredAt?'Set aside':'Not applied'}</span></div><p>${h(source.subject)}</p><div class="inline"><button class="text-button" data-action="select-message" data-id="${h(source.id)}">${source.id===selected?.id?'Reviewing this update':'Review this update'}</button></div><details class="briefing-original"><summary>${source.sourceType==='gmail-reviewed'?'View shared summary':'View email text'}</summary><div class="conversation-email-body">${h(source.body)}</div>${expanded&&source.id===m.id&&source.sourceType==='gmail-reviewed'?`<div class="source-privacy-note">Organizer-approved summary. <button class="text-button" data-action="private-original" data-id="${h(source.externalId.slice(7))}">View private Gmail original</button><div id="privateOriginal" hidden></div></div>`:''}</details></article>`).join('')}</details>
        </article>`;
      }).join('')||empty('No email updates.','Add an email or import a reviewed Gmail summary.')}</div>`;
  }
  const changeNames={title:'Task name',owner:'Owner',status:'Status',dueDate:'Due date',note:'Progress note',category:'Category'};
  function changeValue(key,value) {
    const text=h(key==='owner'?member(value).name:key==='status'?(statuses[value]||'Not set'):key==='dueDate'?dayLabel(value):value||'Not set');
    return key==='note'?`<div class="diff-note">${text}</div>`:text;
  }
  function changePreview(message,s,values=message.suggested) {
    if(GatherInbox.analysisOutdated(message))return '<p class="warning-note">Refresh this suggestion before reviewing its changes. The previous email analysis is out of date.</p>';
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
    const stale=GatherInbox.analysisOutdated(m)||(current&&p.baseRevision!==current.revision);
    const older=current&&s.messages.some(item=>item.appliedTaskId===current.id&&item.receivedAt>m.receivedAt);
    if(!isOrganizer())return `<div class="review-card">${changePreview(m,s)}<p class="notice">Only the organizer can accept email suggestions. You can report progress or comment on the linked task.</p></div>`;
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
    submit.disabled=!!ui.savingProposal||GatherInbox.analysisOutdated(message)||!!(values.mode==='update'&&(!current||Number(values.expectedRevision)!==current.revision));
    const conflict=$('.conflict-approval',form);if(conflict){conflict.hidden=values.mode!=='update';const checkbox=$('input',conflict);checkbox.disabled=values.mode!=='update';checkbox.required=values.mode==='update';}
    const warning=$('.stale-proposal',form);if(warning)warning.hidden=values.mode!=='update';
    submit.textContent=values.mode==='new'?'Accept & create task':'Accept changes';
  }
  async function refreshInbox(manual=false) {
    if(!store.refresh||ui.syncing||document.hidden||ui.view==='details')return;
    ui.syncing=true;
    try {
      const result=await store.refresh(()=>!ui.reviewDirty&&$('#dialogBackdrop').hidden&&!ui.savingProposal&&!document.activeElement?.matches('input,textarea,select'));
      if(result.changed){render();if(manual)toast('Conversation history updated.');}
      const notice=$('#workspaceSyncNotice');if(notice)notice.hidden=!result.pending;
      if(result.pending){showPendingUpdate();const banner=$('#inboxSyncNotice');if(banner){banner.hidden=false;banner.textContent='New updates are available. Your edited proposal is unchanged. Use “Refresh comparison” to discard edits and load the latest task before accepting.';}}
      else if(manual)toast('You have the latest conversation history.');
    } catch(error) {if(manual)toast(error.message);}
    finally {ui.syncing=false;}
  }

  let privateOriginalEpoch=0;
  function clearPrivateOriginal(){privateOriginalEpoch++;const panel=$('#privateOriginal');if(panel){panel.replaceChildren();panel.hidden=true;}}
  async function showPrivateOriginal(id){
    if(window.GatherMode?.demo){toast('Demo emails have no private Gmail originals.');return;}
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
