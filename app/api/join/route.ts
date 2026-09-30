import { body, json, safe } from '@/lib/security';
import { previewInvitation, acceptInvitation } from '@/lib/team';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return safe(async () =>
    json(
      await previewInvitation(new URL(request.url).searchParams.get('invite')),
    ),
  );
}
export async function POST(request: Request) {
  return safe(async () => json(await acceptInvitation(await body(request))));
}
