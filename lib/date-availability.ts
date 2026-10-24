// Team availability is a shared planning response, not an RSVP or booking.
export const availabilityValues = ['available', 'maybe', 'unavailable'] as const;
type Answer = { date: string; availability: typeof availabilityValues[number] };
export type DatePoll = {
  id: string; title: string; dates: string[]; timeZone: string;
  createdAt: string; createdBy: string; createdName: string; closedAt: string;
  responses: { actor: string; name: string; at: string; answers: Answer[] }[];
};
function fields(value: any, allowed: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key)))
    throw new Error('Review the availability fields.');
}
function text(value: unknown, max: number) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value))
    throw new Error('Add a short title and a valid time zone.');
  return value.trim();
}
export function datePollProposal(value: any) {
  fields(value, ['title', 'dates', 'timeZone']);
  const title = text(value.title, 160), timeZone = text(value.timeZone, 100);
  try { new Intl.DateTimeFormat('en', { timeZone }).format(); }
  catch { throw new Error('Choose a valid time zone, such as America/Los_Angeles.'); }
  if (!Array.isArray(value.dates) || value.dates.length < 2 || value.dates.length > 12 || value.dates.some((date: any) =>
    typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + 'T12:00:00Z')) || new Date(date + 'T12:00:00Z').toISOString().slice(0, 10) !== date) || new Set(value.dates).size !== value.dates.length)
    throw new Error('Choose 2–12 different, valid calendar dates.');
  return { title, timeZone, dates: [...value.dates].sort() as string[] };
}
export function datePollAnswers(poll: DatePoll, value: any): Answer[] {
  if (!Array.isArray(value) || value.length > poll.dates.length) throw new Error('Review your availability for these dates.');
  const seen = new Set();
  for (const answer of value) {
    fields(answer, ['date', 'availability']);
    if (!poll.dates.includes(answer.date) || seen.has(answer.date) || !availabilityValues.includes(answer.availability))
      throw new Error('Choose one availability response for each proposed date.');
    seen.add(answer.date);
  }
  return value.map((answer: Answer) => ({ date: answer.date, availability: answer.availability })).sort((a: Answer, b: Answer) => a.date.localeCompare(b.date));
}
