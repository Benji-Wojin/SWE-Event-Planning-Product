(function(root) {
  'use strict';
  function validDay(value) {
    return typeof value==='string' && /^[1-9]\d{3}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
  }
  function shiftDay(value,days) {
    if(!validDay(value)||!Number.isSafeInteger(days))throw new Error('Choose valid calendar dates.');
    const date=new Date(value+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+days);
    const shifted=date.toISOString().slice(0,10);
    if(!validDay(shifted))throw new Error('This date would be outside years 1000–9999.');
    return shifted;
  }
  function uniqueLocalTime(value,timeZone) {
    try {
      const formatter=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
      const key=epoch=>{const p=Object.fromEntries(formatter.formatToParts(new Date(epoch)).map(part=>[part.type,part.value]));return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;};
      const nominal=Date.parse(value+':00Z'),offsets=new Set();
      // Discover offsets around the target, including date-line and DST changes.
      for(let hours=-48;hours<=48;hours+=6){const epoch=nominal+hours*3600000;offsets.add(Date.parse(key(epoch)+'Z')-epoch);}
      return [...offsets].filter(offset=>key(nominal-offset)===value+':00').length===1;
    }catch{return false;}
  }
  // Shift calendar keys, never elapsed hours in the viewer's time zone.
  function preview(state,toDate) {
    const fromDate=state.event.date;
    if(!validDay(fromDate))throw new Error('Set the current event date in Project settings before moving the plan.');
    if(!validDay(toDate)||toDate===fromDate)throw new Error('Choose a different valid event date.');
    const days=(Date.parse(toDate+'T00:00:00Z')-Date.parse(fromDate+'T00:00:00Z'))/86400000;
    const rows=state.tasks.filter(task=>task.dueDate||task.schedule).map(task=>{
      const blocked=task.status==='done'?'Completed work stays unchanged.':task.reportedAt?'Completion reported; review it before moving this task.':'';
      let due='',schedule=null,dueError='',scheduleError='';
      if(task.dueDate&&!blocked&&!task.hardDeadline)try{due=shiftDay(task.dueDate,days);}catch(error){dueError=error.message;}
      if(task.schedule&&!blocked)try{
        schedule={...task.schedule,start:shiftDay(task.schedule.start.slice(0,10),days)+task.schedule.start.slice(10),end:task.schedule.end?shiftDay(task.schedule.end.slice(0,10),days)+task.schedule.end.slice(10):''};
        if(!uniqueLocalTime(schedule.start,state.event.timeZone)||schedule.end&&!uniqueLocalTime(schedule.end,state.event.timeZone))throw new Error('The moved clock time is ambiguous or unavailable in this time zone. Edit this activity separately.');
      }catch(error){schedule=null;scheduleError=error.message;}
      return {id:task.id,revision:task.revision,title:task.title,owner:task.owner,blocked,oldDue:task.dueDate,due,dueError,hardDeadline:!!task.hardDeadline,oldSchedule:task.schedule,schedule,scheduleError};
    });
    return {fromDate,toDate,days,rows};
  }
  function reviewMarkup(state,plan,h) {
    const date=value=>h(value||'Not set'),slot=value=>value?`${h(value.start.replace('T',' · '))}${value.end?' → '+h(value.end.replace('T',' · ')):' · No end time'}`:'Not scheduled';
    return `<p>Event date: <strong>${date(plan.fromDate)} → ${date(plan.toDate)}</strong> · ${Math.abs(plan.days)} calendar days ${plan.days>0?'later':'earlier'}.</p><p>Activity clock times and the event time zone (${h(state.event.timeZone||'not set')}) stay the same. Daylight-saving changes can change the elapsed duration; review local times with your team.</p><p class="notice">Choose each date you want to move. Nothing is selected automatically. Selected tasks keep their owners and progress, but acceptance and Next up commitments are cleared so owners can reconfirm. No messages are sent.</p><form id="rescheduleReviewForm" data-from="${h(plan.fromDate)}" data-to="${h(plan.toDate)}" data-actor="jack"><div class="reschedule-review">${plan.rows.map(row=>`<fieldset class="reschedule-row" data-reschedule-row="${h(row.id)}" data-revision="${row.revision}"><legend>${h(row.title)}</legend><p class="muted">${h(state.members.find(member=>member.id===row.owner)?.name|| (row.owner?'Unavailable owner':'Unassigned'))}</p>${row.blocked?`<p>${h(row.blocked)}</p>`:''}${row.oldDue?`<label class="check-field"><input type="checkbox" data-move-due ${row.due?'':'disabled'}><span>Preparation deadline: ${date(row.oldDue)}${row.due?' → '+date(row.due):''}${row.hardDeadline?' · Fixed external deadline — unchanged':row.dueError?' · '+h(row.dueError):''}</span></label>`:''}${row.oldSchedule?`<label class="check-field"><input type="checkbox" data-move-schedule ${row.schedule?'':'disabled'}><span>Current activity: ${slot(row.oldSchedule)}${row.schedule?'<br>Proposed activity: '+slot(row.schedule):''}${row.scheduleError?' · '+h(row.scheduleError):''}</span></label>`:''}</fieldset>`).join('')||'<p>No task dates or activity times to move.</p>'}</div><p class="muted">Unselected dates, fixed external deadlines, completed/reported work, catering cutoff, budget due dates, private bookings, saved planning briefs and date-poll options stay unchanged. Check these separately. Changes may create owner overlaps or deadline conflicts; review Before the event afterward.</p><label class="check-field section-gap"><input type="checkbox" name="confirmed" required><span>I reviewed the selected changes and the dates that stay unchanged.</span></label><div class="form-actions"><button class="btn btn-primary" type="submit">Save reviewed date changes</button></div></form>`;
  }
  root.GatherReschedule={validDay,shiftDay,uniqueLocalTime,preview,reviewMarkup};
})(typeof window!=='undefined'?window:globalThis);
