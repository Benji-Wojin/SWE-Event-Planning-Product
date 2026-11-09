import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { chatGPTSignInPath } from '@/app/chatgpt-auth';
import { AccountLayout } from '@/components/account-layout';
import { OnboardingDashboard } from '@/components/onboarding-dashboard';
import { readOnboardingMilestones } from '@/lib/onboarding-milestones';
import { HttpError } from '@/lib/security';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Usage analytics — Weft', robots: { index: false, follow: false } };

export default async function OnboardingPage({ searchParams }: {
  searchParams: Promise<{ after?: string | string[] }>;
}) {
  const { after } = await searchParams;
  let data;
  try {
    data = await readOnboardingMilestones(typeof after === 'string' ? after : undefined);
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) redirect(chatGPTSignInPath('/admin/onboarding'));
    if (error instanceof HttpError && error.status === 403) notFound();
    throw error;
  }
  return <AccountLayout title="Usage analytics"><OnboardingDashboard data={data} /></AccountLayout>;
}
