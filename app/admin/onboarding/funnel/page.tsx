import { notFound, redirect } from 'next/navigation';
import { chatGPTSignInPath } from '@/app/chatgpt-auth';
import { AccountLayout } from '@/components/account-layout';
import { TUTORIAL_MILESTONES, TUTORIAL_STEPS } from '@/lib/guided-tutorial';
import { readTutorialFunnel } from '@/lib/tutorial-funnel';
import { HttpError } from '@/lib/security';

const path = '/admin/onboarding/funnel';
const labels = new Map(TUTORIAL_STEPS.map(step => [step.id,step.title]));
const utc = new Intl.DateTimeFormat('en', { dateStyle:'medium', timeStyle:'short', timeZone:'UTC' });
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Tutorial funnel — Weft', robots: { index:false, follow:false } };
export default async function TutorialFunnelPage({ searchParams }: { searchParams: Promise<{ after?: string }> }) {
  const { after } = await searchParams;
  let data;
  try { data = await readTutorialFunnel(after); }
  catch (error) {
    if (error instanceof HttpError && error.status===401) redirect(chatGPTSignInPath(path));
    if (error instanceof HttpError && error.status===403) notFound();
    throw error;
  }
  const started = data.counts[0].accounts;
  const totals = new Map(data.counts.map(item => [item.checkpoint,item.accounts]));
  return <AccountLayout title="Tutorial funnel">
    <div className="space-y-8">
      <a href="/admin/onboarding" className="text-sm underline">Back to usage analytics</a>
      <section aria-labelledby="tutorial-checkpoints" className="space-y-3">
        <h2 id="tutorial-checkpoints" className="text-xl font-semibold">Checkpoint totals</h2>
        <p className="text-sm text-muted-foreground">Version {data.version}. Accounts are counted once per checkpoint. A click or view is separate from a confirmed save. The app owner’s test activity is excluded.</p>
        <div className="overflow-x-auto rounded-xl border"><table className="w-full text-left text-sm">
          <thead><tr><th scope="col" className="p-3">Checkpoint</th><th scope="col" className="p-3">Accounts</th><th scope="col" className="p-3">Of starts</th></tr></thead>
          <tbody>{data.counts.map(({checkpoint,accounts}) => <tr key={checkpoint} className="border-t">
            <th scope="row" className="p-3 font-medium">{labels.get(checkpoint)}</th>
            <td className="p-3 tabular-nums">{accounts}</td><td className="p-3 tabular-nums">{started ? Math.round(accounts*100/started)+'%' : '—'}</td>
          </tr>)}</tbody>
        </table></div>
      </section>
      <section aria-labelledby="tutorial-resume" className="space-y-3">
        <h2 id="tutorial-resume" className="text-xl font-semibold">Next step by account</h2>
        <p className="text-sm text-muted-foreground">“Not yet reached” may mean someone is still working through the guide. Expand an account to see its recorded timestamps (UTC).</p>
        <ul className="flex flex-wrap gap-2 text-sm">
          {TUTORIAL_MILESTONES.slice(1).map((id,index) => <li key={id} className="rounded-lg border px-3 py-2">
            {labels.get(id)}: {(totals.get(TUTORIAL_MILESTONES[index]) ?? 0)-(totals.get(id) ?? 0)} not yet reached
          </li>)}
        </ul>
        {data.rows.length===0 ? <p>No accounts on this page.</p> : <ul className="divide-y rounded-xl border">
          {data.rows.map(row => <li key={row.code} className="px-4 py-3"><details>
            <summary className="cursor-pointer break-words"><span className="font-medium">{row.code}</span> · {row.next ? 'Next: '+labels.get(row.next) : 'Guide complete'}</summary>
            <ol className="mt-2 space-y-1 text-sm text-muted-foreground">{row.events.map(event => <li key={event.checkpoint}>
              {labels.get(event.checkpoint)} · <time dateTime={event.at}>{utc.format(new Date(event.at))}</time>
            </li>)}</ol>
          </details></li>)}
        </ul>}
        <nav aria-label="Funnel pages" className="flex flex-wrap gap-4 text-sm">
          {data.after && <a className="underline" href={path}>First page</a>}
          {data.next && <a className="underline" href={path+'?after='+encodeURIComponent(data.next)}>Next accounts</a>}
        </nav>
      </section>
    </div>
  </AccountLayout>;
}
