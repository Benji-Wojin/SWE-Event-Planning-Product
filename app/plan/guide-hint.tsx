const sample = 'A two-hour welcome night for 40 people. We need a check-in table, a short intro, and time to clean up.';

const steps = [
  ['Describe your event', 'Choose an event type. In “What are you planning?”, add the goal, approximate size, and any constraints. Leave out sensitive details.'],
  ['Generate a private draft', 'Read what gets sent to Groq, then choose Generate draft. You can also use a starter checklist without AI.'],
  ['Review and add what you want', 'Edit or deselect suggestions, then add your selection. Tasks appear in Shared tasks, and scheduled activities appear in Timeline.'],
] as const;

export type PlanGuideStage = 'brief' | 'generate' | 'starter' | 'review' | 'added';

const nextAction: Record<PlanGuideStage, {href: string; label: string}> = {
  brief: {href: '#plan-kind', label: 'Start the event brief'},
  generate: {href: '#plan-generate', label: 'Go to draft controls'},
  starter: {href: '#plan-starter', label: 'Go to starter checklist'},
  review: {href: '#plan-proposed-items', label: 'Review proposed items'},
  added: {href: '#plan-receipt-heading', label: 'See what was added'},
};

export function PlanGuideHint({ stage, locked, draftNeedsRecheck = false }: { stage: PlanGuideStage; locked: boolean; draftNeedsRecheck?: boolean }) {
  const current = stage === 'brief' ? 0 : stage === 'generate' || stage === 'starter' ? 1 : stage === 'review' ? 2 : -1;
  const action = nextAction[stage];
  return <section aria-labelledby="plan-guide-hint" className="mb-6 space-y-4 rounded-2xl border border-primary/25 bg-card p-4 text-sm sm:p-6">
    <header className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">Getting started · Optional walkthrough</p>
      <h2 id="plan-guide-hint" className="text-lg font-semibold">From event brief to a plan you can edit</h2>
      <p className="max-w-prose text-muted-foreground">Opening the planner doesn’t send anything to AI or change your project. You can return to your guide at any time.</p>
    </header>
    <ol aria-label="Plan walkthrough" className="grid gap-2 sm:grid-cols-3">
      {steps.map(([title, instruction], index) => <li key={title}
        aria-current={current === index ? 'step' : undefined}
        className={current === index ? 'space-y-1 rounded-lg border border-primary/40 bg-primary/10 p-3' : 'space-y-1 rounded-lg border p-3'}>
        <h3 className="font-semibold">{index + 1}. {stage === 'starter' && index === 1 ? 'Start a private draft' : title}</h3>
        <p className="leading-relaxed text-muted-foreground">{stage === 'starter' && index === 1 ? 'Choose Use starter checklist to get an editable set of tasks without AI.' : instruction}</p>
      </li>)}
    </ol>
    {(stage === 'brief' || stage === 'starter') && <p className="rounded-lg bg-muted/50 px-3 py-2 text-muted-foreground">
      <strong className="text-foreground">Sample brief:</strong> “{sample}”
    </p>}
    {stage === 'starter' && <p className="text-muted-foreground">AI isn’t configured for this planner. You can still practice reviewing a private draft with a starter checklist.</p>}
    {draftNeedsRecheck && <p className="text-muted-foreground">The project changed since this draft was saved. Review and update the draft before adding anything.</p>}
    {!locked && <a href={action.href} className="inline-flex min-h-11 items-center rounded-lg border px-3 font-medium text-primary underline underline-offset-4">{action.label}</a>}
  </section>;
}
