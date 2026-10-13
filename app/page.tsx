import { getChatGPTUser } from './chatgpt-auth';
import { HttpError, principal } from '@/lib/security';
import { Welcome } from '@/components/welcome';
import { ProjectsClient } from './projects-client';
import { redirect } from 'next/navigation';
export const dynamic = 'force-dynamic';
export default async function Home({ searchParams }: { searchParams: Promise<{ message?: string }> }) {
  const params = await searchParams;
  if (typeof params.message === 'string') redirect('/project?project=main&message=' + encodeURIComponent(params.message.slice(0,200)));
  if (!await getChatGPTUser()) return <Welcome />;
  try { await principal(); }
  catch (error) {
    if (error instanceof HttpError && error.status === 403) redirect('/signup');
    throw error;
  }
  return <ProjectsClient />;
}
