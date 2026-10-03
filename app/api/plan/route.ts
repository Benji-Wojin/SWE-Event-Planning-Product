import { body, json, safe } from '@/lib/security';
import { readEventPlan, writeEventPlan } from '@/lib/event-plan';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return safe(async () => json(await readEventPlan(request)));
}
export async function POST(request: Request) {
  return safe(async () =>
    json(await writeEventPlan(request, await body(request, 100000))),
  );
}
