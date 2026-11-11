import { requireChatGPTUser } from '@/app/chatgpt-auth';
import { ThemeToggle } from '@/components/theme-toggle';
import { ProjectSetup } from './setup-client';
import { HttpError, principal } from '@/lib/security';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';
export default async function Setup({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const params = await searchParams;
  const projectId = typeof params.project === 'string' ? params.project : undefined;
  return <SignedInSetup projectId={projectId}/>;
}
async function SignedInSetup({projectId}:{projectId?:string}) {
  const returnTo = '/setup' + (projectId ? '?project=' + encodeURIComponent(projectId) : '');
  await requireChatGPTUser(returnTo);
  try {
    await principal();
  } catch (error) {
    if (error instanceof HttpError && error.status === 403)
      redirect('/signup?return_to=' + encodeURIComponent(returnTo));
    throw error;
  }
  return <main className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-12">
    <header className="mb-10 flex flex-wrap items-center justify-between gap-4">
      <a href="/" className="text-2xl font-semibold tracking-tight text-primary">weft</a>
      <ThemeToggle />
    </header>
    {!projectId && <p className="mb-3 text-xs font-medium uppercase tracking-widest text-primary">Your first step · Give your event a home</p>}
    <h1 className="mb-4 text-3xl font-semibold">{projectId ? 'Project settings' : 'What are you bringing people together for?'}</h1>
    {!projectId && <p className="mb-7 text-sm leading-7 text-muted-foreground">Start with a name. Add what you know now, then invite someone to help or open your private project and add the first task. Creating it does not call AI or send invitations.</p>}
    <ProjectSetup projectId={projectId} />
  </main>;
}
