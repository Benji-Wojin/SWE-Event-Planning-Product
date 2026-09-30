import { administrator, body, HttpError, json, safe } from '@/lib/security';
import { projectUser } from '@/lib/project-access';
import {
  beginSenderOAuth,
  disconnectSender,
  senderStatus,
} from '@/lib/invitation-sender';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  return safe(async () => {
    const user = await projectUser(await administrator(), request),
      input = await body(request);
    if (user.role !== 'admin')
      throw new HttpError(403, 'Only the organizer can manage the sender.');
    if (Object.keys(input).some((key) => key !== 'action'))
      throw new HttpError(400, 'Unsupported sender field.');
    if (input.action === 'connect')
      return json({ url: await beginSenderOAuth(user) });
    if (input.action === 'disconnect') {
      await disconnectSender(user.userId);
      return json(await senderStatus(user.userId));
    }
    throw new HttpError(400, 'Choose a sender action.');
  });
}
