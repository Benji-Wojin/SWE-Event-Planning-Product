import { administrator, body, HttpError, json, principal, safe } from '@/lib/security';
import { loadWorkspace } from '@/lib/workspace';
import { demoPersona, loadDemo } from '@/lib/demo';
import { taskResources } from '@/lib/task-resources';
import { projectScope } from '@/lib/projects';
export const dynamic = 'force-dynamic';

async function handle(request: Request, generate: boolean) {
  const params = new URL(request.url).searchParams;
  const demo = params.get('demo') === '1';
  const user = demo ? await administrator() : await principal();
  if (demo) demoPersona(params.get('as'));
  const input = generate ? await body(request) : undefined;
  if (input && (Object.keys(input).some(key => !['taskId', 'location', 'refresh'].includes(key)) ||
      input.refresh !== undefined && typeof input.refresh !== 'boolean')) throw new HttpError(400, 'Invalid helpful-links request.');
  const taskId = input?.taskId ?? params.get('taskId');
  if (typeof taskId !== 'string' || !taskId || taskId.length > 160) throw new HttpError(400, 'Choose a task.');
  const projectId = demo ? '' : await projectScope(user, request);
  const { store } = demo ? await loadDemo(user) : await loadWorkspace(user, projectId);
  const state = store.getState(), task = state.tasks.find((item: any) => item.id === taskId);
  if (!task) throw new HttpError(404, 'That task could not be found.');
  const scope = demo ? 'demo:' + user.userId + ':' + state.demoGeneration : projectId;
  return json(await taskResources(scope, user.userId, task, input));
}
export async function GET(request: Request) { return safe(() => handle(request, false)); }
export async function POST(request: Request) { return safe(() => handle(request, true)); }
