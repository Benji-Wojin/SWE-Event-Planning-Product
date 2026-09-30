import { env } from 'cloudflare:workers';
import { bookingRecord, bookingVersion } from '@/lib/bookings';
import { projectScope } from '@/lib/projects';
import { loadWorkspace } from '@/lib/workspace';
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
    const scope = await projectScope(await administrator(), request);
    const action = new URL(request.url).pathname.split('/').pop();
    if (action === 'config')
      return json({ configured: !!env.GATHER_ENCRYPTION_KEY });
    if (action === 'session')
      return json({ expiresAt: Date.now() + 15 * 60000 });
    if (action !== 'records') throw new HttpError(404, 'Not found.');
    const rows = await env.DB.prepare(
      'SELECT id,payload FROM private_records WHERE scope=? ORDER BY updated_at DESC LIMIT 100',
    ).bind(scope).all<any>();
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
    const user = await administrator();
    const scope = await projectScope(user, request);
    const data = await body(request);
    const action = new URL(request.url).pathname.split('/').pop();
    if (action === 'lock') return json({ hidden: true });
    if (action !== 'records') throw new HttpError(404, 'Not found.');
    const record = bookingRecord(data);
    if (record.taskId) {
      const { store } = await loadWorkspace(user, scope);
      if (!store.getState().tasks.some((task: any) => task.id === record.taskId)) throw new HttpError(400, 'Choose a task in this project.');
    }
    const payload = await seal(record, 'booking:' + record.id);
    const at = new Date().toISOString();
    if (data.id) {
      const current = await env.DB.prepare('SELECT payload FROM private_records WHERE id=? AND scope=?').bind(record.id, scope).first<any>();
      if (!current) throw new HttpError(404, 'Booking not found.');
      const conflict = () => new HttpError(409, 'This booking changed in another tab. Your edits are still here; copy them before reloading.');
      if (data.version !== await bookingVersion(current.payload)) throw conflict();
      const updated = await env.DB.prepare('UPDATE private_records SET payload=?,updated_at=? WHERE id=? AND scope=? AND payload=?')
        .bind(payload, at, record.id, scope, current.payload).run();
      if (updated.meta.changes !== 1) throw conflict();
    } else {
      const inserted = await env.DB.prepare('INSERT INTO private_records (id,payload,updated_at,scope) SELECT ?,?,?,? WHERE (SELECT count(*) FROM private_records WHERE scope=?)<100')
        .bind(record.id, payload, at, scope, scope).run();
      if (inserted.meta.changes !== 1) throw new HttpError(409, 'This pilot supports up to 100 private bookings.');
    }
    return json({ saved: true, id: record.id, version: await bookingVersion(payload) });
  });
}
