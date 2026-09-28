import { requireChatGPTUser } from '@/app/chatgpt-auth';
export const dynamic = 'force-dynamic';
export default async function Project({ searchParams }: { searchParams: Promise<{ project?: string; message?: string }> }) {
  const params = await searchParams;
  const query = new URLSearchParams({ project: typeof params.project === 'string' ? params.project : 'main' });
  if (typeof params.message === 'string') query.set('message',params.message.slice(0,200));
  await requireChatGPTUser('/project?' + query);
  return <iframe src={'/workspace.html?' + query + (params.message ? '#inbox' : '')} title="Gather planning workspace"
    style={{ position:'fixed',inset:0,width:'100%',height:'100%',border:0 }} />;
}
