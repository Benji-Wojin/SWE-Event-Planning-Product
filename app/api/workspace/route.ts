import { body, json, principal, safe } from '@/lib/security';
import { loadWorkspace, mutateWorkspace, snapshot } from '@/lib/workspace';
export const dynamic = 'force-dynamic';
export async function GET() {
  return safe(async () => {
    const user = await principal();
    const { row, store } = await loadWorkspace(user);
    return json(snapshot(store, row.revision, user));
  });
}
export async function POST(request: Request) {
  return safe(async () => {
    const user = await principal();
    return json(await mutateWorkspace(user, await body(request)));
  });
}
