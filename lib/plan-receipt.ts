export type PlanReceiptTask = {
  id: string;
  title: string;
  handoff?: {
    state: 'needs-owner'|'needs-reassignment'|'awaiting-acceptance'|'accepted'|'needs-review'|'needs-amendment-review'|'changes-requested'|'complete';
    ownerName?: string;
  };
};

const handoffSections = [
  { id: 'owner', title: 'Assign an owner', help: 'Open a task and choose an active owner in Edit task details.' },
  { id: 'review', title: 'Review completion', help: 'Open a task to review its completion or updated evidence.' },
  { id: 'acceptance', title: 'Waiting for acceptance', help: 'The assigned person still needs to accept responsibility.' },
  { id: 'revision', title: 'Waiting for a revised submission', help: 'The owner needs to address the requested changes and resubmit.' },
  { id: 'settled', title: 'Accepted or complete', help: '' },
  { id: 'unknown', title: 'Status unavailable', help: 'Open a task to see its current status.' },
] as const;

const sectionByState = {
  'needs-owner': 'owner',
  'needs-reassignment': 'owner',
  'needs-review': 'review',
  'needs-amendment-review': 'review',
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
    case 'awaiting-acceptance': return ownerName?`Assigned to ${ownerName} · awaiting acceptance`:'Awaiting owner acceptance';
    case 'accepted': return ownerName?`Accepted by ${ownerName}`:'Owner accepted';
    case 'needs-review': return 'Completion needs verification';
    case 'needs-amendment-review': return 'Complete · updated evidence needs review';
    case 'changes-requested': return ownerName? `Changes requested · waiting for ${ownerName}` : 'Completion changes requested';
    case 'complete': return 'Complete';
  }
}
