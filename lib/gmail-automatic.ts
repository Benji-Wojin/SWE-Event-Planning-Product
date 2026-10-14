import { env } from '@/lib/runtime';
import { requireGmailEnabled } from './gmail-policy';
import { HttpError, seal, unseal } from './security';
import {
  connection,
  configuration,
  saveConnection,
  tokenRequest,
  gmailWithToken,
  GmailError,
  readPlain,
} from './gmail';
import {
  classifyMail,
  mailRequestBody,
  MailProviderError,
  type MailContext,
} from './mail-classifier';
import { projectOwner } from './project-access';
import { MAIL_AI_CONSENT_VERSION } from './groq';

const INTERVAL = 5 * 60000,
  LEASE = 120000,
  DAILY_LIMIT = 250;
type Scan = {
  mode: 'bootstrap' | 'history';
  start: string;
  pageToken: string;
  pending?: string[];
  nextPageToken?: string;
  end?: string;
};
type State = {
  projectIds: string[];
  consentedAt: string;
  consentVersion?: string;
  historyId: string;
  after: number;
  scan?: Scan;
  bootstrap?: Scan;
  recovery?: boolean;
};
type Job = {
  user_id: string;
  generation: string;
  connection_generation: string;
  enabled: number;
  payload: string;
  lease: string;
  lease_until: number;
  next_run: number;
  last_success: string;
  issue: string;
};
const readJob = (userId: string) =>
  env.DB.prepare('SELECT * FROM gmail_automation WHERE user_id=?')
    .bind(userId)
    .first<Job>();
const contextKey = (userId: string) => 'gmail-auto:' + userId;
const issues: Record<string, string> = {
  reconnect: 'Reconnect Gmail, then enable automatic checks again.',
  provider:
    'Email checks are delayed. Weft will retry without skipping messages.',
  limit: 'Daily email-check limit reached. Checks resume tomorrow.',
  access: 'A selected project is no longer available. Review your selection.',
  unconfigured: 'Email suggestions need a server API key.',
  consent:
    'Email checks are paused. Approve sending email text to Groq to resume from saved progress.',
  rate_limit:
    'Groq’s free-plan limit was reached. Checks will retry without skipping messages.',
  context_limit:
    'Email checks are paused: this email and selected project details exceed the free-plan request budget. Select fewer projects or use manual email import. Queued emails are kept.',
  credentials: 'Email AI credentials need attention from the app owner.',
};

export async function automaticStatus(userId: string) {
  const job = await readJob(userId),
    conn = await connection(userId);
  const state: State | null = job
    ? await unseal(job.payload, contextKey(userId))
    : null;
  const current =
    !!job && !!conn && job.connection_generation === conn.generation;
  const consentRequired =
    !!job && state?.consentVersion !== MAIL_AI_CONSENT_VERSION;
  return {
    configured: !!env.GROQ_API_KEY,
    consentRequired,
    backgroundReady:
      env.GMAIL_BACKGROUND_MODE === 'vercel-cron' &&
      (env.CRON_SECRET?.length || 0) >= 32,
    enabled: current && !!job?.enabled && !consentRequired,
    projectIds: state?.projectIds || [],
    lastCheck: job?.last_success || '',
    catchingUp: !!state?.scan || !!state?.bootstrap,
    recovery: !!state?.recovery,
    issue:
      job && !current
        ? issues.reconnect
        : consentRequired
          ? issues.consent
          : issues[job?.issue || ''] || '',
  };
}

async function ownedContexts(
  userId: string,
  ids: string[],
): Promise<MailContext[]> {
  const member = await env.DB.prepare(
    'SELECT 1 FROM members WHERE user_id=?',
  )
    .bind(userId)
    .first();
  if (!member) throw new HttpError(403, 'Project access changed.');
  const result: MailContext[] = [];
  for (const id of ids) {
    if ((await projectOwner(id)) !== userId)
      throw new HttpError(403, 'Project access changed.');
    const row = await env.DB.prepare('SELECT data FROM workspaces WHERE id=?')
      .bind(id)
      .first<{ data: string }>();
    if (!row) throw new HttpError(403, 'Project access changed.');
    const state = JSON.parse(row.data);
    result.push({
      id,
      name: String(state.event?.name || '').slice(0, 200),
      date: String(state.event?.date || '').slice(0, 50),
      location: String(state.event?.location || '').slice(0, 200),
      tasks: (state.tasks || [])
        .filter((t: any) => !t.archivedAt)
        .slice(0, 60)
        .map((t: any) => ({
          id: String(t.id),
          title: String(t.title).slice(0, 200),
        })),
    });
  }
  return result;
}

export async function configureAutomatic(userId: string, input: any) {
  requireGmailEnabled();
  if (input.enabled === false) {
    await env.DB.prepare(
      "UPDATE gmail_automation SET enabled=0,generation=?,lease='',lease_until=0 WHERE user_id=?",
    )
      .bind(crypto.randomUUID(), userId)
      .run();
    return automaticStatus(userId);
  }
  if (
    input.enabled !== true ||
    input.consent !== true ||
    input.consentVersion !== MAIL_AI_CONSENT_VERSION ||
    !Array.isArray(input.projectIds) ||
    input.projectIds.length < 1 ||
    input.projectIds.length > 10 ||
    input.projectIds.some((id: unknown) => typeof id !== 'string') ||
    new Set(input.projectIds).size !== input.projectIds.length
  )
    throw new HttpError(
      400,
      'Choose up to ten projects and approve private AI email checks.',
    );
  if (!env.GROQ_API_KEY) throw new HttpError(503, issues.unconfigured);
  const conn = await connection(userId);
  if (!conn?.email) throw new HttpError(409, 'Connect Gmail first.');
  await ownedContexts(userId, input.projectIds);
  const previous = await readJob(userId);
  const old: State | null = previous
    ? await unseal(previous.payload, contextKey(userId))
    : null;
  // Idempotent repeated clicks preserve the cursor and any active worker lease.
  if (
    previous?.enabled &&
    previous.connection_generation === conn.generation &&
    old &&
    old.consentVersion === MAIL_AI_CONSENT_VERSION &&
    [...old.projectIds].sort().join('|') ===
      [...input.projectIds].sort().join('|')
  )
    return automaticStatus(userId);
  // Provider-only re-consent must preserve pending mail, pagination and deduplication.
  // Match the encrypted snapshot as well as the generation to reject concurrent checkpoints.
  if (
    previous &&
    old &&
    previous.connection_generation === conn.generation &&
    [...old.projectIds].sort().join('|') ===
      [...input.projectIds].sort().join('|')
  ) {
    const resumed =
      await env.DB.prepare(`UPDATE gmail_automation SET payload=?,enabled=1,lease='',lease_until=0,next_run=0,issue=''
      WHERE user_id=? AND generation=? AND payload=? AND connection_generation=?
      AND EXISTS (SELECT 1 FROM gmail_connections WHERE user_id=? AND generation=?)`)
        .bind(
          await seal(
            {
              ...old,
              consentVersion: MAIL_AI_CONSENT_VERSION,
              consentedAt: new Date().toISOString(),
            },
            contextKey(userId),
          ),
          userId,
          previous.generation,
          previous.payload,
          conn.generation,
          userId,
          conn.generation,
        )
        .run();
    if (resumed.meta.changes !== 1)
      throw new HttpError(
        409,
        'Email checks changed. Reload before enabling checks.',
      );
    return automaticStatus(userId);
  }
  const state: State = {
    projectIds: input.projectIds,
    consentedAt: new Date().toISOString(),
    consentVersion: MAIL_AI_CONSENT_VERSION,
    historyId: '',
    after: Math.floor((Date.now() - 7 * 86400000) / 1000),
  };
  const saved =
    await env.DB.prepare(`INSERT INTO gmail_automation (user_id,generation,connection_generation,enabled,payload)
    SELECT ?,?,?,1,? WHERE EXISTS (SELECT 1 FROM gmail_connections WHERE user_id=? AND generation=?)
    ON CONFLICT(user_id) DO UPDATE SET generation=excluded.generation,connection_generation=excluded.connection_generation,
    enabled=1,payload=excluded.payload,lease='',lease_until=0,next_run=0,last_success='',issue=''`)
      .bind(
        userId,
        crypto.randomUUID(),
        conn.generation,
        await seal(state, contextKey(userId)),
        userId,
        conn.generation,
      )
      .run();
  if (saved.meta.changes !== 1)
    throw new HttpError(409, 'Gmail changed. Reload before enabling checks.');
  return automaticStatus(userId);
}

function jobGuard(job: Job, state: State) {
  const sql = `EXISTS (SELECT 1 FROM gmail_automation a JOIN gmail_connections c ON c.user_id=a.user_id
    JOIN members m ON m.user_id=a.user_id WHERE a.user_id=? AND a.generation=? AND a.lease=? AND a.lease_until>?
    AND a.enabled=1 AND c.generation=a.connection_generation)`;
  const parts = state.projectIds.map(
    () => `((?='main' AND EXISTS (SELECT 1 FROM members WHERE user_id=? AND actor_id='jack' AND role='admin'))
    OR EXISTS (SELECT 1 FROM projects WHERE id=? AND owner_id=?))`,
  );
  return {
    sql: [sql, ...parts].join(' AND '),
    args: [
      job.user_id,
      job.generation,
      job.lease,
      Date.now(),
      ...state.projectIds.flatMap((id) => [id, job.user_id, id, job.user_id]),
    ],
  };
}
async function assertActive(job: Job, state: State) {
  const guard = jobGuard(job, state);
  if (
    !(await env.DB.prepare('SELECT 1 WHERE ' + guard.sql)
      .bind(...guard.args)
      .first())
  )
    throw new HttpError(409, 'Automatic email settings changed.');
}
async function checkpoint(job: Job, state: State) {
  const guard = jobGuard(job, state);
  const result = await env.DB.prepare(
    'UPDATE gmail_automation SET payload=? WHERE user_id=? AND ' + guard.sql,
  )
    .bind(
      await seal(state, contextKey(job.user_id)),
      job.user_id,
      ...guard.args,
    )
    .run();
  if (result.meta.changes !== 1)
    throw new HttpError(409, 'Automatic email settings changed.');
}
async function receiptId(job: Job, mailbox: string, id: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(
      JSON.stringify([job.user_id, job.generation, mailbox, id]),
    ),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
function historyId(value: unknown) {
  if (typeof value !== 'string' || !/^\d+$/.test(value))
    throw new HttpError(502, 'Gmail returned an incomplete checkpoint.');
  return value;
}
function incoming(message: any, mailbox: string) {
  const labels: string[] = message.labelIds || [];
  if (labels.some((label) => ['SPAM', 'TRASH', 'DRAFT'].includes(label)))
    return false;
  const recipients =
    (message.payload?.headers || [])
      .filter((h: any) =>
        ['to', 'cc', 'delivered-to'].includes(h.name?.toLowerCase()),
      )
      .map((h: any) => h.value)
      .join(' ')
      .toLowerCase()
      .match(/[^\s<>(),;]+@[^\s<>(),;]+/g) || [];
  return (
    !labels.includes('SENT') ||
    labels.includes('INBOX') ||
    recipients.includes(mailbox.toLowerCase())
  );
}

export async function runAutomatic(userId: string) {
  requireGmailEnabled();
  const lease = crypto.randomUUID(),
    now = Date.now();
  const claimed =
    await env.DB.prepare(`UPDATE gmail_automation SET lease=?,lease_until=?,next_run=?
    WHERE user_id=? AND enabled=1 AND lease_until<=? AND next_run<=?
    AND EXISTS (SELECT 1 FROM gmail_connections c WHERE c.user_id=gmail_automation.user_id AND c.generation=gmail_automation.connection_generation)`)
      .bind(lease, now + LEASE, now + INTERVAL, userId, now, now)
      .run();
  if (claimed.meta.changes !== 1)
    return { checked: 0, imported: 0, status: 'not_due' };
  const job = (await readJob(userId))!;
  if (job.lease !== lease)
    return { checked: 0, imported: 0, status: 'changed' };
  let state: State;
  try {
    state = await unseal(job.payload, contextKey(userId));
    if (state.consentVersion !== MAIL_AI_CONSENT_VERSION) {
      await env.DB.prepare(
        "UPDATE gmail_automation SET enabled=0,lease='',lease_until=0,issue='consent' WHERE user_id=? AND generation=? AND lease=?",
      )
        .bind(userId, job.generation, lease)
        .run();
      return { checked: 0, imported: 0, status: 'consent' };
    }
    await assertActive(job, state);
    const projects = await ownedContexts(userId, state.projectIds);
    if (!env.GROQ_API_KEY) throw new HttpError(503, issues.unconfigured);
    let conn = await connection(userId);
    if (!conn || conn.generation !== job.connection_generation)
      throw new HttpError(409, 'Gmail changed.');
    if (conn.expiresAt < Date.now() + LEASE) {
      const config = await configuration();
      if (!config || !conn.refreshToken)
        throw new HttpError(401, 'Reconnect Gmail.');
      await assertActive(job, state);
      const token = await tokenRequest({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: conn.refreshToken,
        grant_type: 'refresh_token',
      });
      if (
        !token.access_token ||
        !Number.isFinite(token.expires_in) ||
        token.expires_in <= 0
      )
        throw new HttpError(502, 'Gmail token refresh failed.');
      if (token.scope && !String(token.scope).split(' ').includes('https://www.googleapis.com/auth/gmail.readonly'))
        throw new HttpError(401, 'Reconnect Gmail imports to approve read access.');
      conn = {
        ...conn,
        accessToken: token.access_token,
        expiresAt: Date.now() + token.expires_in * 1000,
        refreshToken: token.refresh_token || conn.refreshToken,
      };
      await assertActive(job, state);
      await saveConnection(userId, conn);
    }
    const get = async (path: string) => {
      await assertActive(job, state);
      return gmailWithToken(conn.accessToken, path);
    };
    if (!state.scan) {
      state.scan = state.historyId
        ? { mode: 'history', start: state.historyId, pageToken: '' }
        : {
            mode: 'bootstrap',
            start: historyId((await get('profile')).historyId),
            pageToken: '',
          };
      await checkpoint(job, state);
    }
    // Keep the initial seven-day backlog separate from incoming history.
    // Every invocation checks new arrivals before resuming older messages.
    if (state.scan.mode === 'bootstrap') {
      state.bootstrap = state.scan;
      state.historyId ||= state.scan.start;
      state.scan = { mode: 'history', start: state.historyId, pageToken: '' };
      await checkpoint(job, state);
    }
    let scan = state.scan;
    // At most two pages: incoming history, then one backlog page if idle.
    for (let lane = 0; lane < 2; lane++) {
      if (!scan.pending) {
        const params = new URLSearchParams({ maxResults: '10' });
        if (scan.pageToken) params.set('pageToken', scan.pageToken);
        let list: any;
        if (scan.mode === 'bootstrap') {
          params.set('q', 'after:' + state.after + ' -in:spam -in:trash');
          list = await get('messages?' + params);
          scan.pending = (list.messages || []).map((m: any) => m.id);
          scan.end = scan.start;
        } else {
          params.set('startHistoryId', scan.start);
          params.set('historyTypes', 'messageAdded');
          try {
            list = await get('history?' + params);
          } catch (error) {
            if (!(error instanceof GmailError) || error.providerStatus !== 404)
              throw error;
            state.historyId = '';
            state.scan = undefined;
            delete state.bootstrap;
            state.after = Math.floor((Date.now() - 7 * 86400000) / 1000);
            state.recovery = true;
            await checkpoint(job, state);
            await env.DB.prepare(
              "UPDATE gmail_automation SET lease='',lease_until=0 WHERE user_id=? AND lease=?",
            )
              .bind(userId, lease)
              .run();
            return { checked: 0, imported: 0, status: 'recovering' };
          }
          scan.pending = (list.history || []).flatMap((entry: any) =>
            (entry.messagesAdded || []).map((m: any) => m.message?.id),
          );
          scan.end = historyId(list.historyId);
        }
        if (
          !scan.pending ||
          scan.pending.length > 500 ||
          scan.pending.some(
            (id) => typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,200}$/.test(id),
          )
        )
          throw new HttpError(502, 'Gmail returned an invalid page.');
        scan.pending = [...new Set(scan.pending)];
        scan.nextPageToken = list.nextPageToken || '';
        await checkpoint(job, state);
      }
      if (scan.mode === 'history' && !scan.pending?.length && !scan.nextPageToken && state.bootstrap) {
        state.historyId = historyId(scan.end);
        scan = state.bootstrap;
        state.scan = scan;
        delete state.bootstrap;
        await checkpoint(job, state);
      } else {
        break;
      }
    }
    const ids = scan.pending!.slice(0, 1),
      candidates: any[] = [],
      receipts: string[] = [];
    for (const id of ids) {
      const receipt = await receiptId(job, conn.email.toLowerCase(), id);
      if (
        await env.DB.prepare('SELECT 1 FROM gmail_receipts WHERE id=?')
          .bind(receipt)
          .first()
      )
        continue;
      receipts.push(receipt);
      // Previously reviewed/imported originals are not classified or duplicated again.
      if (
        await env.DB.prepare(
          'SELECT 1 FROM mail_messages WHERE user_id=? AND provider_id=?',
        )
          .bind(userId, conn.email.toLowerCase() + ':' + id)
          .first()
      )
        continue;
      let message: any;
      try {
        message = await get(
          'messages/' + encodeURIComponent(id) + '?format=full',
        );
      } catch (error) {
        if (error instanceof GmailError && error.providerStatus === 404)
          continue;
        throw error;
      }
      if (!incoming(message, conn.email)) continue;
      const header = (name: string) =>
        String(
          (message.payload?.headers || []).find(
            (h: any) => h.name?.toLowerCase() === name,
          )?.value || '',
        );
      const time = Number(message.internalDate);
      candidates.push({
        id,
        mailbox: conn.email,
        providerId: id,
        threadId: String(message.threadId || id),
        sender: header('from').slice(0, 400),
        subject: header('subject').slice(0, 200),
        body: (
          readPlain(message.payload) ||
          message.snippet ||
          '(No text preview available.)'
        ).slice(0, 24000),
        receivedAt: new Date(
          Number.isFinite(time) && time > 0 ? time : now,
        ).toISOString(),
      });
    }
    let suggestions: Awaited<ReturnType<typeof classifyMail>> = [];
    if (candidates.length) {
      await assertActive(job, state);
      const previous =
        await env.DB.prepare(`SELECT id,payload,project_id FROM mail_messages WHERE user_id=?
        AND project_id IN (${state.projectIds.map(() => '?').join(',')}) ORDER BY received_at DESC LIMIT 100`)
          .bind(userId, ...state.projectIds)
          .all<any>();
      for (const row of previous.results) {
        const original = await unseal(row.payload, 'mail:' + row.id);
        if (
          original.mailbox?.toLowerCase() !== conn.email.toLowerCase() ||
          original.ai?.relevance !== 'match'
        )
          continue;
        for (const message of candidates.filter(
          (m) => m.threadId === original.threadId,
        )) {
          if (!message.knownProjectId) {
            message.knownProjectId = row.project_id;
            message.knownTaskId = original.ai.taskId || '';
          } else if (message.knownProjectId !== row.project_id) {
            message.knownProjectId = 'ambiguous';
            message.knownTaskId = '';
          }
        }
      }
      const inputs = candidates.map(
        ({ id, subject, sender, body, knownProjectId, knownTaskId }) => ({
          id,
          subject,
          sender,
          body: body.slice(0, 12000),
          ...(knownProjectId && knownProjectId !== 'ambiguous'
            ? { knownProjectId, knownTaskId }
            : {}),
        }),
      );
      mailRequestBody(inputs, projects); // Check size before consuming the daily allowance.
      const quota =
          'gmail-ai:' + userId + ':' + new Date().toISOString().slice(0, 10),
        guard = jobGuard(job, state);
      const reserved =
        await env.DB.prepare(`INSERT INTO resource_usage (id,count) SELECT ?,? WHERE ${guard.sql}
        ON CONFLICT(id) DO UPDATE SET count=count+excluded.count WHERE resource_usage.count+excluded.count<=?`)
          .bind(quota, candidates.length, ...guard.args, DAILY_LIMIT)
          .run();
      if (reserved.meta.changes !== 1) throw new HttpError(429, issues.limit);
      await assertActive(job, state);
      suggestions = await classifyMail(inputs, projects);
    }
    await assertActive(job, state);
    const statements: D1PreparedStatement[] = [],
      guard = jobGuard(job, state);
    for (const suggestion of suggestions.filter(
      (item) => item.relevance !== 'unrelated',
    )) {
      const message = candidates.find((m) => m.id === suggestion.id)!,
        id = crypto.randomUUID();
      const payload = await seal({ ...message, ai: suggestion }, 'mail:' + id);
      statements.push(
        env.DB.prepare(`INSERT OR IGNORE INTO mail_messages (id,user_id,provider_id,payload,received_at,project_id)
        SELECT ?,?,?,?,?,? WHERE ${guard.sql}`).bind(
          id,
          userId,
          conn.email.toLowerCase() + ':' + message.providerId,
          payload,
          message.receivedAt,
          suggestion.projectId,
          ...guard.args,
        ),
      );
    }
    for (const receipt of receipts)
      statements.push(
        env.DB.prepare(
          `INSERT OR IGNORE INTO gmail_receipts (id,created_at) SELECT ?,? WHERE ${guard.sql}`,
        ).bind(receipt, now, ...guard.args),
      );
    const inserted = statements.length ? await env.DB.batch(statements) : [];
    await assertActive(job, state);
    scan.pending = scan.pending!.slice(ids.length);
    if (!scan.pending.length) {
      if (scan.nextPageToken) {
        scan.pageToken = scan.nextPageToken;
        delete scan.pending;
        delete scan.nextPageToken;
      } else {
        // Bootstrap's start cursor may now be older than the live cursor.
        if (scan.mode === 'history') state.historyId = historyId(scan.end);
        delete state.scan;
      }
    }
    await checkpoint(job, state);
    const finalGuard = jobGuard(job, state);
    await env.DB.prepare(
      `UPDATE gmail_automation SET lease='',lease_until=0,last_success=?,issue='' WHERE user_id=? AND ${finalGuard.sql}`,
    )
      .bind(new Date().toISOString(), userId, ...finalGuard.args)
      .run();
    await env.DB.prepare('DELETE FROM gmail_receipts WHERE created_at<?')
      .bind(now - 30 * 86400000)
      .run();
    return {
      checked: ids.length,
      imported: inserted
        .slice(0, suggestions.filter((s) => s.relevance !== 'unrelated').length)
        .reduce((sum, row) => sum + row.meta.changes, 0),
      status: state.scan || state.bootstrap ? 'catching_up' : 'checked',
    };
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 503;
    const issue =
      error instanceof MailProviderError
        ? error.category
        : !env.GROQ_API_KEY
          ? 'unconfigured'
          : status === 401 ||
              (error instanceof GmailError && error.providerStatus === 401) ||
              (error instanceof HttpError &&
                error.message.includes('expired or was revoked'))
            ? 'reconnect'
            : status === 403
              ? 'access'
              : error instanceof HttpError && error.message === issues.limit
                ? 'limit'
                : 'provider';
    const next =
      issue === 'limit'
        ? Date.parse(
            new Date(now + 86400000).toISOString().slice(0, 10) + 'T00:00:00Z',
          )
        : error instanceof MailProviderError && issue === 'rate_limit'
          ? now + Math.max(INTERVAL, error.retryAfter * 1000)
          : issue === 'credentials'
            ? now + 60 * 60000
            : now + INTERVAL;
    await env.DB.prepare(
      "UPDATE gmail_automation SET lease='',lease_until=0,issue=?,next_run=?,enabled=CASE WHEN ?='context_limit' THEN 0 ELSE enabled END WHERE user_id=? AND generation=? AND lease=?",
    )
      .bind(issue, next, issue, userId, job.generation, lease)
      .run();
    // Never return provider payloads, message text, tokens, or account identifiers to a runner.
    return { checked: 0, imported: 0, status: issue };
  }
}

export async function runDueMailboxes() {
  requireGmailEnabled();
  const due =
    await env.DB.prepare(`SELECT a.user_id FROM gmail_automation a JOIN gmail_connections c ON c.user_id=a.user_id
    WHERE a.enabled=1 AND a.connection_generation=c.generation AND a.next_run<=? AND a.lease_until<=?
    ORDER BY a.next_run,a.user_id LIMIT 1`)
      .bind(Date.now(), Date.now())
      .all<{ user_id: string }>();
  return {
    results: await Promise.all(
      due.results.map((row) => runAutomatic(row.user_id)),
    ),
  };
}
