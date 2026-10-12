(function(root) {
  'use strict';
  // These are event-local wall times, not instants in the viewer's browser zone.
  const dateLabel = value => new Date(value.slice(0,10)+'T12:00:00Z').toLocaleDateString(undefined,{timeZone:'UTC',weekday:'short',month:'short',day:'numeric',year:'numeric'});
  const timeLabel = value => new Date(value+'Z').toLocaleTimeString(undefined,{timeZone:'UTC',hour:'numeric',minute:'2-digit'});
  const range = schedule => timeLabel(schedule.start)+(schedule.end ? ' – '+(schedule.end.slice(0,10)!==schedule.start.slice(0,10)?dateLabel(schedule.end)+' · ':'')+timeLabel(schedule.end) : '');
  const ordered = tasks => tasks.filter(task=>task.schedule).slice().sort((a,b)=>a.schedule.start.localeCompare(b.schedule.start)||a.id.localeCompare(b.id));

  // Every schedule uses the same event-local zone. Compare wall times directly;
  // converting them in the viewer's zone would change overlap results.
  function ownerOverlaps(tasks) {
    const byOwner=new Map(),result=new Map();
    for(const task of ordered(tasks)) {
      if(!task.owner||task.status==='done'&&(!task.requiresVerification||task.verifiedAt))continue;
      const earlier=(byOwner.get(task.owner)||[]).filter(other=>
        other.schedule.end?other.schedule.end>task.schedule.start:other.schedule.start===task.schedule.start);
      for(const other of earlier) {
        if(!result.has(task.id))result.set(task.id,[]);
        if(!result.has(other.id))result.set(other.id,[]);
        result.get(task.id).push(other);result.get(other.id).push(task);
      }
      earlier.push(task);byOwner.set(task.owner,earlier);
    }
    return result;
  }

  function create({h,options,person,statusBadge}) {
    function fields(schedule={}) {
      return `<div class="form-grid"><label class="field">Starts<input name="start" type="datetime-local" required step="60" value="${h(schedule.start||'')}"></label><label class="field">Ends (optional)<input name="end" type="datetime-local" step="60" value="${h(schedule.end||'')}"></label><label class="field full-width">Activity location (optional)<input name="location" maxlength="240" value="${h(schedule.location||'')}"></label></div>`;
    }
    function zone(event) {
      return `<p class="muted schedule-zone">All times: ${h(event.timeZone)}. Preparation deadlines are separate.</p>`;
    }
    function needsZone() {
      return '<p class="muted">Set the event time zone before adding activities.</p><button class="btn btn-secondary" data-action="event-context">Project settings</button>';
    }
    function view(state,organizer) {
      const tasks=ordered(state.tasks),dates=[...new Set(tasks.map(task=>task.schedule.start.slice(0,10)))],overlaps=ownerOverlaps(tasks);
      return `<section class="panel schedule-panel" aria-label="Event schedule">${state.event.timeZone?zone(state.event):''}${overlaps.size?`<p class="schedule-overlap-summary">${overlaps.size} activities have owner overlaps. Open an activity to review.</p>`:''}${tasks.length?dates.map(date=>`<section class="schedule-day"><h2>${h(dateLabel(date))}</h2><div class="schedule-list">${tasks.filter(task=>task.schedule.start.startsWith(date)).map(task=>`<button class="schedule-row" data-action="task" data-id="${h(task.id)}"><span class="schedule-time">${h(range(task.schedule))}</span><span class="schedule-activity"><strong>${h(task.title)}</strong>${task.schedule.location?`<span class="muted">${h(task.schedule.location)}</span>`:''}${overlaps.has(task.id)?'<span class="schedule-overlap-label">Owner overlap</span>':''}</span><span class="schedule-owner">${person(task.owner)}${task.requiresVerification&&task.reportedAt&&!task.verifiedAt?'<span class="status-badge status-blocked">Awaiting verification</span>':statusBadge(task.status)}</span></button>`).join('')}</div></section>`).join(''):`<div class="schedule-empty"><h2>No scheduled activities</h2>${organizer?(state.event.timeZone?'<p class="muted">Add an activity or schedule an existing task.</p>':needsZone()):'<p class="muted">The organizer can add the event schedule here.</p>'}</div>`}</section>`;
    }
    function details(task,organizer,event,tasks=[]) {
      const current=task.schedule;
      const overlaps=ownerOverlaps(tasks).get(task.id)||[];
      const warning=overlaps.length?`<details class="schedule-overlap-details"><summary>Owner overlap · ${overlaps.length} ${overlaps.length===1?'activity':'activities'}</summary><p>The same owner is scheduled at overlapping times. ${organizer?'Review the times or choose another owner.':'Ask the organizer to review the times or owner.'}</p><ul>${overlaps.map(other=>`<li><button class="text-button" data-action="task" data-id="${h(other.id)}">${h(other.title)}</button><span class="muted">${h(dateLabel(other.schedule.start))} · ${h(range(other.schedule))}</span></li>`).join('')}</ul>${!current?.end||overlaps.some(other=>!other.schedule.end)?'<p class="muted">An end time is missing. Only overlaps known from the entered times are shown.</p>':''}</details>`:'';
      const facts=current?`<section class="schedule-facts"><h3>Scheduled activity</h3><p>${h(dateLabel(current.start))} · ${h(range(current))}</p><p class="muted">${h(event.timeZone)}${current.location?' · '+h(current.location):''}</p>${warning}</section>`:'';
      return facts+(organizer?`<details class="task-schedule task-organizer section-gap"><summary>${current?'Edit schedule':'Add to event schedule'}</summary>${event.timeZone?`<form id="scheduleForm" data-id="${h(task.id)}" class="section-gap">${zone(event)}${fields(current||{})}<div class="form-actions"><button class="btn btn-secondary" type="submit" value="save">Save schedule</button>${current?'<button class="text-button" type="submit" value="remove" formnovalidate>Remove from schedule</button>':''}</div></form>`:needsZone()}</details>`:'');
    }
    function picker(state) {
      if(!state.event.timeZone)return needsZone();
      const available=state.tasks.filter(task=>!task.schedule);
      if(!available.length)return '<p>All existing tasks are scheduled.</p><button class="btn btn-primary" data-action="add-activity">Add activity</button>';
      return `<form id="schedulePickerForm">${zone(state.event)}<label class="field">Existing task<select name="taskId" required>${options([['','Choose a task'],...available.map(task=>[task.id,task.title])],'')}</select></label>${fields()}<div class="form-actions"><button class="btn btn-primary" type="submit">Add to schedule</button></div></form>`;
    }
    function newActivity(state) {
      if(!state.event.timeZone)return needsZone();
      return `<form id="newTaskForm" data-scheduled="true"><div class="form-grid"><label class="field full-width">Activity name<input name="title" required maxlength="180" placeholder="e.g. Guest check-in"></label><label class="field full-width">Owner<select name="owner">${options([['','Unassigned'],...state.members.filter(member=>member.active!==false).map(member=>[member.id,member.name])],'')}</select></label><div data-owner-load class="full-width"></div></div>${zone(state.event)}${fields()}<label class="field section-gap">Instructions (optional)<textarea name="note" rows="3" maxlength="3000"></textarea></label><input name="category" type="hidden" value="Program"><input name="status" type="hidden" value="todo"><div class="form-actions"><button class="btn btn-primary" type="submit">Add activity</button></div></form>`;
    }
    return {view,details,picker,newActivity};
  }
  root.GatherScheduleUI={create,ordered,range,dateLabel,ownerOverlaps};
})(typeof window!=='undefined'?window:globalThis);
