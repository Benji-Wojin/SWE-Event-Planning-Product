import { env } from 'cloudflare:workers';
import {
  administrator,
  body,
  HttpError,
  json,
  safe,
  seal,
  unseal,
} from '@/lib/security';
import {
  beginOAuth,
  configuration,
  connection,
  gmail,
  readPlain,
  redirectUri,
  saveConnection,
  tokenRequest,
} from '@/lib/gmail';
import { loadWorkspace, mutateWorkspace } from '@/lib/workspace';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  return safe(async () => {
    const user = await administrator(),
      url = new URL(request.url),
      action = url.pathname.split('/').pop();
    if (action === 'status') {
      const config = await configuration(),
        conn = await connection(user.userId);
      return json({
        configured: !!config,
        connected: !!conn,
        account: conn?.email || '',
        labelId: conn?.labelId || '',
        lastSync: conn?.lastSync || '',
        hasMore: !!conn?.pageToken,
        redirectUri: redirectUri(),
      });
    }
    if (action === 'labels') {
      const data = await gmail(user.userId, 'labels');
      return json({
        labels: data.labels
          .filter((l: any) => l.type === 'user')
          .map((l: any) => ({ id: l.id, name: l.name })),
      });
    }
    if (action === 'messages') {
      const rows = await env.DB.prepare(
        'SELECT id,payload FROM mail_messages WHERE user_id=? ORDER BY received_at DESC LIMIT 100',
      )
        .bind(user.userId)
        .all<any>();
      const { store } = await loadWorkspace(user);
      const state = store.getState(), shared = state.messages;
      const imported = await Promise.all(rows.results.map(async (row) => {
        const original = await unseal(row.payload, 'mail:' + row.id);
        const linked = shared.find((m: any) => m.externalId === 'review:' + row.id);
        const taskId = linked?.appliedTaskId || linked?.linkedTaskId || (linked?.suggested?.mode === 'update' ? linked.suggested.taskId : '');
        return { ...original, id: row.id, reviewed: !!linked, sharedMessageId: linked?.id || '', taskId: state.tasks.some((t: any) => t.id === taskId) ? taskId : '', threadKey: JSON.stringify([original.mailbox || '', original.threadId || row.id]) };
      }));
      return json({
        tasks: state.tasks.map((t: any) => ({ id: t.id, title: t.title })),
        messages: imported.map((m: any) => {
          const known = [...new Set(imported.filter((other: any) => other.threadKey === m.threadKey && other.taskId).map((other: any) => other.taskId))];
          const taskId = m.taskId || (known.length === 1 ? known[0] : '');
          return { ...m, taskId, taskTitle: state.tasks.find((t: any) => t.id === taskId)?.title || '' };
        }),
      });
    }
    if (action === 'original') {
      const row = await env.DB.prepare('SELECT id,payload FROM mail_messages WHERE id=? AND user_id=?')
        .bind(url.searchParams.get('id') || '', user.userId).first<any>();
      if (!row) throw new HttpError(404, 'Private email not found.');
      const original = await unseal(row.payload, 'mail:' + row.id);
      return json({ subject: original.subject, sender: original.sender, body: original.body, receivedAt: original.receivedAt });
    }
    if (action === 'callback') {
      const state = url.searchParams.get('state');
      if (!state)
        throw new HttpError(400, 'Missing Google authorization state.');
      const saved = await env.DB.prepare(
        'SELECT payload FROM oauth_states WHERE id=? AND user_id=? AND expires>?',
      )
        .bind(state, user.userId, Date.now())
        .first<any>();
      if (!saved)
        throw new HttpError(
          400,
          'This authorization expired or was already used. Start again in Gmail settings.',
        );
      if (url.searchParams.has('error')) {
        await env.DB.prepare(
          'DELETE FROM oauth_states WHERE id=? AND user_id=?',
        )
          .bind(state, user.userId)
          .run();
        return Response.redirect(
          env.GATHER_ORIGIN + '/settings?gmail=cancelled',
          303,
        );
      }
      const code = url.searchParams.get('code');
      if (!code)
        throw new HttpError(
          400,
          'Google did not return an authorization code.',
        );
      const config = await configuration();
      if (!config) throw new HttpError(409, 'OAuth configuration is missing.');
      const secret = await unseal(saved.payload, 'oauth:' + state);
      const token = await tokenRequest({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        code_verifier: secret.verifier,
        redirect_uri: redirectUri(),
        grant_type: 'authorization_code',
      });
      if (
        !String(token.scope)
          .split(' ')
          .includes('https://www.googleapis.com/auth/gmail.readonly')
      )
        throw new HttpError(400, 'Gmail read access was not granted.');
      if (!token.refresh_token)
        throw new HttpError(
          400,
          'Google did not grant offline access. Reconnect and approve access.',
        );
      const generation = crypto.randomUUID();
      const payload = await seal(
        {
          accessToken: token.access_token,
          refreshToken: token.refresh_token,
          expiresAt: Date.now() + token.expires_in * 1000,
          labelId: '',
          pageToken: '',
          lastSync: '',
        },
        'gmail:' + user.userId,
      );
      const savedConnection = await env.DB.batch([
        env.DB.prepare(
          'INSERT INTO gmail_connections (user_id,payload,generation) SELECT user_id,?,? FROM oauth_states WHERE id=? AND user_id=? AND expires>? ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload,generation=excluded.generation',
        ).bind(payload, generation, state, user.userId, Date.now()),
        env.DB.prepare(
          'DELETE FROM oauth_states WHERE id=? AND user_id=?',
        ).bind(state, user.userId),
      ]);
      if (savedConnection[0].meta.changes !== 1)
        throw new HttpError(
          409,
          'This authorization was cancelled or already completed.',
        );
      const profile = await gmail(user.userId, 'profile');
      const conn = await connection(user.userId);
      await saveConnection(user.userId, {
        ...conn,
        email: profile.emailAddress,
      });
      return Response.redirect(
        env.GATHER_ORIGIN + '/settings?gmail=connected',
        303,
      );
    }
    throw new HttpError(404, 'Not found.');
  });
}
export async function POST(request: Request) {
  return safe(async () => {
    const user = await administrator(),
      data = await body(request),
      action = new URL(request.url).pathname.split('/').pop();
    if (action === 'configure') {
      const clientId = String(data.clientId || '').trim(),
        clientSecret = String(data.clientSecret || '').trim();
      if (
        !/^[a-zA-Z0-9._-]+\.apps\.googleusercontent\.com$/.test(clientId) ||
        clientId.length > 300 ||
        clientSecret.length < 10 ||
        clientSecret.length > 500
      )
        throw new HttpError(
          400,
          'Enter a valid Google Web application client ID and client secret.',
        );
      if (await connection(user.userId))
        throw new HttpError(
          409,
          'Disconnect Gmail before replacing the OAuth client.',
        );
      await env.DB.prepare(
        'INSERT INTO settings (id,payload) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
      )
        .bind(
          'google-oauth',
          await seal({ clientId, clientSecret }, 'google-oauth'),
        )
        .run();
      return json({ saved: true });
    }
    if (action === 'connect')
      return json({ url: await beginOAuth(user.userId) });
    if (action === 'label') {
      const labelId = String(data.labelId || '');
      const labels = await gmail(user.userId, 'labels');
      if (
        !labels.labels.some((l: any) => l.id === labelId && l.type === 'user')
      )
        throw new HttpError(
          400,
          'Choose a project label from this Gmail account.',
        );
      const conn = await connection(user.userId);
      await saveConnection(
        user.userId,
        { ...conn, labelId, pageToken: '', lastSync: '' },
        true,
      );
      return json({ saved: true });
    }
    if (action === 'sync') {
      const conn = await connection(user.userId);
      if (!conn?.labelId || !conn.email)
        throw new HttpError(
          409,
          'Choose a Gmail project label after the account connection is complete.',
        );
      const params = new URLSearchParams({
        labelIds: conn.labelId,
        maxResults: '20',
      });
      if (data.nextPage && conn.pageToken)
        params.set('pageToken', conn.pageToken);
      const list = await gmail(user.userId, 'messages?' + params);
      let imported = 0;
      for (const item of list.messages || []) {
        const providerKey = conn.email.toLowerCase() + ':' + item.id;
        const existing = await env.DB.prepare(
          'SELECT id FROM mail_messages WHERE user_id=? AND provider_id=?',
        )
          .bind(user.userId, providerKey)
          .first();
        if (existing) continue;
        const message = await gmail(
          user.userId,
          'messages/' + encodeURIComponent(item.id) + '?format=full',
        );
        if (!message.labelIds?.includes(conn.labelId)) continue;
        const headers = message.payload?.headers || [],
          header = (name: string) =>
            headers.find((h: any) => h.name.toLowerCase() === name)?.value ||
            '';
        const id = crypto.randomUUID(),
          receivedAt = new Date(
            Number(message.internalDate) || Date.now(),
          ).toISOString();
        const value = {
          mailbox: conn.email,
          sender: header('from'),
          subject: header('subject'),
          body:
            readPlain(message.payload) ||
            message.snippet ||
            '(No text preview available.)',
          providerId: item.id,
          threadId: message.threadId,
          receivedAt,
        };
        const inserted = await env.DB.prepare(
          'INSERT OR IGNORE INTO mail_messages (id,user_id,provider_id,payload,received_at) SELECT ?,?,?,?,? FROM gmail_connections WHERE user_id=? AND generation=?',
        )
          .bind(
            id,
            user.userId,
            providerKey,
            await seal(value, 'mail:' + id),
            receivedAt,
            user.userId,
            conn.generation,
          )
          .run();
        imported += inserted.meta.changes;
      }
      const latest = await connection(user.userId);
      if (
        latest?.generation !== conn.generation ||
        latest?.labelId !== conn.labelId
      )
        throw new HttpError(
          409,
          'Your Gmail connection changed during sync. Reload before continuing.',
        );
      await saveConnection(user.userId, {
        ...latest,
        lastSync: new Date().toISOString(),
        pageToken: list.nextPageToken || '',
      });
      return json({ imported, hasMore: !!list.nextPageToken });
    }
    if (action === 'review') {
      const row = await env.DB.prepare(
        'SELECT id,payload FROM mail_messages WHERE id=? AND user_id=?',
      )
        .bind(String(data.id), user.userId)
        .first<any>();
      if (!row) throw new HttpError(404, 'Message not found.');
      const subject = String(data.title || '')
          .trim()
          .slice(0, 200),
        summary = String(data.summary || '')
          .trim()
          .slice(0, 3000);
      if (!subject || !summary || data.confirmShared !== true)
        throw new HttpError(
          400,
          'Write a task title and safe summary, then confirm they can be shared.',
        );
      const original = await unseal(row.payload, 'mail:' + row.id);
      const hash = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(
          user.userId +
            ':' +
            (original.mailbox || '') +
            ':' +
            original.threadId,
        ),
      );
      const threadId =
        'gmail-' +
        Array.from(new Uint8Array(hash))
          .map((x) => x.toString(16).padStart(2, '0'))
          .join('');
      const { row: workspaceRow } = await loadWorkspace(user);
      const result = await mutateWorkspace(user, {
        method: 'addMessage',
        args: [
          {
            sender: 'Organizer-reviewed Gmail update',
            subject,
            body: summary,
            externalId: 'review:' + row.id,
            threadId,
            receivedAt: original.receivedAt,
            taskId: data.taskId || undefined,
          },
        ],
        revision: workspaceRow.revision,
      });
      return json({ saved: true, id: (result.result as any).id });
    }
    if (action === 'disconnect') {
      const conn = await connection(user.userId);
      if (conn) {
        const response = await fetch('https://oauth2.googleapis.com/revoke', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            token: conn.refreshToken || conn.accessToken,
          }),
        });
        if (!response.ok && response.status !== 400)
          throw new HttpError(
            502,
            'Google could not revoke access. Try again, or revoke it in your Google account.',
          );
      }
      await env.DB.prepare('DELETE FROM gmail_connections WHERE user_id=?')
        .bind(user.userId)
        .run();
      await env.DB.prepare('DELETE FROM oauth_states WHERE user_id=?')
        .bind(user.userId)
        .run();
      return json({ disconnected: true });
    }
    throw new HttpError(404, 'Not found.');
  });
}
