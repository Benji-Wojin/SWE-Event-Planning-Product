import Link from 'next/link';
import type { readOnboardingMilestones } from '@/lib/onboarding-milestones';

type Dashboard = Awaited<ReturnType<typeof readOnboardingMilestones>>;
const timestamp = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC',
});

function Activity({ data }: { data: Dashboard['activity'] }) {
  const today = data.days[0];
  const stats = [
    ['Active today', today.active], ['Active in 7 days', data.weeklyActive],
    ['App opens today', today.opens], ['Tasks created today', today.created],
    ['Tasks completed today', today.completed],
  ] as const;
  return (
    <section aria-labelledby="product-activity" className="space-y-4">
      <h2 id="product-activity" className="text-lg font-semibold">Product activity</h2>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stats.map(([label, count]) => (
          <div key={label} className="rounded-xl border bg-card p-3">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="mt-2 text-2xl font-semibold tabular-nums">{count.toLocaleString('en-US')}</dd>
          </div>
        ))}
      </dl>
      <details className="rounded-xl border bg-card p-3">
        <summary className="cursor-pointer py-2 text-sm font-medium">Daily breakdown · last 14 days (UTC)</summary>
        <table className="mt-2 w-full table-fixed text-left text-xs sm:text-sm">
          <caption className="sr-only">Daily activity totals, newest first</caption>
          <thead className="border-b">
            <tr>
              <th scope="col" className="w-[24%] px-1 py-2">Date</th>
              <th scope="col" className="px-1 py-2">Active users</th>
              <th scope="col" className="px-1 py-2">App opens</th>
              <th scope="col" className="px-1 py-2">Tasks created</th>
              <th scope="col" className="px-1 py-2">Tasks completed</th>
            </tr>
          </thead>
          <tbody>
            {data.days.map(day => (
              <tr key={day.day} className="border-b last:border-b-0">
                <th scope="row" className="px-1 py-2 font-normal"><time dateTime={day.day}>{day.day}</time></th>
                <td className="px-1 py-2 tabular-nums">{day.active}</td>
                <td className="px-1 py-2 tabular-nums">{day.opens}</td>
                <td className="px-1 py-2 tabular-nums">{day.created}</td>
                <td className="px-1 py-2 tabular-nums">{day.completed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Active users are unique accounts with a counted open, task creation, or task completion in the period.
        An open counts at most once per account in each 30-minute UTC window on Projects or a workspace.
        Task totals count saved additions and existing tasks moved to Done, after verification when required.
        A reopened task can be completed again. Demo and app-owner activity are excluded; historical activity is not backfilled.
      </p>
    </section>
  );
}

function Milestone({ at }: { at: string | null }) {
  if (!at) return <span className="text-muted-foreground">Not recorded</span>;
  return (
    <>
      <span className="block font-medium">Recorded</span>
      <time className="text-muted-foreground" dateTime={at}>{timestamp.format(new Date(at))}</time>
    </>
  );
}

export function OnboardingDashboard({ data }: { data: Dashboard }) {
  const { totals, rows, after, next } = data;
  const stats = [
    ['Registered accounts', totals.accounts],
    ['Created a project', totals.projects],
    ['Created a task', totals.tasks],
    ['Completed both', totals.both],
  ] as const;
  return (
    <div className="space-y-6">
      <Activity data={data.activity} />
      <h2 className="border-t pt-6 text-lg font-semibold">Onboarding milestones</h2>
      <p className="text-sm leading-relaxed text-muted-foreground">
        See which accounts reached the two first-use milestones. The steps are
        independent, and totals exclude the app owner and demo activity.
      </p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(([label, count]) => (
          <div key={label} className="rounded-xl border bg-card p-3 sm:p-4">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="mt-2 text-2xl font-semibold tabular-nums">{count.toLocaleString('en-US')}</dd>
          </div>
        ))}
      </dl>
      <section aria-labelledby="onboarding-accounts" className="space-y-4">
        <div>
          <h2 id="onboarding-accounts" className="text-lg font-semibold">Progress by account</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            All times are UTC. Users can find their account code on their Account page.
          </p>
        </div>
        {rows.length ? (
          <div className="overflow-x-auto rounded-xl border" tabIndex={0} role="region" aria-label="Account milestones">
            <table className="w-full table-fixed text-left text-sm">
              <caption className="sr-only">First project and first task by account</caption>
              <thead className="border-b bg-muted/50">
                <tr>
                  <th scope="col" className="w-2/5 px-2 py-3 font-medium sm:px-4">Account code</th>
                  <th scope="col" className="px-2 py-3 font-medium sm:px-4">First project</th>
                  <th scope="col" className="px-2 py-3 font-medium sm:px-4">First task</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.accountCode} className="border-b last:border-b-0">
                    <th scope="row" className="break-all px-2 py-3 text-left font-mono text-xs font-normal sm:px-4">{row.accountCode}</th>
                    <td className="break-words px-2 py-3 sm:px-4"><Milestone at={row.firstProjectAt} /></td>
                    <td className="break-words px-2 py-3 sm:px-4"><Milestone at={row.firstTaskAt} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="rounded-xl border bg-card p-4 text-sm">{after ? 'No more accounts on this page.' : 'No registered accounts yet.'}</p>}
        {(after || next) && (
          <nav aria-label="Account results pages" className="flex flex-wrap gap-4 text-sm">
            {after && <Link prefetch={false} className="underline" href="/admin/onboarding">First page</Link>}
            {next && <Link prefetch={false} className="underline" href={{ pathname: '/admin/onboarding', query: { after: next } }}>Next page</Link>}
          </nav>
        )}
      </section>
      <p className="border-t pt-4 text-sm leading-relaxed text-muted-foreground">
        First project uses existing project records. First task records the first successful
        addition since task tracking began, including adding a new task from a reviewed plan.
        “Not recorded” does not rule out earlier activity. Drafts and reused tasks do not count.
      </p>
    </div>
  );
}
