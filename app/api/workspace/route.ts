import { body, json, principal, safe } from '@/lib/security';
import { loadWorkspace, mutateWorkspace, snapshot } from '@/lib/workspace';
import { projectScope } from '@/lib/projects';
export const dynamic = 'force-dynamic';
export async function GET(request?: Request) {
  return safe(async () => {
    const user = await principal();
    const projectId = await projectScope(user, request);
    const { row, store } = await loadWorkspace(user, projectId);
    return json({ ...snapshot(store, row.revision, user), projectId });
  });
}
export async function POST(request: Request) {
  return safe(async () => {
    const user = await principal();
    const projectId = await projectScope(user, request);
    return json({ ...await mutateWorkspace(user, await body(request), projectId), projectId });
  });
}
