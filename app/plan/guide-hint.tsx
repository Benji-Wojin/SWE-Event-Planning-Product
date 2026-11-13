const steps = [
  {
    title: 'Describe your event',
    instruction: <>Pick an <strong>Event type</strong>, then use <strong>What are you planning?</strong> to share the goal, size, and constraints. Leave out sensitive details.</>,
  },
  {
    title: 'Generate a private draft',
    instruction: <>Read the note about what goes to Groq, then choose <strong>Generate draft</strong> (or <strong>Generate another draft</strong> if you already have one). Opening this page alone doesn’t send anything to AI. For a non-AI option, choose <strong>Use starter checklist</strong> or <strong>Replace with starter checklist</strong>.</>,
  },
  {
    title: 'Choose what goes into the project',
    instruction: <>Review the suggestions. Edit titles, dates, or owners as needed, and deselect anything you don’t want. Choose <strong>Add selected items to project</strong> to put them in <strong>Shared tasks</strong>. Scheduled activities also appear in <strong>Timeline</strong>.</>,
  },
];

export function PlanGuideHint({ hasDraft, locked }: { hasDraft: boolean; locked: boolean }) {
  return <section aria-labelledby="plan-guide-hint" className="mb-6 space-y-3 rounded-2xl border bg-card p-4 text-sm sm:p-6">
    <header className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">Getting started · Optional walkthrough</p>
      <h2 id="plan-guide-hint" className="text-lg font-semibold">From event brief to a plan you can edit</h2>
      <p className="max-w-prose text-muted-foreground">Describe your event, generate a private draft, then choose what to add. Or choose <strong className="text-foreground">Return to your guide</strong> to continue without generating or adding anything.</p>
    </header>
    {!locked && <div className="flex flex-wrap gap-x-4 gap-y-1">
      <a href="#plan-kind" className="inline-flex min-h-11 items-center rounded-lg border px-3 font-medium text-primary underline underline-offset-4">Start the event brief</a>
      {hasDraft && <a href="#plan-proposed-items" className="inline-flex min-h-11 items-center px-1 font-medium text-primary underline underline-offset-4">Review proposed items</a>}
    </div>}
    <details className="border-t">
      <summary className="min-h-11 cursor-pointer py-3 font-medium">See a sample brief and what happens next</summary>
      <ol className="list-decimal space-y-4 ps-5 marker:font-semibold marker:text-primary">
        {steps.map(({ title, instruction }, index) => <li key={title} className="space-y-1 ps-1">
          <h3 className="font-semibold">{title}</h3>
          <p className="leading-relaxed text-muted-foreground">{instruction}</p>
          {index === 0 && <p className="mt-2 rounded-lg border bg-muted/40 px-3 py-2 text-muted-foreground">
            <strong className="text-foreground">Example:</strong> “A two-hour welcome night for 40 people. We need a check-in table, a short intro, and time to clean up.”
          </p>}
          {index === 1 && <p className="mt-2 rounded-lg border bg-muted/40 px-3 py-2 text-muted-foreground">
            <strong className="text-foreground">Example suggestions:</strong> Set up the check-in table, choose a greeter, and schedule cleanup. Your draft will depend on your brief.
          </p>}
        </li>)}
      </ol>
    </details>
  </section>;
}
