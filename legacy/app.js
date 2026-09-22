/* Gather's local demo UI. All task data lives in the versioned workspace store. */
(() => {
  'use strict';
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const h = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const store = GatherStore.createStore();
  const ui = { view:'overview', actor:'jack', tab:'all', owner:'', status:'', search:'', messageId:'', lastFocus:null, dialogKind:'', detailId:'', privateRecords:[],privateSession:null,privateState:'loading',privateConfigured:false };
  const labels = { overview:'Overview',tasks:'Shared tasks',inbox:'Email briefing',updates:'Team updates',team:'People',timeline:'Timeline',memory:'Event feedback',details:'Private details' };
  const statuses = { todo:'To do', progress:'In progress', blocked:'Blocked', done:'Done' };
  const isOrganizer = () => window.GatherIdentity ? window.GatherIdentity.role === 'admin' : ui.actor === 'jack';
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
  const focusable = root => $$('a[href],button,input,select,textarea,summary,[tabindex]',root).filter(el=>el.tabIndex>=0&&!el.matches(':disabled')&&el.getClientRects().length&&!el.closest('[hidden],[inert]'));
  function restoreFocus(previous,root=document) {
    if(!previous)return false;
    const target=previous.isConnected?previous:previous.id?document.getElementById(previous.id):focusable(root).find(el=>
      el.tagName===previous.tagName&&['action','id','view','filter'].every(key=>el.dataset[key]===previous.dataset[key])&&
      (previous.dataset.id||el.textContent===previous.textContent));
    if(!target||!root.contains(target)||target.closest('[hidden],[inert]'))return false;
    target.focus({preventScroll:true});return true;
  }
  function saveLock(root,submitter) {
    const previousFocus=document.activeElement;
    ui.pendingSave=true;
    root.dataset.saving='true';root.setAttribute('aria-busy','true');
    const controls=$$('button,input,select,textarea',root).map(el=>[el,el.disabled]);
    if(root.matches('button'))controls.push([root,root.disabled]);
    controls.forEach(([el])=>el.disabled=true);
    const label=submitter?.innerHTML;
    if(submitter)submitter.textContent='Saving…';
    return ()=>{
      ui.pendingSave=false;delete root.dataset.saving;root.removeAttribute('aria-busy');
      controls.forEach(([el,disabled])=>{if(el.isConnected)el.disabled=disabled;});
      if(submitter?.isConnected)submitter.innerHTML=label;
      if(previousFocus?.isConnected&&root.isConnected&&document.activeElement===document.body)restoreFocus(previousFocus,root);
    };
  }
  function formError(form,error) {
    if(!form?.isConnected)return;
    let message=$('.form-error',form);
    if(!message){message=document.createElement('p');message.className='form-error';message.setAttribute('role','alert');form.prepend(message);}
    message.textContent=error.message||'Please check the form and try again.';
  }
  function hasUnsavedFields(root,exclude=[]) {
    return !!root&&$$('input,textarea,select',root).some(input=>{
      if(input.readOnly||input.type==='hidden'||exclude.includes(input.name))return false;
      if(input.type==='checkbox'||input.type==='radio')return input.checked!==input.defaultChecked;
      const original=input.tagName==='SELECT'?([...input.options].find(option=>option.defaultSelected)||input.options[0])?.value:input.defaultValue;
      return input.value!==(original??'');
    });
  }
  function confirmDiscard(...roots) {
    return !roots.some(root=>hasUnsavedFields(root))||window.confirm('Discard your unsaved changes?');
  }
  const unsavedDialog=()=>!$('#dialogBackdrop').hidden&&hasUnsavedFields($('#dialog'));
  const unsavedReview=()=>hasUnsavedFields($('#emailReviewForm'));
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
    if(dependencyInfo(task).ready) return {key:'ready',label:'Ready to resume',action:'Review the results from linked tasks',rank:-1};
    if(task.status==='blocked') return {key:'blocked',label:'Blocked',action:'Needs a decision',rank:0};
    if(!task.owner) return {key:'unassigned',label:'No owner',action:'Assign an owner',rank:1};
    if(task.dueDate && task.dueDate<dateKey()) return {key:'overdue',label:'Overdue',action:'Past its due date',rank:2};
    if((task.handoffs||[]).some(item=>item.status==='pending'))return {key:'handoff',label:'Suggested follow-up',action:'Review linked work',rank:3};
    if(task.followupAfter && task.followupAfter<=dateKey()) return {key:'followup',label:'Follow-up due',action:'Check in with the owner',rank:3};
    if(task.followupAfter && task.followupAfter>dateKey()) return null;
    if(!task.acceptedAt) return {key:'acceptance',label:'Acceptance pending',action:'Ask the owner to accept',rank:3};
    if(!task.updatedAt || Date.now()-new Date(task.updatedAt).getTime()>=3*86400000) return {key:'stale',label:'No recent update',action:'Request an update',rank:3};
    return null;
  };
  const attention = s => s.tasks.filter(t=>reason(t)).sort((a,b)=>reason(a).rank-reason(b).rank || (a.dueDate||'9999').localeCompare(b.dueDate||'9999'));
  const pending = s => s.messages.filter(m=>!m.appliedTaskId&&!m.ignoredAt);
  const completed = s => s.tasks.filter(t=>t.status==='done').sort((a,b)=>new Date(b.completedAt)-new Date(a.completedAt));
  const completionText = task => task.completionReportedBy ? `${task.completionReportedBy} reported complete · recorded by ${member(task.completedBy).name}` : `Marked done by ${member(task.completedBy).name}`;
  const commitment = task => task.verifiedAt ? `Verified by ${member(task.verifiedBy).name}` : task.reportedAt ? `Reported complete by ${task.reportedBy}${task.requiresVerification?' · needs verification':''}` : task.acceptedAt ? `${task.acceptedSourceId?'Acceptance reported by':'Accepted by'} ${member(task.acceptedBy).name.split(' ')[0]}` : task.status==='done' ? 'Completed record' : task.owner ? 'Waiting for owner acceptance' : 'No owner yet';
  const latestUpdate = task => {const last=task.comments.at(-1);return last&&last.at===task.updatedAt?last.text:task.note;};
  const toast = message => {const el=$('#toast');el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),3200);};
  const pageHeading = (eyebrow,title,subtitle,actions='') => `<div class="page-heading"><div>${eyebrow?`<div class="eyebrow">${eyebrow}</div>`:''}<h1>${title}</h1>${subtitle?`<p>${subtitle}</p>`:''}</div><div class="header-actions">${actions}</div></div>`;
  const addButton = isOrganizer()?`<button class="btn btn-primary" data-action="add-task">${icon('plus')} Add task</button>`:'';
  const sourceButton = task => {const group=GatherInbox.conversations(store.getState()).find(g=>g.taskId===task.id);return group?`<button class="text-button" data-action="task-conversation" data-id="${h(task.id)}">${icon('mail')} Email briefing (${group.messages.length})</button>`:'';};

  function taskRow(task) {
    const done = task.status==='done';
    return `<tr><td><button class="check-button ${done?'checked':''}" data-action="toggle-task" data-id="${h(task.id)}" aria-label="${isOrganizer()?(done?'Reopen':task.requiresVerification?'Review':'Complete'):'View'} ${h(task.title)}">${done?icon('done'):''}</button></td>
      <td><button class="task-name-button" data-action="task" data-id="${h(task.id)}">${h(task.title)}</button><div class="category-label">${h(task.category)}${task.sourceMessageId?' · From email':''}</div>${done?`<div class="completion-note">${h(completionText(task))} · ${h(timeLabel(task.completedAt))}</div>`:''}</td>
      <td>${!task.owner&&!done?`<button class="btn btn-secondary btn-small" data-action="claim" data-id="${h(task.id)}">Claim task</button>`:`<button class="btn-ghost table-owner" data-action="task" data-id="${h(task.id)}">${person(task.owner)}</button>`}<div class="commitment-note">${h(commitment(task))}</div></td>
      <td>${statusBadge(task.status)}${dependencyInfo(task).ready?'<div class="dependency-ready-label">Ready to resume</div>':''}</td><td>${due(task)}</td>
      <td><div class="task-meta">${h(member(task.updatedBy).name.split(' ')[0])} · ${relative(task.updatedAt)}</div><div class="task-note-preview" title="${h(latestUpdate(task))}">${h(latestUpdate(task) || 'No progress note yet')}</div></td>
      <td><button class="icon-button" data-action="task" data-id="${h(task.id)}" aria-label="Open ${h(task.title)}">${icon('arrow')}</button></td></tr>`;
  }
  const empty = (title,copy,action='') => `<div class="empty-state">${icon('done')}<strong>${title}</strong>${copy?`<p>${copy}</p>`:''}${action}</div>`;
  function activityItem(item,compact=false) {
    return `<article class="${compact?'feed-item':'activity-item'}">${avatar(item.actor,true)}<div class="${compact?'feed-copy':'activity-content'}"><p><strong>${h(member(item.actor).name)}</strong> ${h(item.text)}</p>${item.taskId?`<button class="text-button" data-action="task" data-id="${h(item.taskId)}">Open task ${icon('arrow')}</button>`:''}<time class="${compact?'feed-time':'activity-date'}" datetime="${h(item.at)}">${timeLabel(item.at)}</time></div></article>`;
  }
  function insightMarkup(item) {
    return `<article class="insight"><span class="insight-source">${h(item.source)}</span><h3>${h(item.title)}</h3><p>${h(item.body)}</p><div class="insight-actions"><button class="btn btn-small" data-action="accept-insight" data-id="${h(item.id)}">${icon('plus')} Add to plan</button><button class="icon-button" data-action="dismiss-insight" data-id="${h(item.id)}" aria-label="Dismiss ${h(item.title)}">${icon('close')}</button></div></article>`;
  }

  function overview(s) {
    const needs=attention(s), done=completed(s), emails=pending(s);
    const progress=Math.round(done.length/Math.max(s.tasks.length,1)*100);
    const days=Math.max(0,Math.ceil((new Date(s.event.date+'T00:00:00')-new Date(dateKey()+'T00:00:00'))/86400000));
    const suggestions=store.getSuggestions();
    return pageHeading('', 'Overview', `${dayLabel(s.event.date)} · ${days} days until event`,`<button class="btn btn-secondary" data-action="digest">Summary</button>${addButton}`)+`
      <section class="stat-grid" aria-label="Project status">
        <button class="stat-card" data-action="task-filter" data-filter="attention"><span class="stat-label">Needs attention</span><strong class="stat-number">${needs.length}<span class="metric-icon">${icon('alert')}</span></strong></button>
        <button class="stat-card" data-action="task-filter" data-filter="done"><span class="stat-label">Completed</span><strong class="stat-number">${done.length}<span class="muted"> / ${s.tasks.length}</span></strong><span class="progress-track"><span class="progress-fill" style="width:${progress}%"></span></span></button>
        <button class="stat-card" data-view="inbox"><span class="stat-label">Email to review</span><strong class="stat-number">${emails.length}<span class="metric-icon">${icon('mail')}</span></strong></button>
        <button class="stat-card" data-view="team"><span class="stat-label">People</span><strong class="stat-number">${s.members.length}<span class="metric-icon">${icon('people')}</span></strong></button>
      </section>
      <div class="workspace-grid"><div class="stack">
        <section class="panel"><div class="panel-heading"><div><h2 class="section-title">Needs attention</h2></div><button class="text-button" data-action="task-filter" data-filter="attention">View all ${icon('arrow')}</button></div>
          <div class="attention-list">${needs.slice(0,4).map(t=>{const r=reason(t);return `<article class="attention-item"><div class="attention-reason reason-${r.key}">${r.label}</div><div class="task-summary"><button class="task-title" data-action="task" data-id="${h(t.id)}">${h(t.title)}</button><p>${h(t.note||r.action)}</p><div class="task-meta">${person(t.owner)}<span>·</span>${due(t)}<span>· Updated ${relative(t.updatedAt)}</span></div></div><div class="attention-actions"><button class="btn btn-small btn-secondary" data-action="${!t.owner?'claim':isOrganizer()?'followup':'task'}" data-id="${h(t.id)}">${!t.owner?'Claim task':isOrganizer()?'Draft follow-up':'Open task'}</button></div></article>`;}).join('') || empty('No tasks need attention.','')}</div>
        </section>
        <section class="panel"><div class="panel-heading"><div><h2 class="section-title">Recently completed</h2></div><button class="text-button" data-action="task-filter" data-filter="done">All completed ${icon('arrow')}</button></div><div class="mini-feed">${done.slice(0,3).map(t=>`<article class="feed-item">${avatar(t.completedBy)}<div class="feed-copy"><button class="task-title" data-action="task" data-id="${h(t.id)}">${h(t.title)}</button><p>${h(completionText(t))}</p><time class="feed-time">${timeLabel(t.completedAt)}</time></div><span class="status-badge status-done">${icon('done')} Done</span></article>`).join('') || empty('No completed tasks.','')}</div></section>
      </div><aside class="stack">
        <section class="ai-panel" id="thoughtPartner"><h2>Suggestions</h2>${suggestions.slice(0,2).map(insightMarkup).join('') || '<p>No suggestions.</p>'}<button class="text-button" data-action="thought-partner">All suggestions (${suggestions.length}) ${icon('arrow')}</button></section>
        <section class="panel email-preview"><div class="panel-heading"><div><h2 class="section-title">Email briefing</h2></div></div>${GatherInbox.conversations(s).filter(g=>g.pending.length).slice(0,2).map(g=>{const b=GatherInbox.briefing(g,s),m=b.message;return `<button class="email-item" data-action="source" data-id="${h(m.id)}"><span class="email-icon">${icon('mail')}</span><span class="email-copy"><strong>${h(g.title)}</strong><span class="briefing-summary-preview">${h(m.sender)}: ${h(b.summary)}</span></span>${icon('arrow')}</button>`;}).join('') || '<p class="notice">No emails to review.</p>'}<button class="text-button" data-view="inbox">Open email briefing ${icon('arrow')}</button></section>
      </aside></div>
      <section class="panel section-gap"><div class="panel-heading"><div><h2 class="section-title">Recent activity</h2></div><button class="text-button" data-view="updates">All updates ${icon('arrow')}</button></div><div class="mini-feed">${s.activity.slice(0,3).map(a=>activityItem(a,true)).join('')}</div></section>`;
  }

  function filteredTasks(s) {
    return s.tasks.filter(t=>(ui.tab!=='mine'||t.owner===ui.actor)&&(ui.tab!=='available'||(!t.owner&&t.status!=='done'))&&(ui.tab!=='attention'||reason(t))&&(ui.tab!=='done'||t.status==='done')&&(!ui.owner||t.owner===ui.owner||(ui.owner==='unassigned'&&!t.owner))&&(!ui.status||t.status===ui.status)&&(!ui.search||`${t.title} ${t.note} ${member(t.owner).name} ${t.category}`.toLowerCase().includes(ui.search.toLowerCase())));
  }
  const options = (entries,value) => entries.map(([id,label])=>`<option value="${h(id)}" ${id===value?'selected':''}>${h(label)}</option>`).join('');
  const ownerOptions = (value,all=false) => options([...(all?[['','All owners'],['unassigned','Unassigned']]:[['','Unassigned']]),...store.getState().members.map(p=>[p.id,p.name])],value);
  const statusOptions = value => options(Object.entries(statuses),value);
  function tasksView(s) {
    const tasks=filteredTasks(s);
    return pageHeading('','Tasks','',addButton)+`
      ${s.tasks.filter(t=>t.owner===ui.actor&&dependencyInfo(t,s).ready).map(t=>`<div class="dependency-prompt" role="status"><span><strong>Ready to resume:</strong> ${h(t.title)}</span><button class="btn btn-secondary btn-small" data-action="task" data-id="${h(t.id)}">Review results</button></div>`).join('')}
      <section class="panel"><div class="toolbar"><div class="filter-tabs" role="group" aria-label="Task views">${[['all','All tasks'],['mine','My tasks'],['available','Unassigned · '+s.tasks.filter(t=>!t.owner&&t.status!=='done').length],['attention','Needs attention'],['done','Completed']].map(([id,label])=>`<button class="filter-tab ${ui.tab===id?'active':''}" data-action="task-filter" data-filter="${id}" aria-pressed="${ui.tab===id}">${label}</button>`).join('')}</div><label class="search-input">${icon('search')}<input id="taskSearch" type="search" value="${h(ui.search)}" placeholder="Find a task or person…" aria-label="Search tasks"></label></div>
      <div class="toolbar"><div class="inline"><select id="ownerFilter" class="select-input" aria-label="Filter by owner">${ownerOptions(ui.owner,true)}</select><select id="statusFilter" class="select-input" aria-label="Filter by status">${options([['','All statuses'],...Object.entries(statuses)],ui.status)}</select></div><span class="muted" id="taskResultCount">${tasks.length} ${tasks.length===1?'task':'tasks'}</span></div>
      <div class="task-table-wrap"><table class="task-table"><thead><tr><th><span class="sr-only">Completion</span></th><th scope="col">TASK</th><th scope="col">OWNER</th><th scope="col">STATUS</th><th scope="col">DUE</th><th scope="col">LATEST UPDATE</th><th><span class="sr-only">Details</span></th></tr></thead><tbody id="taskRows">${tasks.map(taskRow).join('')}</tbody></table><div id="taskEmpty" ${tasks.length?'hidden':''}>${empty('No tasks match this view.','Try another filter or search.')}</div></div></section>`;
  }
  function inboxView(s) {
    const messages=s.messages.filter(m=>!m.ignoredAt);
    const selected=messages.find(m=>m.id===ui.messageId) || messages.find(m=>!m.appliedTaskId) || messages[0];
    ui.messageId=selected?.id || '';
    return pageHeading('','Email briefing','',`<button class="btn btn-primary" data-action="paste-email">${icon('plus')} Paste an email</button>`)+`
      <div class="notice">Local email review · no mailbox is connected. Do not paste private confirmation emails here. Put booking references in <button class="text-button" data-view="details">Private details</button>.</div>
      <div class="intake-demo"><span>Try a changing conversation:</span><button class="btn btn-secondary btn-small" data-action="sample-reply" data-step="pending">1. Buses awaiting deposit</button><button class="btn btn-secondary btn-small" data-action="sample-reply" data-step="confirmed">2. Booking confirmed</button><span class="muted">Sample replies · review each before applying</span></div>
      <div class="intake-layout section-gap"><section class="panel message-list" aria-label="Emails to review">${messages.map(m=>`<button class="message-button ${m.id===selected?.id?'selected':''}" data-action="select-message" data-id="${h(m.id)}"><span class="message-sender">${h(m.sender)}</span><strong class="message-subject">${h(m.subject)}</strong><span class="message-preview">${h(m.body.slice(0,95))}</span><span class="message-status ${m.appliedTaskId?'is-applied':''}">${m.appliedTaskId?'✓ Added to the plan':'Needs review'}</span></button>`).join('')}</section>
      ${selected?emailReader(selected,s):`<section class="panel">${empty('No emails.','')}</section>`}</div>`;
  }
  function emailReader(m,s) {
    const p=m.suggested || {};
    const current=s.tasks.find(t=>t.id===p.taskId);
    const stale=current&&p.baseRevision!==current.revision;
    const older=current&&s.messages.some(item=>item.appliedTaskId===current.id&&item.receivedAt>m.receivedAt);
    const conversation=s.messages.filter(item=>item.threadId===m.threadId&&item.id!==m.id);
    return `<section class="panel email-reader"><div class="email-reader-header"><span class="source-label">ORIGINAL MESSAGE</span><h2>${h(m.subject)}</h2><div class="message-meta"><strong>${h(m.sender)}</strong><span>${timeLabel(m.receivedAt)}</span></div></div><div class="email-body">${h(m.body)}</div>${m.appliedTaskId?`<div class="review-card"><span class="status-badge status-done">${icon('done')} Applied to plan</span><p>The original message is attached to the task. Its sender is kept separate from the person who applied the update.</p><button class="btn btn-primary" data-action="task" data-id="${h(m.appliedTaskId)}">Open linked task ${icon('arrow')}</button></div>`:`<form class="review-card" id="emailReviewForm" data-id="${h(m.id)}"><div class="panel-heading"><div><span class="eyebrow">REVIEW BEFORE APPLYING</span><h3>Proposed changes</h3><p class="section-subtitle">These are draft fields. You decide the task, owner, and status.</p></div></div><div class="form-grid">
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
    return pageHeading('','People','',`<button class="btn btn-secondary" data-action="invite">${icon('plus')} Invitation draft</button>`)+`<div class="team-grid">${s.members.map(p=>{const tasks=s.tasks.filter(t=>t.owner===p.id),done=tasks.filter(t=>t.status==='done').length,blocked=tasks.filter(t=>t.status==='blocked').length;return `<article class="team-card"><div class="team-card-head">${avatar(p.id)}<div><h2>${h(p.name)}</h2><p>${h(p.role)}</p></div>${p.id===ui.actor?'<span class="chip">You</span>':''}</div><div class="team-stats"><div><strong>${tasks.filter(t=>t.status!=='done').length}</strong><span>Open</span></div><div><strong>${done}</strong><span>Done</span></div><div><strong>${blocked}</strong><span>Blocked</span></div></div><div class="workload-track"><div class="workload-fill" style="width:${Math.round(done/Math.max(tasks.length,1)*100)}%"></div></div><button class="btn btn-secondary" data-action="person-tasks" data-id="${h(p.id)}">View ${h(p.name.split(' ')[0])}’s tasks ${icon('arrow')}</button></article>`;}).join('')}</div><section class="panel section-gap"><div class="panel-heading"><div><h2 class="section-title">Unassigned tasks</h2></div></div><div class="mini-feed">${s.tasks.filter(t=>!t.owner&&t.status!=='done').map(t=>`<article class="feed-item">${avatar('')}<div class="feed-copy"><button class="task-title" data-action="task" data-id="${h(t.id)}">${h(t.title)}</button><p>${h(t.note)}</p></div><button class="btn btn-secondary btn-small" data-action="claim" data-id="${h(t.id)}">Claim task</button></article>`).join('')||empty('No unassigned tasks.','')}</div></section>`;
  }
  function timelineView(s) {
    const keys=[...new Set(s.tasks.filter(t=>t.status!=='done').map(t=>t.dueDate||''))].sort((a,b)=>(a||'9999').localeCompare(b||'9999'));
    return pageHeading('','Timeline','',addButton)+`<section class="panel"><div class="timeline-list">${keys.map(key=>`<div class="timeline-day"><div class="timeline-date"><strong>${key?dayLabel(key):'Unscheduled'}</strong><span>${key===dateKey()?'Today':key&&key<dateKey()?'Past due':''}</span></div><div class="timeline-tasks">${s.tasks.filter(t=>t.status!=='done'&&(t.dueDate||'')===key).map(t=>`<button class="timeline-task" data-action="task" data-id="${h(t.id)}"><strong>${h(t.title)}</strong><span class="inline">${person(t.owner)}${statusBadge(t.status)}</span></button>`).join('')}</div></div>`).join('')||empty('No open tasks.','')}<div class="timeline-day event-day"><div class="timeline-date"><strong>${dayLabel(s.event.date)}</strong></div><div class="timeline-tasks"><div class="timeline-task"><span class="eyebrow">EVENT DAY</span><strong>${h(s.event.name)}</strong><p>${h(s.event.location)} · 10:00 AM–4:00 PM</p></div></div></div></div></section>`;
  }
  function updatesView(s) {
    return pageHeading('','Activity','',`<button class="btn btn-secondary" data-action="digest">${icon('copy')} Summary</button>`)+`<div class="workspace-grid"><section class="panel"><div class="panel-heading"><h2 class="section-title">Team activity</h2><span class="chip">${s.activity.length} updates</span></div><div class="activity-list">${s.activity.map(a=>activityItem(a)).join('')||empty('No activity yet.','')}</div></section><aside class="panel"><div class="panel-heading"><div><h2 class="section-title">Follow-up drafts</h2></div></div>${s.drafts.length?s.drafts.map(d=>`<article class="source-card"><span class="source-label">DRAFT · ${timeLabel(d.at)}</span><p>${h(d.text)}</p><div class="inline"><button class="text-button" data-action="copy-draft" data-id="${h(d.id)}">${icon('copy')} Copy draft</button><button class="text-button" data-action="task" data-id="${h(d.taskId)}">Open task</button></div></article>`).join(''):empty('No drafts.','Create a draft from a task. Messages are not sent automatically.')}</aside></div>`;
  }
  function memoryView(s) {
    return pageHeading('','Event feedback','',`<button class="btn btn-primary" data-action="feedback">${icon('plus')} Add event feedback</button>`)+`<div class="notice">Record whether each change helped. Retired or unsuccessful feedback is not suggested again.</div><div class="memory-grid section-gap">${s.memories.map(m=>`<article class="memory-card"><span class="memory-category">${h(m.category||'Team learning')}</span><h2>${h(m.change)}</h2>${m.wentWell?`<p><strong>Keep doing:</strong> ${h(m.wentWell)}</p>`:''}<p><strong>Applies:</strong> ${h(({always:'All events',outdoor:'Outdoor events only',transport:'When transport is needed','same-venue':'At the original venue'})[m.scope])}</p>${m.context?`<p>${h(m.context)}</p>`:''}<p class="chip">${!m.active?'Retired':m.outcome==='helped'?'Previously helped':m.outcome==='did-not-help'?'Did not help · not suggested':'Outcome not evaluated'}</p>${m.outcomeNote?`<p>${h(m.outcomeNote)}</p>`:''}<div class="task-meta">${m.rating?`${m.rating}/5 event rating · `:''}${timeLabel(m.at)}</div><button class="text-button" data-action="edit-memory" data-id="${h(m.id)}">Edit context & outcome ${icon('arrow')}</button></article>`).join('')||empty('No feedback yet.','')}</div>`;
  }

  function render() {
    const pendingReview=ui.reviewDirty&&ui.view==='inbox'?$('#emailReviewForm'):null;
    const reviewDraft=pendingReview?{id:pendingReview.dataset.id,expanded:$('.proposal-edit',pendingReview)?.open,fields:$$('input[name],textarea[name],select[name]',pendingReview).map(input=>({name:input.name,value:input.value,checked:input.checked}))}:null;
    ui.reviewDirty=false;
    const previousFocus=$('#viewRoot').contains(document.activeElement)?document.activeElement:null;
    const s=store.getState();
    $('.event-switcher strong').textContent=s.event.name;
    $('.breadcrumb > span').textContent=s.event.name;
    $('#taskNavCount').textContent=s.tasks.filter(t=>t.status!=='done').length;
    $('#inboxNavCount').textContent=pending(s).length;
    $('#aiNavCount').textContent=store.getSuggestions().length;
    $('#storageWarning').hidden=s.persistence!=='unavailable';
    $('#breadcrumbCurrent').textContent=labels[ui.view];
    $$('.nav-item[data-view]').forEach(button=>{button.classList.toggle('active',button.dataset.view===ui.view);button.setAttribute('aria-current',button.dataset.view===ui.view?'page':'false');});
    $('#profile').innerHTML=`${avatar(ui.actor)}<div class="profile-copy"><strong>${h(member(ui.actor).name)}</strong><span>${h(member(ui.actor).role)}</span></div>`;
    $('#actorSelect').innerHTML=options(s.members.map(p=>[p.id,`${p.name.split(' ')[0]} · demo`]),ui.actor);
    $('#viewRoot').innerHTML=({overview,tasks:tasksView,inbox:inboxView,team:teamView,timeline:timelineView,updates:updatesView,memory:memoryView,details:privateView})[ui.view](s);
    const currentReview=$('#emailReviewForm');
    if(reviewDraft&&currentReview?.dataset.id===reviewDraft.id){
      for(const field of reviewDraft.fields){const input=currentReview.elements.namedItem(field.name);if(input){input.value=field.value;if(input.type==='checkbox')input.checked=field.checked;}}
      const details=$('.proposal-edit',currentReview);if(details)details.open=reviewDraft.expanded;
      ui.reviewDirty=true;updateChangePreview();
    }
    const emailTask=$('#emailTask');if(emailTask)emailTask.dataset.previousValue=emailTask.value;
    fillIcons(document);
    if(previousFocus&&!previousFocus.isConnected)restoreFocus(previousFocus,$('#viewRoot'));
  }
  function navigate(view) {
    if(ui.pendingSave){history.replaceState(null,'',`#${ui.view}`);return;}
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
    const wasOpen=$('#sidebar').classList.contains('open');
    const focusInDrawer=$('#sidebar').contains(document.activeElement)||document.activeElement===$('#mobileOverlay');
    $('#sidebar').classList.toggle('open',open);
    $('#mobileOverlay').classList.toggle('open',open&&mobile);
    $('#mobileMenu').setAttribute('aria-expanded',String(open));
    $('#sidebar').inert=mobile&&!open;
    $('#mainContent').inert=mobile&&open;
    $('#sidebar').toggleAttribute('aria-modal',mobile&&open);
    if(mobile&&open){$('#sidebar').setAttribute('role','dialog');$('#sidebar').setAttribute('aria-modal','true');document.body.style.overflow='hidden';focusable($('#sidebar'))[0]?.focus();}
    else{$('#sidebar').removeAttribute('role');if($('#dialogBackdrop').hidden)document.body.style.overflow='';if(mobile&&wasOpen&&focusInDrawer)$('#mobileMenu').focus();}
  }
  function openDialog(title,body,footer='',wide=false,kind='') {
    if($('#sidebar').classList.contains('open'))setDrawer(false);
    if($('#dialogBackdrop').hidden)ui.lastFocus=document.activeElement;
    ui.dialogKind=kind;
    $('#dialog').className=`dialog ${wide?'dialog-wide':''}`;
    $('#dialog').innerHTML=`<div class="dialog-header"><h2 id="dialogTitle">${h(title)}</h2><button class="icon-button dialog-close" data-action="close-dialog" aria-label="Close dialog">${icon('close')}</button></div><div class="dialog-body">${body}</div>${footer?`<div class="dialog-footer">${footer}</div>`:''}`;
    $('#dialogBackdrop').hidden=false;
    $('#dialogBackdrop').classList.add('open');
    $('#appShell').inert=true;
    document.body.style.overflow='hidden';
    requestAnimationFrame(()=>{const controls=focusable($('#dialog'));(controls.find(el=>el.matches('input,select,textarea'))||controls[0]||$('#dialog')).focus();});
  }
  function closeDialog() {
    $('#dialogBackdrop').hidden=true;
    $('#dialogBackdrop').classList.remove('open');
    $('#appShell').inert=false;
    document.body.style.overflow='';
    $('#dialog').replaceChildren();
    ui.dialogKind='';
    if(!restoreFocus(ui.lastFocus))$('#viewRoot').querySelector('button')?.focus();
    ui.lastFocus=null;
  }
  function showPendingUpdate() {
    const banner=$('#workspaceSyncNotice');if(banner)banner.hidden=false;
    if($('#dialogBackdrop').hidden||$('#dialogStaleNotice'))return;
    const note=document.createElement('div');note.id='dialogStaleNotice';note.className='notice';note.setAttribute('role','alert');
    note.innerHTML='<p>The project changed in another tab. Your unsaved text is still here. Copy it before reloading.</p><button class="btn btn-secondary" data-action="reload-workspace">Reload &amp; discard edits</button>';
    $('.dialog-body').prepend(note);
  }
  function dependencyInfo(task, state=store.getState()) {
    const links=(task.dependencies||[]).map(link=>({...link,task:state.tasks.find(t=>t.id===link.taskId)}));
    const resolved=t=>Boolean(t&&t.status==='done'&&(!t.requiresVerification||t.verifiedAt));
    const required=links.filter(link=>link.kind!=='related');
    return {links,ready:task.status==='blocked'&&required.length>0&&required.every(link=>resolved(link.task)),resolved};
  }
  function dependencyMarkup(task) {
    const state=store.getState(), info=dependencyInfo(task,state), manage=isOrganizer()||task.owner===ui.actor;
    const dependents=state.tasks.filter(t=>(t.dependencies||[]).some(link=>link.taskId===task.id));
    if(!info.links.length&&!dependents.length&&task.status!=='blocked')return '';
    return `<section class="task-dependencies section-gap" aria-label="Linked tasks">
      ${info.ready?`<div class="dependency-prompt"><div><strong>Ready to resume</strong><p>Linked work is complete. Review the results below.</p></div>${manage?`<button class="btn btn-primary" data-action="resume-task" data-id="${h(task.id)}">Resume task</button>`:`<span>${h(member(task.owner).name)} can resume this task.</span>`}</div>`:''}
      ${info.links.length?`<h3>Linked work</h3>${info.links.map(link=>{const t=link.task;if(!t)return '<p>Linked task unavailable. Ask the organizer to review it.</p>';const done=info.resolved(t);return `<article class="dependency-card"><div class="dependency-card-heading"><button class="text-button" data-action="task" data-id="${h(t.id)}">${h(t.title)}</button><span class="status-badge ${done?'status-done':'status-blocked'}">${done?'Complete':t.reportedAt&&t.requiresVerification&&!t.verifiedAt?'Awaiting verification':statuses[t.status]}</span></div><p class="muted">${link.kind==='related'?'Related task · ':task.status==='blocked'?'Waiting on · ':'Follow-up · '}${h(member(t.owner).name)}</p>${done?`<p class="dependency-result">${h(t.completionResult?.text||t.note||'No result provided.')}</p><p class="muted">${h(t.verifiedAt?'Verified by '+member(t.verifiedBy).name:completionText(t))}</p>`:''}${manage&&task.status!=='done'?`<button class="text-button dependency-unlink" data-action="unlink-dependency" data-id="${h(task.id)}" data-prerequisite="${h(t.id)}" aria-label="Unlink ${h(t.title)}">Unlink · keep task</button>`:''}</article>`;}).join('')}`:task.status==='blocked'?'<p>No follow-up task linked yet.</p>':''}
      ${task.status==='blocked'&&manage?`<details class="dependency-add"><summary>Name or link follow-up work</summary><form id="dependencyForm" data-id="${h(task.id)}"><label class="field">Existing task<select name="existingTask">${options([['','Name the follow-up'],...state.tasks.filter(t=>t.id!==task.id&&!info.links.some(link=>link.taskId===t.id)).map(t=>[t.id,t.title])],'')}</select></label><label class="field">Follow-up task name<input name="newTitle" maxlength="180" placeholder="What needs to happen first?"></label><label class="check-field"><input name="additional" type="checkbox"> Add a separate blocker instead</label><p class="muted">An unused generic follow-up will be updated, not duplicated.</p><div class="form-actions"><button class="btn btn-secondary" type="submit">Save follow-up</button></div></form></details>`:''}
      ${dependents.length?`<h3>Linked from</h3><div class="dependency-targets">${dependents.map(t=>`<button class="text-button" data-action="task" data-id="${h(t.id)}">${h(t.title)} · ${h(member(t.owner).name)}</button>`).join('')}</div>${task.status!=='done'?'<p class="muted">Your completion note will be shared with these tasks.</p>':''}`:''}
    </section>`;
  }
  function handoffMarkup(task) {
    const pending=(task.handoffs||[]).filter(item=>item.status==='pending');
    if(!pending.length||task.status==='done')return '';
    const organizer=isOrganizer(),manage=organizer||task.owner===ui.actor,state=store.getState();
    const available=state.tasks.filter(other=>other.id!==task.id&&other.status!=='done');
    return `<section class="task-handoffs section-gap" aria-label="Suggested follow-ups"><h3>Suggested follow-ups</h3>${pending.map(item=>{
      const matching=available.find(other=>other.id===item.taskId),mode=matching||(item.matchIds||[]).some(id=>available.some(other=>other.id===id))||item.kind==='related'?'link':'create';
      return `<article class="handoff-card"><h4>${h(item.title)}</h4><p class="muted">${item.kind==='related'?'Related task · no blocking dependency':'Follow-up work'}${item.owner?' · Suggested owner: '+h(member(item.owner).name):''}</p><blockquote>${h(item.sourceText)}</blockquote><p class="muted">${h(member(item.actor).name)} · ${item.sourceKind==='comment'?'Comment':'Progress update'}</p>${manage?`<form id="handoffForm-${h(item.id)}" class="handoff-form" data-id="${h(task.id)}" data-suggestion="${h(item.id)}"><label class="field">Action<select name="mode">${options([...(item.kind==='related'?[]:[['create','Create task']]),['link','Link existing task']],mode)}</select></label><div data-handoff-create ${mode==='link'?'hidden':''}><label class="field">Task name<input name="title" maxlength="180" value="${h(item.title)}" ${mode==='create'?'required':''}></label><label class="field">Assign to<select name="owner">${organizer?ownerOptions(item.owner):options([['','Unassigned'],[ui.actor,'Me · '+member(ui.actor).name]],item.owner===ui.actor?ui.actor:'')}</select></label>${!organizer&&item.owner&&item.owner!==ui.actor?'<p class="muted">An organizer can assign the suggested teammate.</p>':''}</div><label class="field" data-handoff-link ${mode==='create'?'hidden':''}>Existing task<select name="taskId" ${mode==='link'?'required':''}>${options([['','Choose a task'],...available.map(other=>[other.id,other.title+' · '+member(other.owner).name])],matching?.id||'')}</select></label><p class="muted">${item.kind==='related'?'Adds a related link.':'Links this task to the follow-up and shares its completion result here.'} The current status stays unchanged.</p><div class="form-actions"><button class="btn btn-primary btn-small" type="submit" name="handoffAction" value="save">${mode==='link'?'Link task':'Create task'}</button><button class="text-button" type="submit" name="handoffAction" value="dismiss" formnovalidate>Dismiss</button></div></form>`:`<p class="muted">The task owner or organizer can review this suggestion.</p>`}</article>`;
    }).join('')}</section>`;
  }
  function syncHandoffForm(form) {
    const create=form.elements.mode.value==='create';
    $('[data-handoff-create]',form).hidden=!create;$('[data-handoff-link]',form).hidden=create;
    form.elements.title.required=create;form.elements.taskId.required=!create;
    $('button[value="save"]',form).textContent=create?'Create task':'Link task';
  }
  function taskDrafts(exclude='') {
    if(ui.dialogKind!=='task')return [];
    return $$('#dialog form').filter(form=>form.id!==exclude).flatMap(form=>
      $$('input[name],textarea[name],select[name]',form).filter(input=>{
        if(input.type==='checkbox'||input.type==='radio')return input.checked!==input.defaultChecked;
        const initial=input.tagName==='SELECT'?([...input.options].find(option=>option.defaultSelected)?.value??input.options[0]?.value??''):input.defaultValue;
        return input.value!==initial;
      }).map(input=>({form:form.id,name:input.name,value:input.value,checked:input.checked})));
  }
  function taskDialog(id,submittedForm='') {
    const task=store.getState().tasks.find(t=>t.id===id);
    if(!task){toast('That task is no longer available.');return;}
    const sameTask=ui.dialogKind==='task'&&ui.detailId===id;
    const drafts=sameTask?taskDrafts(submittedForm):[];
    const expanded=sameTask?$$('#dialog details[open]').map(el=>el.className):[];
    const previousFocus=sameTask?document.activeElement:null;
    const scroll=sameTask?$('#dialog').scrollTop:0;
    ui.detailId=id;
    const organizer=isOrganizer(), own=task.owner===ui.actor;
    const awaiting=task.requiresVerification&&task.reportedAt&&!task.verifiedAt;
    openDialog(task.title,`<div class="inline">${awaiting?'<span class="status-badge status-blocked">Awaiting organizer verification</span>':statusBadge(task.status)}<span class="category-label">${h(task.category)}</span>${sourceButton(task)}</div>
      <dl class="task-facts"><div><dt>Assigned to</dt><dd>${h(member(task.owner).name)}</dd></div><div><dt>Due</dt><dd>${dayLabel(task.dueDate)}</dd></div></dl>
      ${!task.owner&&task.status!=='done'?`<div class="claim-panel"><p>No owner yet.</p><button class="btn btn-primary" data-action="claim" data-id="${h(id)}">Claim task</button></div>`:''}
      <section class="task-context"><h3>Latest update</h3><p>${h(task.note||'No update yet.')}</p><span class="muted">Updated by ${h(member(task.updatedBy).name)} · ${relative(task.updatedAt)}</span></section>
      ${task.completedAt?`<p class="completion-note">${h(completionText(task))} · ${timeLabel(task.completedAt)}</p>`:''}
      ${awaiting?`<div class="notice section-gap">${h(task.reportedBy)} reported this complete. The organizer needs to confirm it.${organizer?`<button class="btn btn-primary btn-small" data-action="verify-task" data-id="${h(id)}">Verify completion</button>`:''}</div>`:''}
      ${dependencyMarkup(task)}
      ${handoffMarkup(task)}
      ${own&&task.status!=='done'?`<section class="task-report section-gap"><h3>Your update</h3><form id="responseForm" data-id="${h(id)}"><label class="field"><span class="sr-only">What happened or what is blocking you?</span><textarea name="note" required rows="3" maxlength="3000" placeholder="What’s finished? What’s blocking you?"></textarea></label><div class="task-report-actions"><button class="btn btn-primary" type="submit" name="response" value="completed" ${awaiting?'disabled':''}>Report complete</button><button class="btn btn-secondary" type="submit" name="response" value="blocked">Report blocked</button><button class="text-button" type="submit" name="response" value="progress">Share progress</button></div></form><p class="muted">${awaiting?'Reporting a blocker or new progress replaces your pending completion report.':task.requiresVerification?'Your completion report will wait for organizer verification.':'Reporting complete marks this task done and records your name.'}</p>${!task.acceptedAt?`<button class="text-button" data-action="accept-task" data-id="${h(id)}">Accept responsibility</button>`:''}</section>`:!own&&!organizer&&task.owner?`<p class="notice section-gap">${h(member(task.owner).name)} reports progress on this task. You can join the conversation below.</p>`:''}
      <section class="comments section-gap"><h3>Comments</h3>${task.comments.map(c=>`<article class="comment">${avatar(c.actor,true)}<div><strong>${h(member(c.actor).name)}</strong><time>${timeLabel(c.at)}</time><p>${h(c.text)}</p></div></article>`).join('')||'<p class="muted">No comments yet.</p>'}<form id="commentForm" class="comment-form" data-id="${h(id)}"><label class="field"><span class="sr-only">Add a comment</span><textarea name="text" required rows="2" maxlength="3000" placeholder="Add a comment…"></textarea></label><button class="btn btn-secondary btn-small" type="submit">Post as ${h(member(ui.actor).name.split(' ')[0])}</button></form></section>
      ${organizer?`<details class="task-organizer section-gap"><summary>Edit task details <span>Organizer only</span></summary><form id="taskDetailForm" data-id="${h(id)}" class="section-gap"><div class="form-grid"><label class="field full-width">Task name<input name="title" required maxlength="180" value="${h(task.title)}"></label><label class="field">Owner<select name="owner">${ownerOptions(task.owner)}</select></label><label class="field">Status<select name="status">${statusOptions(task.status)}</select></label><label class="field">Due date<input name="dueDate" type="date" value="${h(task.dueDate)}"></label><label class="field">Category<select name="category">${options([...new Set(['Transport','Food & drink','Venue','Program','Guest care',task.category])].map(x=>[x,x]),task.category)}</select></label><label class="field full-width">Latest update<textarea name="note" rows="3" maxlength="3000">${h(task.note)}</textarea></label></div><div class="form-actions"><button class="btn btn-primary" type="submit">Save task details</button></div></form><p class="muted">${h(commitment(task))}</p><div class="inline"><button class="text-button" data-action="verification-toggle" data-id="${h(id)}">${task.requiresVerification?'Turn off':'Require'} organizer verification</button><button class="text-button" data-action="followup" data-id="${h(id)}">Draft follow-up</button></div>${task.followupAfter?`<p class="muted">Next planned follow-up: ${dayLabel(task.followupAfter)}</p>`:''}</details>`:''}`, '',false,'task');
    if(sameTask){
      for(const draft of drafts){const input=document.getElementById(draft.form)?.elements.namedItem(draft.name);if(input){input.value=draft.value;if(input.type==='checkbox'||input.type==='radio')input.checked=draft.checked;}}
      for(const form of $$('.handoff-form',$('#dialog')))syncHandoffForm(form);
      for(const detail of $$('#dialog details'))if(expanded.includes(detail.className))detail.open=true;
      requestAnimationFrame(()=>{restoreFocus(previousFocus,$('#dialog'));$('#dialog').scrollTop=scroll;});
    }
  }
  function newTaskDialog() {
    openDialog('Add task',`<form id="newTaskForm"><div class="form-grid"><label class="field full-width">Task name<input name="title" required maxlength="180" placeholder="What needs to happen?"></label><label class="field">Owner<select name="owner">${ownerOptions('')}</select></label><label class="field">Due date<input name="dueDate" type="date"></label><label class="field">Category<select name="category">${options(['Guest care','Food & drink','Transport','Venue','Program'].map(x=>[x,x]),'Guest care')}</select></label><label class="field">Status<select name="status">${statusOptions('todo')}</select></label><label class="field full-width">Context<textarea name="note" rows="3" maxlength="3000" placeholder="What does the owner need to know?"></textarea></label></div><div class="form-actions"><button class="btn btn-primary" type="submit">Add task</button></div></form>`);
  }
  function followupDialog(id) {
    const task=store.getState().tasks.find(t=>t.id===id);
    if(!task)return;
    const r=reason(task);
    const saved=store.getState().drafts.find(d=>d.taskId===id);
    const draft=saved?.text || `Hi ${task.owner?member(task.owner).name.split(' ')[0]:'team'}, quick check-in on “${task.title}”.\n\n${latestUpdate(task)?`The last update was: “${latestUpdate(task)}”\n\n`:''}${task.status==='blocked'?'What decision or help would unblock this, and who do you need it from?':!task.owner?'Who can take ownership, and what is a realistic next checkpoint?':'What is done so far, and what is the next concrete step?'}${task.dueDate?` We had ${dayLabel(task.dueDate)} as the target—does that still work?`:''}\n\nThanks,\n${member(ui.actor).name.split(' ')[0]}`;
    openDialog('Follow-up draft',`<div class="followup-context"><div><strong>${h(task.title)}</strong><p>${r?h(r.label):'Check-in'} · Last updated ${relative(task.updatedAt)}</p></div></div><form id="followupForm" data-id="${h(id)}"><label class="field section-gap">Your message<textarea name="text" required rows="10" maxlength="5000">${h(draft)}</textarea></label><p class="notice">Draft only. Saving or copying does not send it.</p><div class="form-actions"><button class="btn btn-primary" type="submit">${icon('copy')} Save & copy draft</button><button type="button" class="text-button" data-action="record-followup" data-id="${h(id)}">Record as sent</button></div></form>`, '',false,'followup');
  }
  function digestText(s) {
    return `${s.event.name} — ${new Date().toLocaleDateString()}\n\nCOMPLETED\n${completed(s).map(t=>`• ${t.title} — ${completionText(t)} (${timeLabel(t.completedAt)})`).join('\n')||'No completed tasks yet.'}\n\nNEEDS ATTENTION\n${attention(s).map(t=>`• ${t.title} — ${member(t.owner).name}; ${reason(t).label}. ${t.note||''}`).join('\n')||'No outstanding attention items.'}\n\nEMAIL TO REVIEW\n${pending(s).map(m=>`• ${m.subject} — ${m.sender}`).join('\n')||'All messages reviewed.'}`;
  }
  function digestDialog() {
    const s=store.getState();
    const section=(title,items)=>`<section class="digest-section"><h3>${title}</h3>${items||'<p class="muted">Nothing here right now.</p>'}</section>`;
    openDialog('Event summary',`<p class="muted">Updated ${timeLabel(Date.now())}</p>${section('Completed',completed(s).slice(0,5).map(t=>`<p><button class="text-button" data-action="task" data-id="${h(t.id)}">${h(t.title)}</button><br>${h(completionText(t))} · ${timeLabel(t.completedAt)}</p>`).join(''))}${section('Decisions & follow-ups',attention(s).map(t=>`<p><strong>${h(reason(t).label)}:</strong> <button class="text-button" data-action="task" data-id="${h(t.id)}">${h(t.title)}</button><br>${h(member(t.owner).name)} · ${h(t.note)}</p>`).join(''))}${section(`${pending(s).length} emails still need a review`,pending(s).map(m=>`<p>${h(m.subject)}<br><span class="muted">${h(m.sender)}</span></p>`).join(''))}`,`<button class="btn btn-primary" data-action="copy-digest">${icon('copy')} Copy summary</button>`,true,'digest');
  }
  function feedbackDialog() {
    openDialog('Add event feedback',`<form id="feedbackForm"><div class="form-grid"><label class="field full-width">What worked well?<textarea name="wentWell" rows="2" maxlength="2000" placeholder="Keep the staggered bus departures…"></textarea></label><label class="field full-width">What should we do differently?<textarea name="change" required rows="3" maxlength="2000" placeholder="Set up a quiet space before guests arrive…"></textarea></label><label class="field">Area<select name="category">${options(['Guest care','Transport','Food & drink','Venue','Program'].map(x=>[x,x]),'Guest care')}</select></label><label class="field">Event rating<select name="rating">${options([['5','5 — Great'],['4','4 — Good'],['3','3 — Mixed'],['2','2 — Difficult'],['1','1 — Needs work']],'4')}</select></label></div>${memoryFields()}<p class="notice">Suggestions use the selected event context. Written exceptions require manual review.</p><div class="form-actions"><button class="btn btn-primary" type="submit">Save feedback</button></div></form>`);
  }
  function thoughtDialog() {
    const suggestions=store.getSuggestions();
    openDialog('Suggestions',`<div class="notice">Rule-based suggestions from tasks and feedback. No AI or RSVP service connected.</div><button class="btn btn-secondary section-gap" data-action="event-context">${isOrganizer()?'Update event context':'Event details'}</button><div class="ai-panel section-gap">${suggestions.map(insightMarkup).join('')||empty('No suggestions.','')}</div><button class="text-button section-gap" data-action="feedback">${icon('plus')} Add event feedback</button>`, '',true,'thought');
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
    if(window.GatherMode?.demo&&path==='records'&&body)body={...body,revision:ui.privateRevision};
    const url=window.GatherMode?window.GatherMode.privateUrl(path):`/api/private/${path}`;
    const response=await fetch(url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json','X-Gather-CSRF':session?.csrf||''}:{},body:body?JSON.stringify(body):undefined,cache:'no-store',credentials:'same-origin'});
    if(!(response.headers.get('content-type')||'').includes('application/json'))throw new Error('Could not load private details. Reload or sign in again.');
    const result=await response.json();
    if(!response.ok){if(response.status===401){ui.privateSession=null;ui.privateRecords=[];ui.privateState='locked';}const error=new Error(result.error||'Private details are unavailable.');error.status=response.status;throw error;}
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
    if(document.hidden){clearPrivate();return;}
    if(!isOrganizer()){ui.privateState='locked';render();return;}
    const ticket=++privateEpoch;
    clearTimeout(privateTimer);ui.privateState='loading';ui.privateRecords=[];render();
    try{
      const config=await privateApi('config');if(ticket!==privateEpoch||ui.view!=='details')return;
      ui.privateConfigured=config.configured;
      if(ui.actor!=='jack'){ui.privateState='locked';render();return;}
      let session;try {session=await privateApi('session');}catch{session=null;}
      if(ticket!==privateEpoch||ui.view!=='details')return;
      ui.privateSession=session;
      if(ui.privateSession){const result=await privateApi('records');if(ticket!==privateEpoch||ui.view!=='details')return;ui.privateRecords=result.records;ui.privateRevision=result.revision;ui.privateState='unlocked';privateTimer=setTimeout(()=>{lockPrivate();toast('Private details locked after the administrator session ended.');},Math.max(0,ui.privateSession.expiresAt-Date.now()));}
      else ui.privateState='locked';render();
    }catch(error){if(ticket!==privateEpoch)return;ui.privateRecords=[];ui.privateState='unavailable';ui.privateError=error.message;render();}
  }
  function privateView(s) {
    const heading=pageHeading('','Private bookings',window.GatherMode?.demo?'Sample bookings · fictional details only':'Organizer only',ui.privateState==='unlocked'?`<button class="btn btn-secondary" data-action="lock-private">Lock</button><button class="btn btn-primary" data-action="new-booking">${icon('plus')} Add booking</button>`:'');
    if(!isOrganizer())return heading+'<section class="panel private-panel"><h2>Organizer access required</h2><p>Booking codes are not shared with participants.</p></section>';
    if(ui.privateState==='loading')return heading+'<section class="panel private-panel"><p role="status">Checking the local private-details service…</p></section>';
    if(ui.privateState==='unavailable')return heading+`<section class="panel private-panel"><h2>Private details are not available on this preview server.</h2><p>${h(ui.privateError)}</p><p class="notice">No booking information has been loaded or saved in browser storage.</p><button class="btn btn-secondary" data-action="reload-private">Try again</button></section>`;
    if(ui.privateState!=='unlocked')return heading+`<section class="panel private-panel"><span class="eyebrow">LOCAL ADMINISTRATOR · ENCRYPTED STORAGE</span><h2>${ui.privateConfigured?'Unlock private event details':'Set up private event details'}</h2><p>A separate administrator passphrase protects this local store. Choosing Jack in the demo does not unlock it.</p>${ui.actor==='jack'?`<form id="privateLoginForm"><label class="field">${ui.privateConfigured?'Administrator passphrase':'Create a passphrase (12+ characters)'}<input type="password" name="passphrase" required minlength="12" autocomplete="${ui.privateConfigured?'current-password':'new-password'}"></label>${ui.privateConfigured?'':'<label class="field section-gap">Confirm passphrase<input type="password" name="confirm" required minlength="12" autocomplete="new-password"></label>'}<p class="warning-note">${ui.privateConfigured?'Private details are never included in shared task exports.':'Keep your passphrase somewhere safe. There is no password reset or recovery. Data is encrypted on this computer—not synced to a team account.'}</p><button class="btn btn-primary" type="submit">${ui.privateConfigured?'Unlock private details':'Create encrypted private store'}</button></form>`:'<p class="notice">Switch to Jack’s administrator preview, then sign in with the separate private-details passphrase.</p>'}</section>`;
    return heading+`<div class="notice">Signed in as the local administrator · encrypted on this computer · session expires in 15 minutes. Team login and cloud sharing are not connected. Do not store payment-card or passport details here.</div><div class="booking-grid section-gap">${ui.privateRecords.map(record=>`<article class="panel booking-card"><div class="inline"><span class="chip">${h(record.type)}</span><span class="muted">Private</span></div><h2>${h(record.title)}</h2><p>${h(record.provider)}</p><p>${h(record.traveler)}${record.date?` · ${dayLabel(record.date)}`:''}</p><div class="reference-mask">•••••••• <span>Confirmation reference</span></div><button class="btn btn-secondary" data-action="booking" data-id="${h(record.id)}">View private details ${icon('arrow')}</button></article>`).join('')||`<section class="panel private-panel">${empty('No bookings.','',`<button class="btn btn-primary" data-action="new-booking">Add first booking</button>`)}</section>`}</div>`;
  }
  function bookingDialog(id) {
    if(!ui.privateSession||ui.actor!=='jack')return toast('Unlock private details as the local administrator first.');
    const record=ui.privateRecords.find(item=>item.id===id)||{};
    openDialog(record.title||'Add a private booking',`<p class="notice">Only the authenticated local administrator can retrieve these details. They do not enter task notes, activity, email review, or workspace exports.</p><form id="bookingForm" data-id="${h(record.id||'')}"><div class="form-grid"><label class="field">Booking type<select name="type">${options(['Flight','Hotel','Transport','Venue','Other'].map(x=>[x,x]),record.type||'Flight')}</select></label><label class="field">Booking date<input type="date" name="date" value="${h(record.date||'')}"></label><label class="field full-width">Title<input name="title" required maxlength="160" placeholder="Guest speaker arrival" value="${h(record.title||'')}"></label><label class="field">Airline / hotel / provider<input name="provider" maxlength="160" value="${h(record.provider||'')}"></label><label class="field">Traveler / booked for<input name="traveler" maxlength="160" value="${h(record.traveler||'')}"></label><label class="field full-width">Confirmation reference<input id="privateReference" type="password" name="reference" required maxlength="160" autocomplete="off" value="${h(record.reference||'')}"></label><div class="inline full-width"><button type="button" class="text-button" data-action="reveal-reference">Show / hide reference</button><button type="button" class="text-button" data-action="copy-reference">Copy reference</button></div><label class="field full-width">Itinerary / private logistics notes<textarea name="details" rows="4" maxlength="2000">${h(record.details||'')}</textarea></label><label class="field full-width">Related task (optional)<select name="taskId">${options([['','Not linked'],...store.getState().tasks.map(task=>[task.id,task.title])],record.taskId||'')}</select></label></div><div class="form-actions"><button type="submit" class="btn btn-primary">Save encrypted details</button></div></form>`,'',true,'private');
    $('#bookingForm').dataset.version=record.version||'';
  }
  function responseDialog(id,preview=false) {
    const task=store.getState().tasks.find(item=>item.id===id);if(!task)return;
    openDialog(preview?'A simple participant response':'Report what is complete',`<p class="notice">${preview?'Local response preview only. This is not a shareable guest link; real guest access needs the hosted sign-in setup.':'This report records what the owner says. Tasks requiring verification stay open until Jack confirms.'}</p><h3>${h(task.title)}</h3><p>Assigned to ${h(member(task.owner).name)}</p><form id="responseForm" data-id="${h(id)}"><label class="field">Update<select name="response">${options(preview?[['accepted','I accept this task'],['blocked','I need help'],['completed','I have completed it']]:[['completed','I have completed it']],'completed')}</select></label><label class="field section-gap">What happened / what do you need?<textarea name="note" required rows="4" maxlength="3000"></textarea></label><div class="form-actions"><button class="btn btn-primary" type="submit" ${task.owner!==ui.actor?'disabled':''}>Submit as ${h(member(ui.actor).name.split(' ')[0])}</button></div>${task.owner!==ui.actor?'<p class="warning-note">Switch the demo member to this task’s owner to try their response.</p>':''}</form>`);
  }
  function contextDialog() {
    if(!isOrganizer()){const e=store.getState().event;openDialog('Event details',`<h3>${h(e.name)}</h3><p>${h(e.location)} · ${dayLabel(e.date)}</p><p>${e.guestCount} guests · ${e.outdoor?'Outdoors':'Indoors'} · ${e.transportNeeded?'Transport provided':'No organized transport'}</p>`);return;}
    const e=store.getState().event;openDialog('Event details',`<form id="contextForm"><div class="form-grid"><label class="field">Venue setting<select name="outdoor">${options([['true','Outdoors'],['false','Indoors']],String(e.outdoor))}</select></label><label class="field">Organized transport<select name="transportNeeded">${options([['true','Transport needed'],['false','No organized transport']],String(e.transportNeeded))}</select></label><label class="field">Expected guests<input type="number" name="guestCount" min="0" max="100000" required value="${e.guestCount}"></label><label class="field">Dietary responses outstanding<input type="number" name="dietaryOutstanding" min="0" max="100000" required value="${e.dietaryOutstanding}"></label><label class="field">Catering cutoff<input type="date" name="cateringDeadline" value="${h(e.cateringDeadline)}"></label></div><p class="notice">Manually entered data. No RSVP sync.</p><div class="form-actions"><button class="btn btn-primary" type="submit">${isOrganizer()?'Update event context':'Event details'}</button></div></form>`);
  }
  function memoryEditDialog(id) {
    const m=store.getState().memories.find(item=>item.id===id);if(!m)return;
    openDialog('Edit feedback',`<form id="memoryEditForm" data-id="${h(id)}"><label class="field">What should we do differently?<textarea name="change" required rows="3" maxlength="3000">${h(m.change)}</textarea></label>${memoryFields(m)}<label class="field section-gap">Did the change help?<select name="outcome">${options([['untested','Not evaluated yet'],['helped','It helped'],['did-not-help','It did not help — stop suggesting']],m.outcome)}</select></label><label class="field section-gap">Outcome notes<textarea name="outcomeNote" rows="3" maxlength="2000">${h(m.outcomeNote)}</textarea></label><label class="field section-gap">Suggest in future planning<select name="active">${options([['true','Yes, when the context matches'],['false','Retire this lesson']],String(m.active))}</select></label><div class="form-actions"><button class="btn btn-primary" type="submit">Save lesson & outcome</button></div></form>`);
  }
  function memoryFields(m={}) {return `<label class="field section-gap">When does this apply?<select name="scope">${options([['always','All events'],['outdoor','Outdoor events only'],['transport','When organized transport is needed'],['same-venue','At this venue only']],m.scope||'always')}</select></label><label class="field section-gap">Context / exceptions<textarea name="context" rows="2" maxlength="2000" placeholder="Useful for arrivals above 100 people; reconsider for smaller events…">${h(m.context||'')}</textarea></label>`;}

  document.addEventListener('click',async event=>{
    if(ui.pendingSave){event.preventDefault();return;}
    const el=event.target.closest('[data-action], [data-view]');
    if(!el)return;
    if(el.dataset.view){event.preventDefault();if(el.dataset.view===ui.view&&$('#dialogBackdrop').hidden){setDrawer(false);return;}if(!confirmDiscard($('#dialog'),el.dataset.view!==ui.view?$('#emailReviewForm'):null))return;if(!$('#dialogBackdrop').hidden)closeDialog();navigate(el.dataset.view);return;}
    const {action,id}=el.dataset;
    if((action==='source'||action==='select-message')&&ui.view==='inbox'&&id===ui.messageId)return;
    if(action==='task'&&ui.dialogKind==='task'&&id===ui.detailId)return;
    const replacesDialog=['close-dialog','task','add-task','followup','digest','demo-email','demo-reset','paste-email','report-task','participant-preview','event-context','edit-memory','new-booking','booking','feedback','thought-partner','event-info','invite','demo-info','source','select-message','task-conversation'];
    const replacesReview=['source','select-message','select-conversation','close-briefing','task-conversation','sample-reply','ignore-message','task-filter','person-tasks','paste-email'];
    if(!confirmDiscard(replacesDialog.includes(action)?$('#dialog'):null,replacesReview.includes(action)?$('#emailReviewForm'):null))return;
    const writes=['toggle-task','claim','confirm-demo-reset','sample-reply','refresh-proposal','ignore-message','accept-task','resume-task','unlink-dependency','verify-task','verification-toggle','accept-insight','dismiss-insight','record-followup'];
    const saveRoot=el.closest('#dialog')||el.closest('form')||el;
    const release=writes.includes(action)?saveLock(saveRoot):()=>{};
    try {
      if(action==='close-dialog')closeDialog();
      if(action==='add-task')newTaskDialog();
      if(action==='task')taskDialog(id);
      if(action==='toggle-task'){const t=store.getState().tasks.find(t=>t.id===id);if(!isOrganizer()||(t.requiresVerification&&t.status!=='done')){taskDialog(id);return;}store.updateTask(id,{status:t.status==='done'?'todo':'done'},ui.actor);render();toast(t.status==='done'?'Task reopened. Its history is preserved.':`Marked done by ${member(ui.actor).name}. Recorded in team updates.`);}
      if(action==='task-filter'){ui.tab=el.dataset.filter;ui.owner='';ui.status='';ui.search='';navigate('tasks');}
      if(action==='person-tasks'){ui.owner=id;ui.tab='all';ui.status='';ui.search='';navigate('tasks');}
      if(action==='claim'){store.claimTask(id,ui.actor);render();if(ui.dialogKind==='task')taskDialog(id);toast(`Task claimed by ${member(ui.actor).name}.`);}
      if(action==='reload-workspace')location.reload();
      if(action==='demo-email')openDialog('Demo email', '<p>This demo uses sample email updates. It does not connect to Gmail or read your mailbox.</p><p>Open Email briefing to review suggested changes.</p>', '<button class="btn btn-primary" data-view="inbox">Open email briefing</button>');
      if(action==='demo-reset'&&window.GatherMode?.demo&&isOrganizer())openDialog('Restart demo?', '<p>Reset sample tasks, email decisions, comments, feedback, and sample bookings for all four profiles. Your real project is unchanged.</p>', '<button class="btn btn-secondary" data-action="close-dialog">Cancel</button><button class="btn btn-primary" data-action="confirm-demo-reset">Restart demo</button>');
      if(action==='confirm-demo-reset'&&window.GatherMode?.demo&&isOrganizer()){el.disabled=true;try{store.resetDemo(true);clearPrivate();closeDialog();render();toast('Demo restarted. Your real project is unchanged.');}finally{if(el.isConnected)el.disabled=false;}}
      if(action==='followup')followupDialog(id);
      if(action==='digest')digestDialog();
      if(action==='copy-digest'){const text=digestText(store.getState());if(await copyText(text))toast('Current summary copied.');else copyFallback(text);}
      if(action==='copy-draft'){const text=store.getState().drafts.find(d=>d.id===id).text;if(await copyText(text))toast('Draft copied. Nothing sent.');else copyFallback(text);}
      if(action==='source'||action==='select-message'){ui.messageId=id;if(!$('#dialogBackdrop').hidden)closeDialog();if(ui.view==='inbox')render();else navigate('inbox');}
      if(action==='select-conversation'){ui.messageId='';ui.conversationKey=id;render();}
      if(action==='close-briefing'){ui.messageId='';ui.conversationKey='';render();}
      if(action==='task-conversation'){ui.messageId='';ui.conversationKey='task:'+id;closeDialog();navigate('inbox');}
      if(action==='refresh-inbox')await refreshInbox(true);
      if(action==='paste-email')pasteDialog();
      if(action==='sample-reply'){const confirmed=el.dataset.step==='confirmed';const m=store.addMessage({sender:'Jules Miller',subject:'Re: Northstar buses for Field Day',threadId:'thread-bus',externalId:`gather-sample-bus-${confirmed?'confirmed':'deposit'}`,body:confirmed?'Payment received. Booking confirmed. Both buses are booked for Field Day. — Jules':'The buses are reserved, but we still need the deposit. I cannot confirm the booking until Jack approves payment. — Jules'},ui.actor);ui.messageId=m.id;render();toast('Sample reply added. No task changed until you review.');}
      if(action==='refresh-proposal'){
        if(ui.savingProposal)return;
        const taskId=$('#emailTask')?.value;ui.savingProposal=true;
        try{if(store.refresh)await store.refresh(()=>true);const latest=store.getState().messages.find(message=>message.id===id);if(!latest||latest.appliedTaskId||latest.ignoredAt){render();toast('Showing the latest saved decision.');}else{store.refreshProposal(id,taskId);ui.reviewDirty=false;render();toast('Comparison refreshed. Review the current values before applying.');}}
        catch(error){render();throw error;}
        finally{ui.savingProposal=false;}
      }
      if(action==='ignore-message'){store.ignoreMessage(id,ui.actor);ui.messageId='';render();toast('Set aside. The plan was not changed.');}
      if(action==='accept-task'){store.acceptTask(id,ui.actor);render();taskDialog(id);toast('Responsibility accepted.');}
      if(action==='report-task')responseDialog(id);
      if(action==='resume-task'){el.disabled=true;try{store.resumeTask(id,ui.actor);render();taskDialog(id);toast('Task resumed.');}finally{if(el.isConnected)el.disabled=false;}}
      if(action==='unlink-dependency'){store.removeDependency(id,el.dataset.prerequisite,ui.actor);render();taskDialog(id);toast('Link removed. The follow-up task is unchanged.');}
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
      if(action==='record-followup'){
        const draft=$('#followupForm');
        if(draft){const text=draft.elements.text.value.trim();if(!text)throw new Error('Add your follow-up text before recording it.');store.saveDraft(id,text,ui.actor);render();}
        openDialog('Record your follow-up',`<p class="notice">Your draft is saved. Confirm only after you have sent it yourself. Gather does not send it.</p><form id="recordFollowupForm" data-id="${h(id)}"><label class="field">Check again on<input name="afterDate" type="date" required min="${dateKey()}"></label><div class="form-actions"><button class="btn btn-secondary" type="button" data-action="followup" data-id="${h(id)}">Back to draft</button><button class="btn btn-primary" type="submit">I sent it · record checkpoint</button></div></form>`);
      }
      if(action==='feedback')feedbackDialog();
      if(action==='thought-partner')thoughtDialog();
      if(action==='accept-insight'){const task=store.acceptSuggestion(id,ui.actor);render();if(ui.dialogKind==='thought')thoughtDialog();toast(task?`Added to plan: ${task.title}`:'This check is already covered by the plan.');}
      if(action==='dismiss-insight'){store.dismissSuggestion(id);render();if(ui.dialogKind==='thought')thoughtDialog();toast('Suggestion dismissed for this plan.');}
      if(action==='event-info')contextDialog();
      if(action==='invite'){const text=`Event plan: ${store.getState().event.name}.\n\nHere is the plan: [add your shared workspace link]`;openDialog('Invitation draft',`<p class="notice">Team invitations are a draft in this local prototype. No invite or email will be sent.</p><label class="field">Invitation message<textarea id="inviteDraft" rows="7">${h(text)}</textarea></label>`,`<button class="btn btn-primary" data-action="copy-invite">${icon('copy')} Copy invitation draft</button>`);}
      if(action==='copy-invite'){const text=$('#inviteDraft').value;if(await copyText(text))toast('Invitation draft copied. Nothing sent.');else copyFallback(text);}
      if(action==='demo-info')openDialog('Your local Gather workspace',`<p>Try the full journey: review an email, assign the work, post an update, and mark it complete.</p><p>Switch the demo member in the top bar to try a teammate’s perspective. Every update records who made it.</p><div class="notice">Tasks, comments, messages, and feedback are saved in this browser. This prototype does not connect to live email, send messages, sync between people, or call an AI service.</div>`,`<button class="btn btn-secondary" data-action="export">Export workspace backup</button>`);
      if(action==='export'){const blob=new Blob([store.exportState()],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='gather-workspace.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Workspace backup downloaded.');}
    }catch(error){if(error.status===409)showPendingUpdate();const errorForm=saveRoot.matches('form')?saveRoot:el.closest('form');if(errorForm)formError(errorForm,error);toast(error.message||'Please try again.');}
    finally{release();}
  });

  document.addEventListener('submit',async event=>{
    const form=event.target;
    if(!form.id)return;
    event.preventDefault();
    if(ui.pendingSave||form.dataset.saving==='true')return;
    const data=Object.fromEntries(new FormData(form));
    $('.form-error',form)?.remove();
    const release=saveLock(form.closest('#dialog')||form,event.submitter);
    try {
      if(form.id==='newTaskForm'){store.addTask(data,ui.actor);closeDialog();render();toast('Task added.');}
      if(form.id==='taskDetailForm'){store.updateTask(form.dataset.id,data,ui.actor);const keepDrafts=taskDrafts(form.id).length>0;render();if(keepDrafts)taskDialog(form.dataset.id,form.id);else closeDialog();toast(`Update recorded by ${member(ui.actor).name}.`);}
      if(form.id==='commentForm'){store.addComment(form.dataset.id,data.text,ui.actor);render();taskDialog(form.dataset.id,form.id);toast('Comment posted.');}
      if(form.id.startsWith('handoffForm-')){const action=event.submitter?.value==='dismiss'?'dismiss':data.mode;const request=action==='dismiss'?{action}:action==='link'?{action,taskId:data.taskId}:{action,title:data.title,owner:data.owner};store.resolveHandoff(form.dataset.id,form.dataset.suggestion,request,ui.actor);render();taskDialog(form.dataset.id,form.id);toast(action==='dismiss'?'Suggestion dismissed.':action==='link'?'Task linked.':'Follow-up created and linked.');}
      if(form.id==='emailReviewForm'){
        if(ui.savingProposal)return;
        ui.savingProposal=true;const button=$('button[type="submit"]',form);button.disabled=true;button.textContent='Saving…';
        try{const task=store.applyMessage(form.dataset.id,data,ui.actor);render();toast(`Applied to “${task.title}”. Original email preserved.`);}
        finally{ui.savingProposal=false;}
      }
      if(form.id==='pasteForm'){const m=store.addMessage(data,ui.actor);ui.messageId=m.id;closeDialog();release();navigate('inbox');toast('Message saved. Review its next step before applying.');}
      if(form.id==='feedbackForm'){store.addMemory({...data,rating:Number(data.rating)},ui.actor);closeDialog();render();thoughtDialog();toast('Feedback saved.');}
      if(form.id==='followupForm'){const text=data.text.trim();store.saveDraft(form.dataset.id,text,ui.actor);const copied=await copyText(text);closeDialog();render();if(copied)toast('Draft saved and copied. Nothing sent.');else {toast('Draft saved in Team updates.');copyFallback(text,'Your saved follow-up draft');}}
      if(form.id==='dependencyForm'){store.addDependency(form.dataset.id,{...(data.existingTask?{taskId:data.existingTask}:{title:data.newTitle}),additional:data.additional==='on'},ui.actor);render();taskDialog(form.dataset.id,form.id);toast('Follow-up saved.');}
      if(form.id==='responseForm'){const id=form.dataset.id,response=event.submitter?.value||data.response;if(!String(data.note||'').trim())throw new Error('Add a short note so the team knows what happened.');if(response==='accepted'){store.acceptTask(id,ui.actor);store.addComment(id,data.note,ui.actor);}else if(response==='blocked'||response==='progress')store.updateTask(id,{status:response,note:data.note},ui.actor);else if(response==='completed')store.reportCompletion(id,data.note,ui.actor);else throw new Error('Choose Report complete, Report blocked, or Share progress.');render();taskDialog(id,form.id);const hasSuggestions=(store.getState().tasks.find(task=>task.id===id)?.handoffs||[]).some(item=>item.status==='pending');toast(hasSuggestions?'Update saved. Review the suggested follow-ups.':response==='blocked'?'Blocker saved. Review the linked work.':response==='progress'?'Progress saved.':'Report saved.');}
      if(form.id==='contextForm'){store.updateEvent(data,ui.actor);closeDialog();render();thoughtDialog();toast('Event details saved.');}
      if(form.id==='memoryEditForm'){store.updateMemory(form.dataset.id,data,ui.actor);closeDialog();render();toast('Feedback updated.');}
      if(form.id==='recordFollowupForm'){store.recordFollowup(form.dataset.id,data.afterDate,ui.actor);closeDialog();render();toast('Follow-up recorded.');}
      if(form.id==='privateLoginForm'){
        if(!ui.privateConfigured&&data.passphrase!==data.confirm)throw new Error('The passphrases do not match.');
        const button=$('button[type="submit"]',form);button.disabled=true;button.textContent='Unlocking…';
        const ticket=privateEpoch;
        try{const session=await privateApi(ui.privateConfigured?'unlock':'setup',{passphrase:data.passphrase});form.reset();if(ticket!==privateEpoch||ui.actor!=='jack'||document.hidden||ui.view!=='details'){await privateApi('lock',{},session).catch(()=>{});clearPrivate();return;}ui.privateSession=session;await loadPrivate();toast('Private details unlocked for the local administrator.');}finally{if(button.isConnected){button.disabled=false;button.textContent='Unlock private details';}}
      }
      if(form.id==='bookingForm'){
        const button=$('button[type="submit"]',form);button.disabled=true;
        const ticket=privateEpoch;
        try{await privateApi('records',{...data,id:form.dataset.id,version:form.dataset.version});if(ticket!==privateEpoch||document.hidden||ui.view!=='details')return;form.reset();closeDialog();await loadPrivate();toast('Encrypted booking saved. Shared tasks and exports are unchanged.');}finally{if(button.isConnected)button.disabled=false;}
      }
    }catch(error){if(error.status===409)showPendingUpdate();formError(form,error);toast(error.message||'Please check the form and try again.');}
    finally{release();if(form.id==='emailReviewForm'&&form.isConnected)updateChangePreview();}
  });

  document.addEventListener('change',event=>{
    const el=event.target;
    if(el.name==='mode'&&el.closest('.handoff-form'))syncHandoffForm(el.closest('form'));
    if(ui.pendingSave)return;
    if(el.closest('#emailReviewForm')){ui.reviewDirty=true;updateChangePreview();}
    if(el.id==='actorSelect'){if(window.GatherMode?.demo){window.top.location.href='/demo?as='+encodeURIComponent(el.value);return;}lockPrivate();ui.actor=el.value;render();toast(`Now trying ${member(ui.actor).name.split(' ')[0]}’s perspective. Private details locked.`);}
    if(el.id==='ownerFilter'){ui.owner=el.value;renderTaskRows();}
    if(el.id==='statusFilter'){ui.status=el.value;renderTaskRows();}
    if(el.id==='emailMode'){
      const update=el.value==='update';
      $('#existingTaskField').hidden=!update;
      $('#emailTask').required=update;
      if(update)$('#emailTask').value='';
      $('#emailTask').dataset.previousValue=$('#emailTask').value;
      updateChangePreview();
    }
    if(el.id==='emailTask'){
      const form=$('#emailReviewForm');if(el.value&&form){if(hasUnsavedFields(form,['taskId','mode'])&&!window.confirm('Changing the task replaces your proposed edits. Continue?')){el.value=el.dataset.previousValue||'';updateChangePreview();return;}const target=el.value;const release=saveLock(form);ui.savingProposal=true;try{store.refreshProposal(form.dataset.id,target);if(form.isConnected){ui.reviewDirty=false;render();}}catch(error){formError(form,error);toast(error.message);}finally{ui.savingProposal=false;release();if(form.isConnected)updateChangePreview();}}if(el.isConnected)el.dataset.previousValue=el.value;
    }
  });
  function renderTaskRows() {
    const tasks=filteredTasks(store.getState());
    $('#taskRows').innerHTML=tasks.map(taskRow).join('');
    $('#taskEmpty').hidden=!!tasks.length;
    $('#taskResultCount').textContent=`${tasks.length} ${tasks.length===1?'task':'tasks'}`;
  }
  document.addEventListener('input',event=>{
    if(event.target.closest('#emailReviewForm')){ui.reviewDirty=true;updateChangePreview();}
    if(event.target.id==='taskSearch'){
      ui.search=event.target.value;
      renderTaskRows();
    }
  });
  $('#dialogBackdrop').addEventListener('click',event=>{if(!ui.pendingSave&&event.target===$('#dialogBackdrop')&&confirmDiscard($('#dialog')))closeDialog();});
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'&&!ui.pendingSave){if(!$('#dialogBackdrop').hidden){if(confirmDiscard($('#dialog')))closeDialog();}else setDrawer(false);}
    const scope=!$('#dialogBackdrop').hidden?$('#dialog'):matchMedia('(max-width:800px)').matches&&$('#sidebar').classList.contains('open')?$('#sidebar'):null;
    if(event.key==='Tab'&&scope){
      const controls=focusable(scope);
      const first=controls[0],last=controls.at(-1);
      if(!first){event.preventDefault();scope.focus();return;}
      if(!scope.contains(document.activeElement)){event.preventDefault();(event.shiftKey?last:first).focus();return;}
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
  });
  $('#mobileMenu').addEventListener('click',()=>setDrawer(!$('#sidebar').classList.contains('open')));
  $('#mobileOverlay').addEventListener('click',()=>setDrawer(false));
  matchMedia('(max-width:800px)').addEventListener('change',()=>setDrawer(false));
  window.addEventListener('hashchange',()=>{const view=location.hash.slice(1);if(view!==ui.view&&!confirmDiscard($('#dialog'),$('#emailReviewForm'))){history.replaceState(null,'',`#${ui.view}`);return;}if(!$('#dialogBackdrop').hidden)closeDialog();navigate(view);});
  window.addEventListener('beforeunload',event=>{if(ui.pendingSave||unsavedDialog()||unsavedReview()){event.preventDefault();event.returnValue='';}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)lockPrivate();});
  if(window.GatherMode?.demo&&!isOrganizer())ui.tab='mine';
  setDrawer(false);
  navigate(location.hash.slice(1)||'overview');
})();
