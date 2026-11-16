import { requireChatGPTUser } from '@/app/chatgpt-auth';
import { ThemeToggle } from '@/components/theme-toggle';
import { ProjectSetup } from './setup-client';
import { HttpError, principal } from '@/lib/security';
import { projectIdFrom } from '@/lib/project-access';
import { workspaceTaskId } from '@/lib/workspace-task-link';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';
export default async function Setup({ searchParams }: { searchParams: Promise<{ project?: string | string[]; guide?: string | string[]; scheduleTask?: string | string[] }> }) {
  const params = await searchParams;
  const projectId = typeof params.project === 'string' ? params.project : undefined;
  let scheduleTask = '';
  const task = workspaceTaskId(params.scheduleTask);
  if (task && projectId) {
    try { projectIdFrom(projectId); scheduleTask = task; }
    catch (error) { if (!(error instanceof HttpError && error.status === 404)) throw error; }
  }
  return <SignedInSetup projectId={projectId} guided={!projectId && params.guide==='1'} scheduleTask={scheduleTask} resumeGuide={!!scheduleTask && params.guide==='1'}/>;
}
async function SignedInSetup({projectId,guided,scheduleTask,resumeGuide}:{projectId?:string;guided:boolean;scheduleTask:string;resumeGuide:boolean}) {
  const query = new URLSearchParams();
  if (projectId) query.set('project', projectId);
  if (scheduleTask) query.set('scheduleTask', scheduleTask);
  if (guided || resumeGuide) query.set('guide', '1');
  const returnTo = '/setup' + (query.size ? '?' + query : '');
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
    {!projectId && !guided && <p className="mb-3 text-xs font-medium uppercase tracking-widest text-primary">Your first step · Give your event a home</p>}
    <h1 className={guided ? 'sr-only' : 'mb-4 text-3xl font-semibold'}>{projectId ? 'Project settings' : guided ? 'Set up your event' : 'What are you bringing people together for?'}</h1>
    {!projectId && !guided && <p className="mb-7 text-sm leading-7 text-muted-foreground">Start with a name. Add what you know now, then invite someone to help or open your private project and add the first task. Creating it does not call AI or send invitations.</p>}
    <ProjectSetup projectId={projectId} guided={guided} scheduleTask={scheduleTask} resumeGuide={resumeGuide} />
  </main>;
}
