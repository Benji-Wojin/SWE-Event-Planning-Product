import { body, json, safe } from '@/lib/security';
import { readEventPlan, writeEventPlan } from '@/lib/event-plan';
import { requireAskWeftEnabled } from '@/lib/ask-weft-policy';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return safe(async () => {
    if (new URL(request.url).searchParams.get('mode') === 'assistant') requireAskWeftEnabled();
    return json(await readEventPlan(request));
  });
}
export async function POST(request: Request) {
  return safe(async () => {
    if (new URL(request.url).searchParams.get('mode') === 'assistant') requireAskWeftEnabled();
    return json(await writeEventPlan(request, await body(request, 100000)));
  });
}
