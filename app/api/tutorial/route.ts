import { body, HttpError, json, principal, safe } from '@/lib/security';
import { projectIdFrom } from '@/lib/project-access';
import { TUTORIAL_STEPS } from '@/lib/guided-tutorial';
import { readTutorialProgress, recordTutorialObservation } from '@/lib/guided-tutorial-store';

export const dynamic = 'force-dynamic';
export async function GET() {
  return safe(async () => json(await readTutorialProgress((await principal()).userId)));
}

export async function POST(request: Request) {
  return safe(async () => {
    const user = await principal();
    const input = await body(request, 256);
    if (Object.keys(input).some(key => key !== 'checkpoint' && key !== 'project') ||
      !TUTORIAL_STEPS.some(step => step.id === input.checkpoint &&
        (step.evidence === 'interaction' || step.evidence === 'view')) ||
      (input.project !== undefined && typeof input.project !== 'string'))
      throw new HttpError(400, 'Unsupported tutorial observation.');
    const project = typeof input.project === 'string' ? projectIdFrom(input.project) : null;
    if (project === 'main') throw new HttpError(400, 'Choose the project created in the guide.');
    await recordTutorialObservation(user.userId, input.checkpoint, project);
    return json(await readTutorialProgress(user.userId));
  });
}
