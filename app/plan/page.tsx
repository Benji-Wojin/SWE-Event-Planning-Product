import { requireChatGPTUser } from '@/app/chatgpt-auth';
import { ThemeToggle } from '@/components/theme-toggle';
import { PlanReview } from './plan-client';

export const dynamic = 'force-dynamic';
export default async function Plan({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; demo?: string; as?: string }>;
}) {
  const params = await searchParams;
  const query =
    params.demo === '1'
      ? 'demo=1&as=' + encodeURIComponent(params.as || 'jack')
      : 'project=' + encodeURIComponent(params.project || 'main');
  await requireChatGPTUser('/plan?' + query);
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
      <h1 className="mb-2 text-3xl font-semibold">Draft a plan</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Private until you add selected items to the project.
      </p>
      <PlanReview query={query} />
    </main>
  );
}
