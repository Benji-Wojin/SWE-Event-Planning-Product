export function PlanGuideHint() {
  return <section aria-labelledby="plan-guide-hint" className="mb-6 space-y-3 rounded-xl border bg-card p-4 text-sm sm:p-5">
    <h2 id="plan-guide-hint" className="font-semibold">Optional stop: draft a plan with AI</h2>
    <ol className="list-decimal space-y-2 ps-5 text-muted-foreground">
      <li><strong className="text-foreground">Describe your event.</strong> Pick an event type and share the goal, size, or constraints you already know. Leave out private details.</li>
      <li><strong className="text-foreground">Choose Generate draft.</strong> Review what will be sent to Groq first. Opening this page doesn’t send anything to AI.</li>
      <li><strong className="text-foreground">Review the suggestions.</strong> Edit or deselect items, then add only the ones you want to share with the team.</li>
    </ol>
    <p className="text-muted-foreground">You can return to your guide without generating a draft or adding tasks.</p>
  </section>;
}
