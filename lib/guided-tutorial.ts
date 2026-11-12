/**
 * One onboarding run per account and tutorial version. Checkpoint labels are
 * shared by the guide and the private funnel; changing their meaning requires
 * a new version, not a reinterpretation of recorded history.
 */
export const TUTORIAL_VERSION = 1;

export const TUTORIAL_STEPS = [
  { id: 'started', title: 'Start the guide', evidence: 'interaction' },
  { id: 'create_project_clicked', title: 'Choose to create a project', evidence: 'interaction', after: 'started', before: 'project_created' },
  { id: 'setup_viewed', title: 'Open project setup', evidence: 'view', after: 'started', before: 'project_created' },
  { id: 'project_created', title: 'Save project setup', evidence: 'project_commit', after: 'started' },
  { id: 'add_task_clicked', title: 'Open Add task', evidence: 'interaction', after: 'project_created', before: 'task_created' },
  { id: 'task_created', title: 'Save the first task', evidence: 'task_commit', after: 'project_created' },
  { id: 'budget_clicked', title: 'Choose to open Budget', evidence: 'interaction', after: 'task_created', before: 'budget_viewed' },
  { id: 'budget_viewed', title: 'Explore Budget', evidence: 'view', after: 'task_created' },
  { id: 'event_details_clicked', title: 'Choose to open Event info', evidence: 'interaction', after: 'budget_viewed', before: 'event_details_viewed' },
  { id: 'event_details_viewed', title: 'Explore Event info', evidence: 'view', after: 'budget_viewed' },
  { id: 'invite_clicked', title: 'Choose to invite a teammate', evidence: 'interaction', after: 'event_details_viewed', before: 'invite_created' },
  { id: 'invite_form_viewed', title: 'Open the invitation form', evidence: 'view', after: 'event_details_viewed', before: 'invite_created' },
  { id: 'invite_created', title: 'Create an invitation', evidence: 'invite_commit', after: 'event_details_viewed', before: 'invite_skipped' },
  { id: 'invite_skipped', title: 'Finish without a new invitation', evidence: 'interaction', after: 'event_details_viewed', before: 'invite_created' },
] as const;

type Step = (typeof TUTORIAL_STEPS)[number];
export type TutorialCheckpoint = Step['id'];
type Evidence = Step['evidence'];

export const TUTORIAL_MILESTONES = [
  'started', 'project_created', 'task_created', 'budget_viewed', 'event_details_viewed', 'invite_created',
] as const satisfies readonly TutorialCheckpoint[];
export const TUTORIAL_GUIDE_STEPS = [
  ['project_created', 'Set up your event', 'Create a project and give the event a name.'],
  ['task_created', 'Add a real task', 'Save one task and learn where to find, finish, and link it.'],
  ['budget_viewed', 'Explore Budget', 'See how to track estimates and spending without moving money.'],
  ['event_details_viewed', 'Review Event info', 'See where teammates find the event details.'],
  ['invite_created', 'Invite a teammate', 'Use the email they sign in with to give them a way to join.'],
] as const;
export type TutorialResume = {
  next: (typeof TUTORIAL_GUIDE_STEPS)[number][0];
  projectId: string | null;
};

type Progress = {
  readonly projectId: string | null;
  readonly reached: readonly TutorialCheckpoint[];
};

/**
 * Only the server may supply *_commit evidence. Analytics may record a button
 * or view without inferring a save. Milestones do not depend on button events:
 * direct navigation, keyboard use, or a dropped analytics request may omit one.
 */
export function shouldRecordTutorialCheckpoint(
  progress: Progress,
  id: unknown,
  evidence: Evidence,
  projectId: string | null,
): id is TutorialCheckpoint {
  const step = TUTORIAL_STEPS.find(step => step.id === id);
  if (!step || step.evidence !== evidence || progress.reached.includes(step.id)) return false;
  if ('after' in step && !progress.reached.includes(step.after)) return false;
  if ('before' in step && progress.reached.includes(step.before)) return false;

  if (step.id === 'project_created') return projectId !== null && progress.projectId === null;
  if (step.id === 'started' || step.id === 'create_project_clicked' || step.id === 'setup_viewed') return projectId === null;
  return projectId !== null && projectId === progress.projectId;
}

export function nextTutorialMilestone(reached: readonly TutorialCheckpoint[]) {
  return TUTORIAL_MILESTONES.find(id => !reached.includes(id) &&
    (id !== 'invite_created' || !reached.includes('invite_skipped'))) ?? null;
}

/** Resume only a started, incomplete guide. Do not start a second project
 * when the original guide's project is no longer in the visible list. */
export function tutorialResume(progress: Progress, visibleProjectIds: readonly string[]): TutorialResume | null {
  const next = nextTutorialMilestone(progress.reached);
  if (!next || next === 'started') return null;
  if (next === 'project_created') return progress.projectId === null ? { next, projectId: null } : null;
  if (!progress.projectId || !visibleProjectIds.includes(progress.projectId)) return null;
  return { next, projectId: progress.projectId };
}
