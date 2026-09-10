import { requireChatGPTUser } from '@/app/chatgpt-auth';
import { DemoWorkspace } from './demo-client';
import './demo.css';
export const dynamic = 'force-dynamic';
export default async function Demo({ searchParams }: { searchParams: Promise<{ as?: string }> }) {
  const params = await searchParams;
  const actor = typeof params.as === 'string' && ['jack','maya','jules','dev'].includes(params.as) ? params.as : 'jack';
  return <SignedInDemo actor={actor} />;
}
async function SignedInDemo({ actor }: { actor: string }) {
  await requireChatGPTUser('/demo?as=' + actor);
  return <DemoWorkspace key={actor} actor={actor} />;
}
