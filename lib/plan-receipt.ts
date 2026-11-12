export type PlanReceiptTask = {
  id: string;
  title: string;
  handoff?: {
    state: 'needs-owner'|'needs-reassignment'|'awaiting-acceptance'|'accepted'|'needs-review'|'needs-amendment-review'|'changes-requested'|'complete';
    ownerName?: string;
  };
};

export function handoffLabel({state,ownerName}: NonNullable<PlanReceiptTask['handoff']>) {
  switch(state){
    case 'needs-owner': return 'Unassigned · choose an owner';
    case 'needs-reassignment': return 'Owner unavailable · reassign';
    case 'awaiting-acceptance': return ownerName?`Assigned to ${ownerName} · awaiting acceptance`:'Awaiting owner acceptance';
    case 'accepted': return ownerName?`Accepted by ${ownerName}`:'Owner accepted';
    case 'needs-review': return 'Completion needs verification';
    case 'needs-amendment-review': return 'Complete · updated evidence needs review';
    case 'changes-requested': return 'Completion changes requested';
    case 'complete': return 'Complete';
  }
}
