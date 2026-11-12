'use client';

import { useRef, useState } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { observeTutorial, type TutorialProgress } from '@/lib/guided-tutorial-client';
import { nextTutorialMilestone, TUTORIAL_GUIDE_STEPS as steps } from '@/lib/guided-tutorial';
import { GuideStage } from '@/components/guide-stage';

export function GuideClient({ initial }: { initial: TutorialProgress }) {
  const [progress, setProgress] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const reached = progress.events.map(event => event.checkpoint);
  const next = nextTutorialMilestone(reached);
  const query = progress.projectId ? '?project=' + encodeURIComponent(progress.projectId) : '';
  const currentIndex = next === 'started' ? 0 : steps.findIndex(([id]) => id === next);
  const intro = next === 'started';
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
  return <section className="weft-guide-intro" aria-label="First project guide">
    <div className="weft-guide-hero">
      {currentIndex >= 0 && !intro ? <GuideStage step={currentIndex+1} /> : <span className="weft-guide-badge">{intro ? 'Five quick steps' : 'Guide complete'}</span>}
      <h2>{intro ? 'Get your event off the ground' : next ? steps[currentIndex]?.[1] : 'You’re ready to keep planning'}</h2>
      <p>{intro ? 'Create a real project, add your first task, and see where the team will work together. You can pause any time and pick up from Getting started.' : next ? steps[currentIndex]?.[2] : reached.includes('invite_skipped') ? 'You finished the guide on your own. Invite a teammate from People whenever you’re ready.' : 'Your invitation is ready. Your teammate still needs to accept it.'}</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="weft-guide-actions">
        {intro || next === 'project_created'
          ? <Button disabled={busy} onClick={startOrOpenSetup}>{busy ? 'Saving…' : intro ? 'Start guide' : 'Create a project'}</Button>
          : <a className={buttonVariants()} href={'/project'+query+(next ? '&guide=1' : '')}>{next ? 'Resume in your project' : 'Open your project'}</a>}
        <a className={buttonVariants({variant:'ghost'})} href="/">Back to projects</a>
      </div>
    </div>
    <ol className="weft-guide-roadmap" aria-label="Guide steps">
      {steps.map(([id,title,copy], index) => {
        const status = reached.includes(id) ? 'Done' : id==='invite_created' && reached.includes('invite_skipped') ? 'Skipped' : id===next ? 'Up next' : id==='invite_created' ? 'Optional' : '';
        return <li key={id} aria-current={id===next?'step':undefined}>
          <span aria-hidden="true">{status==='Done'?'✓':index+1}</span><div><strong>{title}</strong><p>{copy}</p></div>
          {status && <span className="weft-guide-badge">{status}</span>}
        </li>;
      })}
    </ol>
    <p className="weft-guide-fine-print">Weft saves which steps you reach so you can resume. The app owner can see that progress to improve onboarding.</p>
  </section>;
}
