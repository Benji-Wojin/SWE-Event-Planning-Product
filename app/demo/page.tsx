import { requireChatGPTUser } from '@/app/chatgpt-auth';
import { workspaceTaskId } from '@/lib/workspace-task-link';
export const dynamic = 'force-dynamic';
export default async function Demo({ searchParams }: { searchParams: Promise<{ as?: string;task?: string }> }) {
  const params = await searchParams;
  const actor = typeof params.as === 'string' && ['jack','maya','jules','dev'].includes(params.as) ? params.as : 'jack';
  return <SignedInDemo actor={actor} task={workspaceTaskId(params.task)} />;
}
async function SignedInDemo({ actor,task }: { actor: string;task: string }) {
  const query=new URLSearchParams({as:actor});
  if(task)query.set('task',task);
  await requireChatGPTUser('/demo?'+query);
  return <iframe
    src={'/workspace.html?demo=1&'+query+(!task&&actor==='jack'?'#overview':'#tasks')}
    title={'Weft demo — ' + actor}
    style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', border: 0 }}
  />;
}
