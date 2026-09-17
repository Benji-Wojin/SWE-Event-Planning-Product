import { administrator, body, json, safe } from '@/lib/security';
import { demoPersona, demoSnapshot, loadDemo, mutateDemo, demoPrivate } from '@/lib/demo';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return safe(async () => {
    const user = await administrator();
    const params = new URL(request.url).searchParams;
    const actor = demoPersona(params.get('as'));
    if (params.get('resource') === 'private') return json(await demoPrivate(user, actor, params.get('action') || ''));
    const { row, store } = await loadDemo(user);
    return json(demoSnapshot(store, row.revision, actor));
  });
}
export async function POST(request: Request) {
  return safe(async () => {
    const user = await administrator();
    const params = new URL(request.url).searchParams;
    const actor = demoPersona(params.get('as'));
    const data = await body(request);
    if (params.get('resource') === 'private') return json(await demoPrivate(user, actor, params.get('action') || '', data));
    return json(await mutateDemo(user, actor, data));
  });
}
