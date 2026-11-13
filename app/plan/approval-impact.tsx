import type { ReviewedItem } from '@/lib/plan-generation';

export function PlanApprovalImpact({ selected }: { selected: readonly ReviewedItem[] }) {
  let preparation = 0, timed = 0, locationInNotes = false;
  const untimed: ReviewedItem[] = [];
  for (const item of selected) {
    if (item.kind === 'preparation') preparation++;
    else if (item.start) timed++;
    else untimed.push(item);
    if (!item.start && item.location.trim()) locationInNotes = true;
  }

  return <section id="plan-approval-impact" aria-labelledby="plan-approval-impact-heading" className="space-y-2">
    <h3 id="plan-approval-impact-heading" className="font-semibold">Selected items preview</h3>
    {selected.length ? <>
      <p className="text-sm text-muted-foreground">If added, these become incomplete items in Shared tasks. Unchecked proposals stay private; existing tasks used as prerequisites aren’t edited.</p>
      <ul className="space-y-1 border-s ps-3 text-sm">
        {preparation > 0 && <li><strong>{preparation} preparation {preparation === 1 ? 'task' : 'tasks'}</strong></li>}
        {timed > 0 && <li><strong>{timed} event-day {timed === 1 ? 'activity' : 'activities'} with a start time entered</strong><span className="block text-muted-foreground">Appears on the Timeline timetable and run sheet if the time passes validation.</span></li>}
        {untimed.length > 0 && <li>
          <strong>{untimed.length} event-day {untimed.length === 1 ? 'activity' : 'activities'} without a start time</strong>
          <span className="block text-muted-foreground">Needs a start time before appearing on the timetable or run sheet.</span>
          <details className="mt-1">
            <summary className="min-h-11 cursor-pointer content-center text-primary">See activities that need a start time</summary>
            <ul className="list-disc space-y-1 ps-5">
              {untimed.map(item => <li key={item.id} className="wrap-anywhere">{item.title.trim() || 'Untitled activity'}</li>)}
            </ul>
          </details>
        </li>}
      </ul>
      {locationInNotes && <p className="text-sm text-muted-foreground">Locations entered without a start time go into shared task notes, not Timeline locations.</p>}
    </> : <p className="text-sm text-muted-foreground">No items selected. Nothing will be added.</p>}
  </section>;
}
