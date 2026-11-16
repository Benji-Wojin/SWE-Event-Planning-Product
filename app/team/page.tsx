import { requireChatGPTUser } from '@/app/chatgpt-auth';
import { AccountLayout } from '@/components/account-layout';
import { TeamClient } from './team-client';
import { HttpError, principal } from '@/lib/security';
import { readTutorialProgress } from '@/lib/guided-tutorial-store';
import { nextTutorialMilestone } from '@/lib/guided-tutorial';
import { projectIdFrom } from '@/lib/project-access';
import { planHandoffHref, teamAccessFromPlanHref, workspaceTaskId } from '@/lib/workspace-task-link';
export const dynamic = 'force-dynamic';
export default async function Team({
  searchParams,
}: {
  searchParams: Promise<{ project?: string | string[]; start?: string | string[]; guide?: string | string[];
    from?: string | string[]; receiptPlan?: string | string[]; receiptTask?: string | string[]; resumeGuide?: string | string[] }>;
}) {
  const params = await searchParams;
  const projectId = typeof params.project === 'string' ? params.project : 'main';
  const receiptPlan = workspaceTaskId(params.receiptPlan);
  const receiptTask = workspaceTaskId(params.receiptTask);
  let handoff = false;
  if (typeof params.project === 'string' && params.from === 'plan-handoff' && receiptPlan && params.start === undefined && params.guide === undefined &&
    (params.receiptTask === undefined || receiptTask) && (params.resumeGuide === undefined || params.resumeGuide === '1')) {
    try { projectIdFrom(projectId); handoff = true; }
    catch (error) { if (!(error instanceof HttpError && error.status === 404)) throw error; }
  }
  return (
    <AuthenticatedTeam
      projectId={projectId}
      guided={params.start === '1' || params.guide === '1'}
      tutorial={params.guide === '1'}
      handoffHref={handoff ? planHandoffHref(projectId, receiptPlan, receiptTask, params.resumeGuide === '1') : ''}
      handoffEntry={handoff ? teamAccessFromPlanHref(projectId, receiptPlan, receiptTask, params.resumeGuide === '1') : ''}
    />
  );
}
async function AuthenticatedTeam({ projectId, guided, tutorial, handoffHref, handoffEntry }: {
  projectId: string; guided: boolean; tutorial: boolean; handoffHref: string; handoffEntry: string;
}) {
  await requireChatGPTUser(handoffEntry || '/team?project=' + encodeURIComponent(projectId) + (tutorial ? '&guide=1' : guided ? '&start=1' : ''));
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
      <TeamClient key={projectId + ':' + activeGuidance + ':' + activeTutorial + ':' + handoffHref}
        projectId={projectId} guided={activeGuidance} tutorial={activeTutorial} handoffHref={handoffHref} />
    </AccountLayout>
  );
}
