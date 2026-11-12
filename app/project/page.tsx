import { requireChatGPTUser } from '@/app/chatgpt-auth';
import { AppOpen } from '@/components/app-open';
import { workspaceScheduleDate } from '@/lib/workspace-day';
import { workspaceTaskId } from '@/lib/workspace-task-link';
export const dynamic = 'force-dynamic';
type ProjectParams = { project?: string | string[]; message?: string | string[]; guide?: string | string[]; day?: string | string[]; task?: string | string[]; welcome?: string | string[] };
export default async function Project({ searchParams }: { searchParams: Promise<ProjectParams> }) {
  const params = await searchParams;
  const project = typeof params.project === 'string' ? params.project : null;
  const query = new URLSearchParams({ project: project ?? 'main' });
  const message = typeof params.message === 'string' ? params.message.slice(0,200) : '';
  const guide = params.guide === '1';
  if (message) query.set('message',message);
  if (guide) query.set('guide','1');
  const day = workspaceScheduleDate(params.day);
  if (day) query.set('day',day);
  const task = workspaceTaskId(params.task);
  if(task)query.set('task',task);
  if (project && params.welcome === '1' && !guide && !task && !message && !day) query.set('welcome','1');
  return <SignedInProject query={query.toString()} defaultSection={task ? '#tasks' : message ? '#inbox' : day ? '#timeline' : ''}/>;
}
async function SignedInProject({query,defaultSection}:{query:string;defaultSection:string}) {
  await requireChatGPTUser('/project?' + query);
  return <><AppOpen /><iframe src={'/workspace.html?' + query + defaultSection} title="Weft planning workspace"
    style={{ position:'fixed',inset:0,width:'100%',height:'100%',border:0 }} /></>;
}
