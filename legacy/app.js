/* Gather's local demo UI. All task data lives in the versioned workspace store. */
(() => {
  'use strict';
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const h = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const store = GatherStore.createStore();
  const ui = { view:'overview', actor:'jack', tab:'all', owner:'', status:'', search:'', messageId:'', lastFocus:null, dialogKind:'', detailId:'', privateRecords:[],privateSession:null,privateState:'loading',privateConfigured:false };
  const labels = { overview:'Overview',tasks:'Shared tasks',inbox:'Email inbox',updates:'Team updates',team:'People',timeline:'Timeline',memory:'Event memory',details:'Private details' };
  const statuses = { todo:'To do', progress:'In progress', blocked:'Blocked', done:'Done' };
  const icons = {
    grid:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
    check:'m4 6 2 2 4-4M13 6h7M4 16l2 2 4-4M13 16h7',
    mail:'M3 5h18v14H3zM3 6l9 7 9-7',
    activity:'M3 12h4l3-8 4 16 3-8h4',
    people:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M17 4a4 4 0 0 1 0 7M22 21v-2a4 4 0 0 0-3-4',
    calendar:'M5 5h14a2 2 0 0 1 2 2v13H3V7a2 2 0 0 1 2-2zM7 3v4M17 3v4M3 11h18',
    spark:'m12 3 2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2L12 3Z',
    memory:'M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2',
    leaf:'M20 3C9 2 3 6 4 14s12 9 16-11ZM4 20l9-10',
    menu:'M4 6h16M4 12h16M4 18h16',plus:'M12 5v14M5 12h14',
    arrow:'M4 12h16m-6-6 6 6-6 6',close:'m6 6 12 12M6 18 18 6',
    clock:'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7v5l3 2',
    done:'m5 12 4 4L19 6',alert:'m12 3 10 18H2L12 3ZM12 9v5M12 17h.01',
    copy:'M8 8h12v13H8zM16 8V3H3v13h5',search:'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm5-2 6 6',
  };
  const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name] || icons.grid}"/></svg>`;
  const fillIcons = root => $$('[data-icon]', root).forEach(el => el.innerHTML = icon(el.dataset.icon));
  const dateKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const dayLabel = value => !value ? 'No due date' : new Date(value+'T12:00:00').toLocaleDateString(undefined,{month:'short',day:'numeric'});
  const timeLabel = value => !value ? 'No update yet' : new Date(value).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  const relative = value => {
    if (!value) return 'No update yet';
    const mins = Math.max(0,Math.floor((Date.now()-new Date(value).getTime())/60000));
    return mins < 1 ? 'Just now' : mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.floor(mins/60)}h ago` : `${Math.floor(mins/1440)}d ago`;
  };
  const member = id => store.getState().members.find(p=>p.id===id) || {id:'',name:'Unassigned',initials:'?',role:'Choose an owner',color:'#e5e8e2'};
  const avatar = (id, small=false) => {const p=member(id);const color=({peach:'#efc9b5',lavender:'#ded3ee',mint:'#c6dfd0',sand:'#f1dfb3'})[p.color]||'#e5e8e2';return `<span class="avatar ${small?'avatar-small':''}" style="--avatar-bg:${color};--avatar-ink:#233b2e" title="${h(p.name)}">${h(p.initials)}</span>`;};
  const person = id => `<span class="person-chip">${avatar(id,true)}<span>${h(member(id).name.split(' ')[0])}</span></span>`;
  const statusBadge = status => `<span class="status-badge status-${h(status)}">${h(statuses[status])}</span>`;
  const due = task => `<span class="${task.status!=='done' && task.dueDate && task.dueDate<dateKey()?'due-overdue':''}">${task.dueDate===dateKey()?'Today':dayLabel(task.dueDate)}</span>`;
  const reason = task => {
    if(task.reportedAt && task.requiresVerification && !task.verifiedAt) return {key:'verification',label:'Verify completion',action:'The owner reports this is finished',rank:0};
    if(task.status==='done') return null;
    if(task.status==='blocked') return {key:'blocked',label:'Blocked',action:'Needs a decision',rank:0};
    if(!task.owner) return {key:'unassigned',label:'No owner',action:'Someone needs to take this',rank:1};
    if(task.dueDate && task.dueDate<dateKey()) return {key:'overdue',label:'Overdue',action:'Past its due date',rank:2};
    if(task.followupAfter && task.followupAfter>dateKey()) return null;
    if(!task.acceptedAt) return {key:'acceptance',label:'Acceptance pending',action:'Ask the owner to acknowledge this commitment',rank:3};
    if(!task.updatedAt || Date.now()-new Date(task.updatedAt).getTime()>=3*86400000) return {key:'stale',label:'No recent update',action:'Time for a check-in',rank:3};
    return null;
  };
  const attention = s => s.tasks.filter(t=>reason(t)).sort((a,b)=>reason(a).rank-reason(b).rank || (a.dueDate||'9999').localeCompare(b.dueDate||'9999'));
  const pending = s => s.messages.filter(m=>!m.appliedTaskId&&!m.ignoredAt);
  const completed = s => s.tasks.filter(t=>t.status==='done').sort((a,b)=>new Date(b.completedAt)-new Date(a.completedAt));
  const completionText = task => task.completionReportedBy ? `${task.completionReportedBy} reported complete · recorded by ${member(task.completedBy).name}` : `Marked done by ${member(task.completedBy).name}`;
  const commitment = task => task.verifiedAt ? `Verified by ${member(task.verifiedBy).name}` : task.reportedAt ? `Reported complete by ${task.reportedBy}${task.requiresVerification?' · needs verification':''}` : task.acceptedAt ? `${task.acceptedSourceId?'Acceptance reported by':'Accepted by'} ${member(task.acceptedBy).name.split(' ')[0]}` : task.status==='done' ? 'Completed record' : task.owner ? 'Waiting for owner acceptance' : 'No owner yet';
  const latestUpdate = task => {const last=task.comments.at(-1);return last&&last.at===task.updatedAt?last.text:task.note;};
  const toast = message => {const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),3200);};
  const pageHeading = (eyebrow,title,subtitle,actions='') => `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${subtitle}</p></div><div class="header-actions">${actions}</div></div>`;
  const addButton = `<button class="btn btn-primary" data-action="add-task">${icon('plus')} Add task</button>`;
  const sourceButton = task => {const group=GatherInbox.conversations(store.getState()).find(g=>g.taskId===task.id);return group?`<button class="text-button" data-action="task-conversation" data-id="${h(task.id)}">${icon('mail')} All emails & changes (${group.messages.length})</button>`:'';};

  function taskRow(task) {
    const done = task.status==='done';
    return `<tr><td><button class="check-button ${done?'checked':''}" data-action="toggle-task" data-id="${h(task.id)}" aria-label="${done?'Reopen':'Complete'} ${h(task.title)}">${done?icon('done'):''}</button></td>
      <td><button class="task-name-button" data-action="task" data-id="${h(task.id)}">${h(task.title)}</button><div class="category-label">${h(task.category)}${task.sourceMessageId?' · From email':''}</div>${done?`<div class="completion-note">${h(completionText(task))} · ${h(timeLabel(task.completedAt))}</div>`:''}</td>
      <td><button class="btn-ghost table-owner" data-action="task" data-id="${h(task.id)}">${person(task.owner)}</button><div class="commitment-note">${h(commitment(task))}</div></td>
      <td>${statusBadge(task.status)}</td><td>${due(task)}</td>
      <td><div class="task-meta">${h(member(task.updatedBy).name.split(' ')[0])} · ${relative(task.updatedAt)}</div><div class="task-note-preview" title="${h(latestUpdate(task))}">${h(latestUpdate(task) || 'No progress note yet')}</div></td>
      <td><button class="icon-button" data-action="task" data-id="${h(task.id)}" aria-label="Open ${h(task.title)}">${icon('arrow')}</button></td></tr>`;
  }
  const empty = (title,copy,action='') => `<div class="empty-state">${icon('done')}<strong>${title}</strong><p>${copy}</p>${action}</div>`;
  function activityItem(item,compact=false) {
    return `<article class="${compact?'feed-item':'activity-item'}">${avatar(item.actor,true)}<div class="${compact?'feed-copy':'activity-content'}"><p><strong>${h(member(item.actor).name)}</strong> ${h(item.text)}</p>${item.taskId?`<button class="text-button" data-action="task" data-id="${h(item.taskId)}">Open task ${icon('arrow')}</button>`:''}<time class="${compact?'feed-time':'activity-date'}" datetime="${h(item.at)}">${timeLabel(item.at)}</time></div></article>`;
  }
  function insightMarkup(item) {
    return `<article class="insight"><span class="insight-source">${h(item.source)}</span><h3>${h(item.title)}</h3><p>${h(item.body)}</p><div class="insight-actions"><button class="btn btn-small" data-action="accept-insight" data-id="${h(item.id)}">${icon('plus')} Add to plan</button><button class="icon-button" data-action="dismiss-insight" data-id="${h(item.id)}" aria-label="Dismiss ${h(item.title)}">${icon('close')}</button></div></article>`;
  }

  function overview(s) {
    const needs=attention(s), done=completed(s), emails=pending(s), blocked=s.tasks.filter(t=>t.status==='blocked');
    const progress=Math.round(done.length/Math.max(s.tasks.length,1)*100);
    const days=Math.max(0,Math.ceil((new Date(s.event.date+'T00:00:00')-new Date(dateKey()+'T00:00:00'))/86400000));
    const suggestions=store.getSuggestions();
    return pageHeading(`${h(s.event.name)} <span>·</span> ${days} DAYS TO GO`, 'A clear plan. A lighter day.', `Here’s where things stand, ${h(member(ui.actor).name.split(' ')[0])}.`,addButton)+`
      <section class="briefing-banner"><div class="briefing-icon">${icon('spark')}</div><div class="briefing-copy"><strong>${needs.length ? `${needs.length} things need a little attention.` : 'The plan is in good shape.'}</strong><p>${blocked.length?`${blocked.length} blocked ${blocked.length===1?'task':'tasks'}. `:''}${emails.length} ${emails.length===1?'email is':'emails are'} ready to review. ${done.length} tasks are finished and accounted for.</p></div><div class="briefing-actions"><button class="btn btn-secondary" data-action="digest">Catch me up ${icon('arrow')}</button></div></section>
      <section class="stat-grid" aria-label="Project status">
        <button class="stat-card" data-action="task-filter" data-filter="attention"><span class="stat-label">Needs attention</span><strong class="stat-number">${needs.length}<span class="metric-icon">${icon('alert')}</span></strong><span class="stat-note">Decisions, owners & follow-ups</span></button>
        <button class="stat-card" data-action="task-filter" data-filter="done"><span class="stat-label">Completed</span><strong class="stat-number">${done.length}<span class="muted"> / ${s.tasks.length}</span></strong><span class="progress-track"><span class="progress-fill" style="width:${progress}%"></span></span><span class="stat-note">${progress}% of the plan is done</span></button>
        <button class="stat-card" data-view="inbox"><span class="stat-label">Email to review</span><strong class="stat-number">${emails.length}<span class="metric-icon">${icon('mail')}</span></strong><span class="stat-note">Turn loose threads into next steps</span></button>
        <button class="stat-card" data-view="team"><span class="stat-label">People, together</span><strong class="stat-number">${s.members.length}<span class="metric-icon">${icon('people')}</span></strong><span class="stat-note">One owner for every commitment</span></button>
      </section>
      <div class="workspace-grid"><div class="stack">
        <section class="panel"><div class="panel-heading"><div><h2 class="section-title">Needs your attention</h2><p class="section-subtitle">The things that won’t move themselves.</p></div><button class="text-button" data-action="task-filter" data-filter="attention">View all ${icon('arrow')}</button></div>
          <div class="attention-list">${needs.slice(0,4).map(t=>{const r=reason(t);return `<article class="attention-item"><div class="attention-reason reason-${r.key}">${r.label}</div><div class="task-summary"><button class="task-title" data-action="task" data-id="${h(t.id)}">${h(t.title)}</button><p>${h(t.note||r.action)}</p><div class="task-meta">${person(t.owner)}<span>·</span>${due(t)}<span>· Updated ${relative(t.updatedAt)}</span></div></div><div class="attention-actions"><button class="btn btn-small btn-secondary" data-action="${!t.owner?'task':'followup'}" data-id="${h(t.id)}">${!t.owner?'Assign owner':'Draft follow-up'}</button></div></article>`;}).join('') || empty('Nothing to chase.','Every open task has an owner and a recent update.')}</div>
        </section>
        <section class="panel"><div class="panel-heading"><div><h2 class="section-title">Recently finished</h2><p class="section-subtitle">Done, with a name and a record behind it.</p></div><button class="text-button" data-action="task-filter" data-filter="done">All completed ${icon('arrow')}</button></div><div class="mini-feed">${done.slice(0,3).map(t=>`<article class="feed-item">${avatar(t.completedBy)}<div class="feed-copy"><button class="task-title" data-action="task" data-id="${h(t.id)}">${h(t.title)}</button><p>${h(completionText(t))}</p><time class="feed-time">${timeLabel(t.completedAt)}</time></div><span class="status-badge status-done">${icon('done')} Done</span></article>`).join('') || empty('Your next win goes here.','Complete a task and its owner, time, and context stay visible.')}</div></section>
      </div><aside class="stack">
        <section class="ai-panel" id="thoughtPartner"><div class="ai-title"><span class="ai-orb">${icon('spark')}</span><span>GATHER THOUGHT PARTNER</span></div><h2>A step ahead, together.</h2><p>Small things that make a better day. Each suggestion has a reason.</p>${suggestions.slice(0,2).map(insightMarkup).join('') || '<div class="insight"><h3>All caught up.</h3><p>Your current checks are covered. New event feedback will shape the next recommendations.</p></div>'}<button class="text-button" data-action="thought-partner">Review all ${suggestions.length} suggestions ${icon('arrow')}</button></section>
        <section class="panel email-preview"><div class="panel-heading"><div><h2 class="section-title">From email to action</h2><p class="section-subtitle">Review it once. Keep it with the plan.</p></div></div>${emails.slice(0,2).map(m=>`<button class="email-item" data-action="source" data-id="${h(m.id)}"><span class="email-icon">${icon('mail')}</span><span class="email-copy"><strong>${h(m.subject)}</strong><span>${h(m.sender)}</span></span>${icon('arrow')}</button>`).join('') || '<p class="notice">Every message has been reviewed.</p>'}<button class="text-button" data-view="inbox">Open email inbox ${icon('arrow')}</button></section>
      </aside></div>
      <section class="panel section-gap"><div class="panel-heading"><div><h2 class="section-title">Latest from the team</h2><p class="section-subtitle">The update stays with the work.</p></div><button class="text-button" data-view="updates">All updates ${icon('arrow')}</button></div><div class="mini-feed">${s.activity.slice(0,3).map(a=>activityItem(a,true)).join('')}</div></section>`;
  }

  function filteredTasks(s) {
    return s.tasks.filter(t=>(ui.tab!=='mine'||t.owner===ui.actor)&&(ui.tab!=='attention'||reason(t))&&(ui.tab!=='done'||t.status==='done')&&(!ui.owner||t.owner===ui.owner||(ui.owner==='unassigned'&&!t.owner))&&(!ui.status||t.status===ui.status)&&(!ui.search||`${t.title} ${t.note} ${member(t.owner).name} ${t.category}`.toLowerCase().includes(ui.search.toLowerCase())));
  }
  const options = (entries,value) => entries.map(([id,label])=>`<option value="${h(id)}" ${id===value?'selected':''}>${h(label)}</option>`).join('');
  const ownerOptions = (value,all=false) => options([...(all?[['','All owners'],['unassigned','Unassigned']]:[['','Unassigned']]),...store.getState().members.map(p=>[p.id,p.name])],value);
  const statusOptions = value => options(Object.entries(statuses),value);
  function tasksView(s) {
    const tasks=filteredTasks(s);
    return pageHeading('WHO’S DOING WHAT','Every commitment, accounted for.','A name, a status, and the latest word on every task.',addButton)+`
      <section class="panel"><div class="toolbar"><div class="filter-tabs" role="group" aria-label="Task views">${[['all','All tasks'],['mine','My tasks'],['attention','Needs attention'],['done','Completed']].map(([id,label])=>`<button class="filter-tab ${ui.tab===id?'active':''}" data-action="task-filter" data-filter="${id}" aria-pressed="${ui.tab===id}">${label}</button>`).join('')}</div><label class="search-input">${icon('search')}<input id="taskSearch" type="search" value="${h(ui.search)}" placeholder="Find a task or person…" aria-label="Search tasks"></label></div>
      <div class="toolbar"><div class="inline"><select id="ownerFilter" class="select-input" aria-label="Filter by owner">${ownerOptions(ui.owner,true)}</select><select id="statusFilter" class="select-input" aria-label="Filter by status">${options([['','All statuses'],...Object.entries(statuses)],ui.status)}</select></div><span class="muted" id="taskResultCount">${tasks.length} ${tasks.length===1?'task':'tasks'}</span></div>
      <div class="task-table-wrap"><table class="task-table"><thead><tr><th><span class="sr-only">Completion</span></th><th scope="col">TASK</th><th scope="col">OWNER</th><th scope="col">STATUS</th><th scope="col">DUE</th><th scope="col">LATEST UPDATE</th><th><span class="sr-only">Details</span></th></tr></thead><tbody id="taskRows">${tasks.map(taskRow).join('')}</tbody></table><div id="taskEmpty" ${tasks.length?'hidden':''}>${empty('No tasks match this view.','Try another filter or search.')}</div></div></section>`;
  }
  function inboxView(s) {
    const messages=s.messages.filter(m=>!m.ignoredAt);
    const selected=messages.find(m=>m.id===ui.messageId) || messages.find(m=>!m.appliedTaskId) || messages[0];
    ui.messageId=selected?.id || '';
    return pageHeading('CLEAR THE LOOSE ENDS','The inbox that leads somewhere.','Review an email, confirm what it means, and attach it to the work.',`<button class="btn btn-primary" data-action="paste-email">${icon('plus')} Paste an email</button>`)+`
      <div class="notice">Local email review · no mailbox is connected. Do not paste private confirmation emails here. Put booking references in <button class="text-button" data-view="details">Private details</button>.</div>
      <div class="intake-demo"><span>Try a changing conversation:</span><button class="btn btn-secondary btn-small" data-action="sample-reply" data-step="pending">1. Buses awaiting deposit</button><button class="btn btn-secondary btn-small" data-action="sample-reply" data-step="confirmed">2. Booking confirmed</button><span class="muted">Sample replies · review each before applying</span></div>
      <div class="intake-layout section-gap"><section class="panel message-list" aria-label="Emails to review">${messages.map(m=>`<button class="message-button ${m.id===selected?.id?'selected':''}" data-action="select-message" data-id="${h(m.id)}"><span class="message-sender">${h(m.sender)}</span><strong class="message-subject">${h(m.subject)}</strong><span class="message-preview">${h(m.body.slice(0,95))}</span><span class="message-status ${m.appliedTaskId?'is-applied':''}">${m.appliedTaskId?'✓ Added to the plan':'Needs review'}</span></button>`).join('')}</section>
      ${selected?emailReader(selected,s):`<section class="panel">${empty('A clean inbox.','Paste a message to turn it into a clear next step.')}</section>`}</div>`;
  }
  function emailReader(m,s) {
    const p=m.suggested || {};
    const current=s.tasks.find(t=>t.id===p.taskId);
    const stale=current&&p.baseRevision!==current.revision;
    const older=current&&s.messages.some(item=>item.appliedTaskId===current.id&&item.receivedAt>m.receivedAt);
    const conversation=s.messages.filter(item=>item.threadId===m.threadId&&item.id!==m.id);
    return `<section class="panel email-reader"><div class="email-reader-header"><span class="source-label">ORIGINAL MESSAGE</span><h2>${h(m.subject)}</h2><div class="message-meta"><strong>${h(m.sender)}</strong><span>${timeLabel(m.receivedAt)}</span></div></div><div class="email-body">${h(m.body)}</div>${m.appliedTaskId?`<div class="review-card"><span class="status-badge status-done">${icon('done')} Applied to plan</span><p>The original message is attached to the task. Its sender is kept separate from the person who applied the update.</p><button class="btn btn-primary" data-action="task" data-id="${h(m.appliedTaskId)}">Open linked task ${icon('arrow')}</button></div>`:`<form class="review-card" id="emailReviewForm" data-id="${h(m.id)}"><div class="panel-heading"><div><span class="eyebrow">REVIEW BEFORE APPLYING</span><h3>A message becomes a next step.</h3><p class="section-subtitle">These are draft fields. You decide the task, owner, and status.</p></div></div><div class="form-grid">
      <div class="full-width"><p class="notice">${h(p.reason||'Review the sender’s claim against the current plan.')}</p>${current?`<div class="comparison"><div><small>CURRENT PLAN · REVISION ${current.revision}</small><strong>${h(statuses[current.status])}</strong><span>${h(member(current.owner).name)} · ${dayLabel(current.dueDate)}</span><p>${h(current.note)}</p></div><div><small>EMAIL PROPOSES</small><strong>${h(statuses[p.status])}</strong><span>${h(member(p.owner).name)} · ${dayLabel(p.dueDate)}</span><p>${h(p.note)}</p></div></div>`:''}${stale?'<p class="warning-note">The task changed after this proposal. Refresh it before making a decision.</p>':''}<button type="button" class="text-button" data-action="refresh-proposal" data-id="${h(m.id)}">Refresh against the current plan</button></div>
      <input type="hidden" name="expectedRevision" value="${h(p.baseRevision||0)}">
      <label class="field">Action<select name="mode" id="emailMode">${options([['update','Update an existing task'],['new','Create a new task']],p.mode||'new')}</select></label>
      <label class="field" id="existingTaskField" ${p.mode==='update'?'':'hidden'}>Linked task<select name="taskId" id="emailTask" ${p.mode==='update'?'required':''}>${options([['','Choose the task to update…'],...s.tasks.map(t=>[t.id,t.title])],p.taskId||'')}</select></label>
      <label class="field full-width">Task name<input name="title" required maxlength="180" value="${h(p.title||m.subject)}"></label>
      <label class="field">Owner<select name="owner">${ownerOptions(p.owner||'')}</select></label>
      <label class="field">Status<select name="status">${statusOptions(p.status||'todo')}</select></label>
      <label class="field">Due date<input type="date" name="dueDate" value="${h(p.dueDate||'')}"></label>
      <label class="field full-width">Progress note<textarea name="note" rows="3" maxlength="3000">${h(p.note||'')}</textarea></label>${older?'<label class="check-field full-width"><input name="confirmConflict" type="checkbox" required> I reviewed the newer update and intend to apply this older message.</label>':''}</div><div class="form-actions"><button type="button" class="text-button" data-action="ignore-message" data-id="${h(m.id)}">Set aside · no task change</button><button class="btn btn-primary" type="submit" ${stale?'disabled':''}>Apply reviewed change ${icon('arrow')}</button></div><p class="muted">Recorded by ${h(member(ui.actor).name)}. Completion reports do not imply independent verification.</p></form>`}${conversation.length?`<div class="thread-context"><h3>Same conversation</h3>${conversation.map(item=>`<button class="text-button" data-action="source" data-id="${h(item.id)}">${h(item.subject)} · ${item.appliedTaskId?'Applied':item.ignoredAt?'Set aside':'Needs review'} ${icon('arrow')}</button>`).join('')}</div>`:''}</section>`;
  }
  function teamView(s) {
    return pageHeading('CLEAR OWNERSHIP','Good people. Shared momentum.','See each person’s commitments without asking for another status email.',`<button class="btn btn-secondary" data-action="invite">${icon('plus')} Invite someone</button>`)+`<div class="team-grid">${s.members.map(p=>{const tasks=s.tasks.filter(t=>t.owner===p.id),done=tasks.filter(t=>t.status==='done').length,blocked=tasks.filter(t=>t.status==='blocked').length;return `<article class="team-card"><div class="team-card-head">${avatar(p.id)}<div><h2>${h(p.name)}</h2><p>${h(p.role)}</p></div>${p.id===ui.actor?'<span class="chip">You</span>':''}</div><div class="team-stats"><div><strong>${tasks.filter(t=>t.status!=='done').length}</strong><span>Open</span></div><div><strong>${done}</strong><span>Done</span></div><div><strong>${blocked}</strong><span>Blocked</span></div></div><div class="workload-track"><div class="workload-fill" style="width:${Math.round(done/Math.max(tasks.length,1)*100)}%"></div></div><button class="btn btn-secondary" data-action="person-tasks" data-id="${h(p.id)}">View ${h(p.name.split(' ')[0])}’s tasks ${icon('arrow')}</button></article>`;}).join('')}</div><section class="panel section-gap"><div class="panel-heading"><div><h2 class="section-title">Still looking for an owner</h2><p class="section-subtitle">Shared responsibility works best when one person takes the lead.</p></div></div><div class="mini-feed">${s.tasks.filter(t=>!t.owner&&t.status!=='done').map(t=>`<article class="feed-item">${avatar('')}<div class="feed-copy"><button class="task-title" data-action="task" data-id="${h(t.id)}">${h(t.title)}</button><p>${h(t.note)}</p></div><button class="btn btn-secondary btn-small" data-action="claim" data-id="${h(t.id)}">I’ll take this</button></article>`).join('')||empty('Every task has an owner.','No commitments are falling between people.')}</div></section>`;
  }
  function timelineView(s) {
    const keys=[...new Set(s.tasks.filter(t=>t.status!=='done').map(t=>t.dueDate||''))].sort((a,b)=>(a||'9999').localeCompare(b||'9999'));
    return pageHeading('THE DAYS AHEAD','A plan you can see coming.','Deadlines follow the tasks. Change one and the timeline changes with it.',addButton)+`<section class="panel"><div class="timeline-list">${keys.map(key=>`<div class="timeline-day"><div class="timeline-date"><strong>${key?dayLabel(key):'Unscheduled'}</strong><span>${key===dateKey()?'Today':key&&key<dateKey()?'Past due':''}</span></div><div class="timeline-tasks">${s.tasks.filter(t=>t.status!=='done'&&(t.dueDate||'')===key).map(t=>`<button class="timeline-task" data-action="task" data-id="${h(t.id)}"><strong>${h(t.title)}</strong><span class="inline">${person(t.owner)}${statusBadge(t.status)}</span></button>`).join('')}</div></div>`).join('')||empty('The work is complete.','All your planned tasks have been checked off.')}<div class="timeline-day event-day"><div class="timeline-date"><strong>${dayLabel(s.event.date)}</strong></div><div class="timeline-tasks"><div class="timeline-task"><span class="eyebrow">EVENT DAY</span><strong>${h(s.event.name)}</strong><p>${h(s.event.location)} · 10:00 AM–4:00 PM</p></div></div></div></div></section>`;
  }
  function updatesView(s) {
    return pageHeading('THE WHO, WHAT, AND WHEN','No more “did anyone do this?”','A running record of decisions, handoffs, progress, and completions.',`<button class="btn btn-secondary" data-action="digest">${icon('copy')} Catch me up</button>`)+`<div class="workspace-grid"><section class="panel"><div class="panel-heading"><h2 class="section-title">Team activity</h2><span class="chip">${s.activity.length} updates</span></div><div class="activity-list">${s.activity.map(a=>activityItem(a)).join('')||empty('Your next update belongs here.','Changes to the plan will record who made them.')}</div></section><aside class="panel"><div class="panel-heading"><div><h2 class="section-title">Follow-up drafts</h2><p class="section-subtitle">Saved here. Ready for you to send.</p></div></div>${s.drafts.length?s.drafts.map(d=>`<article class="source-card"><span class="source-label">DRAFT · ${timeLabel(d.at)}</span><p>${h(d.text)}</p><div class="inline"><button class="text-button" data-action="copy-draft" data-id="${h(d.id)}">${icon('copy')} Copy draft</button><button class="text-button" data-action="task" data-id="${h(d.taskId)}">Open task</button></div></article>`).join(''):empty('One thoughtful nudge at a time.','Draft a follow-up from a blocked or stale task. Nothing is sent automatically.')}</aside></div>`;
  }
  function memoryView(s) {
    return pageHeading('GET BETTER, EVENT BY EVENT','Don’t learn the same lesson twice.','Keep the lesson, its context, and whether the change actually helped.',`<button class="btn btn-primary" data-action="feedback">${icon('plus')} Add event feedback</button>`)+`<div class="notice">A completed task is not proof a lesson helped. Record the outcome separately; irrelevant or unsuccessful lessons stop being suggested.</div><div class="memory-grid section-gap">${s.memories.map(m=>`<article class="memory-card"><span class="memory-category">${h(m.category||'Team learning')}</span><h2>${h(m.change)}</h2>${m.wentWell?`<p><strong>Keep doing:</strong> ${h(m.wentWell)}</p>`:''}<p><strong>Applies:</strong> ${h(({always:'All events',outdoor:'Outdoor events only',transport:'When transport is needed','same-venue':'At the original venue'})[m.scope])}</p>${m.context?`<p>${h(m.context)}</p>`:''}<p class="chip">${!m.active?'Retired':m.outcome==='helped'?'Previously helped':m.outcome==='did-not-help'?'Did not help · not suggested':'Outcome not evaluated'}</p>${m.outcomeNote?`<p>${h(m.outcomeNote)}</p>`:''}<div class="task-meta">${m.rating?`${m.rating}/5 event rating · `:''}${timeLabel(m.at)}</div><button class="text-button" data-action="edit-memory" data-id="${h(m.id)}">Edit context & outcome ${icon('arrow')}</button></article>`).join('')||empty('What should the next plan remember?','Capture one learning from a past event and Gather will turn it into a check.')}</div>`;
  }

  function render() {
    ui.reviewDirty=false;
    const s=store.getState();
    $('#taskNavCount').textContent=s.tasks.filter(t=>t.status!=='done').length;
    $('#inboxNavCount').textContent=pending(s).length;
    $('#aiNavCount').textContent=store.getSuggestions().length;
    $('#storageWarning').hidden=s.persistence!=='unavailable';
    $('#breadcrumbCurrent').textContent=labels[ui.view];
    $$('.nav-item[data-view]').forEach(button=>{button.classList.toggle('active',button.dataset.view===ui.view);button.setAttribute('aria-current',button.dataset.view===ui.view?'page':'false');});
    $('#profile').innerHTML=`${avatar(ui.actor)}<div class="profile-copy"><strong>${h(member(ui.actor).name)}</strong><span>${h(member(ui.actor).role)}</span></div>`;
    $('#actorSelect').innerHTML=options(s.members.map(p=>[p.id,`${p.name.split(' ')[0]} · demo`]),ui.actor);
    $('#viewRoot').innerHTML=({overview,tasks:tasksView,inbox:inboxView,team:teamView,timeline:timelineView,updates:updatesView,memory:memoryView,details:privateView})[ui.view](s);
    fillIcons(document);
  }
  function navigate(view) {
    if(!labels[view]) view='overview';
    ui.view=view;
    if(view!=='details'){privateEpoch++;ui.privateRecords=[];}
    history.replaceState(null,'',`#${view}`);
    setDrawer(false);
    render();
    if(view==='details')loadPrivate();
    window.scrollTo({top:0,behavior:'instant'});
  }
  function setDrawer(open) {
    const mobile=matchMedia('(max-width:800px)').matches;
    $('#sidebar').classList.toggle('open',open);
    $('#mobileOverlay').classList.toggle('open',open&&mobile);
    $('#mobileMenu').setAttribute('aria-expanded',String(open));
    $('#sidebar').inert=mobile&&!open;
  }
  function openDialog(title,body,footer='',wide=false,kind='') {
    ui.lastFocus=document.activeElement;
    ui.dialogKind=kind;
    $('#dialog').className=`dialog ${wide?'dialog-wide':''}`;
    $('#dialog').innerHTML=`<div class="dialog-header"><h2 id="dialogTitle">${h(title)}</h2><button class="icon-button dialog-close" data-action="close-dialog" aria-label="Close dialog">${icon('close')}</button></div><div class="dialog-body">${body}</div>${footer?`<div class="dialog-footer">${footer}</div>`:''}`;
    $('#dialogBackdrop').hidden=false;
    $('#dialogBackdrop').classList.add('open');
    $('#appShell').inert=true;
    document.body.style.overflow='hidden';
    requestAnimationFrame(()=>{const first=$('input,select,textarea', $('#dialog')) || $('.dialog-close');first?.focus();});
  }
  function closeDialog() {
    $('#dialogBackdrop').hidden=true;
    $('#dialogBackdrop').classList.remove('open');
    $('#appShell').inert=false;
    document.body.style.overflow='';
    $('#dialog').replaceChildren();
    ui.dialogKind='';
    if(ui.lastFocus?.isConnected)ui.lastFocus.focus();
    else $('#viewRoot').querySelector('button')?.focus();
  }
  function taskDialog(id) {
    const task=store.getState().tasks.find(t=>t.id===id);
    if(!task){toast('That task is no longer available.');return;}
    ui.detailId=id;
    openDialog(task.title,`<div class="inline">${statusBadge(task.status)}<span class="category-label">${h(task.category)}</span>${sourceButton(task)}</div>${task.completedAt?`<p class="completion-note">${h(completionText(task))} · ${timeLabel(task.completedAt)}</p>`:''}
      <form id="taskDetailForm" data-id="${h(id)}" class="section-gap"><div class="form-grid"><label class="field full-width">Task name<input name="title" required maxlength="180" value="${h(task.title)}"></label><label class="field">Owner<select name="owner">${ownerOptions(task.owner)}</select></label><label class="field">Status<select name="status">${statusOptions(task.status)}</select></label><label class="field">Due date<input name="dueDate" type="date" value="${h(task.dueDate)}"></label><label class="field">Category<select name="category">${options(['Transport','Food & drink','Venue','Program','Guest care'].map(x=>[x,x]),task.category)}</select></label><label class="field full-width">Latest progress / what’s blocking this?<textarea name="note" rows="3" maxlength="3000" placeholder="Give Jack the context, not another email chain…">${h(task.note)}</textarea></label></div><div class="form-actions"><span class="muted">Updated by ${h(member(task.updatedBy).name)} · ${relative(task.updatedAt)}</span><button class="btn btn-primary" type="submit">Save changes</button></div></form>
      <section class="commitment-panel section-gap"><h3>Commitment & confirmation</h3><p>${h(commitment(task))}</p><div class="inline">${task.owner===ui.actor&&!task.acceptedAt&&task.status!=='done'?`<button class="btn btn-secondary btn-small" data-action="accept-task" data-id="${h(id)}">I accept this task</button>`:''}${task.owner===ui.actor&&task.status!=='done'?`<button class="btn btn-secondary btn-small" data-action="report-task" data-id="${h(id)}">Report completion</button>`:''}${task.reportedAt&&!task.verifiedAt&&ui.actor==='jack'?`<button class="btn btn-primary btn-small" data-action="verify-task" data-id="${h(id)}">Verify completion</button>`:''}<button class="text-button" data-action="participant-preview" data-id="${h(id)}">Preview simple participant response</button>${ui.actor==='jack'?`<button class="text-button" data-action="verification-toggle" data-id="${h(id)}">${task.requiresVerification?'Turn off':'Require'} organizer verification</button>`:''}</div><p class="muted">${task.requiresVerification?'A completion report waits for Jack’s verification.':'Owner reports can complete this task without a separate verification.'}</p></section>
      <div class="followup-context section-gap"><div><strong>${reason(task)?reason(task).action:'Keep the next step clear'}</strong><p>${task.owner?`Draft a specific check-in for ${h(member(task.owner).name.split(' ')[0])}.`:'Assign an owner so this does not get lost.'}</p>${task.followupAfter?`<p>Next planned follow-up: ${dayLabel(task.followupAfter)}</p>`:''}</div><button class="btn btn-secondary btn-small" data-action="followup" data-id="${h(id)}">Draft follow-up</button></div>
      <section class="comments section-gap"><h3>Keep the conversation with the work</h3>${task.comments.map(c=>`<article class="comment">${avatar(c.actor,true)}<div><strong>${h(member(c.actor).name)}</strong><time>${timeLabel(c.at)}</time><p>${h(c.text)}</p></div></article>`).join('')||'<p class="muted">No comments yet. Add the context your team needs.</p>'}<form id="commentForm" class="comment-form" data-id="${h(id)}"><label class="field"><span class="sr-only">Add a comment</span><textarea name="text" required rows="2" maxlength="3000" placeholder="Share an update or decision…"></textarea></label><button class="btn btn-primary btn-small" type="submit">Post as ${h(member(ui.actor).name.split(' ')[0])}</button></form></section>`, '',true,'task');
  }
  function newTaskDialog() {
    openDialog('Give the next step a home.',`<p class="muted">A clear owner means one less thing to chase.</p><form id="newTaskForm"><div class="form-grid"><label class="field full-width">Task name<input name="title" required maxlength="180" placeholder="What needs to happen?"></label><label class="field">Owner<select name="owner">${ownerOptions('')}</select></label><label class="field">Due date<input name="dueDate" type="date"></label><label class="field">Category<select name="category">${options(['Guest care','Food & drink','Transport','Venue','Program'].map(x=>[x,x]),'Guest care')}</select></label><label class="field">Status<select name="status">${statusOptions('todo')}</select></label><label class="field full-width">Context<textarea name="note" rows="3" maxlength="3000" placeholder="What does the owner need to know?"></textarea></label></div><div class="form-actions"><button class="btn btn-primary" type="submit">Add task</button></div></form>`);
  }
  function followupDialog(id) {
    const task=store.getState().tasks.find(t=>t.id===id);
    if(!task)return;
    const r=reason(task);
    const saved=store.getState().drafts.find(d=>d.taskId===id);
    const draft=saved?.text || `Hi ${task.owner?member(task.owner).name.split(' ')[0]:'team'}, quick check-in on “${task.title}”.\n\n${latestUpdate(task)?`The last update was: “${latestUpdate(task)}”\n\n`:''}${task.status==='blocked'?'What decision or help would unblock this, and who do you need it from?':!task.owner?'Who can take ownership, and what is a realistic next checkpoint?':'What is done so far, and what is the next concrete step?'}${task.dueDate?` We had ${dayLabel(task.dueDate)} as the target—does that still work?`:''}\n\nThanks,\n${member(ui.actor).name.split(' ')[0]}`;
    openDialog('A useful nudge, already drafted.',`<div class="followup-context"><div><strong>${h(task.title)}</strong><p>${r?h(r.label):'Check-in'} · Last updated ${relative(task.updatedAt)}</p></div></div><form id="followupForm" data-id="${h(id)}"><label class="field section-gap">Your message<textarea name="text" required rows="10" maxlength="6000">${h(draft)}</textarea></label><p class="notice">This is an editable draft. Saving or copying it does not send a message.</p><div class="form-actions"><button class="btn btn-primary" type="submit">${icon('copy')} Save & copy draft</button><button type="button" class="text-button" data-action="record-followup" data-id="${h(id)}">I’ve already sent a follow-up</button></div></form>`, '',false,'followup');
  }
  function digestText(s) {
    return `${s.event.name} — ${new Date().toLocaleDateString()}\n\nCOMPLETED\n${completed(s).map(t=>`• ${t.title} — ${completionText(t)} (${timeLabel(t.completedAt)})`).join('\n')||'No completed tasks yet.'}\n\nNEEDS ATTENTION\n${attention(s).map(t=>`• ${t.title} — ${member(t.owner).name}; ${reason(t).label}. ${t.note||''}`).join('\n')||'No outstanding attention items.'}\n\nEMAIL TO REVIEW\n${pending(s).map(m=>`• ${m.subject} — ${m.sender}`).join('\n')||'All messages reviewed.'}`;
  }
  function digestDialog() {
    const s=store.getState();
    const section=(title,items)=>`<section class="digest-section"><h3>${title}</h3>${items||'<p class="muted">Nothing here right now.</p>'}</section>`;
    openDialog('Here’s the whole picture.',`<p class="muted">A snapshot of the current plan · ${timeLabel(Date.now())}</p>${section('Completed, and by whom',completed(s).slice(0,5).map(t=>`<p><button class="text-button" data-action="task" data-id="${h(t.id)}">${h(t.title)}</button><br>${h(completionText(t))} · ${timeLabel(t.completedAt)}</p>`).join(''))}${section('Decisions & follow-ups',attention(s).map(t=>`<p><strong>${h(reason(t).label)}:</strong> <button class="text-button" data-action="task" data-id="${h(t.id)}">${h(t.title)}</button><br>${h(member(t.owner).name)} · ${h(t.note)}</p>`).join(''))}${section(`${pending(s).length} emails still need a review`,pending(s).map(m=>`<p>${h(m.subject)}<br><span class="muted">${h(m.sender)}</span></p>`).join(''))}`,`<span class="muted">Only your current task records are summarized.</span><button class="btn btn-primary" data-action="copy-digest">${icon('copy')} Copy summary</button>`,true,'digest');
  }
  function feedbackDialog() {
    openDialog('What should the next plan remember?',`<form id="feedbackForm"><div class="form-grid"><label class="field full-width">What worked well?<textarea name="wentWell" rows="2" maxlength="2000" placeholder="Keep the staggered bus departures…"></textarea></label><label class="field full-width">What should we do differently?<textarea name="change" required rows="3" maxlength="2000" placeholder="Set up a quiet space before guests arrive…"></textarea></label><label class="field">Area<select name="category">${options(['Guest care','Transport','Food & drink','Venue','Program'].map(x=>[x,x]),'Guest care')}</select></label><label class="field">How did the event feel?<select name="rating">${options([['5','5 — Great'],['4','4 — Good'],['3','3 — Mixed'],['2','2 — Difficult'],['1','1 — Needs work']],'4')}</select></label></div>${memoryFields()}<p class="notice">Your lesson becomes a suggestion only when its selected event context matches. Free-text exceptions are shown for your review, not automatically interpreted.</p><div class="form-actions"><button class="btn btn-primary" type="submit">Save learning</button></div></form>`);
  }
  function thoughtDialog() {
    const suggestions=store.getSuggestions();
    openDialog('What might be slipping through?',`<div class="notice">These checks use your recorded event context, tasks, and applicable feedback. No live AI or RSVP service is connected.</div><button class="btn btn-secondary section-gap" data-action="event-context">Update event context</button><div class="ai-panel section-gap">${suggestions.map(insightMarkup).join('')||empty('You’ve covered the current checks.','New feedback can bring the next useful question into focus.')}</div><button class="text-button section-gap" data-action="feedback">${icon('plus')} Add a lesson from a past event</button>`, '',true,'thought');
  }
  function pasteDialog() {
    const threads=[...new Map(store.getState().messages.map(m=>[m.threadId,[m.threadId,m.subject]])).values()];
    const group=GatherInbox.conversations(store.getState()).find(g=>g.key===ui.conversationKey);
    openDialog('Add an email to a task',`<p class="warning-note">This text becomes shared planning data. Remove booking references, private links, and personal details first.</p><form id="pasteForm"><label class="field">Task<select name="taskId">${options([['','Let Gather suggest a task'],...store.getState().tasks.map(t=>[t.id,t.title])],group?.taskId||'')}</select></label><label class="field section-gap">Sender<input name="sender" required maxlength="200" placeholder="Maya Singh"></label><details class="section-gap"><summary>Link an existing email thread (optional)</summary><label class="field">Email thread<select name="threadId">${options([['','New email thread'],...threads],'')}</select></label></details><label class="field section-gap">Subject<input name="subject" required maxlength="180" placeholder="Catering numbers confirmed"></label><label class="field section-gap">Email text<textarea name="body" required rows="6" maxlength="12000" placeholder="Paste the new reply. Remove private details first."></textarea></label><div class="form-actions"><button class="btn btn-primary" type="submit">Add to conversation</button></div></form>`);
  }
  async function copyText(text) {
    try {await navigator.clipboard.writeText(text);return true;}catch{return false;}
  }
  function copyFallback(text,title='Copy this text') {
    openDialog(title,`<p class="notice">Automatic copying is unavailable here. Select and copy the text below.</p><label class="field"><span class="sr-only">Text to copy</span><textarea rows="12" readonly>${h(text)}</textarea></label>`);
    setTimeout(()=>$('#dialog textarea')?.select(),0);
  }

  let privateEpoch=0, privateTimer;
  async function privateApi(path,body,session=ui.privateSession) {
    const response=await fetch(`/api/private/${path}`,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json','X-Gather-CSRF':session?.csrf||''}:{},body:body?JSON.stringify(body):undefined,cache:'no-store',credentials:'same-origin'});
    if(!(response.headers.get('content-type')||'').includes('application/json'))throw new Error('Start the Gather local server to use protected private details.');
    const result=await response.json();
    if(!response.ok){if(response.status===401){ui.privateSession=null;ui.privateRecords=[];ui.privateState='locked';}throw new Error(result.error||'Private details are unavailable.');}
    return result;
  }
  function clearPrivate() {
    privateEpoch++;clearTimeout(privateTimer);ui.privateSession=null;ui.privateRecords=[];ui.privateState='locked';
    if(ui.dialogKind==='private')closeDialog();
    if(ui.view==='details')render();
  }
  async function lockPrivate() {
    const request=ui.privateSession?privateApi('lock',{}).catch(()=>{}):Promise.resolve();clearPrivate();await request;
  }
  async function loadPrivate() {
    const ticket=++privateEpoch;
    try{
      const config=await privateApi('config');if(ticket!==privateEpoch||ui.view!=='details')return;
      ui.privateConfigured=config.configured;
      if(ui.actor!=='jack'){ui.privateState='locked';render();return;}
      let session;try {session=await privateApi('session');}catch{session=null;}
      if(ticket!==privateEpoch||ui.view!=='details')return;
      ui.privateSession=session;
      if(ui.privateSession){const result=await privateApi('records');if(ticket!==privateEpoch||ui.view!=='details')return;ui.privateRecords=result.records;ui.privateState='unlocked';privateTimer=setTimeout(()=>{lockPrivate();toast('Private details locked after the administrator session ended.');},Math.max(0,ui.privateSession.expiresAt-Date.now()));}
      else ui.privateState='locked';render();
    }catch(error){if(ticket!==privateEpoch)return;ui.privateRecords=[];ui.privateState='unavailable';ui.privateError=error.message;render();}
  }
  function privateView(s) {
    const heading=pageHeading('ADMINISTRATOR DETAILS','Bookings, without the searching.','Flight references, hotel confirmations, and logistics details stay separate from the shared plan.',ui.privateState==='unlocked'?`<button class="btn btn-secondary" data-action="lock-private">Lock</button><button class="btn btn-primary" data-action="new-booking">${icon('plus')} Add booking</button>`:'');
    if(ui.privateState==='loading')return heading+'<section class="panel private-panel"><p role="status">Checking the local private-details service…</p></section>';
    if(ui.privateState==='unavailable')return heading+`<section class="panel private-panel"><h2>Private details are not available on this preview server.</h2><p>${h(ui.privateError)}</p><p class="notice">No booking information has been loaded or saved in browser storage.</p><button class="btn btn-secondary" data-action="reload-private">Try again</button></section>`;
    if(ui.privateState!=='unlocked')return heading+`<section class="panel private-panel"><span class="eyebrow">LOCAL ADMINISTRATOR · ENCRYPTED STORAGE</span><h2>${ui.privateConfigured?'Unlock private event details':'Set up private event details'}</h2><p>A separate administrator passphrase protects this local store. Choosing Jack in the demo does not unlock it.</p>${ui.actor==='jack'?`<form id="privateLoginForm"><label class="field">${ui.privateConfigured?'Administrator passphrase':'Create a passphrase (12+ characters)'}<input type="password" name="passphrase" required minlength="12" autocomplete="${ui.privateConfigured?'current-password':'new-password'}"></label>${ui.privateConfigured?'':'<label class="field section-gap">Confirm passphrase<input type="password" name="confirm" required minlength="12" autocomplete="new-password"></label>'}<p class="warning-note">${ui.privateConfigured?'Private details are never included in shared task exports.':'Keep your passphrase somewhere safe. There is no password reset or recovery. Data is encrypted on this computer—not synced to a team account.'}</p><button class="btn btn-primary" type="submit">${ui.privateConfigured?'Unlock private details':'Create encrypted private store'}</button></form>`:'<p class="notice">Switch to Jack’s administrator preview, then sign in with the separate private-details passphrase.</p>'}</section>`;
    return heading+`<div class="notice">Signed in as the local administrator · encrypted on this computer · session expires in 15 minutes. Team login and cloud sharing are not connected. Do not store payment-card or passport details here.</div><div class="booking-grid section-gap">${ui.privateRecords.map(record=>`<article class="panel booking-card"><div class="inline"><span class="chip">${h(record.type)}</span><span class="muted">Private</span></div><h2>${h(record.title)}</h2><p>${h(record.provider)}</p><p>${h(record.traveler)}${record.date?` · ${dayLabel(record.date)}`:''}</p><div class="reference-mask">•••••••• <span>Confirmation reference</span></div><button class="btn btn-secondary" data-action="booking" data-id="${h(record.id)}">View private details ${icon('arrow')}</button></article>`).join('')||`<section class="panel private-panel">${empty('Your confirmations, all together.','Add a flight, hotel, transport, or venue booking. References are masked until you choose to view them.',`<button class="btn btn-primary" data-action="new-booking">Add first booking</button>`)}</section>`}</div>`;
  }
  function bookingDialog(id) {
    if(!ui.privateSession||ui.actor!=='jack')return toast('Unlock private details as the local administrator first.');
    const record=ui.privateRecords.find(item=>item.id===id)||{};
    openDialog(record.title||'Add a private booking',`<p class="notice">Only the authenticated local administrator can retrieve these details. They do not enter task notes, activity, email review, or workspace exports.</p><form id="bookingForm" data-id="${h(record.id||'')}"><div class="form-grid"><label class="field">Booking type<select name="type">${options(['Flight','Hotel','Transport','Venue','Other'].map(x=>[x,x]),record.type||'Flight')}</select></label><label class="field">Booking date<input type="date" name="date" value="${h(record.date||'')}"></label><label class="field full-width">Title<input name="title" required maxlength="160" placeholder="Guest speaker arrival" value="${h(record.title||'')}"></label><label class="field">Airline / hotel / provider<input name="provider" maxlength="160" value="${h(record.provider||'')}"></label><label class="field">Traveler / booked for<input name="traveler" maxlength="160" value="${h(record.traveler||'')}"></label><label class="field full-width">Confirmation reference<input id="privateReference" type="password" name="reference" required maxlength="160" autocomplete="off" value="${h(record.reference||'')}"></label><div class="inline full-width"><button type="button" class="text-button" data-action="reveal-reference">Show / hide reference</button><button type="button" class="text-button" data-action="copy-reference">Copy reference</button></div><label class="field full-width">Itinerary / private logistics notes<textarea name="details" rows="4" maxlength="2000">${h(record.details||'')}</textarea></label><label class="field full-width">Related task (optional)<select name="taskId">${options([['','Not linked'],...store.getState().tasks.map(task=>[task.id,task.title])],record.taskId||'')}</select></label></div><div class="form-actions"><button type="submit" class="btn btn-primary">Save encrypted details</button></div></form>`,'',true,'private');
  }
  function responseDialog(id,preview=false) {
    const task=store.getState().tasks.find(item=>item.id===id);if(!task)return;
    openDialog(preview?'A simple participant response':'Report what is complete',`<p class="notice">${preview?'Local response preview only. This is not a shareable guest link; real guest access needs the hosted sign-in setup.':'This report records what the owner says. Tasks requiring verification stay open until Jack confirms.'}</p><h3>${h(task.title)}</h3><p>Assigned to ${h(member(task.owner).name)}</p><form id="responseForm" data-id="${h(id)}"><label class="field">Update<select name="response">${options(preview?[['accepted','I accept this task'],['blocked','I need help'],['completed','I have completed it']]:[['completed','I have completed it']],'completed')}</select></label><label class="field section-gap">What happened / what do you need?<textarea name="note" required rows="4" maxlength="3000"></textarea></label><div class="form-actions"><button class="btn btn-primary" type="submit" ${task.owner!==ui.actor?'disabled':''}>Submit as ${h(member(ui.actor).name.split(' ')[0])}</button></div>${task.owner!==ui.actor?'<p class="warning-note">Switch the demo member to this task’s owner to try their response.</p>':''}</form>`);
  }
  function contextDialog() {
    const e=store.getState().event;openDialog('Event context for useful checks',`<form id="contextForm"><div class="form-grid"><label class="field">Venue setting<select name="outdoor">${options([['true','Outdoors'],['false','Indoors']],String(e.outdoor))}</select></label><label class="field">Organized transport<select name="transportNeeded">${options([['true','Transport needed'],['false','No organized transport']],String(e.transportNeeded))}</select></label><label class="field">Expected guests<input type="number" name="guestCount" min="0" max="100000" required value="${e.guestCount}"></label><label class="field">Dietary responses outstanding<input type="number" name="dietaryOutstanding" min="0" max="100000" required value="${e.dietaryOutstanding}"></label><label class="field">Catering cutoff<input type="date" name="cateringDeadline" value="${h(e.cateringDeadline)}"></label></div><p class="notice">These are manually recorded facts, not a connected RSVP feed. Keep them up to date so reminders stay relevant.</p><div class="form-actions"><button class="btn btn-primary" type="submit">Update event context</button></div></form>`);
  }
  function memoryEditDialog(id) {
    const m=store.getState().memories.find(item=>item.id===id);if(!m)return;
    openDialog('Refine this lesson',`<form id="memoryEditForm" data-id="${h(id)}"><label class="field">What should we do differently?<textarea name="change" required rows="3">${h(m.change)}</textarea></label>${memoryFields(m)}<label class="field section-gap">Did the change help?<select name="outcome">${options([['untested','Not evaluated yet'],['helped','It helped'],['did-not-help','It did not help — stop suggesting']],m.outcome)}</select></label><label class="field section-gap">Outcome notes<textarea name="outcomeNote" rows="3">${h(m.outcomeNote)}</textarea></label><label class="field section-gap">Suggest in future planning<select name="active">${options([['true','Yes, when the context matches'],['false','Retire this lesson']],String(m.active))}</select></label><div class="form-actions"><button class="btn btn-primary" type="submit">Save lesson & outcome</button></div></form>`);
  }
  function memoryFields(m={}) {return `<label class="field section-gap">When does this apply?<select name="scope">${options([['always','All events'],['outdoor','Outdoor events only'],['transport','When organized transport is needed'],['same-venue','At this venue only']],m.scope||'always')}</select></label><label class="field section-gap">Context / exceptions<textarea name="context" rows="2" maxlength="2000" placeholder="Useful for arrivals above 100 people; reconsider for smaller events…">${h(m.context||'')}</textarea></label>`;}

  document.addEventListener('click',async event=>{
    const el=event.target.closest('[data-action], [data-view]');
    if(!el)return;
    if(el.dataset.view){if(!$('#dialogBackdrop').hidden)closeDialog();navigate(el.dataset.view);return;}
    const {action,id}=el.dataset;
    try {
      if(action==='close-dialog')closeDialog();
      if(action==='add-task')newTaskDialog();
      if(action==='task')taskDialog(id);
      if(action==='toggle-task'){const t=store.getState().tasks.find(t=>t.id===id);if(t.requiresVerification&&t.status!=='done'&&ui.actor!=='jack'){responseDialog(id);return;}store.updateTask(id,{status:t.status==='done'?'todo':'done'},ui.actor);render();toast(t.status==='done'?'Task reopened. Its history is preserved.':`Marked done by ${member(ui.actor).name}. Recorded in team updates.`);}
      if(action==='task-filter'){ui.tab=el.dataset.filter;ui.owner='';ui.status='';ui.search='';navigate('tasks');}
      if(action==='person-tasks'){ui.owner=id;ui.tab='all';ui.status='';ui.search='';navigate('tasks');}
      if(action==='claim'){store.updateTask(id,{owner:ui.actor},ui.actor);store.acceptTask(id,ui.actor);render();toast(`Accepted by ${member(ui.actor).name}.`);}
      if(action==='followup')followupDialog(id);
      if(action==='digest')digestDialog();
      if(action==='copy-digest'){const text=digestText(store.getState());if(await copyText(text))toast('Current summary copied.');else copyFallback(text);}
      if(action==='copy-draft'){const text=store.getState().drafts.find(d=>d.id===id).text;if(await copyText(text))toast('Draft copied. Nothing sent.');else copyFallback(text);}
      if(action==='source'||action==='select-message'){ui.messageId=id;if(!$('#dialogBackdrop').hidden)closeDialog();if(ui.view==='inbox')render();else navigate('inbox');}
      if(action==='select-conversation'){ui.messageId='';ui.conversationKey=id;render();}
      if(action==='task-conversation'){ui.messageId='';ui.conversationKey='task:'+id;closeDialog();navigate('inbox');}
      if(action==='refresh-inbox')await refreshInbox(true);
      if(action==='paste-email')pasteDialog();
      if(action==='sample-reply'){const confirmed=el.dataset.step==='confirmed';const m=store.addMessage({sender:'Jules Miller',subject:'Re: Northstar buses for Field Day',threadId:'thread-bus',externalId:`gather-sample-bus-${confirmed?'confirmed':'deposit'}`,body:confirmed?'Payment received. Booking confirmed. Both buses are booked for Field Day. — Jules':'The buses are reserved, but we still need the deposit. I cannot confirm the booking until Jack approves payment. — Jules'},ui.actor);ui.messageId=m.id;navigate('inbox');toast('Sample reply added. No task changed until you review.');}
      if(action==='refresh-proposal'){
        if(ui.savingProposal)return;
        const taskId=$('#emailTask')?.value;ui.savingProposal=true;
        try{if(store.refresh)await store.refresh(()=>true);store.refreshProposal(id,taskId);render();toast('Comparison refreshed. Review the current values before applying.');}
        finally{ui.savingProposal=false;}
      }
      if(action==='ignore-message'){store.ignoreMessage(id,ui.actor);ui.messageId='';render();toast('Set aside. The plan was not changed.');}
      if(action==='accept-task'){store.acceptTask(id,ui.actor);render();taskDialog(id);toast('Acceptance recorded separately from assignment.');}
      if(action==='report-task')responseDialog(id);
      if(action==='participant-preview')responseDialog(id,true);
      if(action==='verify-task'){store.verifyTask(id,ui.actor);render();taskDialog(id);toast('Completion verified by the organizer.');}
      if(action==='verification-toggle'){const task=store.getState().tasks.find(t=>t.id===id);store.updateTask(id,{requiresVerification:!task.requiresVerification},ui.actor);render();taskDialog(id);}
      if(action==='event-context')contextDialog();
      if(action==='edit-memory')memoryEditDialog(id);
      if(action==='reload-private')loadPrivate();
      if(action==='lock-private'){await lockPrivate();toast('Private details locked.');}
      if(action==='new-booking')bookingDialog();
      if(action==='booking')bookingDialog(id);
      if(action==='reveal-reference'){const input=$('#privateReference');if(input)input.type=input.type==='password'?'text':'password';}
      if(action==='copy-reference'){const input=$('#privateReference');if(input){if(await copyText(input.value))toast('Reference copied. Clear your clipboard after use.');else {input.type='text';input.select();toast('Select and copy the reference manually.');}}}
      if(action==='record-followup'){openDialog('Record your follow-up',`<p class="notice">Use this only after you have sent the message yourself. Gather does not send it.</p><form id="recordFollowupForm" data-id="${h(id)}"><label class="field">Check again on<input name="afterDate" type="date" required min="${dateKey()}"></label><div class="form-actions"><button class="btn btn-primary" type="submit">I sent it · record checkpoint</button></div></form>`);}
      if(action==='feedback')feedbackDialog();
      if(action==='thought-partner')thoughtDialog();
      if(action==='accept-insight'){const task=store.acceptSuggestion(id,ui.actor);render();if(ui.dialogKind==='thought')thoughtDialog();toast(task?`Added to plan: ${task.title}`:'This check is already covered by the plan.');}
      if(action==='dismiss-insight'){store.dismissSuggestion(id);render();if(ui.dialogKind==='thought')thoughtDialog();toast('Suggestion dismissed for this plan.');}
      if(action==='event-info')contextDialog();
      if(action==='invite'){const text=`Join our planning crew for ${store.getState().event.name}. We’re keeping tasks, decisions, and updates in Gather so everyone knows who is doing what.\n\nHere is the plan: [add your shared workspace link]`;openDialog('Bring someone into the loop.',`<p class="notice">Team invitations are a draft in this local prototype. No invite or email will be sent.</p><label class="field">Invitation message<textarea id="inviteDraft" rows="7">${h(text)}</textarea></label>`,`<button class="btn btn-primary" data-action="copy-invite">${icon('copy')} Copy invitation draft</button>`);}
      if(action==='copy-invite'){const text=$('#inviteDraft').value;if(await copyText(text))toast('Invitation draft copied. Nothing sent.');else copyFallback(text);}
      if(action==='demo-info')openDialog('Your local Gather workspace',`<p>Try the full journey: review an email, assign the work, post an update, and mark it complete.</p><p>Switch the demo member in the top bar to try a teammate’s perspective. Every update records who made it.</p><div class="notice">Tasks, comments, messages, and feedback are saved in this browser. This prototype does not connect to live email, send messages, sync between people, or call an AI service.</div>`,`<button class="btn btn-secondary" data-action="export">Export workspace backup</button>`);
      if(action==='export'){const blob=new Blob([store.exportState()],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='gather-workspace.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Workspace backup downloaded.');}
    }catch(error){toast(error.message||'Please try again.');}
  });

  document.addEventListener('submit',async event=>{
    const form=event.target;
    if(!form.id)return;
    event.preventDefault();
    const data=Object.fromEntries(new FormData(form));
    try {
      if(form.id==='newTaskForm'){store.addTask(data,ui.actor);closeDialog();render();toast('Task added with a clear next step.');}
      if(form.id==='taskDetailForm'){store.updateTask(form.dataset.id,data,ui.actor);closeDialog();render();toast(`Update recorded by ${member(ui.actor).name}.`);}
      if(form.id==='commentForm'){store.addComment(form.dataset.id,data.text,ui.actor);render();taskDialog(form.dataset.id);toast('Comment saved with the task.');}
      if(form.id==='emailReviewForm'){
        if(ui.savingProposal)return;
        ui.savingProposal=true;const button=$('button[type="submit"]',form);button.disabled=true;button.textContent='Saving…';
        try{const task=store.applyMessage(form.dataset.id,data,ui.actor);render();toast(`Applied to “${task.title}”. Original email preserved.`);}
        finally{ui.savingProposal=false;if(form.isConnected)updateChangePreview();}
      }
      if(form.id==='pasteForm'){const m=store.addMessage(data,ui.actor);ui.messageId=m.id;closeDialog();navigate('inbox');toast('Message saved. Review its next step before applying.');}
      if(form.id==='feedbackForm'){store.addMemory({...data,rating:Number(data.rating)},ui.actor);closeDialog();render();thoughtDialog();toast('Learning saved. Your planning suggestions have changed.');}
      if(form.id==='followupForm'){const text=data.text.trim();store.saveDraft(form.dataset.id,text,ui.actor);const copied=await copyText(text);closeDialog();render();if(copied)toast('Draft saved and copied. Nothing sent.');else {toast('Draft saved in Team updates.');copyFallback(text,'Your saved follow-up draft');}}
      if(form.id==='responseForm'){const id=form.dataset.id;if(data.response==='accepted'){store.acceptTask(id,ui.actor);store.addComment(id,data.note,ui.actor);}else if(data.response==='blocked')store.updateTask(id,{status:'blocked',note:data.note},ui.actor);else store.reportCompletion(id,data.note,ui.actor);closeDialog();render();taskDialog(id);toast('Response recorded with the commitment.');}
      if(form.id==='contextForm'){store.updateEvent(data,ui.actor);closeDialog();render();thoughtDialog();toast('Planning checks now use the updated event context.');}
      if(form.id==='memoryEditForm'){store.updateMemory(form.dataset.id,data,ui.actor);closeDialog();render();toast('Lesson updated. Future suggestions respect its context and outcome.');}
      if(form.id==='recordFollowupForm'){store.recordFollowup(form.dataset.id,data.afterDate,ui.actor);closeDialog();render();toast('Your manually sent follow-up and next checkpoint were recorded.');}
      if(form.id==='privateLoginForm'){
        if(!ui.privateConfigured&&data.passphrase!==data.confirm)throw new Error('The passphrases do not match.');
        const button=$('button[type="submit"]',form);button.disabled=true;button.textContent='Unlocking…';
        const ticket=privateEpoch;
        try{const session=await privateApi(ui.privateConfigured?'unlock':'setup',{passphrase:data.passphrase});form.reset();if(ticket!==privateEpoch||ui.actor!=='jack'||document.hidden||ui.view!=='details'){await privateApi('lock',{},session).catch(()=>{});clearPrivate();return;}ui.privateSession=session;await loadPrivate();toast('Private details unlocked for the local administrator.');}finally{if(button.isConnected){button.disabled=false;button.textContent='Unlock private details';}}
      }
      if(form.id==='bookingForm'){
        const button=$('button[type="submit"]',form);button.disabled=true;
        try{await privateApi('records',{...data,id:form.dataset.id});form.reset();closeDialog();await loadPrivate();toast('Encrypted booking saved. Shared tasks and exports are unchanged.');}finally{if(button.isConnected)button.disabled=false;}
      }
    }catch(error){toast(error.message||'Please check the form and try again.');}
  });

  document.addEventListener('change',event=>{
    const el=event.target;
    if(el.closest('#emailReviewForm')){ui.reviewDirty=true;updateChangePreview();}
    if(el.id==='actorSelect'){lockPrivate();ui.actor=el.value;render();toast(`Now trying ${member(ui.actor).name.split(' ')[0]}’s perspective. Private details locked.`);}
    if(el.id==='ownerFilter'){ui.owner=el.value;render();}
    if(el.id==='statusFilter'){ui.status=el.value;render();}
    if(el.id==='emailMode'){
      const update=el.value==='update';
      $('#existingTaskField').hidden=!update;
      $('#emailTask').required=update;
      if(update)$('#emailTask').value='';
      updateChangePreview();
    }
    if(el.id==='emailTask'){
      const form=$('#emailReviewForm');if(el.value&&form){try{store.refreshProposal(form.dataset.id,el.value);render();}catch(error){toast(error.message);}}
    }
  });
  document.addEventListener('input',event=>{
    if(event.target.closest('#emailReviewForm')){ui.reviewDirty=true;updateChangePreview();}
    if(event.target.id==='taskSearch'){
      ui.search=event.target.value;
      const tasks=filteredTasks(store.getState());
      $('#taskRows').innerHTML=tasks.map(taskRow).join('');
      $('#taskEmpty').hidden=!!tasks.length;
      $('#taskResultCount').textContent=`${tasks.length} ${tasks.length===1?'task':'tasks'}`;
    }
  });
  $('#dialogBackdrop').addEventListener('click',event=>{if(event.target===$('#dialogBackdrop'))closeDialog();});
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){if(!$('#dialogBackdrop').hidden)closeDialog();else setDrawer(false);}
    if(event.key==='Tab'&&!$('#dialogBackdrop').hidden){
      const controls=$$('button:not([disabled]),input,select,textarea,[tabindex="0"]',$('#dialog')).filter(el=>el.getClientRects().length);
      const first=controls[0],last=controls.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
  });
  $('#mobileMenu').addEventListener('click',()=>setDrawer(!$('#sidebar').classList.contains('open')));
  $('#mobileOverlay').addEventListener('click',()=>setDrawer(false));
  matchMedia('(max-width:800px)').addEventListener('change',()=>setDrawer(false));
  window.addEventListener('hashchange',()=>navigate(location.hash.slice(1)));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)lockPrivate();});
  setDrawer(false);
  navigate(location.hash.slice(1)||'overview');
})();
