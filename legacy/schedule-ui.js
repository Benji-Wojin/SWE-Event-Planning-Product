(function(root) {
  'use strict';
  // These are event-local wall times, not instants in the viewer's browser zone.
  const dateLabel = value => new Date(value.slice(0,10)+'T12:00:00Z').toLocaleDateString(undefined,{timeZone:'UTC',weekday:'short',month:'short',day:'numeric',year:'numeric'});
  const timeLabel = value => new Date(value+'Z').toLocaleTimeString(undefined,{timeZone:'UTC',hour:'numeric',minute:'2-digit'});
  const range = schedule => timeLabel(schedule.start)+(schedule.end ? ' – '+(schedule.end.slice(0,10)!==schedule.start.slice(0,10)?dateLabel(schedule.end)+' · ':'')+timeLabel(schedule.end) : '');
  // Operational views leave archived rows out, but dependency lookups still
  // use the full saved plan: an archived prerequisite is unavailable.
  const active = task => !task.archivedAt;
  const scheduled = task => active(task)&&!!task.schedule;
  const ordered = tasks => tasks.filter(scheduled).sort((a,b)=>a.schedule.start.localeCompare(b.schedule.start)||a.id.localeCompare(b.id));
  const scoped = (tasks,scope={}) => tasks.filter(task=>active(task)&&(!scope.mine||!!scope.actor&&task.owner===scope.actor));
  function selectedDate(scope) {
    const day=scope.date;
    if(typeof day!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(day)||day.startsWith('0000-'))return '';
    const utc=new Date(day+'T00:00:00Z');
    return Number.isFinite(utc.getTime())&&utc.toISOString().slice(0,10)===day?day:'';
  }
  const onDate = (task,day) => !day||Boolean(task.schedule&&(
    task.schedule.start.startsWith(day)||
    task.schedule.start<day+'T00:00'&&task.schedule.end>day+'T00:00'));
  function activityVisibility(task,scope) {
    return {outsideDate:!onDate(task,selectedDate(scope)),outsideMine:!!scope.mine&&task.owner!==scope.actor};
  }
  function scheduledTimelineDay(task) {
    const start=task?.schedule?.start;
    if(task?.archivedAt||typeof start!=='string'||
      !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(start))return '';
    // Retain navigation to legacy ambiguous wall times so the existing
    // schedule warning can be read. No browser time-zone conversion.
    return selectedDate({date:start.slice(0,10)});
  }
  function personalTimelineDay(task,actor) {
    return actor&&task?.owner===actor?scheduledTimelineDay(task):'';
  }
  function pendingReconfirmation(task,actor) {
    const change=task?.scheduleReconfirmation;
    return !!(change&&actor&&change.owner===actor&&task.owner===actor&&!task.acceptedAt&&
      !task.reportedAt&&!task.verifiedAt&&!task.archivedAt&&task.status!=='done');
  }
  function guestAgendaSnapshot(state,scope={}) {
    const date=selectedDate(scope);
    const candidates=ordered(scoped(state.tasks,scope).filter(task=>onDate(task,date)));
    const activities=candidates.filter(task=>!wallTimeIssue(task,state.event.timeZone));
    return {date,mine:!!scope.mine,timeZone:state.event.timeZone,
      ...(activities.length<candidates.length?{invalidTimes:candidates.length-activities.length}:{}),
      activities:activities.map(task=>({title:task.title,start:task.schedule.start,end:task.schedule.end}))};
  }
  const agendaText = value => typeof value==='string' ? value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g,' ').trim().slice(0,180) : '';
  const agendaTime = slot => slot.start.replace('T',' ') + (slot.end ? ' – ' +
    (slot.end.slice(0,10)===slot.start.slice(0,10)?slot.end.slice(11):slot.end.replace('T',' ')) : '');
  function guestAgenda(snapshot,title,choices) {
    const heading=agendaText(title);
    if(!heading)return '';
    const items=snapshot.activities.flatMap((slot,index)=>{
      const choice=choices[index];
      if(!choice?.included)return [];
      const title=agendaText(choice.title),location=agendaText(choice.location);
      return title?[agendaTime(slot)+' · '+title+(location?' · '+location:'')]:[null];
    });
    if(!items.length||items.some(item=>item===null))return '';
    return [heading,'Times: '+agendaText(snapshot.timeZone), '', ...items].join('\n');
  }
  // UTC here is only calendar arithmetic; these strings represent event wall dates.
  function stepDate(day,step) {
    const date=new Date(day+'T12:00:00Z');
    date.setUTCDate(date.getUTCDate()+step);
    return selectedDate({date:date.toISOString().slice(0,10)});
  }
  function lastActivityDate(task) {
    const end=task.schedule.end?.slice(0,10);
    return !end?task.schedule.start.slice(0,10):onDate(task,end)?end:stepDate(end,-1);
  }
  // Include starts and both ends of a multi-day carryover without expanding
  // arbitrary date ranges. Every activity still appears on any selected day
  // that it overlaps, including days that have no All dates heading.
  function activityDateGroups(tasks,day) {
    if(day)return [{date:day,tasks}];
    const dates=new Set(),windows=tasks.map(task=>{
      const start=task.schedule.start.slice(0,10),last=lastActivityDate(task);
      dates.add(start);
      if(last>start){dates.add(stepDate(start,1));dates.add(last);}
      return {task,start,last};
    });
    let next=0,active=[];
    return [...dates].sort().map(date=>{
      active=active.filter(window=>window.last>=date);
      while(next<windows.length&&windows[next].start<=date)active.push(windows[next++]);
      return {date,tasks:active.map(window=>window.task)};
    });
  }
  function activityDays(state,now=Date.now(),scope={}) {
    const day=selectedDate(scope);
    const prior=day?stepDate(day,-1):'',later=day?stepDate(day,1):'';
    let first='',previous='',next='';
    // Intersect each activity's occupied dates with the two search directions.
    // Never generate all intervening dates, even for a years-long activity.
    for(const task of scoped(state.tasks,scope)){
      const {schedule}=task;
      if(!schedule)continue;
      const start=schedule.start.slice(0,10);
      if(!first||start<first)first=start;
      if(!day)continue;
      const end=lastActivityDate(task);
      if(prior&&start<=prior){
        const candidate=end<prior?end:prior;
        if(candidate>previous)previous=candidate;
      }
      if(later&&end>=later){
        const candidate=start>later?start:later;
        if(!next||candidate<next)next=candidate;
      }
    }
    const today=first?selectedDate({date:momentKey(now,state.event.timeZone)?.slice(0,10)}):'';
    return {first:day?'':first,previous,next,today};
  }
  const activityDayLabels={first:'First activity day',previous:'Previous activity day',next:'Next activity day',today:'Today'};
  const resolved = task => task.status==='done'&&(!task.requiresVerification||task.verifiedAt);
  const needsActivityTime = task => active(task)&&task.eventActivity===true&&!task.schedule&&!resolved(task);
  const noActivityEnd='No end time set',noActivityLocation='Location not set';
  const activityLocation = slot => typeof slot.location==='string'?slot.location.trim():'';
  const needsActivityDetails = task => scheduled(task)&&!resolved(task)&&(!task.schedule.end||!activityLocation(task.schedule));
  const scheduledInScope = (tasks,scope) => ordered(scoped(tasks,scope).filter(task=>onDate(task,selectedDate(scope))));
  const assignmentGroup = key => key==='unassigned'||key==='owner-unavailable';
  const canReviewAssignment = task => active(task)&&task.status!=='done'&&!task.reportedAt&&!task.verifiedAt;
  const activeMember = member => member.active!==false;
  const assignmentIssue = (task,members,assignable=activeMember) => !task.owner?'unassigned':
    members.some(member=>member.id===task.owner&&assignable(member))?'':'owner-unavailable';
  function scheduleOwnerLabel(id,members=[],assignable=activeMember) {
    if(!id)return 'Unassigned';
    const owner=members.find(member=>member.id===id);
    return owner?owner.name+(owner.active===false?' · Inactive teammate':!assignable(owner)?' · Example only · unavailable owner':''):'Assigned owner unavailable';
  }
  function newActivityTask({title,owner,note,start='',end='',location=''}) {
    if(!start&&(end||location.trim()))throw new Error('Enter a start time to save an end time or activity location, or clear those fields to set the time later.');
    return {title,owner,note,category:'Program',status:'todo',eventActivity:true,
      ...(start?{schedule:{start,end,location}}:{})};
  }
  const waitingVerification = task => task.requiresVerification&&(task.reportedAt||task.status==='done')&&!task.verifiedAt;
  const planRequestKind = task => {
    if(task.status==='done'||waitingVerification(task))return '';
    const request=(task.recoveryRequests||[]).find(item=>item.status==='pending');
    return request?.kind==='help'||request?.kind==='date'?request.kind:'';
  };
  const planRequestLabels={help:'Help requested · awaiting organizer',date:'Date proposed · awaiting organizer'};
  // Match the active review shown in Completion details, not historical comments.
  const evidenceAmended = task => Boolean(task.verifiedAt&&task.completionEvidence&&task.completionEvidenceReviewAt!==task.verifiedAt);
  // Historical Done records without a report are visible, but have no pending
  // decision in the organizer queue. Keep those on the normal task route.
  function organizerReviewKind(task,kind,organizer) {
    if(!organizer)return '';
    if(kind==='completion'&&task.reportedAt&&waitingVerification(task))return kind;
    if(kind==='amendment'&&task.status==='done'&&evidenceAmended(task))return kind;
    if((kind==='help'||kind==='date')&&planRequestKind(task)===kind)return kind;
    return '';
  }
  const changesRequested = task => task.status!=='done'&&!task.reportedAt&&Boolean(task.completionReview);
  const canOpenOverlap = task => !waitingVerification(task)&&!evidenceAmended(task)&&!changesRequested(task)&&!planRequestKind(task);
  const pendingAcceptance = (task,members,assignable=activeMember) => !resolved(task)&&task.owner&&members.some(member=>member.id===task.owner&&assignable(member))&&!task.acceptedAt&&!task.reportedAt&&!waitingVerification(task);
  const awaitingScheduleAcceptance = (task,members,assignable=activeMember) => pendingReconfirmation(task,task.owner)&&pendingAcceptance(task,members,assignable);
  const scheduleAcceptanceCue = 'Schedule changed · owner needs to accept again';
  const requiredResultReady = task => !!task&&!task.archivedAt&&resolved(task);
  function requiredWorkState(link,byId) {
    if(link.kind==='related')return '';
    const target=byId.get(link.taskId);
    if(!target||target.archivedAt)return 'unavailable';
    if(requiredResultReady(target))return '';
    return waitingVerification(target)?'verification':'open';
  }
  const unfinishedRequiredWork = (task,byId) => !resolved(task)&&(task.dependencies||[]).some(link=>requiredWorkState(link,byId));
  function requiredWorkSummary(task,byId) {
    const counts={open:0,verification:0,unavailable:0};
    for(const link of task.dependencies||[]){
      const state=requiredWorkState(link,byId);
      if(state)counts[state]++;
    }
    return [counts.open&&counts.open+' still open',counts.verification&&counts.verification+' awaiting verification',
      counts.unavailable&&counts.unavailable+' unavailable'].filter(Boolean).join(' · ');
  }
  function linkedResultsReady(task,byId) {
    if(!task||task.archivedAt||task.status!=='blocked'||waitingVerification(task))return false;
    const required=(task.dependencies||[]).filter(link=>link.kind!=='related');
    return required.length>0&&required.every(link=>requiredResultReady(byId.get(link.taskId)));
  }
  const wallTimeIssue=(task,zone)=>zone&&root.GatherCalendar?.scheduleTimeIssue(task.schedule,zone);
  const usableWallTimes=(tasks,zone)=>tasks.filter(task=>active(task)&&!wallTimeIssue(task,zone));
  const wallTimeWarning=(task,zone,nextStep)=>{
    const issue=wallTimeIssue(task,zone);
    return issue?root.GatherCalendar.scheduleTimeMessage(issue,zone,nextStep):'';
  };
  function activitySummary(task,zone) {
    const slot=task.schedule;
    if (!slot?.start) return task.eventActivity===true
      ? {timing:'Start time not set',location:'',warning:''}
      : null;
    return {
      timing:[dateLabel(slot.start),range(slot),zone||'Time zone not set',slot.end?'':noActivityEnd].filter(Boolean).join(' · '),
      location:activityLocation(slot)||noActivityLocation,
      warning:wallTimeWarning(task,zone,'Confirm the time with the organizer before relying on it.'),
    };
  }
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
      if(wallTimeIssue(task,timeZone))continue;
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
  const overlapsOnDay=(matches,task,date)=>matches.get(task.id)?.some(other=>onDate(other,date));
  function scheduleOverlaps(state,tasks,day) {
    const zone=state.event.timeZone;
    return {overlaps:ownerOverlaps(usableWallTimes(tasks,zone)),
      locations:locationOverlaps(usableWallTimes(state.tasks.filter(task=>onDate(task,day)),zone))};
  }
  const overlapKinds=(matches,task,date)=>[
    overlapsOnDay(matches.overlaps,task,date)?'owner':'',
    overlapsOnDay(matches.locations,task,date)?'location':'',
  ].filter(Boolean);
  const overlapKind = kinds => kinds.length===2?'both':kinds[0]||'';
  const overlapLabel = {owner:'Owner overlap',location:'Potential location overlap'};
  const overlapLabels=(matches,task,date)=>overlapKinds(matches,task,date).map(kind=>overlapLabel[kind]);
  function overlapKindForDay(state,id,day,scope={}) {
    const date=selectedDate({date:day});
    if(!date||(scope.date&&selectedDate(scope)!==date))return '';
    const tasks=scoped(state.tasks,scope).filter(task=>onDate(task,date));
    const task=tasks.find(item=>item.id===id);
    return task&&canOpenOverlap(task)?overlapKind(overlapKinds(scheduleOverlaps(state,tasks,date),task,date)):'';
  }
  function overlapPairIsCurrent(state,originId,peerId,kind) {
    if(originId===peerId||!['owner','location'].includes(kind))return false;
    const tasks=usableWallTimes(state.tasks.filter(task=>task.schedule&&(task.id===originId||task.id===peerId)),state.event.timeZone);
    if(tasks.length!==2)return false;
    const matches=kind==='owner'?ownerOverlaps(tasks):locationOverlaps(tasks);
    return !!matches.get(originId)?.some(item=>item.id===peerId);
  }

  // A review of saved facts, not a safety certification or a readiness score.
  // Explicitly planned activities retain their intent before a time is set.
  function reviewItems(state,now=Date.now(),scope={},assignable=activeMember) {
    const tasks=scoped(state.tasks,scope),open=tasks.filter(task=>!resolved(task));
    const byId=new Map(state.tasks.map(task=>[task.id,task]));
    const requiredSummaries=new Map(),needsRequiredWork=[];
    for(const task of open){
      const summary=requiredWorkSummary(task,byId);
      if(!summary)continue;
      requiredSummaries.set(task.id,summary);
      needsRequiredWork.push(task);
    }
    const day=momentKey(now,state.event.timeZone)?.slice(0,10);
    const overlapIds=ownerOverlaps(usableWallTimes(tasks,state.event.timeZone)),locationIds=locationOverlaps(usableWallTimes(state.tasks,state.event.timeZone));
    return [
      {key:'clock-times',title:'Activity times need correction',help:'These saved times do not identify a single time in the event time zone. Open the task to review and correct its schedule. Until corrected, they do not appear as Scheduled now, Next, or Check progress.',tasks:tasks.filter(task=>wallTimeIssue(task,state.event.timeZone))},
      {key:'activity-time',title:'Activities need a start time',help:'These planned activities are not on the schedule or run sheet yet. Open the task or visit Timeline to coordinate a start time.',tasks:open.filter(needsActivityTime)},
      {key:'preparation',title:'Preparation still open',help:'Open preparation tasks that are not awaiting verification.',tasks:open.filter(task=>!task.schedule&&task.eventActivity!==true&&!waitingVerification(task))},
      {key:'verification',title:'Completion needs verification',help:'A completion report or completed record still needs the required organizer verification.',tasks:open.filter(waitingVerification)},
      {key:'evidence-amendments',title:'Evidence amended after verification',help:'The current completion submission was edited after verification and has not been reviewed. Task verification is unchanged. Open the task to review the amendment with the organizer.',tasks:tasks.filter(evidenceAmended)},
      {key:'changes',title:'Completion changes requested',help:'The organizer returned a completion report. Review the requested changes with the owner, then submit a new report; the work is not verified.',tasks:open.filter(changesRequested)},
      {key:'plan-requests',title:'Plan requests awaiting review',help:'A teammate asked for help or proposed a different preparation deadline. These requests do not change the saved plan or activity times.',tasks:open.filter(planRequestKind)},
      {key:'linked-results',title:'Review linked results',help:'Required linked work is complete. Open the task to review its results and check for other blockers. Its status stays Blocked until someone resumes it or updates it explicitly.',tasks:open.filter(task=>linkedResultsReady(task,byId))},
      {key:'blocked',title:'Marked blocked',help:'Review the latest update with the owner; this review does not change task status.',tasks:open.filter(task=>task.status==='blocked'&&!waitingVerification(task)&&!linkedResultsReady(task,byId))},
      {key:'unassigned',title:'No owner assigned',help:'Choose who will take responsibility for this work.',tasks:open.filter(task=>assignmentIssue(task,state.members,assignable)==='unassigned')},
      {key:'owner-unavailable',title:'Assigned owner unavailable',help:'The assigned owner cannot accept tasks in this project. Review who will take responsibility.',tasks:open.filter(task=>assignmentIssue(task,state.members,assignable)==='owner-unavailable')},
      {key:'schedule-reconfirmation',title:'Schedule changes awaiting owner acceptance',help:'An earlier acceptance was cleared when the schedule changed. Ask the assigned owner to review the current plan and accept again. This does not change progress.',tasks:open.filter(task=>awaitingScheduleAcceptance(task,state.members,assignable))},
      {key:'acceptance',title:'Owner acceptance not recorded',help:'An active owner is assigned, but acceptance or a completion report has not been recorded.',tasks:open.filter(task=>pendingAcceptance(task,state.members,assignable)&&!awaitingScheduleAcceptance(task,state.members,assignable))},
      {key:'overdue',title:'Preparation deadline passed',help:'The entered due date is before today in the event time zone. Check the real progress.',tasks:day?open.filter(task=>task.dueDate&&task.dueDate<day&&!waitingVerification(task)):[]},
      {key:'prerequisites',title:'Required work not complete',help:'These counts cover directly linked required tasks, not Related links. Open a task to review its links. If a link is unavailable, check it with the organizer.',tasks:needsRequiredWork,requiredSummaries},
      {key:'overlaps',title:'Activities with owner overlaps',help:'The same owner has overlapping entered activity times. Missing end times limit which overlaps can be detected.',tasks:open.filter(task=>overlapIds.has(task.id))},
      {key:'locations',title:'Potential location overlaps',help:'Matching location labels have overlapping entered times, including activities outside My tasks. A space may be shared or divisible; confirm with the organizer. Aliases, capacity, travel and external bookings are not checked. Missing ends limit detection.',tasks:open.filter(task=>locationIds.has(task.id))},
      {key:'activity-details',title:'Activity details not entered',help:'An activity has no end time or no activity location. These may be intentional; confirm what the team needs.',tasks:open.filter(needsActivityDetails)},
    ];
  }

  function create({h,options,statusBadge,assignableTaskOwner=activeMember}) {
    const awaitingOwnerReconfirmation = (task,members) => awaitingScheduleAcceptance(task,members,assignableTaskOwner);
    const ownerUnavailable = (task,members) => assignmentIssue(task,members,assignableTaskOwner)==='owner-unavailable';
    function reviewRoute(task,kind,organizer) {
      const reviewKind=organizerReviewKind(task,kind,organizer);
      return reviewKind
        ? `data-action="review-organizer-item" data-id="${h(task.id)}" data-review-kind="${reviewKind}"`
        : taskRoute(task,kind==='help'||kind==='date');
    }
    function taskRoute(task,request=false) {
      return `data-action="task"${request?' data-open-recovery':''} data-id="${h(task.id)}"`;
    }
    function carriedOver(task,day) {
      const start=task.schedule.start.slice(0,10);
      return start<day?`<span class="muted">Continues from ${h(dateLabel(start))}</span>`:'';
    }
    function scheduleTimeWarning(task,zone) {
      const warning=wallTimeWarning(task,zone);
      return warning?`<span class="schedule-overlap-label">${h(warning)}</span>`:'';
    }
    function liveOwner(task,state) {
      return `<span class="person-chip schedule-owner-label">${h(scheduleOwnerLabel(task.owner,state.members,assignableTaskOwner))}</span>`;
    }
    function liveHandoff(slot) {
      return `<span class="muted">${h(activityLocation(slot)||noActivityLocation)}</span>${slot.end?'':`<span class="muted">${noActivityEnd}</span>`}`;
    }
    // Use the same saved-fact predicates as Before event and the run sheet.
    // A clock cue is never a readiness decision or an automatic status change.
    function liveWarnings(task,state,byId) {
      const wallWarning=wallTimeWarning(task,state.event.timeZone);
      if(resolved(task)&&!evidenceAmended(task))return wallWarning?`<span class="schedule-warnings"><span>${h(wallWarning)}</span></span>`:'';
      const labels=wallWarning?[wallWarning]:[];
      if(evidenceAmended(task))labels.push('Evidence amended after verification');
      if(changesRequested(task))labels.push('Changes requested');
      const request=planRequestKind(task);
      if(request)labels.push(planRequestLabels[request]);
      // A missing roster record already uses this text in the owner label.
      if(state.members?.some(member=>member.id===task.owner&&!assignableTaskOwner(member)))labels.push('Assigned owner unavailable');
      if(awaitingOwnerReconfirmation(task,state.members||[]))labels.push(scheduleAcceptanceCue);
      else if(pendingAcceptance(task,state.members||[],assignableTaskOwner))labels.push('Acceptance not recorded');
      if(unfinishedRequiredWork(task,byId))labels.push('Required work not complete');
      if(linkedResultsReady(task,byId))labels.push('Review linked results');
      return labels.length?`<span class="schedule-warnings">${labels.map(label=>`<span>${h(label)}</span>`).join('')}</span>`:'';
    }
    function locationWarning(tasks,locations) {
      const count=tasks.filter(task=>locations.has(task.id)).length;
      return count?`${count} ${count===1?'activity has a':'activities have'} potential location overlap. Matching location labels can include other teams outside this view. Confirm shared space with the organizer; this is not a booking check.`:'';
    }
    function locationNotice(tasks,locations) {
      const warning=locationWarning(tasks,locations);
      return warning?`<p class="schedule-overlap-summary">${h(warning)}</p>`:'';
    }
    function fields(schedule={},startRequired=true) {
      return `<div class="form-grid"><label class="field">${startRequired?'Starts':'Starts (optional)'}<input name="start" type="datetime-local"${startRequired?' required':''} step="60" value="${h(schedule.start||'')}"></label><label class="field">Ends (optional)<input name="end" type="datetime-local" step="60" value="${h(schedule.end||'')}"></label><label class="field full-width">Activity location (optional)<input name="location" maxlength="240" value="${h(schedule.location||'')}"></label></div>`;
    }
    function zone(event) {
      return `<p class="muted schedule-zone">All times: ${h(event.timeZone)}. Preparation deadlines are separate.</p>`;
    }
    function scheduleCommitmentHint(task) {
      if(!task)return '<p class="muted">Scheduling an open task resets any existing acceptance and Next up commitment so its owner can reconfirm. Progress is unchanged.</p>';
      if(task.status==='done'||task.reportedAt||task.verifiedAt||!task.owner||!(task.acceptedAt||task.nextUpAt))return '';
      return '<p class="notice">Changing or removing this schedule clears the current acceptance and Next up commitment. The same owner can accept again after reviewing the change. Progress is unchanged.</p>';
    }
    function needsZone() {
      return '<p class="muted">Set the event time zone before scheduling activities.</p><button class="btn btn-secondary" data-action="event-context">Project settings</button>';
    }
    function reconfirmation(task,event,actor) {
      if(!pendingReconfirmation(task,actor))return '';
      const change=task.scheduleReconfirmation;
      const facts=(slot,timeZone)=>{
        if(!slot)return 'Not on the schedule';
        const summary=activitySummary({schedule:slot},timeZone);
        const fields=[summary.timing,summary.location,summary.warning].filter(Boolean);
        return h(fields.join(' · '));
      };
      const previous=change.previous,current=task.schedule;
      const matches=!previous&&!current||previous&&current&&change.timeZone===event.timeZone&&
        previous.start===current.start&&previous.end===current.end&&previous.location===current.location;
      return `<span class="schedule-reconfirmation"><strong>Review schedule changes before accepting again</strong><span><strong>Before changes:</strong> ${facts(previous,change.timeZone)}</span><span><strong>Current schedule:</strong> ${facts(current,event.timeZone)}</span><span class="muted">${matches?'The current schedule matches the earlier one, but you still need to accept again.':'Your previous acceptance was cleared.'} Progress is unchanged.</span></span>`;
    }
    function overlapMarkup(kinds) {
      return kinds.map(kind=>`<span class="schedule-overlap-label">${overlapLabel[kind]}</span>`).join('');
    }
    function overlapIntent(kinds,task,reviewKind='') {
      // The card's existing review/request destination takes precedence.
      return kinds.length&&!reviewKind&&canOpenOverlap(task)
        ? ` data-open-schedule-overlap="${overlapKind(kinds)}"`:'';
    }
    function clock(state,now=Date.now(),scope={},organizer=false,matches) {
      const day=selectedDate(scope);
      const tasks=scheduledInScope(state.tasks,scope);
      const empty=()=>({markup:'',labels:new Map(),rowDays:new Map()});
      if(!tasks.length)return empty();
      const today=momentKey(now,state.event.timeZone)?.slice(0,10);
      // A date filter can hide live clock cues, not saved review obligations.
      const live=today&&(!day||day===today)?timing(tasks,state.event.timeZone,now):null;
      const verification=tasks.filter(waitingVerification),amendments=tasks.filter(evidenceAmended);
      if(!live&&!verification.length&&!amendments.length)return empty();
      const byId=new Map(state.tasks.map(task=>[task.id,task]));
      const rowDays=new Map(live?[
        ...live.current.map(task=>[task.id,today]),
        ...live.next.map(task=>[task.id,task.schedule.start.slice(0,10)]),
        ...live.followUp.map(task=>[task.id,lastActivityDate(task)]),
      ]:[]);
      const focusDate=task=>rowDays.get(task.id)||day||(today&&onDate(task,today)?today:lastActivityDate(task));
      const activityConflicts=(task,date)=>overlapKinds(matches??=scheduleOverlaps(state,tasks,day),task,date);
      const group=(title,groupTasks,empty,{followUp=false,reviewKind=''}={})=>`<div class="schedule-focus-group"><h3>${title}</h3>${reviewKind==='completion'?'<p class="muted schedule-follow-up-help">Open an activity to review its completion status. When a report is available, only the organizer can verify it or request changes.</p>':''}${followUp?'<p class="muted schedule-follow-up-help">A scheduled time has passed, but these activities are not marked complete. Check with the owner before changing their status.</p>':''}${groupTasks.length?groupTasks.map(task=>{
        const date=focusDate(task), conflicts=activityConflicts(task,date);
        return `<button class="text-button schedule-focus-task" data-schedule-focus-day="${h(date)}"${reviewKind?` data-schedule-focus-kind="${reviewKind}"`:''}${overlapIntent(conflicts,task,reviewKind)} ${reviewKind?reviewRoute(task,reviewKind,organizer):taskRoute(task,!!planRequestKind(task))}><strong>${h(task.title)}</strong>${followUp?`<span class="schedule-focus-reason">${h(live.labels.get(task.id))}</span>`:''}<span class="muted">${task.schedule.start.slice(0,10)!==today?h(dateLabel(task.schedule.start))+' · ':''}${h(range(task.schedule))}</span>${liveHandoff(task.schedule)}${overlapMarkup(conflicts)}<span class="schedule-focus-meta">${liveOwner(task,state)}${waitingVerification(task)?'<span class="status-badge status-blocked">Awaiting verification</span>':statusBadge(task.status)}</span>${liveWarnings(task,state,byId)}</button>`;
      }).join(''):`<p class="muted">${empty}</p>`}</div>`;
      return {markup:`<div class="schedule-focus${live?'':' schedule-focus-review-only'}">${live?group('Scheduled now',live.current,'No current time slot')+group('Next',live.next,'No upcoming activities'):''}${verification.length?`<div class="schedule-completion-review">${group('Completion awaiting verification · '+verification.length,verification,'',{reviewKind:'completion'})}</div>`:''}${amendments.length?`<div class="schedule-completion-review"><p class="muted schedule-follow-up-help">The current submission was edited after verification and has not been reviewed. Task verification is unchanged; open the activity to review the amendment.</p>${group('Evidence amended after verification · '+amendments.length,amendments,'',{reviewKind:'amendment'})}</div>`:''}${live?.followUp.length?`<div class="schedule-follow-up">${group('Check progress',live.followUp,'',{followUp:true})}</div>`:''}</div>`,labels:live?.labels||new Map(),rowDays};
    }
    function view(state,organizer,now=Date.now(),scope={}) {
      const visible=scoped(state.tasks,scope),day=selectedDate(scope);
      const tasks=ordered(visible.filter(task=>onDate(task,day))),days=activityDateGroups(tasks,day);
      const matches=scheduleOverlaps(state,tasks,day),{overlaps,locations}=matches;
      const pending=visible.filter(needsActivityTime);
      const hasScheduled=state.tasks.some(scheduled);
      const live=clock(state,now,scope,organizer,matches),hasActivities=hasScheduled||state.tasks.some(needsActivityTime),byId=new Map(state.tasks.map(task=>[task.id,task]));
      const refresh=scope.canRefresh?`<div class="schedule-refresh"><button id="timelineScheduleRefresh" class="btn btn-secondary" type="button" data-action="refresh-timeline-schedule" aria-describedby="timelineScheduleRefreshStatus">Check for schedule updates</button><p id="timelineScheduleRefreshStatus" role="status" class="muted"${scope.updatesPending?' data-pending="true"':''}>${scope.updatesPending?'Project updates are available. This schedule shows the last loaded times.':''}</p></div>`:'';
      const shortcuts=Object.entries(activityDays(state,now,scope)).filter(([,date])=>date).map(([key])=>`<button class="btn btn-secondary" type="button" id="schedule-jump-${key}" data-action="jump-schedule-date" data-id="${key}">${activityDayLabels[key]}</button>`).join('');
      const shareDay=day&&scope.shareDay?`<div class="schedule-share"><button class="btn btn-secondary" type="button" data-action="copy-schedule-day" aria-describedby="scheduleDayShareHelp">Copy day link</button><p class="muted" id="scheduleDayShareHelp">Opens this date in the live project. Recipients still need project access. Their view starts with all activities.</p></div>`:'';
      const dateFilter=(hasScheduled||day||scope.keepDateFilter)?`${shortcuts?`<div class="schedule-date-shortcuts" role="group" aria-label="Jump to an activity day">${shortcuts}</div>`:''}<form id="scheduleDateForm" class="schedule-date-filter"><label class="field">Schedule date<input type="date" id="scheduleDate" name="scheduleDate" value="${h(day)}" min="0001-01-01" max="9999-12-31" required aria-describedby="scheduleDateHelp"></label><button id="applyScheduleDate" class="btn btn-secondary" type="submit">Apply date</button>${day?'<button class="btn btn-secondary" type="button" data-action="clear-schedule-date">Show all dates</button>':''}</form><p class="muted schedule-date-help" id="scheduleDateHelp">${day?'Showing '+h(dateLabel(day))+' in the event time zone. Live clock cues show only for today. The run sheet uses this date.':'Apply a date to see everything scheduled that day, including activities continuing from an earlier date.'} Before the event still reviews all dates.</p>`:'';
      const awaitingTime=pending.length?`<section class="schedule-pending" aria-labelledby="schedulePendingHeading"><h2 id="schedulePendingHeading">Activities need a start time · ${pending.length}</h2><p class="muted">These are planned activities. They won’t appear on the run sheet until a start time is saved.${day?' Undated activities are shown here regardless of the selected date.':''}</p><ul>${pending.map(task=>`<li><button class="text-button" data-action="task" data-id="${h(task.id)}">${h(task.title)}</button>${liveOwner(task,state)}${organizer?`<button type="button" class="btn btn-secondary btn-small" data-action="schedule-set-start" data-id="${h(task.id)}" aria-label="Set start time for ${h(task.title)}">Set start time</button>`:''}</li>`).join('')}</ul></section>`:'';
      const filters=hasActivities||scope.canRefresh?`<div class="schedule-switch" role="group" aria-label="Activity scope"><button class="filter-tab ${scope.mine?'':'active'}" aria-pressed="${!scope.mine}" data-action="schedule-scope" data-id="all">All activities</button><button class="filter-tab ${scope.mine?'active':''}" aria-pressed="${!!scope.mine}" data-action="schedule-scope" data-id="mine">My activities</button></div>`:'';
      const empty=day?`<h2>${scope.mine?'No activities assigned to you on this date':'No scheduled activities on this date'}</h2>${scope.mine&&hasActivities?'<button class="btn btn-secondary" data-action="schedule-scope" data-id="all">Show all activities</button>':''}`:scope.mine&&hasActivities&&!pending.length?'<h2>No activities assigned to you</h2><button class="btn btn-secondary" data-action="schedule-scope" data-id="all">Show all activities</button>':pending.length?'<h2>No scheduled activities yet</h2>':`<h2>No scheduled activities</h2>${organizer?(state.event.timeZone?'<p class="muted">Add an activity or schedule an existing task.</p>':needsZone()):'<p class="muted">The organizer can add the event schedule here.</p>'}`;
      return `<section class="panel schedule-panel" aria-labelledby="schedulePanelHeading"><h2 id="schedulePanelHeading" tabindex="-1" class="section-title">Event schedule</h2>${refresh}${filters}${dateFilter}${shareDay}${state.event.timeZone?zone(state.event):''}<div data-schedule-clock>${live.markup}</div>${overlaps.size?`<p class="schedule-overlap-summary">${overlaps.size} activities have owner overlaps. Open an activity to review.</p>`:''}${locationNotice(tasks,locations)}${awaitingTime}${tasks.length?days.map(({date,tasks:dayTasks})=>`<section class="schedule-day"><h2>${h(dateLabel(date))}</h2><div class="schedule-list">${dayTasks.map(task=>{const phase=live.rowDays.get(task.id)===date?live.labels.get(task.id):'',conflicts=overlapKinds(matches,task,date);return `<button class="schedule-row" ${taskRoute(task,!!planRequestKind(task))} data-schedule-day="${h(date)}"${overlapIntent(conflicts,task)}><span class="schedule-time">${h(range(task.schedule))}<span class="schedule-phase" data-schedule-phase="${h(task.id)}" data-schedule-phase-day="${h(date)}"${phase?'':' hidden'}>${h(phase||'')}</span></span><span class="schedule-activity"><strong>${h(task.title)}</strong>${carriedOver(task,date)}${liveHandoff(task.schedule)}${overlapMarkup(conflicts)}</span><span class="schedule-owner">${liveOwner(task,state)}${waitingVerification(task)?'<span class="status-badge status-blocked">Awaiting verification</span>':statusBadge(task.status)}${liveWarnings(task,state,byId)}</span></button>`;}).join('')}</div></section>`).join(''):`<div class="schedule-empty">${empty}</div>`}</section>`;
    }
    function details(task,organizer,event,tasks=[],reviewDay='') {
      const current=task.schedule;
      if(!active(task))return current
        ? `<section class="schedule-facts"><h3>Archived activity schedule</h3><p>${h(dateLabel(current.start))} · ${h(range(current))}</p><p class="muted">${h(activityLocation(current)||noActivityLocation)} · Not part of the active schedule.</p></section>`
        : '';
      const usable=usableWallTimes(tasks,event.timeZone);
      const date=selectedDate({date:reviewDay});
      const matchesDate=other=>!!date&&onDate(task,date)&&onDate(other,date);
      const prioritize=peers=>date?peers.filter(matchesDate).concat(peers.filter(other=>!matchesDate(other))):peers;
      const overlaps=prioritize(ownerOverlaps(usable).get(task.id)||[]),locations=prioritize(locationOverlaps(usable).get(task.id)||[]);
      const otherDay=other=>date&&!matchesDate(other)?' <span class="muted">Overlap on another day</span>':'';
      const summaryCount=peers=>date?`${peers.filter(matchesDate).length} on this date · ${peers.length} total`:`${peers.length} ${peers.length===1?'activity':'activities'}`;
      const context=date?`<p id="scheduleOverlapContext" class="schedule-overlap-context">Timeline date: <strong>${h(dateLabel(date))}</strong>. ${[...overlaps,...locations].some(matchesDate)?'Overlaps on this date are listed first.':'No current overlap on this date.'}</p>`:'';
      const editSchedule=label=>`<button type="button" class="btn btn-secondary btn-small" data-action="review-overlap-schedule" data-id="${h(task.id)}">${label}</button>`;
      const peerLink=(other,kind)=>`<button type="button" class="text-button" data-action="inspect-overlap-peer" data-id="${h(other.id)}" data-overlap-kind="${kind}">${h(other.title)}</button>`;
      const warning=overlaps.length?`<details class="schedule-overlap-details schedule-overlap-owner" data-schedule-overlap-kind="owner"><summary id="scheduleOwnerOverlapSummary"${date?' aria-describedby="scheduleOverlapContext"':''}>Owner overlap · ${summaryCount(overlaps)}</summary><p>The same owner is scheduled at overlapping times. ${organizer?'Review the times or choose another owner.':'Ask the organizer to review the times or owner.'}</p><ul>${overlaps.map(other=>`<li>${peerLink(other,'owner')}<span class="muted">${h(dateLabel(other.schedule.start))} · ${h(range(other.schedule))}</span>${otherDay(other)}</li>`).join('')}</ul>${organizer?`<div class="inline schedule-overlap-actions">${editSchedule('Review activity time')}${!task.reportedAt?`<button type="button" class="btn btn-secondary btn-small" data-action="review-task-owner" data-id="${h(task.id)}">Review owner</button>`:''}</div>`:''}${!current?.end||overlaps.some(other=>!other.schedule.end)?'<p class="muted">An end time is missing. Only overlaps known from the entered times are shown.</p>':''}</details>`:'';
      const locationWarning=locations.length?`<details class="schedule-overlap-details schedule-overlap-location" data-schedule-overlap-kind="location"><summary id="scheduleLocationOverlapSummary"${date?' aria-describedby="scheduleOverlapContext"':''}>Potential location overlap · ${summaryCount(locations)}</summary><p>Matching location labels have overlapping entered times. The space may be shared or divisible. ${organizer?'Confirm whether these activities can share the space, or edit the times or activity location.':'Ask the organizer to confirm shared space, times or activity locations.'}</p><ul>${locations.map(other=>`<li>${peerLink(other,'location')}<span class="muted">${h(other.schedule.location)} · ${h(dateLabel(other.schedule.start))} · ${h(range(other.schedule))}</span>${otherDay(other)}</li>`).join('')}</ul><p class="muted">Only matching labels are checked, ignoring case and extra spaces. Different room names, capacity, travel and external bookings are not checked.</p>${organizer?`<div class="inline schedule-overlap-actions">${editSchedule('Review time or location')}</div>`:''}${!current?.end||locations.some(other=>!other.schedule.end)?'<p class="muted">An end time is missing. Only overlaps known from the entered times are shown.</p>':''}</details>`:'';
      const facts=current?`<section class="schedule-facts"><h3>Scheduled activity</h3><p>${h(dateLabel(current.start))} · ${h(range(current))}${current.end?'':' · '+noActivityEnd}</p><p class="muted">${h(event.timeZone)} · ${h(activityLocation(current)||noActivityLocation)}</p>${scheduleTimeWarning(task,event.timeZone)}${context}${warning}${locationWarning}</section>`:needsActivityTime(task)?'<section class="schedule-facts"><h3>Planned activity · no start time</h3><p class="muted">This activity is not on the schedule or run sheet yet.</p></section>':'';
      return facts+(organizer?`<details class="task-schedule task-organizer section-gap"><summary>${current?'Edit schedule':'Add to event schedule'}</summary>${event.timeZone?`<form id="scheduleForm" data-id="${h(task.id)}" class="section-gap">${zone(event)}${scheduleCommitmentHint(task)}${fields(current||{})}<div class="form-actions"><button class="btn btn-secondary" type="submit" value="save">Save schedule</button>${current?'<button class="text-button" type="submit" value="remove" formnovalidate>Remove from schedule</button>':''}</div></form>`:needsZone()}</details>`:'');
    }
    function picker(state,taskId='') {
      if(!state.event.timeZone)return needsZone();
      const available=state.tasks.filter(task=>active(task)&&!task.schedule);
      if(!available.length)return '<p>No unscheduled active tasks.</p><button class="btn btn-primary" data-action="add-activity">Add activity</button>';
      return `<form id="schedulePickerForm">${zone(state.event)}${scheduleCommitmentHint()}<label class="field">Existing task<select name="taskId" required>${options([['','Choose a task'],...available.map(task=>[task.id,task.title])],available.some(task=>task.id===taskId)?taskId:'')}</select></label>${fields()}<div class="form-actions"><button class="btn btn-primary" type="submit">Add to schedule</button></div></form>`;
    }
    function activityReviewForm(state,taskId) {
      const task=state.tasks.find(task=>task.id===taskId);
      if(!task||!(needsActivityTime(task)||needsActivityDetails(task)))
        throw new Error('This schedule item has changed. Reopen the event review.');
      if(!state.event.timeZone)return needsZone();
      return `<p><strong>${h(task.title)}</strong></p><form id="reviewScheduleForm" data-id="${h(task.id)}" data-revision="${h(task.revision)}">${zone(state.event)}${scheduleCommitmentHint(task)}${fields(task.schedule||{})}<div class="form-actions"><button class="btn btn-primary" type="submit">Save schedule</button></div></form>`;
    }
    function reviewScheduleTask(state,scope,group,id) {
      const task=scoped(state.tasks,scope).find(item=>item.id===id);
      return task&&(group==='activity-time'&&needsActivityTime(task)||
        group==='activity-details'&&needsActivityDetails(task))?task:null;
    }
    function firstTimeTask(state,taskId,scope) {
      return scoped(state.tasks,scope).find(task=>task.id===taskId&&needsActivityTime(task));
    }
    function firstTimeForm(state,taskId,scope) {
      const task=firstTimeTask(state,taskId,scope);
      if(!task)return '';
      if(!state.event.timeZone)return needsZone();
      return `<p>Set the first start time for <strong>${h(task.title)}</strong>. This adds the activity to the event schedule.</p><form id="firstScheduleForm" data-id="${h(task.id)}" data-revision="${h(task.revision)}">${zone(state.event)}${scheduleCommitmentHint(task)}${fields()}<div class="form-actions"><button class="btn btn-primary" type="submit">Save start time</button></div></form>`;
    }
    function reviewAssignmentTasks(state,scope,key) {
      if(!assignmentGroup(key))return [];
      return scoped(state.tasks,scope)
        .filter(task=>canReviewAssignment(task)&&(key==='unassigned'?!task.owner:ownerUnavailable(task,state.members)));
    }
    function reviewAcceptanceTasks(state,scope={}) {
      if(!scope.actor)return [];
      return state.tasks.filter(task=>task.owner===scope.actor&&canReviewAssignment(task)&&pendingAcceptance(task,state.members,assignableTaskOwner));
    }
    function preparationReview(state,now=Date.now(),scope={},organizer=false) {
      const groups=reviewItems(state,now,scope,assignableTaskOwner),tasks=scoped(state.tasks,scope);
      const local=momentKey(now,state.event.timeZone);
      const name=id=>state.members.find(member=>member.id===id)?.name||'Unassigned';
      const scopeLabel=scope.mine?'My tasks · '+name(scope.actor):'All tasks';
      const emptyTasks=scope.mine?'No active tasks assigned to you. This does not mean the whole event is ready.':
        state.tasks.length?'No active tasks in this plan. Archived tasks are not included in this review.':'No tasks in this plan yet. Build a plan or add the work your event needs.';
      const context=[!state.event.date?'Event date not entered':'Event date: '+dateLabel(state.event.date),
        !local?'Event time zone not set or unavailable':'Event time zone: '+state.event.timeZone,
        !state.event.location?'Event location not entered':'Event location: '+state.event.location];
      const scheduleAction=(group,task)=>{
        if(!organizer||!['activity-time','activity-details'].includes(group.key))return '';
        const label=group.key==='activity-time'?'Set start time':'Review timing and location';
        return `<button class="btn btn-secondary btn-small review-activity-action" data-action="schedule-review-activity" data-id="${h(task.id)}" aria-label="${label} for ${h(task.title)}">${label}</button>`;
      };
      const assignmentAction=group=>{
        if(!organizer||!assignmentGroup(group.key)||!group.tasks.some(canReviewAssignment))return '';
        const label=group.key==='unassigned'?'Assign unowned tasks':'Reassign tasks with unavailable owners';
        return `<button class="btn btn-secondary btn-small review-activity-action" data-action="review-event-assignments" data-id="${group.key}">${label}</button>`;
      };
      const ownPending=reviewAcceptanceTasks(state,scope).length;
      const groupReviewKind=(group,task)=>group.key==='verification'?'completion':
        group.key==='evidence-amendments'?'amendment':group.key==='plan-requests'?planRequestKind(task):'';
      const requestLabel=(group,task)=>group.key==='plan-requests'?' · '+planRequestLabels[planRequestKind(task)]:'';
      const currentSchedule=(group,task)=>{
        if(group.key!=='schedule-reconfirmation')return '';
        if(!task.schedule)return '<span>Not on the schedule</span>';
        const activity=activitySummary(task,state.event.timeZone);
        return `<span>${activity.warning?'Saved time needs correction: ':'Current schedule: '}${h(activity.timing)}</span>`;
      };
      const acceptanceAction=ownPending
        ? `<p><button class="btn btn-secondary btn-small review-activity-action" data-action="review-event-acceptance">Review my assignments (${ownPending})</button></p>`:'';
      const groupMarkup=group=>{
        const expanded=group.tasks.length&&(group.tasks.length<=3||['activity-time','plan-requests','schedule-reconfirmation'].includes(group.key));
        const requiredReview=group.key==='prerequisites'||group.key==='linked-results';
        const rows=group.tasks.map((task,index)=>{
          const requiredSummary=group.requiredSummaries?.get(task.id);
          const summaryId='eventRequiredWorkSummary-'+index;
          return `<li><button type="button" class="text-button" ${requiredReview
            ?`data-action="review-event-required-work" data-id="${h(task.id)}" aria-label="${group.key==='prerequisites'?'Review required work for':'Review linked results for'} ${h(task.title)}"`
            :reviewRoute(task,groupReviewKind(group,task),organizer)}${requiredSummary?` aria-describedby="${summaryId}"`:''}>${h(task.title)}</button><span>${h(name(task.owner))}${ownerUnavailable(task,state.members)?' · owner unavailable':''}${task.dueDate?' · Due '+h(dateLabel(task.dueDate)):''}${requestLabel(group,task)}</span>${requiredSummary?`<span id="${summaryId}" class="event-required-work-summary">Required work: ${h(requiredSummary)}</span>`:''}${currentSchedule(group,task)}${scheduleAction(group,task)}</li>`;
        }).join('');
        return `<details class="before-event-group" data-event-review-group="${h(group.key)}"${expanded?' open':''}><summary>${h(group.title)} · ${group.tasks.length}</summary><p class="muted">${h(group.help)}</p>${assignmentAction(group)}${rows?`<ul>${rows}</ul>`:'<p class="muted">None found in the saved plan.</p>'}</details>`;
      };
      return `<article class="before-event-review"><p class="eyebrow">${h(scopeLabel)}</p><h3>${h(state.event.name||'Untitled event')}</h3><p>Snapshot: ${h(local?local.replace('T',' · ')+' · '+state.event.timeZone:new Date(now).toISOString()+' · UTC')}. Reopen this review to refresh it.</p><p>This checks saved planning facts only. It does not certify safety, approvals, bookings or event readiness. Tasks can appear in more than one section. Opening this review does not change tasks or send messages.</p><section aria-label="Saved event details"><h3>Event details</h3><ul>${context.map(fact=>`<li>${h(fact)}</li>`).join('')}</ul><button class="text-button" data-action="event-context">Review event details</button></section>${!tasks.length?`<p class="notice">${emptyTasks}</p>`:''}<p class="muted">${tasks.filter(task=>task.schedule).length} scheduled activities in this scope. This review covers all event dates in this scope. Only planned activities need a start time. Preparation tasks do not need an activity time.</p>${acceptanceAction}${groups.map(groupMarkup).join('')}</article>`;
    }
    function runSheetModel(state,now=Date.now(),scope={},liveTargets) {
      liveTargets?.clear();
      const visible=scoped(state.tasks,scope),day=selectedDate(scope);
      const tasks=scheduledInScope(state.tasks,scope);
      const matches=scheduleOverlaps(state,tasks,day),{overlaps,locations}=matches;
      const untimed=visible.filter(needsActivityTime).length;
      const untimedNotice=untimed?`${untimed} planned ${untimed===1?'activity is':'activities are'} not shown because ${untimed===1?'it has':'they have'} no start time.${day?' Undated activities are not tied to the selected date.':''} Check the live Timeline before sharing this copy.`:'';
      const missingDetails=tasks.filter(needsActivityDetails).length;
      const detailsNotice=missingDetails?`${missingDetails} ${missingDetails===1?'activity is':'activities are'} missing an end time or location. Confirm the missing details in the live Timeline before relying on this copy.`:'';
      const name=id=>scheduleOwnerLabel(id,state.members,assignableTaskOwner);
      const unassigned=tasks.filter(task=>!task.owner&&!resolved(task)).length;
      const unassignedNotice=unassigned?`${unassigned} ${unassigned===1?'activity has':'activities have'} no owner assigned. Confirm who will cover the work with the organizer.`:'';
      const invalidTimes=tasks.filter(task=>wallTimeIssue(task,state.event.timeZone)).length;
      const invalidTimeNotice=invalidTimes?`${invalidTimes} ${invalidTimes===1?'activity has a saved time that needs':'activities have saved times that need'} correction. Do not rely on the flagged times until the organizer confirms them in Timeline.`:'';
      const unavailable=tasks.filter(task=>!resolved(task)&&ownerUnavailable(task,state.members)).length;
      const ownerNotice=unavailable?unavailable+' '+(unavailable===1?'activity has':'activities have')+' an assigned owner who cannot accept tasks in this project. Confirm responsibility with the organizer; this snapshot does not reassign work.':'';
      const byId=new Map(state.tasks.map(task=>[task.id,task]));
      const prerequisites=new Set(tasks.filter(task=>unfinishedRequiredWork(task,byId)).map(task=>task.id));
      const prerequisiteNotice=prerequisites.size?prerequisites.size+' '+(prerequisites.size===1?'activity has':'activities have')+' unfinished required work. Required linked tasks are incomplete, awaiting verification or unavailable. Confirm the current plan with the organizer; this snapshot does not certify event readiness.':'';
      const linkedResults=new Set(tasks.filter(task=>linkedResultsReady(task,byId)).map(task=>task.id));
      const linkedResultsNotice=linkedResults.size?`${linkedResults.size} ${linkedResults.size===1?'activity remains':'activities remain'} marked Blocked after required linked work finished. Open the live project to review the linked results and check for other blockers before resuming.`:'';
      // Count unique scheduled activities before creating any carryover rows.
      const reconfirmation=new Set(tasks.filter(task=>awaitingOwnerReconfirmation(task,state.members)).map(task=>task.id));
      const acceptance=new Set(tasks.filter(task=>!reconfirmation.has(task.id)&&pendingAcceptance(task,state.members,assignableTaskOwner)).map(task=>task.id));
      const acceptanceNotice=acceptance.size?acceptance.size+' '+(acceptance.size===1?'activity has':'activities have')+' owner acceptance not recorded. Assignment alone does not confirm responsibility. Check with the owner; this snapshot does not accept work for them.':'';
      const reconfirmationNotice=reconfirmation.size?`${reconfirmation.size} ${reconfirmation.size===1?'activity needs':'activities need'} renewed owner acceptance after a schedule change. Confirm responsibility against the current plan with the assigned owner.`:'';
      const verification=tasks.filter(waitingVerification).length;
      const verificationNotice=verification?`${verification} ${verification===1?'activity has':'activities have'} completion awaiting organizer verification. Open the live project to review the saved completion status; this copy does not include completion evidence.`:'';
      const changes=new Set(tasks.filter(changesRequested).map(task=>task.id));
      const changesNotice=changes.size?changes.size+' '+(changes.size===1?'activity has':'activities have')+' completion changes requested. Review the task with the owner before resubmitting. Review notes are not included in this copy; the work is not verified.':'';
      const amendments=new Set(tasks.filter(evidenceAmended).map(task=>task.id));
      const amendmentNotice=amendments.size?amendments.size+' '+(amendments.size===1?'activity has':'activities have')+' evidence amended after verification. The current submission has not been reviewed. Task verification is unchanged; review amendments with the organizer. Evidence contents are not included in this copy.':'';
      const local=momentKey(now,state.event.timeZone);
      const timestamp=local?local.replace('T',' · ')+' · '+state.event.timeZone:new Date(now).toISOString()+' · UTC';
      const title=state.event.name||'Untitled event',scopeLabel=(scope.mine?'My activities · '+name(scope.actor):'All activities')+(day?' · '+dateLabel(day):'');
      const status=task=>waitingVerification(task)?'Awaiting verification':({todo:'To do',progress:'In progress',blocked:'Blocked',done:'Done'})[task.status]||'Unknown';
      // Deliberately project only schedule facts. Never serialize the workspace,
      // notes, comments, guest records, email, files or private booking details.
      const days=activityDateGroups(tasks,day).filter(group=>group.tasks.length).map(({date,tasks:dayTasks},dayIndex)=>({label:dateLabel(date),rows:dayTasks.map((task,rowIndex)=>{
        const start=task.schedule.start.slice(0,10),id=task.id;
        liveTargets?.set(`${dayIndex}-${rowIndex}`,{id,day:date});
        return {title:task.title,range:range(task.schedule),openEnded:!task.schedule.end,location:activityLocation(task.schedule),
          continues:start<date?'Continues from '+dateLabel(start):'',
          activityWarnings:[wallTimeWarning(task,state.event.timeZone),...overlapLabels(matches,task,date)].filter(Boolean),
          owner:name(task.owner),acceptance:reconfirmation.has(id)?scheduleAcceptanceCue:acceptance.has(id)?'Acceptance not recorded':'',status:status(task),
          statusWarnings:[amendments.has(id)?'Evidence amended after verification':'',changes.has(id)?'Changes requested':'',prerequisites.has(id)?'Required work not complete':'',linkedResults.has(id)?'Review linked results':''].filter(Boolean)};
      })}));
      return {title,scopeLabel,timestamp,day,mine:!!scope.mine,missingDetails,timeZone:state.event.timeZone||'Time zone not set',
        cautions:[invalidTimeNotice,untimedNotice,detailsNotice,unassignedNotice,ownerNotice,reconfirmationNotice,acceptanceNotice,prerequisiteNotice,linkedResultsNotice,verificationNotice,changesNotice,amendmentNotice,
          overlaps.size?`${overlaps.size} activities have owner overlaps. Review these with the organizer.`:''].filter(Boolean),
        locationWarning:locationWarning(tasks,locations),
        empty:day?'No scheduled activities in this scope on the selected date.':'No scheduled activities in this view.',
        days};
    }
    const snapshotDisclaimer='This copy is not live. Confirm changes with your team; scheduled times never mark work complete.';
    const sharingDisclaimer='Team-only schedule facts. Private bookings, guest records and task notes are not included. Share printed or saved copies only with the people who need them; downloaded copies cannot be recalled.';
    function runSheetMarkup(model,liveTargets) {
      const {title,scopeLabel,timestamp,timeZone,cautions,locationWarning,days,empty}=model;
      const spans=(values)=>values.filter(Boolean).map(value=>`<span>${h(value)}</span>`).join('');
      const liveAction=(row,label,dayIndex,rowIndex)=>{
        const key=`${dayIndex}-${rowIndex}`;
        if(!liveTargets?.has(key))return '';
        return `<button type="button" class="text-button run-sheet-live-action" data-action="review-run-sheet-row" data-run-sheet-row="${key}" aria-describedby="runSheetReviewDetailsStatus" aria-label="${h('Show in Timeline: '+row.title+' · '+label+' · '+row.range)}">Show in Timeline</button>`;
      };
      return `<article id="eventRunSheet" class="event-run-sheet"><header><p class="eyebrow">EVENT RUN SHEET</p><h2>${h(title)}</h2><p>${h(scopeLabel)}</p><p>All activity times: ${h(timeZone)}</p><p class="run-sheet-snapshot">Snapshot: ${h(timestamp)}. ${snapshotDisclaimer}</p><p class="notice" data-run-sheet-update-warning hidden></p><p class="muted">${sharingDisclaimer}</p></header>${cautions.map(warning=>`<p class="notice">${h(warning)}</p>`).join('')}${locationWarning?`<p class="schedule-overlap-summary">${h(locationWarning)}</p>`:''}${days.map(({label,rows},dayIndex)=>`<div class="run-sheet-table-wrap"><table class="run-sheet-table"><caption>${h(label)}</caption><thead><tr class="run-sheet-repeat-heading"><th colspan="4">${h(title)} · ${h(label)}<span>${h(scopeLabel)} · All activity times: ${h(timeZone)}</span><span>Team only · Not live · Snapshot: ${h(timestamp)}</span><span data-run-sheet-update-warning hidden></span></th></tr><tr><th scope="col">Time</th><th scope="col">Activity / location</th><th scope="col">Owner</th><th scope="col">Status at snapshot</th></tr></thead><tbody>${rows.map((row,rowIndex)=>`<tr><td data-label="Time">${h(row.range)}${row.openEnded?`<span>${noActivityEnd}</span>`:''}</td><th scope="row">${h(row.title)}${row.continues?`<span class="muted">${h(row.continues)}</span>`:''}${spans([row.location||noActivityLocation,...row.activityWarnings])}${liveAction(row,label,dayIndex,rowIndex)}</th><td data-label="Owner">${h(row.owner)}${spans([row.acceptance])}</td><td data-label="Status at snapshot">${h(row.status)}${spans(row.statusWarnings)}</td></tr>`).join('')}</tbody></table></div>`).join('')||`<p>${h(empty)}</p>`}</article>`;
    }
    function runSheetText(model) {
      // User-entered fields stay on one line so they cannot masquerade as
      // headings, timestamps or review warnings in the offline copy.
      const line=value=>String(value??'').replace(/[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]+/g,' ').trim();
      const {title,scopeLabel,timestamp,timeZone,cautions,locationWarning,days,empty}=model;
      return ['EVENT RUN SHEET — TEAM ONLY',line(title),line(scopeLabel),'All activity times: '+line(timeZone),
        'Snapshot: '+line(timestamp)+'. '+snapshotDisclaimer,sharingDisclaimer,'',
        ...[...cautions,locationWarning].filter(Boolean).map(warning=>'Check: '+line(warning)),
        ...(days.length?days.flatMap(({label,rows})=>['',line(label),...rows.flatMap(row=>[
          '',line(row.range)+' — '+line(row.title),...(row.continues?[line(row.continues)]:[]),
          line(row.location)?'Location: '+line(row.location):noActivityLocation,'Owner: '+line(row.owner),'Status at snapshot: '+line(row.status),
          ...[row.openEnded?noActivityEnd:'',row.acceptance,...row.activityWarnings,...row.statusWarnings].filter(Boolean).map(warning=>'Check: '+line(warning))
        ])]):[empty]),''].join('\n');
    }
    function runSheet(state,now=Date.now(),scope={}) {
      return runSheetMarkup(runSheetModel(state,now,scope));
    }
    function firstMissingRunSheetDetail(state,scope={}) {
      const task=scheduledInScope(state.tasks,scope).find(needsActivityDetails);
      return task?{id:task.id,day:selectedDate(scope)||task.schedule.start.slice(0,10)}:null;
    }
    function newActivity(state) {
      const timing=state.event.timeZone
        ? `<p class="muted">Leave the timing fields blank to set a start time later in Timeline.</p>${zone(state.event)}${fields({},false)}`
        : '<p class="muted">Add this activity now and set its start time later, after setting the event time zone in Project settings.</p>';
      return `<form id="newTaskForm" data-scheduled="true"><div class="form-grid"><label class="field full-width">Activity name<input name="title" required maxlength="180" placeholder="e.g. Guest check-in"></label><label class="field full-width">Owner<select name="owner">${options([['','Unassigned'],...state.members.filter(assignableTaskOwner).map(member=>[member.id,member.name])],'')}</select></label><div data-owner-load class="full-width"></div></div>${timing}<label class="field section-gap">Instructions (optional)<textarea name="note" rows="3" maxlength="3000"></textarea></label><div class="form-actions"><button class="btn btn-primary" type="submit">Add activity</button></div></form>`;
    }
    function guestAgendaForm(snapshot,title) {
      return `<p>Choose only the activities guests should see, then review their titles and the preview. Check each title for internal details. Notes, owners, statuses, saved locations, bookings and guest records are not copied. Nothing is saved or sent.</p>
        <p><strong>${snapshot.mine?'My activities only':'All activities'}</strong> · ${snapshot.date?h(dateLabel(snapshot.date)):'All dates'} · ${h(snapshot.timeZone)}</p>
        ${snapshot.invalidTimes?`<p class="notice">${snapshot.invalidTimes} ${snapshot.invalidTimes===1?'activity was':'activities were'} left out because the saved time needs correction. Review the schedule in Timeline before sharing.</p>`:''}
        ${snapshot.mine?'<div class="notice"><p>Activities assigned to someone else or with no owner are not listed. If you need them, start a new draft with all activities. This replaces your current draft.</p><button type="button" class="btn btn-secondary" data-action="all-guest-agenda-activities">Start over with all activities</button></div>':''}
        <p id="guestAgendaWarning" class="notice" role="status" hidden></p>
        <form id="guestAgendaForm" class="section-gap">
          <label class="field">Agenda title<input name="agendaTitle" maxlength="180" value="${h(agendaText(title))}"></label>
          <div class="acceptance-list">${snapshot.activities.map((slot,index)=>`<div class="section-gap">
            <label class="acceptance-item"><input type="checkbox" name="include-${index}"><span><strong>${h(slot.title)}</strong><span>${h(agendaTime(slot))}</span></span></label>
            <fieldset class="form-grid" data-agenda-fields="${index}" hidden><legend class="sr-only">Guest details for ${h(slot.title)}</legend>
              <label class="field">Guest-facing title<input name="title-${index}" maxlength="180" value="${h(agendaText(slot.title))}"></label>
              <label class="field">Location to share (optional)<input name="location-${index}" maxlength="180" placeholder="Leave blank to omit"></label>
            </fieldset>
          </div>`).join('')}</div>
        </form>
        <p class="muted" id="guestAgendaSelectionStatus" role="status">Select at least one activity.</p>
        <p class="muted" id="guestAgendaCopyHelp" role="status">Use Copy guest agenda to check the schedule before copying. Nothing is sent.</p>
        <label class="field section-gap">Guest agenda preview<textarea id="guestAgendaText" rows="8" readonly aria-describedby="guestAgendaCopyHelp"></textarea></label>`;
    }
    return {view,details,picker,firstTimeTask,firstTimeForm,newActivity,clock,runSheet,runSheetModel,runSheetMarkup,runSheetText,firstMissingRunSheetDetail,preparationReview,activityReviewForm,reviewScheduleTask,reviewAssignmentTasks,reviewAcceptanceTasks,activityDays,guestAgendaForm,reconfirmation,awaitingScheduleAcceptance:awaitingOwnerReconfirmation};
  }
  root.GatherScheduleUI={create,newActivityTask,ordered,range,dateLabel,activitySummary,activityVisibility,scheduledTimelineDay,personalTimelineDay,pendingReconfirmation,linkedResultsReady,ownerOverlaps,locationOverlaps,overlapKindForDay,overlapPairIsCurrent,timing,momentKey,reviewItems,guestAgendaSnapshot,guestAgenda};
})(typeof window!=='undefined'?window:globalThis);
