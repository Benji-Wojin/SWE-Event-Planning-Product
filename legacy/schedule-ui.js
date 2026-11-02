(function(root) {
  'use strict';
  // These are event-local wall times, not instants in the viewer's browser zone.
  const dateLabel = value => new Date(value.slice(0,10)+'T12:00:00Z').toLocaleDateString(undefined,{timeZone:'UTC',weekday:'short',month:'short',day:'numeric',year:'numeric'});
  const timeLabel = value => new Date(value+'Z').toLocaleTimeString(undefined,{timeZone:'UTC',hour:'numeric',minute:'2-digit'});
  const range = schedule => timeLabel(schedule.start)+(schedule.end ? ' – '+(schedule.end.slice(0,10)!==schedule.start.slice(0,10)?dateLabel(schedule.end)+' · ':'')+timeLabel(schedule.end) : '');
  const ordered = tasks => tasks.filter(task=>task.schedule).slice().sort((a,b)=>a.schedule.start.localeCompare(b.schedule.start)||a.id.localeCompare(b.id));
  const scoped = (tasks,scope={}) => scope.mine ? tasks.filter(task=>!!scope.actor&&task.owner===scope.actor) : tasks;
  const resolved = task => task.status==='done'&&(!task.requiresVerification||task.verifiedAt);
  const waitingVerification = task => task.requiresVerification&&(task.reportedAt||task.status==='done')&&!task.verifiedAt;
  // Match the active review shown in Completion details, not historical comments.
  const changesRequested = task => task.status!=='done'&&!task.reportedAt&&Boolean(task.completionReview);
  const pendingAcceptance = (task,members) => !resolved(task)&&task.owner&&members.some(member=>member.id===task.owner&&member.active!==false)&&!task.acceptedAt&&!task.reportedAt&&!waitingVerification(task);
  const unfinishedRequiredWork = (task,byId) => !resolved(task)&&(task.dependencies||[]).some(link=>link.kind!=='related'&&(!byId.has(link.taskId)||!resolved(byId.get(link.taskId))));
  const clockFormatters = new Map();
  function momentKey(now,timeZone) {
    if(!timeZone)return null;
    try {
      let formatter=clockFormatters.get(timeZone);
      if(!formatter){
        formatter=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
        if(clockFormatters.size>=32)clockFormatters.clear();
        clockFormatters.set(timeZone,formatter);
      }
      const parts=Object.fromEntries(formatter.formatToParts(new Date(now)).map(part=>[part.type,part.value]));
      return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
    } catch { return null; }
  }
  // Clock cues describe the timetable, never infer actual progress or completion.
  function timing(tasks,timeZone,now=Date.now()) {
    const local=momentKey(now,timeZone),current=[],next=[],followUp=[],labels=new Map();
    if(!local)return {local,current,next,followUp,labels};
    let nextStart='';
    for(const task of ordered(tasks)) {
      if(resolved(task)||waitingVerification(task))continue;
      const slot=task.schedule;
      if(slot.start>local){
        if(!nextStart)nextStart=slot.start;
        if(slot.start===nextStart){next.push(task);labels.set(task.id,'Next');}
      } else if(!slot.end){followUp.push(task);labels.set(task.id,'Start time reached · no end set');}
      else if(slot.end>local){current.push(task);labels.set(task.id,'Scheduled now');}
      else {followUp.push(task);labels.set(task.id,'Past scheduled end');}
    }
    return {local,current,next,followUp,labels};
  }

  // Every schedule uses the same event-local zone. Compare wall times directly;
  // converting them in the viewer's zone would change overlap results.
  function overlapsBy(tasks,keyFor) {
    const groups=new Map(),result=new Map();
    for(const task of ordered(tasks)) {
      const key=keyFor(task);
      if(!key||resolved(task))continue;
      const earlier=(groups.get(key)||[]).filter(other=>
        other.schedule.end?other.schedule.end>task.schedule.start:other.schedule.start===task.schedule.start);
      for(const other of earlier) {
        if(!result.has(task.id))result.set(task.id,[]);
        if(!result.has(other.id))result.set(other.id,[]);
        result.get(task.id).push(other);result.get(other.id).push(task);
      }
      earlier.push(task);groups.set(key,earlier);
    }
    return result;
  }
  const ownerOverlaps = tasks => overlapsBy(tasks,task=>task.owner);
  // Labels are not venue reservations. Match only the entered location, with
  // compatibility/case/whitespace normalization; never infer aliases or capacity.
  const locationOverlaps = tasks => overlapsBy(tasks,task=>typeof task.schedule.location==='string'?task.schedule.location.normalize('NFKC').trim().replace(/\s+/gu,' ').toLowerCase():'');

  // A review of saved facts, not a safety certification or a readiness score.
  // Unscheduled tasks are preparation; activity dates never imply completion.
  function reviewItems(state,now=Date.now(),scope={}) {
    const tasks=scoped(state.tasks,scope),open=tasks.filter(task=>!resolved(task));
    const byId=new Map(state.tasks.map(task=>[task.id,task]));
    const day=momentKey(now,state.event.timeZone)?.slice(0,10);
    const overlapIds=ownerOverlaps(tasks),locationIds=locationOverlaps(state.tasks);
    return [
      {key:'preparation',title:'Preparation still open',help:'Tasks without an activity time that are not complete or awaiting verification.',tasks:open.filter(task=>!task.schedule&&!waitingVerification(task))},
      {key:'verification',title:'Completion needs verification',help:'A completion report or completed record still needs the required organizer verification.',tasks:open.filter(waitingVerification)},
      {key:'changes',title:'Completion changes requested',help:'The organizer returned a completion report. Review the requested changes with the owner, then submit a new report; the work is not verified.',tasks:open.filter(changesRequested)},
      {key:'blocked',title:'Marked blocked',help:'Review the latest update with the owner; this review does not change task status.',tasks:open.filter(task=>task.status==='blocked'&&!waitingVerification(task))},
      {key:'unassigned',title:'No owner assigned',help:'Choose who will take responsibility for this work.',tasks:open.filter(task=>!task.owner)},
      {key:'owner-unavailable',title:'Assigned owner unavailable',help:'The assigned owner is missing or inactive in this project. Review who will take responsibility.',tasks:open.filter(task=>task.owner&&!state.members.some(member=>member.id===task.owner&&member.active!==false))},
      {key:'acceptance',title:'Owner acceptance not recorded',help:'An active owner is assigned, but acceptance or a completion report has not been recorded.',tasks:open.filter(task=>pendingAcceptance(task,state.members))},
      {key:'overdue',title:'Preparation deadline passed',help:'The entered due date is before today in the event time zone. Check the real progress.',tasks:day?open.filter(task=>task.dueDate&&task.dueDate<day&&!waitingVerification(task)):[]},
      {key:'prerequisites',title:'Required work not complete',help:'One or more required linked tasks are incomplete, awaiting verification, or unavailable. Related links do not block completion.',tasks:open.filter(task=>unfinishedRequiredWork(task,byId))},
      {key:'overlaps',title:'Activities with owner overlaps',help:'The same owner has overlapping entered activity times. Missing end times limit which overlaps can be detected.',tasks:open.filter(task=>overlapIds.has(task.id))},
      {key:'locations',title:'Potential location overlaps',help:'Matching location labels have overlapping entered times, including activities outside My tasks. A space may be shared or divisible; confirm with the organizer. Aliases, capacity, travel and external bookings are not checked. Missing ends limit detection.',tasks:open.filter(task=>locationIds.has(task.id))},
      {key:'activity-details',title:'Activity details not entered',help:'An activity has no end time or no activity location. These may be intentional; confirm what the team needs.',tasks:open.filter(task=>task.schedule&&(!task.schedule.end||!task.schedule.location))},
    ];
  }

  function create({h,options,person,statusBadge}) {
    function liveOwner(task,state) {
      return task.owner&&!state.members?.some(member=>member.id===task.owner)
        ? '<span class="person-chip">Assigned owner unavailable</span>' : person(task.owner);
    }
    // Use the same saved-fact predicates as Before event and the run sheet.
    // A clock cue is never a readiness decision or an automatic status change.
    function liveWarnings(task,state,byId) {
      if(resolved(task))return '';
      const labels=[];
      if(changesRequested(task))labels.push('Changes requested');
      if(state.members?.some(member=>member.id===task.owner&&member.active===false))labels.push('Assigned owner unavailable');
      if(pendingAcceptance(task,state.members||[]))labels.push('Acceptance not recorded');
      if(unfinishedRequiredWork(task,byId))labels.push('Required work not complete');
      return labels.length?`<span class="schedule-warnings">${labels.map(label=>`<span>${label}</span>`).join('')}</span>`:'';
    }
    function locationNotice(tasks,locations) {
      const count=tasks.filter(task=>locations.has(task.id)).length;
      return count?`<p class="schedule-overlap-summary">${count} ${count===1?'activity has a':'activities have'} potential location overlap. Matching location labels can include other teams outside this view. Confirm shared space with the organizer; this is not a booking check.</p>`:'';
    }
    function fields(schedule={}) {
      return `<div class="form-grid"><label class="field">Starts<input name="start" type="datetime-local" required step="60" value="${h(schedule.start||'')}"></label><label class="field">Ends (optional)<input name="end" type="datetime-local" step="60" value="${h(schedule.end||'')}"></label><label class="field full-width">Activity location (optional)<input name="location" maxlength="240" value="${h(schedule.location||'')}"></label></div>`;
    }
    function zone(event) {
      return `<p class="muted schedule-zone">All times: ${h(event.timeZone)}. Preparation deadlines are separate.</p>`;
    }
    function needsZone() {
      return '<p class="muted">Set the event time zone before adding activities.</p><button class="btn btn-secondary" data-action="event-context">Project settings</button>';
    }
    function clock(state,now=Date.now(),scope={}) {
      const tasks=scoped(state.tasks,scope),live=timing(tasks,state.event.timeZone,now),byId=new Map(state.tasks.map(task=>[task.id,task]));
      if(!live.local||!tasks.some(task=>task.schedule))return {markup:'',labels:live.labels};
      const verification=ordered(tasks).filter(waitingVerification);
      const group=(title,tasks,empty,followUp=false,verification=false)=>`<div class="schedule-focus-group"><h3>${title}</h3>${verification?'<p class="muted schedule-follow-up-help">Recorded completion still needs the required organizer verification. Open an activity to review its result; only the organizer can verify or request changes.</p>':''}${followUp?'<p class="muted schedule-follow-up-help">A scheduled time has passed, but these activities are not marked complete. Check with the owner before changing their status.</p>':''}${tasks.length?tasks.map(task=>`<button class="text-button schedule-focus-task" data-action="task" data-id="${h(task.id)}"><strong>${h(task.title)}</strong>${followUp?`<span class="schedule-focus-reason">${h(live.labels.get(task.id))}</span>`:''}<span class="muted">${task.schedule.start.slice(0,10)!==live.local.slice(0,10)?h(dateLabel(task.schedule.start))+' · ':''}${h(range(task.schedule))}</span>${task.schedule.location?`<span class="muted">${h(task.schedule.location)}</span>`:''}<span class="schedule-focus-meta">${liveOwner(task,state)}${waitingVerification(task)?'<span class="status-badge status-blocked">Awaiting verification</span>':statusBadge(task.status)}</span>${liveWarnings(task,state,byId)}</button>`).join(''):`<p class="muted">${empty}</p>`}</div>`;
      return {markup:`<div class="schedule-focus">${group('Scheduled now',live.current,'No current time slot')}${group('Next',live.next,'No upcoming activities')}${verification.length?`<div class="schedule-completion-review">${group('Completion awaiting verification · '+verification.length,verification,'',false,true)}</div>`:''}${live.followUp.length?`<div class="schedule-follow-up">${group('Check progress',live.followUp,'',true)}</div>`:''}</div>`,labels:live.labels};
    }
    function view(state,organizer,now=Date.now(),scope={}) {
      const tasks=ordered(scoped(state.tasks,scope)),dates=[...new Set(tasks.map(task=>task.schedule.start.slice(0,10)))],overlaps=ownerOverlaps(tasks),locations=locationOverlaps(state.tasks);
      const live=clock(state,now,scope),hasSchedule=state.tasks.some(task=>task.schedule),byId=new Map(state.tasks.map(task=>[task.id,task]));
      const filters=hasSchedule?`<div class="schedule-switch" role="group" aria-label="Activity scope"><button class="filter-tab ${scope.mine?'':'active'}" aria-pressed="${!scope.mine}" data-action="schedule-scope" data-id="all">All activities</button><button class="filter-tab ${scope.mine?'active':''}" aria-pressed="${!!scope.mine}" data-action="schedule-scope" data-id="mine">My activities</button></div>`:'';
      const empty=scope.mine&&hasSchedule?'<h2>No activities assigned to you</h2><button class="btn btn-secondary" data-action="schedule-scope" data-id="all">Show all activities</button>':`<h2>No scheduled activities</h2>${organizer?(state.event.timeZone?'<p class="muted">Add an activity or schedule an existing task.</p>':needsZone()):'<p class="muted">The organizer can add the event schedule here.</p>'}`;
      return `<section class="panel schedule-panel" aria-label="Event schedule">${filters}${state.event.timeZone?zone(state.event):''}<div data-schedule-clock>${live.markup}</div>${overlaps.size?`<p class="schedule-overlap-summary">${overlaps.size} activities have owner overlaps. Open an activity to review.</p>`:''}${locationNotice(tasks,locations)}${tasks.length?dates.map(date=>`<section class="schedule-day"><h2>${h(dateLabel(date))}</h2><div class="schedule-list">${tasks.filter(task=>task.schedule.start.startsWith(date)).map(task=>`<button class="schedule-row" data-action="task" data-id="${h(task.id)}"><span class="schedule-time">${h(range(task.schedule))}<span class="schedule-phase" data-schedule-phase="${h(task.id)}"${live.labels.has(task.id)?'':' hidden'}>${h(live.labels.get(task.id)||'')}</span></span><span class="schedule-activity"><strong>${h(task.title)}</strong>${task.schedule.location?`<span class="muted">${h(task.schedule.location)}</span>`:''}${overlaps.has(task.id)?'<span class="schedule-overlap-label">Owner overlap</span>':''}${locations.has(task.id)?'<span class="schedule-overlap-label">Potential location overlap</span>':''}</span><span class="schedule-owner">${liveOwner(task,state)}${waitingVerification(task)?'<span class="status-badge status-blocked">Awaiting verification</span>':statusBadge(task.status)}${liveWarnings(task,state,byId)}</span></button>`).join('')}</div></section>`).join(''):`<div class="schedule-empty">${empty}</div>`}</section>`;
    }
    function details(task,organizer,event,tasks=[]) {
      const current=task.schedule;
      const overlaps=ownerOverlaps(tasks).get(task.id)||[],locations=locationOverlaps(tasks).get(task.id)||[];
      const warning=overlaps.length?`<details class="schedule-overlap-details"><summary>Owner overlap · ${overlaps.length} ${overlaps.length===1?'activity':'activities'}</summary><p>The same owner is scheduled at overlapping times. ${organizer?'Review the times or choose another owner.':'Ask the organizer to review the times or owner.'}</p><ul>${overlaps.map(other=>`<li><button class="text-button" data-action="task" data-id="${h(other.id)}">${h(other.title)}</button><span class="muted">${h(dateLabel(other.schedule.start))} · ${h(range(other.schedule))}</span></li>`).join('')}</ul>${!current?.end||overlaps.some(other=>!other.schedule.end)?'<p class="muted">An end time is missing. Only overlaps known from the entered times are shown.</p>':''}</details>`:'';
      const locationWarning=locations.length?`<details class="schedule-overlap-details"><summary>Potential location overlap · ${locations.length} ${locations.length===1?'activity':'activities'}</summary><p>Matching location labels have overlapping entered times. The space may be shared or divisible. ${organizer?'Confirm whether these activities can share the space, or edit the times or activity location.':'Ask the organizer to confirm shared space, times or activity locations.'}</p><ul>${locations.map(other=>`<li><button class="text-button" data-action="task" data-id="${h(other.id)}">${h(other.title)}</button><span class="muted">${h(other.schedule.location)} · ${h(dateLabel(other.schedule.start))} · ${h(range(other.schedule))}</span></li>`).join('')}</ul><p class="muted">Only matching labels are checked, ignoring case and extra spaces. Different room names, capacity, travel and external bookings are not checked.</p>${!current?.end||locations.some(other=>!other.schedule.end)?'<p class="muted">An end time is missing. Only overlaps known from the entered times are shown.</p>':''}</details>`:'';
      const facts=current?`<section class="schedule-facts"><h3>Scheduled activity</h3><p>${h(dateLabel(current.start))} · ${h(range(current))}</p><p class="muted">${h(event.timeZone)}${current.location?' · '+h(current.location):''}</p>${warning}${locationWarning}</section>`:'';
      return facts+(organizer?`<details class="task-schedule task-organizer section-gap"><summary>${current?'Edit schedule':'Add to event schedule'}</summary>${event.timeZone?`<form id="scheduleForm" data-id="${h(task.id)}" class="section-gap">${zone(event)}${fields(current||{})}<div class="form-actions"><button class="btn btn-secondary" type="submit" value="save">Save schedule</button>${current?'<button class="text-button" type="submit" value="remove" formnovalidate>Remove from schedule</button>':''}</div></form>`:needsZone()}</details>`:'');
    }
    function picker(state) {
      if(!state.event.timeZone)return needsZone();
      const available=state.tasks.filter(task=>!task.schedule);
      if(!available.length)return '<p>All existing tasks are scheduled.</p><button class="btn btn-primary" data-action="add-activity">Add activity</button>';
      return `<form id="schedulePickerForm">${zone(state.event)}<label class="field">Existing task<select name="taskId" required>${options([['','Choose a task'],...available.map(task=>[task.id,task.title])],'')}</select></label>${fields()}<div class="form-actions"><button class="btn btn-primary" type="submit">Add to schedule</button></div></form>`;
    }
    function preparationReview(state,now=Date.now(),scope={}) {
      const groups=reviewItems(state,now,scope),tasks=scoped(state.tasks,scope);
      const local=momentKey(now,state.event.timeZone);
      const name=id=>state.members.find(member=>member.id===id)?.name||'Unassigned';
      const scopeLabel=scope.mine?'My tasks · '+name(scope.actor):'All tasks';
      const context=[!state.event.date?'Event date not entered':'Event date: '+dateLabel(state.event.date),
        !local?'Event time zone not set or unavailable':'Event time zone: '+state.event.timeZone,
        !state.event.location?'Event location not entered':'Event location: '+state.event.location];
      return `<article class="before-event-review"><p class="eyebrow">${h(scopeLabel)}</p><h3>${h(state.event.name||'Untitled event')}</h3><p>Snapshot: ${h(local?local.replace('T',' · ')+' · '+state.event.timeZone:new Date(now).toISOString()+' · UTC')}. Reopen this review to refresh it.</p><p>This checks saved planning facts only. It does not certify safety, approvals, bookings or event readiness. Tasks can appear in more than one section. No task is changed and no message is sent.</p><section aria-label="Saved event details"><h3>Event details</h3><ul>${context.map(fact=>`<li>${h(fact)}</li>`).join('')}</ul><button class="text-button" data-action="event-context">Review event details</button></section>${!tasks.length?`<p class="notice">${scope.mine?'No tasks assigned to you. This does not mean the whole event is ready.':'No tasks in this plan yet. Build a plan or add the work your event needs.'}</p>`:''}<p class="muted">${tasks.filter(task=>task.schedule).length} scheduled activities in this scope. Unscheduled tasks appear as preparation; not every task needs an activity time.</p>${groups.map(group=>`<details class="before-event-group"${group.tasks.length&&group.tasks.length<=3?' open':''}><summary>${h(group.title)} · ${group.tasks.length}</summary><p class="muted">${h(group.help)}</p>${group.tasks.length?`<ul>${group.tasks.map(task=>`<li><button class="text-button" data-action="task" data-id="${h(task.id)}">${h(task.title)}</button><span>${h(name(task.owner))}${task.owner&&!state.members.some(member=>member.id===task.owner&&member.active!==false)?' · owner unavailable':''}${task.dueDate?' · Due '+h(dateLabel(task.dueDate)):''}</span></li>`).join('')}</ul>`:'<p class="muted">None found in the saved plan.</p>'}</details>`).join('')}</article>`;
    }
    function runSheet(state,now=Date.now(),scope={}) {
      const tasks=ordered(scoped(state.tasks,scope)),overlaps=ownerOverlaps(tasks),locations=locationOverlaps(state.tasks);
      const dates=[...new Set(tasks.map(task=>task.schedule.start.slice(0,10)))];
      const name=id=>{
        if(!id)return 'Unassigned';
        const owner=state.members.find(member=>member.id===id);
        return owner?owner.name+(owner.active===false?' · Inactive teammate':''):'Assigned owner unavailable';
      };
      const unavailable=tasks.filter(task=>task.owner&&!resolved(task)&&!state.members.some(member=>member.id===task.owner&&member.active!==false)).length;
      const ownerNotice=unavailable?'<p class="notice">'+unavailable+' '+(unavailable===1?'activity has':'activities have')+' a missing or inactive assigned owner. Confirm responsibility with the organizer; this snapshot does not reassign work.</p>':'';
      const byId=new Map(state.tasks.map(task=>[task.id,task]));
      const prerequisites=new Set(tasks.filter(task=>unfinishedRequiredWork(task,byId)).map(task=>task.id));
      const prerequisiteNotice=prerequisites.size?'<p class="notice">'+prerequisites.size+' '+(prerequisites.size===1?'activity has':'activities have')+' unfinished required work. Required linked tasks are incomplete, awaiting verification or unavailable. Confirm the current plan with the organizer; this snapshot does not certify event readiness.</p>':'';
      const acceptance=new Set(tasks.filter(task=>pendingAcceptance(task,state.members)).map(task=>task.id));
      const acceptanceNotice=acceptance.size?'<p class="notice">'+acceptance.size+' '+(acceptance.size===1?'activity has':'activities have')+' owner acceptance not recorded. Assignment alone does not confirm responsibility. Check with the owner; this snapshot does not accept work for them.</p>':'';
      const changes=new Set(tasks.filter(changesRequested).map(task=>task.id));
      const changesNotice=changes.size?'<p class="notice">'+changes.size+' '+(changes.size===1?'activity has':'activities have')+' completion changes requested. Review the task with the owner before resubmitting. Review notes are not included in this copy; the work is not verified.</p>':'';
      const local=momentKey(now,state.event.timeZone);
      const timestamp=local?local.replace('T',' · ')+' · '+state.event.timeZone:new Date(now).toISOString()+' · UTC';
      const title=state.event.name||'Untitled event',scopeLabel=scope.mine?'My activities · '+name(scope.actor):'All activities';
      const status=task=>task.requiresVerification&&!task.verifiedAt&&(task.reportedAt||task.status==='done')?'Awaiting verification':({todo:'To do',progress:'In progress',blocked:'Blocked',done:'Done'})[task.status]||'Unknown';
      // Deliberately project only schedule facts. Never serialize the workspace,
      // notes, comments, guest records, email, files or private booking details.
      return `<article id="eventRunSheet" class="event-run-sheet"><header><p class="eyebrow">EVENT RUN SHEET</p><h2>${h(title)}</h2><p>${h(scopeLabel)}</p><p>All activity times: ${h(state.event.timeZone||'Time zone not set')}</p><p class="run-sheet-snapshot">Snapshot: ${h(timestamp)}. This copy is not live. Confirm changes with your team; scheduled times never mark work complete.</p><p class="muted">Team-only schedule facts. Private bookings, guest records and task notes are not included. Share printed or saved copies only with the people who need them; downloaded copies cannot be recalled.</p></header>${ownerNotice}${acceptanceNotice}${prerequisiteNotice}${changesNotice}${overlaps.size?`<p class="notice">${overlaps.size} activities have owner overlaps. Review these with the organizer.</p>`:''}${locationNotice(tasks,locations)}${dates.map(date=>`<div class="run-sheet-table-wrap"><table class="run-sheet-table"><caption>${h(dateLabel(date))}</caption><thead><tr class="run-sheet-repeat-heading"><th colspan="4">${h(title)} · ${h(dateLabel(date))}<span>${h(scopeLabel)} · Snapshot: ${h(timestamp)}</span></th></tr><tr><th scope="col">Time</th><th scope="col">Activity / location</th><th scope="col">Owner</th><th scope="col">Status at snapshot</th></tr></thead><tbody>${tasks.filter(task=>task.schedule.start.startsWith(date)).map(task=>`<tr><td data-label="Time">${h(range(task.schedule))}${!task.schedule.end?'<span>No end time set</span>':''}</td><th scope="row">${h(task.title)}${task.schedule.location?`<span>${h(task.schedule.location)}</span>`:''}${overlaps.has(task.id)?'<span>Owner overlap</span>':''}${locations.has(task.id)?'<span>Potential location overlap</span>':''}</th><td data-label="Owner">${h(name(task.owner))}${acceptance.has(task.id)?'<span>Acceptance not recorded</span>':''}</td><td data-label="Status at snapshot">${h(status(task))}${changes.has(task.id)?'<span>Changes requested</span>':''}${prerequisites.has(task.id)?'<span>Required work not complete</span>':''}</td></tr>`).join('')}</tbody></table></div>`).join('')||'<p>No scheduled activities in this view.</p>'}</article>`;
    }
    function newActivity(state) {
      if(!state.event.timeZone)return needsZone();
      return `<form id="newTaskForm" data-scheduled="true"><div class="form-grid"><label class="field full-width">Activity name<input name="title" required maxlength="180" placeholder="e.g. Guest check-in"></label><label class="field full-width">Owner<select name="owner">${options([['','Unassigned'],...state.members.filter(member=>member.active!==false).map(member=>[member.id,member.name])],'')}</select></label><div data-owner-load class="full-width"></div></div>${zone(state.event)}${fields()}<label class="field section-gap">Instructions (optional)<textarea name="note" rows="3" maxlength="3000"></textarea></label><input name="category" type="hidden" value="Program"><input name="status" type="hidden" value="todo"><div class="form-actions"><button class="btn btn-primary" type="submit">Add activity</button></div></form>`;
    }
    return {view,details,picker,newActivity,clock,runSheet,preparationReview};
  }
  root.GatherScheduleUI={create,ordered,range,dateLabel,ownerOverlaps,locationOverlaps,timing,momentKey,reviewItems};
})(typeof window!=='undefined'?window:globalThis);
