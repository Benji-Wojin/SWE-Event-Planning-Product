import { administrator, body, json, principal, safe } from '@/lib/security';
import { projectUser } from '@/lib/project-access';
import { demoPersona, loadDemo } from '@/lib/demo';
import { weftResearch } from '@/lib/weft-research';
export const dynamic = 'force-dynamic';
async function handle(request: Request, generate: boolean) {
  const params = new URL(request.url).searchParams,
    demo = params.get('demo') === '1';
  const authorization = demo
    ? undefined
    : await projectUser(await principal(), request);
  const user = authorization || (await administrator());
  let scope = authorization?.projectId || '';
  if (demo) {
    demoPersona(params.get('as'));
    const { store } = await loadDemo(user);
    scope = 'demo:' + user.userId + ':' + store.getState().demoGeneration;
  }
  return json(
    await weftResearch(
      scope,
      user.userId,
      generate ? await body(request, 8000) : undefined,
      authorization,
    ),
  );
}
export async function GET(request: Request) {
  return safe(() => handle(request, false));
}
export async function POST(request: Request) {
  return safe(() => handle(request, true));
}
