import { requireChatGPTUser } from '@/app/chatgpt-auth';
export const dynamic = 'force-dynamic';
export default async function Demo({ searchParams }: { searchParams: Promise<{ as?: string }> }) {
  const params = await searchParams;
  const actor = typeof params.as === 'string' && ['jack','maya','jules','dev'].includes(params.as) ? params.as : 'jack';
  return <SignedInDemo actor={actor} />;
}
async function SignedInDemo({ actor }: { actor: string }) {
  await requireChatGPTUser('/demo?as=' + actor);
  return <iframe
    src={'/workspace.html?demo=1&as=' + actor + (actor === 'jack' ? '#overview' : '#tasks')}
    title={'Gather demo — ' + actor}
    style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', border: 0 }}
  />;
}
