import { ASK_WEFT_ENABLED } from './release-policy';
import { HttpError } from './security';

export function requireAskWeftEnabled() {
  if (!ASK_WEFT_ENABLED) throw new HttpError(503, 'Ask Weft is coming soon.');
}
