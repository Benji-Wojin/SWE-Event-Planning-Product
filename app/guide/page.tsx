import { requireChatGPTUser } from '@/app/chatgpt-auth';
import { AccountLayout } from '@/components/account-layout';
import { principal } from '@/lib/security';
import { readTutorialProgress } from '@/lib/guided-tutorial-store';
import { GuideClient } from './guide-client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Getting started — Weft', robots: { index: false, follow: false } };
export default async function GuidePage() {
  await requireChatGPTUser('/guide');
  const progress = await readTutorialProgress((await principal()).userId);
  return <AccountLayout title="Getting started"><GuideClient initial={progress} /></AccountLayout>;
}
