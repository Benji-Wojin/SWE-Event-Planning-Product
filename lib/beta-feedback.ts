import { env } from 'cloudflare:workers';
import { HttpError } from './security';

export const FEEDBACK_AREAS = ['Projects', 'Tasks', 'Email', 'Guests and files', 'Team access', 'Other'] as const;
const kinds = ['bug', 'error', 'request'];
function field(value: unknown, name: string, max: number, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string') throw new HttpError(400, `${name} must be text.`);
  const result = value.trim();
  if ((required && !result) || result.length > max)
    throw new HttpError(400, `${name} ${required ? 'is required and ' : ''}must be at most ${max} characters.`);
  return result;
}
export function normalizeFeedback(input: Record<string, unknown>) {
  const id = field(input.id, 'Report ID', 36, true);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
    throw new HttpError(400, 'Invalid report ID. Reload the form.');
  const kind = field(input.kind, 'Report type', 10, true);
  const area = field(input.area, 'Area', 30, true);
  if (!kinds.includes(kind) || !(FEEDBACK_AREAS as readonly string[]).includes(area))
    throw new HttpError(400, 'Choose a report type and area.');
  const payload = JSON.stringify({
    kind, area,
    title: field(input.title, 'Summary', 120, true),
    details: field(input.details, 'Details', 1500, true),
    steps: field(input.steps, 'Steps to reproduce', 1000),
    expected: field(input.expected, 'Expected result', 500),
  });
  return { id: id.toLowerCase(), payload };
}

export async function submitFeedback(userId: string, input: Record<string, unknown>) {
  const { id, payload } = normalizeFeedback(input);
  const existing = await env.DB.prepare('SELECT user_id,payload FROM beta_reports WHERE id=?').bind(id).first<any>();
  if (existing) {
    if (existing.user_id !== userId || existing.payload !== payload)
      throw new HttpError(409, 'That report was already submitted with different details. Start a new report.');
    return { id, saved: true };
  }
  const now = new Date();
  const since = new Date(now.getTime() - 86_400_000).toISOString();
  // The quota check and insert are one statement, so concurrent requests share the limit.
  await env.DB.prepare(`INSERT OR IGNORE INTO beta_reports (id,user_id,payload,created_at)
    SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM beta_reports WHERE user_id=? AND created_at>?) < 20`)
    .bind(id, userId, payload, now.toISOString(), userId, since).run();
  const saved = await env.DB.prepare('SELECT user_id,payload FROM beta_reports WHERE id=?').bind(id).first<any>();
  if (!saved) throw new HttpError(429, 'You have sent 20 reports in the last day. Please try again tomorrow.');
  if (saved.user_id !== userId || saved.payload !== payload)
    throw new HttpError(409, 'That report ID is already in use. Start a new report.');
  return { id, saved: true };
}
