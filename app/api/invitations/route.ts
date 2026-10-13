import { body, HttpError, json, principal, safe } from '@/lib/security';
import {
  acceptInvitation,
  declineInvitation,
  pendingInvitations,
} from '@/lib/team';
export const dynamic = 'force-dynamic';
export async function GET() {
  return safe(async () =>
    json({ invitations: await pendingInvitations(await principal()) }),
  );
}
export async function POST(request: Request) {
  return safe(async () => {
    const user = await principal(),
      input = await body(request);
    if (Object.keys(input).some((key) => !['action', 'id'].includes(key)))
      throw new HttpError(400, 'Unsupported invitation field.');
    if (input.action === 'accept')
      return json(await acceptInvitation({ invitationId: input.id }));
    if (input.action === 'decline') {
      await declineInvitation(user, input.id);
      return json({ declined: true });
    }
    throw new HttpError(400, 'Choose an invitation action.');
  });
}
