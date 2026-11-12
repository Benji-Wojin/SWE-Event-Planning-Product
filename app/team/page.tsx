import { requireChatGPTUser } from '@/app/chatgpt-auth';
import { AccountLayout } from '@/components/account-layout';
import { TeamClient } from './team-client';
import { HttpError, principal } from '@/lib/security';
import { readTutorialProgress } from '@/lib/guided-tutorial-store';
import { nextTutorialMilestone } from '@/lib/guided-tutorial';
export const dynamic = 'force-dynamic';
export default async function Team({
  searchParams,
}: {
  searchParams: Promise<{ project?: string; start?: string; guide?: string }>;
}) {
  const params = await searchParams;
  return (
    <AuthenticatedTeam
      projectId={typeof params.project === 'string' ? params.project : 'main'}
      guided={params.start === '1' || params.guide === '1'}
      tutorial={params.guide === '1'}
    />
  );
}
async function AuthenticatedTeam({ projectId, guided, tutorial }: { projectId: string; guided: boolean; tutorial: boolean }) {
  await requireChatGPTUser('/team?project=' + encodeURIComponent(projectId) + (tutorial ? '&guide=1' : guided ? '&start=1' : ''));
  let activeTutorial = false;
  if (tutorial) {
    try {
      const progress = await readTutorialProgress((await principal()).userId);
      activeTutorial = progress.projectId === projectId &&
        nextTutorialMilestone(progress.events.map(event => event.checkpoint)) === 'invite_created';
    } catch (error) {
      if (!(error instanceof HttpError && error.status === 403)) throw error;
    }
  }
  const activeGuidance = activeTutorial || (guided && !tutorial);
  return (
    <AccountLayout title="Team access">
      <TeamClient key={projectId + ':' + activeGuidance + ':' + activeTutorial} projectId={projectId} guided={activeGuidance} tutorial={activeTutorial} />
    </AccountLayout>
  );
}
