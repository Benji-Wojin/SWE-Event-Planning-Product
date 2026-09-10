import { requireChatGPTUser } from './chatgpt-auth';
export const dynamic = 'force-dynamic';
export default async function Home({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const params = await searchParams;
  return <Workspace message={typeof params.message === 'string' ? params.message.slice(0,200) : ''} />;
}
async function Workspace({ message }: { message: string }) {
  const query = message ? '?message=' + encodeURIComponent(message) : '';
  await requireChatGPTUser('/' + query);
  return (
    <iframe
      src={'/workspace.html' + query + (message ? '#inbox' : '')}
      title="Gather planning workspace"
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        border: 0,
      }}
    />
  );
}
