import { requireChatGPTUser } from './chatgpt-auth';
import { ProjectsClient } from './projects-client';
import { redirect } from 'next/navigation';
export const dynamic = 'force-dynamic';
export default async function Home({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const params = await searchParams;
  if (typeof params.message === 'string') redirect('/project?project=main&message=' + encodeURIComponent(params.message.slice(0,200)));
  await requireChatGPTUser('/');
  return <ProjectsClient />;
}
