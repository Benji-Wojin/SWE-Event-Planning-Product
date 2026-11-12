import { accountRequest } from './account-request';
import type { TutorialCheckpoint } from './guided-tutorial';

export type TutorialProgress = {
  projectId: string | null;
  events: { checkpoint: TutorialCheckpoint; at: string }[];
};

export function observeTutorial(checkpoint: TutorialCheckpoint, project?: string) {
  return accountRequest<TutorialProgress>('/api/tutorial', { checkpoint, ...(project ? { project } : {}) });
}
