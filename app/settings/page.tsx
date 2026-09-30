import { requireChatGPTUser, chatGPTSignOutPath } from '@/app/chatgpt-auth';
import { GmailSettings } from './settings-client';
import { ThemeToggle } from '@/components/theme-toggle';
export const dynamic = 'force-dynamic';
export default async function Settings({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const params = await searchParams;
  const projectId = typeof params.project === 'string' ? params.project : undefined;
  return <SignedInSettings projectId={projectId}/>;
}
async function SignedInSettings({projectId}:{projectId?:string}) {
  const query = projectId !== undefined ? '?project=' + encodeURIComponent(projectId) : '';
  const user = await requireChatGPTUser('/settings' + query);
  return (
    <main className="mx-auto max-w-4xl px-5 py-10 md:px-10">
      <header className="mb-9 flex flex-wrap items-center justify-between gap-5">
        <a
          href="/"
          className="text-3xl font-semibold tracking-tight text-primary"
        >
          gather
        </a>
        <div className="flex items-center gap-4"><ThemeToggle /><a
          href={chatGPTSignOutPath()}
          target="_top"
          className="text-sm underline"
        >
          Sign out
        </a></div>
      </header>
      <p className="mb-2 text-sm uppercase tracking-widest text-muted-foreground">
        Organizer settings
      </p>
      <h1 className="mb-3 text-3xl font-semibold">
        Gmail settings
      </h1>
      <p className="mb-7 text-base text-muted-foreground">
        Signed in as {user.displayName}. Private to your account.
      </p>
      {projectId !== undefined && <a href={'/setup' + query} className="mb-7 inline-block text-primary underline">Project settings</a>}
      <GmailSettings projectId={projectId} />
      <a href={projectId !== undefined ? '/project' + query : '/'} className="mt-7 inline-block text-primary underline">
        {projectId !== undefined ? 'Back to project' : 'Projects'}
      </a>
    </main>
  );
}
