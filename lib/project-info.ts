import { env } from 'cloudflare:workers';
import '@/legacy/guests.js';
import {
  administrator,
  principal,
  HttpError,
  seal,
  unseal,
  sealFile,
  unsealFile,
} from './security';
import { demoPersona, loadDemo } from './demo';
import { projectUser, assertProjectAccess, projectWriteAccess, accessArgs, type ProjectUser } from './project-access';

const guests = (globalThis as any).GatherGuests;
const MAX_FILE = 5 * 1024 * 1024,
  MAX_STORAGE = 50 * 1024 * 1024;
type Context = {
  scope: string;
  userId: string;
  actor: string;
  name: string;
  admin: boolean;
  demoId: string;
  generation: string;
  authorization?: ProjectUser;
};
type Info = { guests: any[]; files: any[]; receipts: any[] };
export async function infoContext(request: Request): Promise<Context> {
  const params = new URL(request.url).searchParams;
  if (params.get('demo') === '1') {
    const user = await administrator(),
      actor = demoPersona(params.get('as')),
      { id, store } = await loadDemo(user),
      state = store.getState();
    return {
      scope: id + ':' + state.demoGeneration,
      userId: user.userId,
      actor,
      name: state.members.find((m: any) => m.id === actor).name,
      admin: actor === 'jack',
      demoId: id,
      generation: state.demoGeneration,
    };
  }
  const user = await projectUser(await principal(),request);
  return {
    scope: user.projectId,
    authorization: user,
    userId: user.userId,
    actor: user.actorId,
    name: user.displayName,
    admin: user.role === 'admin',
    demoId: '',
    generation: '',
  };
}
function initial(context: Context): Info {
  return {
    guests: context.demoId
      ? [
          {
            id: crypto.randomUUID(),
            ...guests.normalize({
              name: 'Avery Chen',
              email: 'avery@example.com',
              group: 'Design team',
              attendance: 'attending',
            }),
            createdBy: 'jack',
            updatedBy: 'jack',
            updatedName: 'Jack Morgan',
            updatedAt: new Date().toISOString(),
            archivedAt: '',
          },
          {
            id: crypto.randomUUID(),
            ...guests.normalize({
              name: 'Morgan Rivera',
              email: 'morgan@example.com',
              type: 'speaker',
              attendance: 'tentative',
            }),
            createdBy: 'maya',
            updatedBy: 'maya',
            updatedName: 'Maya Singh',
            updatedAt: new Date().toISOString(),
            archivedAt: '',
          },
        ]
      : [],
    files: [],
    receipts: [],
  };
}
async function load(context: Context) {
  await assertProjectAccess(context.authorization);
  let row = await env.DB.prepare(
    'SELECT payload,revision FROM project_info WHERE scope=?',
  )
    .bind(context.scope)
    .first<any>();
  if (!row) {
    await env.DB.prepare(
      'INSERT OR IGNORE INTO project_info (scope,payload,revision) VALUES (?,?,1)',
    )
      .bind(
        context.scope,
        await seal(initial(context), 'info:' + context.scope),
      )
      .run();
    row = await env.DB.prepare(
      'SELECT payload,revision FROM project_info WHERE scope=?',
    )
      .bind(context.scope)
      .first<any>();
  }
  return {
    state: (await unseal(row.payload, 'info:' + context.scope)) as Info,
    revision: row.revision as number,
  };
}
export function infoSnapshot(context: Context, state: Info, revision: number) {
  return {
    revision,
    identity: {
      actor: context.actor,
      name: context.name,
      admin: context.admin,
    },
    guests: state.guests,
    files: state.files.map(({ key, ...file }) => ({
      ...file,
      canArchive: context.admin || file.createdBy === context.actor,
    })),
    uploadsAvailable: !!env.BUCKET,
  };
}
export async function readInfo(context: Context) {
  const { state, revision } = await load(context);
  await assertProjectAccess(context.authorization);
  return infoSnapshot(context, state, revision);
}
function keys(value: any, allowed: string[]) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw new HttpError(400, 'Unsupported event info field.');
}
function text(value: unknown, max: number) {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new HttpError(400, 'Invalid text field.');
  return value.trim();
}
async function digest(value: BufferSource) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', value)),
  )
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
async function fingerprint(input: unknown) {
  return digest(new TextEncoder().encode(JSON.stringify(input)));
}
function requestId(value: unknown) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(value))
    throw new HttpError(400, 'Reload the form and try again.');
  return value;
}
function retried(state: Info, id: string, actor: string, hash: string) {
  const receipt = state.receipts.find((r) => r.id === id && r.actor === actor);
  if (receipt && receipt.hash !== hash)
    throw new HttpError(
      409,
      'This request already saved different information. Reload the form.',
    );
  return !!receipt;
}
function checkRevision(expected: unknown, current: number) {
  if (!Number.isInteger(expected) || expected !== current)
    throw new HttpError(
      409,
      'Event info changed in another tab. Reload it and review your changes before saving.',
    );
}
async function save(
  context: Context,
  state: Info,
  revision: number,
  id: string,
  hash: string,
) {
  state.receipts.push({ id, hash, actor: context.actor });
  state.receipts = state.receipts.slice(-100);
  if (new TextEncoder().encode(JSON.stringify(state)).length > 850000)
    throw new HttpError(
      413,
      'This event’s information is full. Shorten the notes before adding more.',
    );
  const result =
    await env.DB.prepare(`UPDATE project_info SET payload=?,revision=revision+1 WHERE scope=? AND revision=?
    AND (?='' OR EXISTS (SELECT 1 FROM workspaces WHERE id=? AND json_extract(data,'$.demoGeneration')=?))
    AND ${context.authorization ? projectWriteAccess : '1'}`)
      .bind(
        await seal(state, 'info:' + context.scope),
        context.scope,
        revision,
        context.demoId,
        context.demoId,
        context.generation,
        ...(context.authorization ? accessArgs(context.authorization) : []),
      )
      .run();
  if (result.meta.changes !== 1)
    throw new HttpError(
      409,
      'The project changed or the demo restarted. Reload event info before saving.',
    );
  return infoSnapshot(context, state, revision + 1);
}
function normalizeGuest(value: unknown) {
  try {
    return guests.normalize(value);
  } catch (error) {
    throw new HttpError(400, (error as Error).message);
  }
}
function preview(csv: unknown, state: Info) {
  try {
    return guests.preview(csv, state.guests);
  } catch (error) {
    throw new HttpError(400, (error as Error).message);
  }
}
export async function mutateInfo(context: Context, input: any) {
  const allowed: Record<string, string[]> = {
    add: ['guest'],
    edit: ['id', 'guest'],
    archiveGuest: ['id', 'archived'],
    archiveFile: ['id', 'archived'],
    preview: ['csv'],
    import: ['csv', 'filename'],
  };
  if (!Object.hasOwn(allowed, input.action))
    throw new HttpError(400, 'Choose a valid event info action.');
  keys(input, ['action', 'revision', 'requestId', ...allowed[input.action]]);
  const { state, revision } = await load(context);
  if (input.action === 'preview') {
    checkRevision(input.revision, revision);
    return { ...preview(input.csv, state), revision };
  }
  const id = requestId(input.requestId),
    hash = await fingerprint(input);
  if (retried(state, id, context.actor, hash))
    return infoSnapshot(context, state, revision);
  checkRevision(input.revision, revision);
  const at = new Date().toISOString(),
    audit = {
      updatedAt: at,
      updatedBy: context.actor,
      updatedName: context.name,
    };
  if (input.action === 'add' || input.action === 'edit') {
    const guest = normalizeGuest(input.guest),
      existing =
        input.action === 'edit'
          ? state.guests.find((g) => g.id === input.id)
          : null;
    if (input.action === 'edit' && (!existing || existing.archivedAt))
      throw new HttpError(404, 'Guest not found in the active list.');
    if (
      guest.email &&
      state.guests.some((g) => g.id !== existing?.id && g.email === guest.email)
    )
      throw new HttpError(
        409,
        'This email is already in the guest list, including archived records. Edit or restore that guest instead.',
      );
    if (existing) Object.assign(existing, guest, audit);
    else {
      if (state.guests.length >= 500)
        throw new HttpError(
          409,
          'This event supports 500 guest records, including archived guests.',
        );
      state.guests.push({
        id: crypto.randomUUID(),
        ...guest,
        ...audit,
        createdBy: context.actor,
        archivedAt: '',
      });
    }
  }
  if (input.action === 'import') {
    const result = preview(input.csv, state),
      filename = text(input.filename, 120);
    if (result.invalid)
      throw new HttpError(
        400,
        'Fix the invalid rows before importing. No guests were added.',
      );
    if (state.guests.length + result.added > 500)
      throw new HttpError(409, 'This import would exceed 500 guest records.');
    for (const row of result.rows.filter((r: any) => r.status === 'new'))
      state.guests.push({
        id: crypto.randomUUID(),
        ...row.guest,
        ...audit,
        createdBy: context.actor,
        archivedAt: '',
        source: filename,
      });
  }
  if (input.action === 'archiveGuest' || input.action === 'archiveFile') {
    if (typeof input.archived !== 'boolean')
      throw new HttpError(400, 'Choose archive or restore.');
    const record = (
      input.action === 'archiveGuest' ? state.guests : state.files
    ).find((r) => r.id === input.id);
    if (!record) throw new HttpError(404, 'Record not found.');
    if (
      !context.admin &&
      (input.action === 'archiveGuest' || record.createdBy !== context.actor)
    )
      throw new HttpError(
        403,
        'Only the organizer can archive guests or another person’s file.',
      );
    record.archivedAt = input.archived ? at : '';
    Object.assign(record, audit);
  }
  return save(context, state, revision, id, hash);
}

export async function readUpload(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data'))
    throw new HttpError(400, 'Choose a file to upload.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Choose a file to upload.');
  const parts: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_FILE + 16384) {
        await reader.cancel();
        throw new HttpError(413, 'Files must be 5 MB or smaller.');
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  let form: FormData;
  try {
    form = await new Response(bytes, {
      headers: { 'Content-Type': request.headers.get('content-type')! },
    }).formData();
  } catch {
    throw new HttpError(
      400,
      'The upload could not be read. Choose the file again.',
    );
  }
  if (
    [...form.keys()].some(
      (key) => !['file', 'revision', 'requestId'].includes(key),
    ) ||
    ['file', 'revision', 'requestId'].some(
      (key) => form.getAll(key).length !== 1,
    )
  )
    throw new HttpError(400, 'Invalid upload fields.');
  const file = form.get('file');
  if (!file || typeof file === 'string' || !file.size || file.size > MAX_FILE)
    throw new HttpError(400, 'Choose a non-empty file up to 5 MB.');
  const name = file.name
    .replace(/[\\/\u0000-\u001f\u007f]/g, '_')
    .slice(0, 120);
  if (!/\.(pdf|txt|csv|png|jpe?g|docx|xlsx)$/i.test(name))
    throw new HttpError(400, 'Use PDF, TXT, CSV, PNG, JPG, DOCX or XLSX.');
  return {
    bytes: await file.arrayBuffer(),
    name,
    revision: Number(form.get('revision')),
    requestId: requestId(form.get('requestId')),
  };
}
export async function uploadInfo(
  context: Context,
  upload: Awaited<ReturnType<typeof readUpload>>,
) {
  if (!env.BUCKET)
    throw new HttpError(503, 'File uploads are not available yet.');
  const { state, revision } = await load(context),
    hash = await fingerprint({
      name: upload.name,
      size: upload.bytes.byteLength,
      hash: await digest(upload.bytes),
    });
  if (retried(state, upload.requestId, context.actor, hash))
    return infoSnapshot(context, state, revision);
  checkRevision(upload.revision, revision);
  const id = crypto.randomUUID(),
    key = 'project-files/' + id;
  const reserved =
    await env.DB.prepare(`INSERT INTO project_uploads (id,account_id,size) SELECT ?,?,? WHERE
    COALESCE((SELECT SUM(size) FROM project_uploads WHERE account_id=?),0)+?<=? AND (SELECT COUNT(*) FROM project_uploads WHERE account_id=?)<200
    AND ${context.authorization ? projectWriteAccess : '1'}`)
      .bind(
        id,
        context.userId,
        upload.bytes.byteLength,
        context.userId,
        upload.bytes.byteLength,
        MAX_STORAGE,
        context.userId,
        ...(context.authorization ? accessArgs(context.authorization) : []),
      )
      .run();
  if (reserved.meta.changes !== 1)
    throw new HttpError(
      409,
      'The 50 MB / 200-file account limit is reached. Archived and demo files also count.',
    );
  let saving = false;
  try {
    await env.BUCKET.put(
      key,
      await sealFile(upload.bytes, context.scope + ':' + id),
      { httpMetadata: { contentType: 'application/octet-stream' } },
    );
    const at = new Date().toISOString();
    state.files.push({
      id,
      key,
      name: upload.name,
      size: upload.bytes.byteLength,
      createdBy: context.actor,
      updatedBy: context.actor,
      updatedName: context.name,
      updatedAt: at,
      archivedAt: '',
    });
    saving = true;
    return await save(context, state, revision, upload.requestId, hash);
  } catch (error) {
    // A database error can occur after commit. Never delete possibly committed bytes.
    let current: Awaited<ReturnType<typeof load>> | undefined;
    if (saving) {
      try {
        // Internal reconciliation must still determine whether bytes committed after access was revoked.
        current = await load({...context,authorization:undefined});
      } catch {
        console.error(
          'Upload outcome unknown; bytes and reservation retained.',
        );
        throw error;
      }
    }
    await assertProjectAccess(context.authorization).catch(async error => {
      if (!current?.state.files.some((file) => file.id === id)) {
        await env.BUCKET.delete(key);
        await env.DB.prepare('DELETE FROM project_uploads WHERE id=?').bind(id).run();
      }
      throw error;
    });
    if (current?.state.files.some((file) => file.id === id))
      return infoSnapshot(context, current.state, current.revision);
    if (!saving || error instanceof HttpError) {
      try {
        await env.BUCKET.delete(key);
        await env.DB.prepare('DELETE FROM project_uploads WHERE id=?')
          .bind(id)
          .run();
      } catch {
        console.error('Project upload cleanup failed; reservation retained.');
      }
    }
    if (
      current &&
      retried(current.state, upload.requestId, context.actor, hash)
    )
      return infoSnapshot(context, current.state, current.revision);
    throw error;
  }
}
export async function downloadInfo(context: Context, id: string) {
  const { state } = await load(context),
    file = state.files.find((item) => item.id === id && !item.archivedAt);
  if (!file) throw new HttpError(404, 'File not found in this project.');
  if (!env.BUCKET)
    throw new HttpError(503, 'Files are temporarily unavailable.');
  const object = await env.BUCKET.get(file.key);
  if (!object) throw new HttpError(404, 'File is unavailable.');
  const data = await unsealFile(
    await object.arrayBuffer(),
    context.scope + ':' + file.id,
  );
  const fallback = file.name.replace(/[^a-zA-Z0-9._ -]/g, '_');
  await assertProjectAccess(context.authorization);
  return new Response(data, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      Vary: 'Cookie',
    },
  });
}
