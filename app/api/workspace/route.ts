import { body, json, principal, safe } from '@/lib/security';
import { loadWorkspace, mutateWorkspace, snapshot } from '@/lib/workspace';
import { projectUser, assertProjectAccess } from '@/lib/project-access';
export const dynamic = 'force-dynamic';
export async function GET(request?: Request) {
  return safe(async () => {
    const user = await projectUser(await principal(),request);
    const projectId = user.projectId;
    const { row, store } = await loadWorkspace(user, projectId);
    await assertProjectAccess(user);
    return json({ ...snapshot(store, row.revision, user), projectId });
  });
}
export async function POST(request: Request) {
  return safe(async () => {
    const user = await projectUser(await principal(),request);
    const projectId = user.projectId;
    return json({ ...await mutateWorkspace(user, await body(request), projectId), projectId });
  });
}
