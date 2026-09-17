import { env } from 'cloudflare:workers';
import { bookingRecord } from '@/lib/bookings';
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
        rows.results.map((row) => unseal(row.payload, 'booking:' + row.id)),
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
    if (
      data.id &&
      !(await env.DB.prepare('SELECT id FROM private_records WHERE id=?')
        .bind(record.id)
        .first())
    )
      throw new HttpError(404, 'Booking not found.');
    if (!data.id) {
      const count = await env.DB.prepare(
        'SELECT count(*) AS n FROM private_records',
      ).first<any>();
      if (count.n >= 100)
        throw new HttpError(
          409,
          'This pilot supports up to 100 private bookings.',
        );
    }
    await env.DB.prepare(
      'INSERT INTO private_records (id,payload,updated_at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at',
    )
      .bind(
        record.id,
        await seal(record, 'booking:' + record.id),
        new Date().toISOString(),
      )
      .run();
    return json({ saved: true, id: record.id });
  });
}
