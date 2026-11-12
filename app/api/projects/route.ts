import { body, json, principal, safe } from '@/lib/security';
import { createProject, listProjects } from '@/lib/projects';
import { readTutorialProgress } from '@/lib/guided-tutorial-store';
import { tutorialResume } from '@/lib/guided-tutorial';
import { notificationScope } from '@/lib/notification-scope';
export const dynamic = 'force-dynamic';
export async function GET() {
  return safe(async () => {
    const user = await principal();
    const [projects, progress] = await Promise.all([
      listProjects(user),
      // The regular project list remains available if guide analytics are unavailable.
      readTutorialProgress(user.userId).catch(() => null),
    ]);
    const resumeGuide = progress ? tutorialResume({
      projectId: progress.projectId, reached: progress.events.map(event => event.checkpoint),
    }, projects.map(project => project.id)) : null;
    return json({ projects, canCreateProjects: true, canUseDemo: user.role === 'admin', resumeGuide });
  });
}
export async function POST(request: Request) {
  return safe(async () => {
    const user = await principal();
    const project = await createProject(user, await body(request));
    return json({ ...project, reminderScope: notificationScope(user.userId, project.id) }, 201);
  });
}
