import { GMAIL_ENABLED } from './release-policy';
import { HttpError } from './security';

export function requireGmailEnabled() {
  if (!GMAIL_ENABLED) {
    throw new HttpError(403, 'Gmail integration is not available in this release.');
  }
}
