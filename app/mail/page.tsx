import { requireChatGPTUser } from '@/app/chatgpt-auth';
import { MailInbox } from './mail-client';
import { ThemeToggle } from '@/components/theme-toggle';
export const dynamic = 'force-dynamic';
export default async function Mail({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const params = await searchParams;
  const projectId = typeof params.project === 'string' ? params.project : undefined;
  const query = projectId !== undefined ? '?project=' + encodeURIComponent(projectId) : '';
  await requireChatGPTUser('/mail' + query);
  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <header className="mb-7 flex flex-wrap items-center justify-between gap-4">
        <a href="/" className="text-3xl font-semibold text-primary">
          gather
        </a>
        <nav className="flex flex-wrap items-center gap-5 text-sm">
          <ThemeToggle />
          <a className="underline" href={projectId !== undefined ? '/project' + query : '/'}>
            {projectId !== undefined ? 'Back to project' : 'Projects'}
          </a>
          <a className="underline" href={'/settings' + query}>
            Gmail settings
          </a>
        </nav>
      </header>
      <p className="mb-2 text-sm uppercase tracking-widest text-muted-foreground">
        Organizer only
      </p>
      <h1 className="text-3xl font-semibold">Gmail sources</h1>
      <p className="mb-7 mt-3 text-base text-muted-foreground">
        Account-wide Gmail imports. Only summaries you approve are added to the selected project.
      </p>
      {projectId !== undefined ? <MailInbox projectId={projectId} /> : <a href="/" className="text-primary underline">Open a project, then choose Private Gmail imports from its email briefing.</a>}
    </main>
  );
}
