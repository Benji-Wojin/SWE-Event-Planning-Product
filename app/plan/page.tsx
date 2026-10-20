import { requireChatGPTUser } from '@/app/chatgpt-auth';
import { ThemeToggle } from '@/components/theme-toggle';
import { PlanReview } from './plan-client';

export const dynamic = 'force-dynamic';
export default async function Plan({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; demo?: string; as?: string; mode?: string; embed?: string }>;
}) {
  const params = await searchParams;
  const suggestions = params.mode === 'suggestions';
  const assistant = params.mode === 'assistant';
  const query = (params.demo === '1'
      ? 'demo=1&as=' + encodeURIComponent(params.as || 'jack')
      : 'project=' + encodeURIComponent(params.project || 'main')) + (assistant ? '&mode=assistant' : suggestions ? '&mode=suggestions' : '');
  await requireChatGPTUser('/plan?' + query);
  if ((suggestions || assistant) && params.embed === '1') return (
    <main id="embeddedPlan" className="plan-sidebar-shell">
      <PlanReview query={query} embedded />
    </main>
  );
  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <a
          href="/"
          className="text-2xl font-semibold tracking-tight text-primary"
        >
          weft
        </a>
        <ThemeToggle />
      </header>
      <h1 className="mb-2 text-3xl font-semibold">{assistant ? 'Create tasks with Weft' : suggestions ? 'Find your next steps' : 'Draft a plan'}</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        {suggestions ? 'A focused AI review of what’s missing—not another generic checklist. ' : ''}Private until you add selected items to the project.
      </p>
      <PlanReview query={query} />
    </main>
  );
}
