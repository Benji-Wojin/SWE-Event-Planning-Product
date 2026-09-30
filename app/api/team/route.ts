import { body, json, principal, safe } from '@/lib/security';
import { projectUser } from '@/lib/project-access';
import { readTeam, changeTeam } from '@/lib/team';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return safe(async () =>
    json(await readTeam(await projectUser(await principal(), request))),
  );
}
export async function POST(request: Request) {
  return safe(async () =>
    json(
      await changeTeam(
        await projectUser(await principal(), request),
        await body(request),
      ),
    ),
  );
}
