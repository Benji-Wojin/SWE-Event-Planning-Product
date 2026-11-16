import type { PlanScheduleIssue, ReviewedItem } from '@/lib/plan-generation';

export function PlanApprovalImpact({ selected, itemNumbers, scheduleIssues, onEditSchedule }: {
  selected: readonly ReviewedItem[];
  itemNumbers: ReadonlyMap<string, number>;
  scheduleIssues: ReadonlyMap<string, { item: ReviewedItem; issue: PlanScheduleIssue }>;
  onEditSchedule?: (itemId: string, field: 'start' | 'end') => void;
}) {
  let preparation = 0, timed = 0, locationInNotes = false;
  const untimed: ReviewedItem[] = [];
  for (const item of selected) {
    if (scheduleIssues.has(item.id)) continue;
    if (item.kind === 'preparation') preparation++;
    else if (item.start) timed++;
    else untimed.push(item);
    if (!item.start && item.location.trim()) locationInNotes = true;
  }

  return <section id="plan-approval-impact" aria-labelledby="plan-approval-impact-heading" className="space-y-2">
    <h3 id="plan-approval-impact-heading" className="font-semibold">Selected items preview</h3>
    {scheduleIssues.size > 0 && <div className="space-y-2 rounded-md border border-destructive/40 p-3 text-sm">
      <p className="font-semibold">Review activity times before adding items</p>
      <ul className="space-y-2">
        {Array.from(scheduleIssues.values(), ({ item, issue }) => {
          const title = item.title.trim() || 'Untitled activity';
          const number = itemNumbers.get(item.id);
          const label = `Fix ${issue.field} time`;
          return <li key={item.id} className="wrap-anywhere">
            <strong>{title}</strong>{number !== undefined && <span className="ms-2 text-xs text-muted-foreground">Item {number}</span>}
            <p className="text-muted-foreground">{issue.message} {issue.blocksPrivateSave && !item.included && 'Unchecked items still need valid fields to save the private draft.'}</p>
            {onEditSchedule && number !== undefined && <button type="button" className="inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4"
              aria-label={`${label} for ${title} (item ${number})`} onClick={() => onEditSchedule(item.id, issue.field)}>{label}</button>}
          </li>;
        })}
      </ul>
    </div>}
    {selected.length ? <>
      <p className="text-sm text-muted-foreground">If added, these become incomplete items in Shared tasks. Unchecked proposals stay private; existing tasks used as prerequisites aren’t edited.</p>
      {(preparation > 0 || timed > 0 || untimed.length > 0) && <ul className="space-y-1 border-s ps-3 text-sm">
        {preparation > 0 && <li><strong>{preparation} preparation {preparation === 1 ? 'task' : 'tasks'}</strong></li>}
        {timed > 0 && <li><strong>{timed} event-day {timed === 1 ? 'activity' : 'activities'} with a start time entered</strong><span className="block text-muted-foreground">Once added, appears on the Timeline timetable and run sheet.</span></li>}
        {untimed.length > 0 && <li>
          <strong>{untimed.length} event-day {untimed.length === 1 ? 'activity' : 'activities'} without a start time</strong>
          <span className="block text-muted-foreground">Needs a start time before appearing on the timetable or run sheet.</span>
          <details className="mt-1">
            <summary className="min-h-11 cursor-pointer content-center text-primary">See activities that need a start time</summary>
            <ul className="list-disc space-y-1 ps-5">
              {untimed.map(item => {
                const title = item.title.trim() || 'Untitled activity';
                const number = itemNumbers.get(item.id);
                return <li key={item.id} className="wrap-anywhere">
                  <span>{title}</span>{number !== undefined && <span className="ms-2 text-xs text-muted-foreground">Item {number}</span>}
                  {onEditSchedule && number !== undefined && <button type="button" className="ms-2 inline-flex min-h-11 items-center font-medium text-primary underline underline-offset-4"
                    aria-label={`Set start time for ${title} (item ${number})`} onClick={() => onEditSchedule(item.id, 'start')}>Set start time</button>}
                </li>;
              })}
            </ul>
          </details>
        </li>}
      </ul>}
      {locationInNotes && <p className="text-sm text-muted-foreground">Locations entered without a start time go into shared task notes, not Timeline locations.</p>}
    </> : <p className="text-sm text-muted-foreground">No items selected. Nothing will be added.</p>}
  </section>;
}
