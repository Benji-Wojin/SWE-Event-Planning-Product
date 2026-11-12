import type { PlanItem, PlanOutput } from './plan-generation';
import { validPlanDate } from './plan-generation';

// Product-authored starting points, not AI output or a complete policy/safety checklist.
// Unknown dates, bookings, costs and people must stay unknown until the team decides.
type Entry = [id: string, title: string, category: string, note: string, dependsOn?: string[]];
const shared = {
  purpose: ['purpose', 'Agree the event purpose and audience', 'Program', 'Write down who the event is for, what a useful outcome looks like, and the decisions still open.'] as Entry,
  venue: ['venue', 'Confirm the venue and access arrangements', 'Venue', 'Record the agreed space, availability, arrival route, access needs and setup/clearance times. Check details with the venue; do not treat a shortlist as a confirmed booking.'] as Entry,
  budget: ['budget', 'Agree a spending limit and who approves costs', 'Program', 'Record the working spending limit, who can approve commitments, and what costs remain unknown. Estimates are not payments or confirmed purchases.'] as Entry,
  roles: ['roles', 'Agree activity leads and backup contacts', 'Program', 'Choose who owns setup, guest welcome, programme delivery and cleanup. Confirm availability with each person before treating a role as covered.'] as Entry,
  programme: ['programme', 'Prepare the running order', 'Program', 'Draft the activity sequence, durations, transitions and buffers. Review it with the team before entering confirmed activity times in Timeline.'] as Entry,
  needs: ['needs', 'Check attendee access and dietary needs', 'Guest care', 'Ask what attendees need to participate, using the organizer’s appropriate process. Agree who follows up; keep sensitive individual details out of shared task notes.'] as Entry,
  contingency: ['contingency', 'Agree a disruption plan and decision owner', 'Program', 'Choose a practical fallback for the event’s actual risks and agree who decides and tells the team. Do not assume transport, outdoor activities or a particular emergency policy applies.'] as Entry,
  cleanup: ['cleanup', 'Agree cleanup and venue handback', 'Venue', 'Confirm who clears each area, returns equipment and checks the venue with its contact. Record the handback outcome rather than assuming departure means cleanup is complete.'] as Entry,
  feedback: ['feedback', 'Capture feedback and next steps', 'Program', 'Ask what worked, what should change, and which follow-ups need an owner. Save concrete lessons for the next event.'] as Entry,
};
const checklists: Record<string, Entry[]> = {
  school: [
    shared.purpose,
    ['approval', 'Confirm school approval and supervision arrangements', 'Program', 'Review the proposed event with the school’s responsible organizer. Confirm the approval route, supervision roles and applicable school procedures; this checklist does not establish policy or grant approval.'],
    shared.venue, shared.budget, shared.needs,
    ['arrival', 'Agree attendee arrival and release arrangements', 'Guest care', 'Confirm how attendees arrive, check in and leave, who supervises each handoff, and how exceptions are handled under the school’s agreed process.'],
    shared.programme, shared.roles,
    ['av', 'Rehearse the programme and equipment transitions', 'Program', 'Test the actual presentation, music or activity equipment with its operator. Record fixes, transition needs and a practical backup.'],
    ['communications', 'Prepare attendee and family information', 'Guest care', 'Draft the confirmed date, place, arrival/release arrangements and contact route. Have the responsible organizer review it before sharing; this task does not send messages.'],
    ['briefing', 'Brief the event team on the final running order', 'Program', 'Walk through the reviewed running order and named roles, including handoffs, the agreed fallback and cleanup. Record who still needs the briefing.', ['programme', 'roles']],
    shared.contingency, shared.cleanup, shared.feedback,
  ],
  corporate: [
    shared.purpose,
    ['decisions', 'Confirm stakeholder decisions and approval owners', 'Program', 'Identify the decisions that need sign-off, who can make them, and the dates the team agrees. A proposal is not an approved commitment.'],
    shared.budget, shared.venue, shared.needs,
    ['vendors', 'Review supplier scope and approval needs', 'Venue', 'Decide which suppliers, if any, are needed. Compare the proposed scope, quote assumptions and approval route before anyone commits; no supplier is booked by this checklist.'],
    shared.programme, shared.roles,
    ['speakers', 'Confirm speaker or facilitator requirements', 'Program', 'Agree session goals, availability and material deadlines with any speakers or facilitators. Note which confirmations remain outstanding.'],
    ['av', 'Rehearse AV and remote participation', 'Program', 'Test the actual rooms, presentation files and any remote-participation setup. Agree a backup and record unresolved issues with owners.'],
    ['briefing', 'Brief the delivery team on the final agenda', 'Program', 'Review the agenda, named delivery roles, transitions and decisions needed on the day. Make outstanding handoffs explicit.', ['programme', 'roles']],
    shared.contingency, shared.cleanup,
    ['followup', 'Record decisions and assign post-event actions', 'Program', 'Capture the decisions actually made and agree an owner for each follow-up. Confirm what may be shared before circulating a summary.'],
  ],
  offsite: [
    shared.purpose, shared.budget, shared.needs,
    ['travel', 'Agree travel, arrival and check-in arrangements', 'Transport', 'Confirm how the group will get there, meeting points and buffers. Distinguish options from booked travel or accommodation; keep confirmation codes private.'],
    shared.programme, shared.roles, shared.contingency, shared.feedback,
  ],
  trip: [
    ['choices', 'Agree the trip plan and must-haves', 'Program', 'Agree who is joining, the destination options, dates and shared priorities. Keep undecided choices visible rather than assuming agreement.'],
    shared.budget, shared.needs,
    ['travel', 'Review travel and accommodation choices', 'Transport', 'Compare suitable options and confirm who will book after group agreement. Record what is actually confirmed, and keep booking codes and personal documents private.'],
    ['itinerary', 'Build a flexible itinerary with travel buffers', 'Program', 'Agree the activities worth reserving and leave room for transfers, breaks and changes. Check actual opening times and availability before treating an option as confirmed.'],
    ['meeting', 'Agree meeting points and a group contact route', 'Guest care', 'Confirm how the group stays in touch and where to meet if separated or delayed. Share only the details the group needs.'],
    shared.contingency, shared.feedback,
  ],
  party: [
    ['shape', 'Agree the party plan and guest count', 'Program', 'Choose the occasion, rough size, date options and what matters most. Keep this proportional to the gathering.'],
    ['place', 'Confirm a place and how guests will arrive', 'Venue', 'Check availability, access needs, setup and cleanup arrangements with whoever controls the space.'],
    ['food', 'Agree food, drinks and a spending limit', 'Food & drink', 'Decide what to provide, who brings what and the agreed cost limit. Check dietary preferences without putting sensitive details in shared notes.'],
    ['invites', 'Prepare the guest information', 'Guest care', 'Draft the agreed date, place, arrival details and reply route. Review it before sharing; Weft does not send it from this task.'],
    ['activities', 'Choose activities and shared responsibilities', 'Program', 'Agree any music, games or other activities and who handles the few practical jobs. Leave unnecessary tasks out.'],
    shared.cleanup,
  ],
  anniversary: [
    ['shape', 'Agree what would make the anniversary meaningful', 'Program', 'Discuss the people, tone and moments that matter. Confirm preferences rather than assuming a surprise, formal meal or large guest list.'],
    shared.budget,
    ['place', 'Confirm the setting and guest arrangements', 'Venue', 'Agree where and when to gather, any access needs and how people will arrive. Confirm availability before treating the setting as booked.'],
    ['memories', 'Prepare the personal touches', 'Program', 'Choose any photos, messages, music or shared memories with appropriate permission. Give preparation jobs clear owners.'],
    ['food', 'Agree food and timing', 'Food & drink', 'Confirm meal preferences, dietary needs and the plan for serving or going out. Keep unknown reservations and prices explicit.'],
    ['day', 'Agree the simple running order and cleanup', 'Program', 'Walk through arrivals, the main moments and cleanup with the people helping. Leave space for the celebration itself.'],
  ],
  other: [shared.purpose, shared.venue, shared.budget, shared.needs, shared.programme, shared.roles, shared.cleanup, shared.feedback],
};

// Optional day-of activities are draft rows, not scheduled appointments.
// Chronological order alone is not a prerequisite for task completion.
type Activity = [id:string,title:string,category:string,note:string,scope:string];
const dayOf: Record<string, Activity[]> = {
  school: [
    ['day_setup','Open the venue and brief the event team','Venue','Confirm the venue is available, walk the setup with the responsible organizer and hand over the agreed roles and contact route.','The venue contact and event lead have confirmed the setup handoff, and unresolved issues have an owner.'],
    ['day_arrivals','Run attendee check-in','Guest care','Use the school’s agreed arrival process. Have the check-in lead tell the event organizer about exceptions without posting personal attendee details in shared notes.','The check-in lead has handed off attendance and unresolved exceptions through the school’s agreed process.'],
    ['day_programme','Run the main programme and transitions','Program','Follow the reviewed order and have the named leads hand off each transition. If the order changes, let the next lead know.','Activity leads have handled transitions and communicated any changes affecting the next part of the programme.'],
    ['day_release','Hand off attendee release and venue close','Guest care','Use the agreed release process and hand remaining issues to the school’s responsible organizer. Confirm who stays for equipment return and venue close.','The responsible organizer has received outstanding release issues and the venue contact has a named closeout lead.'],
  ],
  corporate: [
    ['day_setup','Open rooms and confirm AV handoff','Venue','Check room access, the presentation setup and any remote participation with the people responsible before handing over to the delivery lead.','Room and AV leads have handed over the setup or named a fallback for unresolved issues.'],
    ['day_arrivals','Welcome and check in attendees','Guest care','Brief the welcome team on the arrival route, access support and who should handle exceptions.','The welcome lead has handled arrival handoffs and escalated unresolved access issues.'],
    ['day_programme','Deliver the sessions and announce changes','Program','Use the reviewed agenda. Confirm the next facilitator is ready before each transition and share changes with affected roles.','Facilitators have handed off sessions and the delivery lead has recorded changes requiring follow-up.'],
    ['day_close','Close the event and hand off decisions','Program','Capture decisions and owners before people leave; hand unresolved venue or supplier issues to the responsible organizer.','The organizer has the action owners and the venue contact has an agreed closeout lead.'],
  ],
  offsite: [
    ['day_arrivals','Meet the group and check in','Transport','Use the agreed meeting point and check-in plan. Tell the group how to reconnect if arrival times change.','The arrival lead knows who has joined and has passed on delays or changes.'],
    ['day_programme','Run the main off-site activity','Program','Review the aim, time available and next meeting point with the group before handing over to the activity lead.','The activity lead has communicated timing changes and the next meeting point.'],
    ['day_close','Confirm departure arrangements','Transport','Confirm how everyone is leaving and what follow-ups remain before the group separates.','The group has a departure plan and a named contact for outstanding arrangements.'],
  ],
  trip: [
    ['day_arrivals','Meet at the agreed departure point','Transport','Check in with the group and share any change in departure plans or the fallback meeting point.','The group has checked in and knows where to meet if plans change.'],
    ['day_programme','Run the main outing','Program','Confirm the next activity and meeting point with the group. Adjust for actual delays, breaks and availability.','The group knows any change to the outing and where to meet afterward.'],
    ['day_close','Regroup before the return or next stop','Transport','Confirm the next transfer or stop and who will update people if plans change.','The group has confirmed the next stop or return plan and a contact for delays.'],
  ],
  party: [
    ['day_setup','Set up and welcome guests','Guest care','Check the arrival area and hand over food, music or greeting duties to the people helping.','The welcome area is ready and the helpers know their roles.'],
    ['day_programme','Run the main celebration moment','Program','Check in with the people helping before the main activity or toast. Leave room for timing changes.','The main activity is complete or the helpers know the revised plan.'],
    ['day_close','Close up and return the space','Venue','Check who will clear up, return shared items and close the space with the person responsible.','Cleanup and any outstanding returns have been handed over.'],
  ],
  anniversary: [
    ['day_arrivals','Welcome guests and check the personal touches','Guest care','Check that the agreed photos, music or messages are ready and that helpers know who will lead the welcome.','The welcome lead and personal-touch helpers are ready or have agreed an alternative.'],
    ['day_programme','Share the main anniversary moment','Program','Check with the people involved before starting the planned toast, meal or shared memories. Adapt if preferences or timing change.','The main moment has taken place or the group has agreed an alternative.'],
    ['day_close','Close the gathering and thank helpers','Program','Confirm any cleanup and item returns, and thank the people who helped.','Cleanup is handed over and outstanding items have an owner.'],
  ],
  other: [
    ['day_setup','Check setup and welcome attendees','Guest care','Confirm the space and hand over arrival responsibilities to the people doing the work.','The arrival lead has confirmed setup or named the remaining issue.'],
    ['day_programme','Run the main activity','Program','Use the reviewed running order and let the next lead know about changes.','The activity lead has communicated timing changes and the next handoff.'],
    ['day_close','Hand off cleanup and follow-ups','Venue','Confirm who finishes cleanup and who will handle open decisions or returns.','The team has named owners for cleanup and remaining work.'],
  ],
};

// Proposed results for human review, not evidence of approval or completion.
const outcomes: Record<string,string> = {
  purpose:'The team has recorded the intended audience, purpose and useful result, with open decisions identified.',
  venue:'The space, access route and setup/handback arrangements have been checked with the venue contact; outstanding confirmations are recorded.',
  budget:'A working spending limit and approval owner are recorded, with unknown costs clearly identified.',
  roles:'Delivery roles and backups are recorded and each person’s availability has been checked; remaining gaps are explicit.',
  programme:'A reviewed running order records activities, transitions, durations and buffers without presenting tentative times as confirmed.',
  needs:'Access and dietary needs have been checked through the organizer’s appropriate process, with follow-up owners and no sensitive individual details in shared notes.',
  contingency:'The team has agreed a practical fallback for the actual event risks and named who decides and communicates a change.',
  cleanup:'Area cleanup, equipment returns and venue handback responsibilities have been agreed with the people doing them.',
  feedback:'Concrete lessons and outstanding follow-ups are recorded with owners for the next steps.',
  approval:'The responsible school organizer has confirmed the applicable approval route and supervision arrangements, with outstanding decisions recorded.',
  arrival:'The responsible organizer has reviewed arrival, check-in, release and exception handoffs under the school’s agreed process.',
  av:'The actual equipment and delivery transitions have been rehearsed; unresolved issues have owners and a practical backup is agreed.',
  communications:'The responsible organizer has reviewed the attendee/family information draft and identified any unconfirmed details before sharing.',
  briefing:'The delivery team has reviewed the running order, named roles and handoffs; anyone still needing the briefing is recorded.',
  decisions:'Stakeholder decisions, authorized approval owners and remaining sign-offs are recorded without treating proposals as commitments.',
  vendors:'Supplier needs, scope assumptions and approval routes have been reviewed; no booking or commitment is implied by an unchecked quote.',
  speakers:'Session goals and facilitator/speaker requirements are agreed, with outstanding confirmations and material deadlines recorded.',
  followup:'Decisions actually made and post-event actions are recorded with owners and a reviewed sharing boundary.',
  travel:'The group has reviewed travel and arrival arrangements, clearly separating options from confirmed bookings and keeping booking codes private.',
  choices:'The group has agreed the trip priorities and recorded who is joining, destination/date choices and unresolved decisions.',
  itinerary:'A reviewed itinerary includes transfers, breaks and buffers, with availability still needing confirmation made explicit.',
  meeting:'The group has agreed meeting points and a contact route for separation or delay, sharing only necessary details.',
  shape:'The people planning the occasion have agreed what matters, the intended scale and the choices still open.',
  place:'The setting, access and arrival arrangements have been checked with the people responsible for the space; unconfirmed availability is explicit.',
  food:'Food preferences, responsibilities, timing and cost assumptions are agreed, with unresolved choices kept explicit and sensitive details private.',
  invites:'The guest-information draft has been reviewed for agreed date, place, arrival and reply details; nothing is sent by this task.',
  activities:'The group has agreed suitable activities and named who handles the practical jobs, leaving unnecessary work out.',
  memories:'Chosen personal touches have appropriate permission and preparation owners, with any remaining decisions recorded.',
  day:'The people helping have reviewed arrivals, main moments and cleanup responsibilities, leaving time for the celebration.',
};

type PreparationDates = { eventDate: string; endDate: string; today: string };
// Product-authored lead times, not venue requirements or organizational policy.
const leadDays: Record<string, number> = {
  purpose: 42, approval: 35, decisions: 35, budget: 35, venue: 28,
  vendors: 28, needs: 21, speakers: 21, travel: 21, choices: 28,
  arrival: 14, programme: 14, roles: 14, itinerary: 14,
  communications: 7, contingency: 7, meeting: 7, cleanup: 7,
  shape: 21, place: 14, food: 7, invites: 7, activities: 3, memories: 7,
  av: 2, briefing: 1, day: 1,
};
function shiftDay(day: string, offset: number) {
  const date = new Date(day + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + offset);
  const value = date.toISOString().slice(0, 10);
  if (!value || !validPlanDate(value)) throw new Error('The suggested dates fall outside the supported calendar range. Leave dates unset or choose another event date.');
  return value;
}
export function starterChecklist(kind: string, dates?: PreparationDates, includeActivities = false): PlanOutput {
  if (!Object.hasOwn(checklists, kind)) throw new Error('Choose a supported event type.');
  if (dates && (!dates.eventDate || !dates.today || !validPlanDate(dates.eventDate) || !validPlanDate(dates.today) || !validPlanDate(dates.endDate) || dates.eventDate < dates.today || dates.endDate && dates.endDate < dates.eventDate))
    throw new Error('Use a current or future event date and check the last day, or leave preparation dates unset.');
  const compressed: string[] = [];
  const due = (id: string, title: string) => {
    if (!dates) return '';
    if (id === 'feedback' || id === 'followup') return shiftDay(dates.endDate || dates.eventDate, id === 'feedback' ? 2 : 1);
    const proposed = shiftDay(dates.eventDate, -(leadDays[id] ?? 7));
    if (proposed < dates.today) { compressed.push(title); return dates.today; }
    return proposed;
  };
  const items: PlanItem[] = checklists[kind].map(([id, title, category, note, dependsOn]) => ({
    id, title, category, note, scope: outcomes[id], kind: 'preparation', dueDate: due(id, title), start: '', end: '', location: '', dependsOn: [...(dependsOn || [])], existingTaskIndex: null,
  } satisfies PlanItem));
  if (includeActivities) items.push(...dayOf[kind].map(([id,title,category,note,scope]):PlanItem => ({
    id,title,category,note,scope,kind:'activity',dueDate:'',start:'',end:'',location:'',dependsOn:[],existingTaskIndex:null,
  })));
  return {
    items,
    questions: ['Which items fit your event, and who will own them?', 'What dates, confirmations and details still need a decision?'],
    assumptions: ['Product-authored starter checklist, not AI-generated or tailored to your brief.', dates ? `Preparation deadlines are editable lead-time suggestions anchored to ${dates.eventDate}; wrap-up uses ${dates.endDate || dates.eventDate}. They are not confirmed deadlines. Owners and activity times remain unset; nothing is booked, approved, sent or completed.` : 'Nothing is booked, approved, sent or completed. Dates, times and owners are intentionally unset.', 'A starting point, not a complete safety, legal or organizational-policy checklist. Review it for your event.', ...(includeActivities ? ['Event-day activities are optional. Add reviewed start times before including them in the run sheet; you can set missing start times later in Timeline.'] : [])],
    ...(compressed.length ? {scheduleWarnings:[`Short notice: ${compressed.length} suggested preparation deadlines would fall before ${dates!.today}, so they are proposed for today instead. Review what is feasible, reduce scope or change dates before adding tasks: ${compressed.join('; ')}.`]} : {}),
  };
}
