import { HttpError } from './security';

export async function bookingVersion(payload: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function bookingRecord(data: any) {
  const text = (key: string, max: number) => String(data[key] ?? '').trim().slice(0, max);
  const record = {
    id: text('id', 100) || crypto.randomUUID(), title: text('title', 160),
    type: text('type', 30), provider: text('provider', 160), traveler: text('traveler', 160),
    date: text('date', 10), reference: text('reference', 160), details: text('details', 2000), taskId: text('taskId', 100),
  };
  if (!record.title || !record.reference || !['Flight', 'Hotel', 'Transport', 'Venue', 'Other'].includes(record.type))
    throw new HttpError(400, 'Add a title, booking type, and confirmation reference.');
  if (record.date && (!/^\d{4}-\d{2}-\d{2}$/.test(record.date) || Number.isNaN(Date.parse(record.date)) || new Date(record.date).toISOString().slice(0, 10) !== record.date))
    throw new HttpError(400, 'Choose a valid booking date.');
  return record;
}
