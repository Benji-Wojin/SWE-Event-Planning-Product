export type PlanReceiptTask = {
  id: string;
  title: string;
  needsStartTime?: true;
  scheduleDay?: string;
  handoff?: {
    state: 'needs-owner'|'needs-reassignment'|'awaiting-acceptance'|'awaiting-schedule-acceptance'|'accepted'|'needs-review'|'review-blocked'|'needs-amendment-review'|'changes-requested'|'complete';
    ownerName?: string;
  };
};

const handoffSections = [
  { id: 'owner', title: 'Assign an owner', help: 'Open a task to choose an owner in Edit task details. The task changes only when you save.' },
  { id: 'review', title: 'Review completion', help: 'Open a task to review its completion or updated evidence.' },
  { id: 'required-work', title: 'Review required work', help: 'Open the task and check Task relationships. The report is still on file, but verification must wait until the required work is resolved.' },
  { id: 'schedule-acceptance', title: 'Waiting for renewed acceptance', help: 'The schedule changed. The assigned owner needs to review the current plan and accept responsibility again.' },
  { id: 'acceptance', title: 'Waiting for acceptance', help: 'The assigned person still needs to accept responsibility.' },
  { id: 'revision', title: 'Waiting for a revised submission', help: 'The owner needs to address the requested changes and resubmit.' },
  { id: 'settled', title: 'Accepted or complete', help: '' },
  { id: 'unknown', title: 'Status unavailable', help: 'Open a task to see its current status.' },
] as const;

const sectionByState = {
  'needs-owner': 'owner',
  'needs-reassignment': 'owner',
  'needs-review': 'review',
  'review-blocked': 'required-work',
  'needs-amendment-review': 'review',
  'awaiting-schedule-acceptance': 'schedule-acceptance',
  'awaiting-acceptance': 'acceptance',
  'changes-requested': 'revision',
  accepted: 'settled',
  complete: 'settled',
} satisfies Record<NonNullable<PlanReceiptTask['handoff']>['state'], typeof handoffSections[number]['id']>;

export function groupPlanHandoff(tasks: PlanReceiptTask[]) {
  const groups = handoffSections.map(section => ({ ...section, tasks: [] as PlanReceiptTask[] }));
  const byId = new Map(groups.map(group => [group.id, group]));
  for (const task of tasks) {
    const section = task.handoff && byId.get(sectionByState[task.handoff.state]);
    (section || byId.get('unknown')!).tasks.push(task);
  }
  return groups.filter(group => group.tasks.length > 0);
}

export function handoffLabel({state,ownerName}: NonNullable<PlanReceiptTask['handoff']>) {
  switch(state){
    case 'needs-owner': return 'Unassigned · choose an owner';
    case 'needs-reassignment': return 'Owner unavailable · reassign';
    case 'awaiting-schedule-acceptance': return ownerName?`Schedule changed · ${ownerName} needs to accept again`:'Schedule changed · owner needs to accept again';
    case 'awaiting-acceptance': return ownerName?`Assigned to ${ownerName} · awaiting acceptance`:'Awaiting owner acceptance';
    case 'accepted': return ownerName?`Accepted by ${ownerName}`:'Owner accepted';
    case 'needs-review': return 'Completion needs verification';
    case 'review-blocked': return 'Verification waiting on required work';
    case 'needs-amendment-review': return 'Complete · updated evidence needs review';
    case 'changes-requested': return ownerName? `Changes requested · waiting for ${ownerName}` : 'Completion changes requested';
    case 'complete': return 'Complete';
  }
}
