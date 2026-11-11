import { requireChatGPTUser } from '@/app/chatgpt-auth';
import { AccountLayout } from '@/components/account-layout';
import { TeamClient } from './team-client';
export const dynamic = 'force-dynamic';
export default async function Team({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; start?: string }>;
}) {
  const params = await searchParams;
  return (
    <AuthenticatedTeam
      projectId={typeof params.project === 'string' ? params.project : 'main'}
      guided={params.start === '1'}
    />
  );
}
async function AuthenticatedTeam({ projectId, guided }: { projectId: string; guided: boolean }) {
  await requireChatGPTUser('/team?project=' + encodeURIComponent(projectId) + (guided ? '&start=1' : ''));
  return (
    <AccountLayout title="Team access">
      <TeamClient key={projectId + ':' + guided} projectId={projectId} guided={guided} />
    </AccountLayout>
  );
}
