import type { PlanItem, PlanOutput } from './plan-generation';

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

export function starterChecklist(kind: string): PlanOutput {
  if (!Object.hasOwn(checklists, kind)) throw new Error('Choose a supported event type.');
  return {
    items: checklists[kind].map(([id, title, category, note, dependsOn]) => ({
      id, title, category, note, kind: 'preparation', dueDate: '', start: '', end: '', location: '', dependsOn: [...(dependsOn || [])], existingTaskIndex: null,
    } satisfies PlanItem)),
    questions: ['Which items fit your event, and who will own them?', 'What dates, confirmations and details still need a decision?'],
    assumptions: ['Product-authored starter checklist, not AI-generated or tailored to your brief.', 'Nothing is booked, approved, sent or completed. Dates, times and owners are intentionally unset.', 'A starting point, not a complete safety, legal or organizational-policy checklist. Review it for your event.'],
  };
}
