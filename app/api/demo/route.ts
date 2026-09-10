import { administrator, body, json, safe } from '@/lib/security';
import { demoPersona, demoSnapshot, loadDemo, mutateDemo } from '@/lib/demo';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return safe(async () => {
    const user = await administrator();
    const actor = demoPersona(new URL(request.url).searchParams.get('as'));
    const { row, store } = await loadDemo(user);
    return json(demoSnapshot(store, row.revision, actor));
  });
}
export async function POST(request: Request) {
  return safe(async () => {
    const user = await administrator();
    const actor = demoPersona(new URL(request.url).searchParams.get('as'));
    return json(await mutateDemo(user, actor, await body(request)));
  });
}
