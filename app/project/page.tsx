import { requireChatGPTUser } from '@/app/chatgpt-auth';
import { AppOpen } from '@/components/app-open';
import { workspaceScheduleDate } from '@/lib/workspace-day';
import { workspaceTaskId } from '@/lib/workspace-task-link';
export const dynamic = 'force-dynamic';
export default async function Project({ searchParams }: { searchParams: Promise<{ project?: string; message?: string; guide?: string; day?: string; task?: string }> }) {
  const params = await searchParams;
  const query = new URLSearchParams({ project: typeof params.project === 'string' ? params.project : 'main' });
  if (typeof params.message === 'string') query.set('message',params.message.slice(0,200));
  if (params.guide === '1') query.set('guide','1');
  const day = workspaceScheduleDate(params.day);
  if (day) query.set('day',day);
  const task = workspaceTaskId(params.task);
  if(task)query.set('task',task);
  return <SignedInProject query={query.toString()} defaultSection={task ? '#tasks' : params.message ? '#inbox' : day ? '#timeline' : ''}/>;
}
async function SignedInProject({query,defaultSection}:{query:string;defaultSection:string}) {
  await requireChatGPTUser('/project?' + query);
  return <><AppOpen /><iframe src={'/workspace.html?' + query + defaultSection} title="Weft planning workspace"
    style={{ position:'fixed',inset:0,width:'100%',height:'100%',border:0 }} /></>;
}
