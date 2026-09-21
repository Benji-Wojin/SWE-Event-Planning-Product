import { env } from 'cloudflare:workers';
import { bookingRecord, bookingVersion } from '@/lib/bookings';
import {
  administrator,
  body,
  HttpError,
  json,
  safe,
  seal,
  unseal,
} from '@/lib/security';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return safe(async () => {
    await administrator();
    const action = new URL(request.url).pathname.split('/').pop();
    if (action === 'config')
      return json({ configured: !!env.GATHER_ENCRYPTION_KEY });
    if (action === 'session')
      return json({ expiresAt: Date.now() + 15 * 60000 });
    if (action !== 'records') throw new HttpError(404, 'Not found.');
    const rows = await env.DB.prepare(
      'SELECT id,payload FROM private_records ORDER BY updated_at DESC LIMIT 100',
    ).all<any>();
    return json({
      records: await Promise.all(
        rows.results.map(async (row) => ({
          ...(await unseal(row.payload, 'booking:' + row.id)),
          version: await bookingVersion(row.payload),
        })),
      ),
    });
  });
}
export async function POST(request: Request) {
  return safe(async () => {
    await administrator();
    const data = await body(request);
    const action = new URL(request.url).pathname.split('/').pop();
    if (action === 'lock') return json({ hidden: true });
    if (action !== 'records') throw new HttpError(404, 'Not found.');
    const record = bookingRecord(data);
    const payload = await seal(record, 'booking:' + record.id);
    const at = new Date().toISOString();
    if (data.id) {
      const current = await env.DB.prepare('SELECT payload FROM private_records WHERE id=?').bind(record.id).first<any>();
      if (!current) throw new HttpError(404, 'Booking not found.');
      const conflict = () => new HttpError(409, 'This booking changed in another tab. Your edits are still here; copy them before reloading.');
      if (data.version !== await bookingVersion(current.payload)) throw conflict();
      const updated = await env.DB.prepare('UPDATE private_records SET payload=?,updated_at=? WHERE id=? AND payload=?')
        .bind(payload, at, record.id, current.payload).run();
      if (updated.meta.changes !== 1) throw conflict();
    } else {
      const inserted = await env.DB.prepare('INSERT INTO private_records (id,payload,updated_at) SELECT ?,?,? WHERE (SELECT count(*) FROM private_records)<100')
        .bind(record.id, payload, at).run();
      if (inserted.meta.changes !== 1) throw new HttpError(409, 'This pilot supports up to 100 private bookings.');
    }
    return json({ saved: true, id: record.id, version: await bookingVersion(payload) });
  });
}
