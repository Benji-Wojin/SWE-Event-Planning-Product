'use client';

import { useRef, useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { observeTutorial, type TutorialProgress } from '@/lib/guided-tutorial-client';
import { nextTutorialMilestone, TUTORIAL_GUIDE_STEPS } from '@/lib/guided-tutorial';

export function GuideClient({ initial }: { initial: TutorialProgress }) {
  const [progress, setProgress] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const reached = progress.events.map(event => event.checkpoint);
  const next = nextTutorialMilestone(reached);
  const query = progress.projectId ? '?project=' + encodeURIComponent(progress.projectId) : '';
  async function startOrOpenSetup() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setError('');
    try {
      if (next === 'started') setProgress(await observeTutorial('started'));
      else {
        const updated = await observeTutorial('create_project_clicked');
        if (updated.projectId) setProgress(updated);
        else window.location.assign('/setup?guide=1');
      }
    } catch {
      setError('We couldn’t save your guide progress. Try again, or keep using Weft without the guide.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return <section className="space-y-5">
    <p className="text-muted-foreground">Follow a few short steps in a real project. You can leave at any time and resume from Projects. Weft saves guide progress and the app owner can see which steps people reach.</p>
    <ol className="divide-y rounded-xl border bg-card px-5">
      {TUTORIAL_GUIDE_STEPS.map(([id,title,copy], index) => <li key={id} className="py-4" aria-current={id===next?'step':undefined}>
        <p className="font-medium">{index+1}. {title}{reached.includes(id) ? ' · Done' : id==='invite_created' && reached.includes('invite_skipped') ? ' · Skipped' : id===next ? ' · Next' : ''}</p>
        <p className="text-sm text-muted-foreground">{copy}</p>
      </li>)}
    </ol>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap items-center gap-3">
      {next === 'started' || next === 'project_created'
        ? <Button disabled={busy} onClick={startOrOpenSetup}>{busy ? 'Saving…' : next === 'started' ? 'Start guide' : 'Create a project'}</Button>
        : next === 'invite_created'
          ? <a className={buttonVariants()} href={'/project'+query+'&guide=1'}>Resume guide to invite someone</a>
          : <a className={buttonVariants()} href={'/project'+query+(next ? '&guide=1' : '')}>{next ? 'Resume in your project' : 'Open your project'}</a>}
      <a className={buttonVariants({variant:'ghost'})} href="/">Back to projects</a>
    </div>
    {next === null && <p role="status">Guide complete. Your project is ready to keep planning.</p>}
  </section>;
}
