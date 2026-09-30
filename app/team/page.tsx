import { requireChatGPTUser } from '@/app/chatgpt-auth';
import { AccountLayout } from '@/components/account-layout';
import { TeamClient } from './team-client';
export const dynamic = 'force-dynamic';
export default async function Team({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const params = await searchParams;
  return (
    <AuthenticatedTeam
      projectId={typeof params.project === 'string' ? params.project : 'main'}
    />
  );
}
async function AuthenticatedTeam({ projectId }: { projectId: string }) {
  await requireChatGPTUser('/team?project=' + encodeURIComponent(projectId));
  return (
    <AccountLayout title="Team access">
      <TeamClient projectId={projectId} />
    </AccountLayout>
  );
}
