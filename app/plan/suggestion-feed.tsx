'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { planSelection } from '@/lib/plan-selection';
import { planApprovalHash } from '@/lib/plan-approval-hash';

const approvalTimeout = 15_000;
type Approval = {
  kind: 'uncertain' | 'conflict';
  scope: string;
  generation: string;
  hash: string;
  revision: number;
  workspaceRevision: number;
};
const isAccessError = (status?: number) => status === 401 || status === 403 || status === 404;
async function read(query: string, body?: unknown, timeout = 45_000) {
  const response = await fetch('/api/plan?' + query, {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(timeout),
    headers: body
      ? { 'Content-Type': 'application/json', 'X-Gather-Request': '1' }
      : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const result: any = await response.json().catch(() => null);
  if (!response.ok || !result?.event)
    throw Object.assign(
      new Error(result?.error || 'Could not load suggestions.'),
      { status: response.status, staleWrite: !!body && response.status === 409, unreadable: response.ok },
    );
  return result;
}
const stored = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const remember = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* Preferences are optional. */
  }
};

export function SuggestionFeed({ query }: { query: string }) {
  const [data, setData] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [enabled, setEnabled] = useState(false),
    [dismissed, setDismissed] = useState<string[]>([]);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [approvalNotice, setApprovalNotice] = useState('');
  const [confirmedApproval, setConfirmedApproval] = useState<Approval | null>(null);
  const recovery = useRef<Approval | null>(null);
  const pauseAutomatic = useRef(false);
  const receiptHeading = useRef<HTMLParagraphElement>(null);
  const focusReceipt = useRef(false);
  const pending = useRef(false),
    attempted = useRef(''),
    queuedReload = useRef(false),
    activeConsent = useRef('');
  const consentKey = data
    ? 'weft-auto-suggestions-v1:' + data.suggestionScope
    : '';
  const dismissalKey = data
    ? 'weft-dismissed-suggestions-v1:' +
      data.suggestionScope +
      ':' +
      data.draft?.generation
    : '';
  function updateApproval(value: Approval | null) {
    recovery.current = value;
    setApproval(value);
    setApprovalNotice('');
  }
  async function run(operation: () => Promise<void>, { reloadOnConflict = true } = {}) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (e) {
      if (isAccessError((e as { status?: number }).status)) {
        remember(activeConsent.current, null);
        setData(null);
        setEnabled(false);
        setDismissed([]);
        queuedReload.current = false;
        updateApproval(null);
        setConfirmedApproval(null);
      }
      // A rejected stale write must refresh the saved snapshot, never replay the write.
      if (reloadOnConflict && (e as { staleWrite?: boolean }).staleWrite)
        queuedReload.current = true;
      setError(
        e instanceof Error && ['TimeoutError', 'AbortError'].includes(e.name)
          ? 'The request timed out. Reload suggestions to check the saved result before retrying.'
          : e instanceof Error ? e.message : 'Suggestions are unavailable.',
      );
    } finally {
      pending.current = false;
      setBusy(false);
      if (queuedReload.current) {
        queuedReload.current = false;
        void reload();
      }
    }
  }
  function accept(result: any) {
    activeConsent.current =
      'weft-auto-suggestions-v1:' + result.suggestionScope;
    setData(result);
    setEnabled(stored(activeConsent.current) === 'enabled');
    let ids = [];
    try {
      ids = JSON.parse(
        stored(
          'weft-dismissed-suggestions-v1:' +
            result.suggestionScope +
            ':' +
            result.draft?.generation,
        ) || '[]',
      );
    } catch {}
    setDismissed(
      Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [],
    );
  }
  const reload = () => run(async () => {
    const result = await read(query);
    // Parent updates may revalidate access, but cannot settle an explicit Add.
    if (recovery.current && result.suggestionScope === recovery.current.scope) return;
    if (recovery.current) updateApproval(null);
    accept(result);
  });
  useEffect(() => {
    void reload();
  }, [query]);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.origin === location.origin &&
        event.source === window.parent &&
        event.data?.type === 'weft-context-changed'
      ) {
        if (pending.current) queuedReload.current = true;
        else void reload();
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [query]);
  useEffect(() => {
    window.parent.postMessage(
      {
        type: 'weft-plan-sidebar',
        event: 'state',
        dirty: !!approval,
        busy: busy || data?.status === 'generating',
      },
      location.origin,
    );
  }, [approval, busy, data?.status]);
  useEffect(() => {
    if (!data?.receipt || !focusReceipt.current) return;
    focusReceipt.current = false;
    receiptHeading.current?.focus();
  }, [data?.receipt]);
  useEffect(() => {
    const root = document.getElementById('embeddedPlan');
    if (!root) return;
    const measure = () =>
      window.parent.postMessage(
        {
          type: 'weft-plan-sidebar',
          event: 'height',
          height: Math.ceil(root.getBoundingClientRect().height) + 12,
        },
        location.origin,
      );
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    measure();
    return () => observer.disconnect();
  }, []);
  async function generate(fresh = false) {
    if (!data || recovery.current || (!fresh && pauseAutomatic.current)) return;
    if(fresh)pauseAutomatic.current=false;
    const initiatingScope = data.suggestionScope;
    attempted.current = data.contextKey;
    await run(async () => {
      const latest = fresh ? await read(query) : data;
      accept(latest);
      if (
        latest.suggestionScope !== initiatingScope ||
        stored('weft-auto-suggestions-v1:' + initiatingScope) !== 'enabled'
      )
        return;
      accept(
        await read(query, {
          action: 'generate',
          revision: latest.revision,
          workspaceRevision: latest.workspaceRevision,
          requestId: crypto.randomUUID(),
          brief: latest.brief,
          consent: true,
          consentVersion: 'groq-plan-v1',
        }),
      );
    });
  }
  // One attempt per context in this mounted feed. No automatic retries after failure.
  // Consent is scoped to the signed-in user's private draft, never to a shared browser-wide flag.
  useEffect(() => {
    if (
      !data ||
      approval ||
      pauseAutomatic.current ||
      !enabled ||
      !data.configured ||
      busy ||
      error ||
      data.issue ||
      data.status === 'generating' ||
      (data.draft && !data.contextChanged) ||
      attempted.current === data.contextKey
    )
      return;
    const timer = window.setTimeout(
      () => void generate(),
      Math.max(0, data.retryAfter || 0) * 1000,
    );
    return () => window.clearTimeout(timer);
  }, [data, approval, enabled, busy, error]);
  useEffect(() => {
    if (data?.status !== 'generating' || busy || error) return;
    const timer = window.setTimeout(() => void reload(), 2500);
    return () => window.clearTimeout(timer);
  }, [data?.status, data?.revision, busy, error]);
  async function add(id: string) {
    if(recovery.current)return;
    await run(async () => {
      const items = data.draft.items.map((item: any) => ({
        ...item,
        included: item.id === id,
      }));
      const payload = {
        action: 'apply',
        revision: data.revision,
        workspaceRevision: data.workspaceRevision,
        generation: data.draft.generation,
        items,
        confirm: true,
      };
      const attempt: Approval = {kind:'uncertain', scope:data.suggestionScope,
        generation:payload.generation, hash:await planApprovalHash(payload.generation,items),
        revision:payload.revision, workspaceRevision:payload.workspaceRevision};
      try {
        const result = await read(query,payload,approvalTimeout);
        if(result.suggestionScope!==attempt.scope){accept(result);return;}
        if(!matchesApproval(result,attempt))throw new Error('The response did not confirm this task was added.');
        confirmApproval(result,attempt);
      } catch(err) {
        const {status,unreadable}=err as {status?:number;unreadable?:boolean};
        if(status===409||!status||status===408||status>=500||unreadable){
          pauseAutomatic.current=true;
          updateApproval({...attempt,kind:status===409?'conflict':'uncertain'});
        }
        throw err;
      }
    },{reloadOnConflict:false});
  }
  function matchesApproval(result:any,attempt:Approval) {
    return result.suggestionScope===attempt.scope&&result.receipt?.generation===attempt.generation&&
      result.receipt.approvalHash===attempt.hash&&Array.isArray(result.receipt.taskIds);
  }
  function confirmApproval(result:any,attempt:Approval) {
    updateApproval(null);
    setConfirmedApproval(attempt);
    focusReceipt.current=true;
    accept(result);
    window.parent.postMessage({type:'weft-plan-sidebar',event:'applied'},location.origin);
  }
  async function checkApproval(attempt: Approval, reloadSaved = false) {
    await run(async()=>{
      const result=await read(query,undefined,approvalTimeout);
      if(matchesApproval(result,attempt)){confirmApproval(result,attempt);return;}
      if(result.suggestionScope!==attempt.scope){
        updateApproval(null);accept(result);
        return;
      }
      const sameDraft=!result.receipt&&result.revision===attempt.revision&&result.draft?.generation===attempt.generation;
      const validContext=Number.isSafeInteger(result.workspaceRevision)&&result.workspaceRevision>=attempt.workspaceRevision&&
        (attempt.kind!=='conflict'||result.workspaceRevision>attempt.workspaceRevision||result.contextChanged);
      if(sameDraft&&validContext){
        updateApproval(null);accept(result);
        setApprovalNotice('No matching receipt was found. Review the suggestion before choosing Add again.');
      }else if(reloadSaved&&!sameDraft){
        updateApproval(null);accept(result);
      }else{
        setApprovalNotice(sameDraft?'The server still shows the same project version. Check again before adding.':
          'We could not confirm this task was added. The saved suggestions changed. Reload them to review the current version.');
      }
    });
  }
  if (!data)
    return (
      <section>
        {error ? (
          <p role="alert">{error}</p>
        ) : (
          <p role="status">Loading suggestions…</p>
        )}
        <Button variant="ghost" disabled={busy} onClick={reload}>
          Reload
        </Button>
      </section>
    );
  const working = busy || data.status === 'generating';
  const locked = working || !!approval;
  const cards = (data.receipt ? [] : data.draft?.items || []).filter(
    (item: any) => item.included && !dismissed.includes(item.id),
  );
  return (
    <section
      className="suggestion-feed space-y-3"
      aria-label="Automatic AI suggestions"
      aria-busy={working}
    >
      {!enabled ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Optional: let Weft suggest missing next steps automatically as your
            plan changes. Suggestions never add tasks on their own.
          </p>
          <details className="text-xs">
            <summary>What’s shared with AI?</summary>
            <p>
              Enabling shares event details, shared task names, the saved plan
              brief and saved event feedback with Groq. No emails, guest lists,
              files or private bookings. Each refresh uses an AI attempt. You
              can turn this off here.
            </p>
          </details>
          <Button
            disabled={!data.configured || locked}
            onClick={() => {
              remember(consentKey, 'enabled');
              setEnabled(true);
            }}
          >
            Enable automatic suggestions
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          AI suggestions · review before adding{' '}
          <button
            className="underline"
            disabled={busy}
            onClick={() => {
              remember(consentKey, null);
              setEnabled(false);
            }}
          >
            Turn off
          </button>
        </p>
      )}
      {!data.configured && (
        <p role="status" className="text-sm">
          AI isn’t configured. Automatic checks below still work.
        </p>
      )}
      {approval && (
        <section aria-label="Check suggestion approval" className="space-y-2 rounded-lg border p-3 text-sm">
          <p className="font-medium">{approval.kind==='conflict'?'This approval needs a fresh review':'Adding this task was not confirmed'}</p>
          <p>Checking the saved result won’t add tasks or use AI.</p>
          {error && <p role="alert">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" className="min-h-11" disabled={busy} onClick={()=>checkApproval(approval)}>
              {approval.kind==='conflict'?'Refresh before adding':'Check what was added'}
            </Button>
            <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={()=>checkApproval(approval,true)}>
              Reload saved suggestions
            </Button>
          </div>
        </section>
      )}
      {approvalNotice && <p role="status" className="text-sm">{approvalNotice}</p>}
      {!approval && (error || data.issue) && (
        <div>
          <p role="alert" className="text-sm">
            {error || data.issue} Reload the project to check the saved result
            before retrying.
          </p>
          <button
            className="text-xs underline"
            disabled={busy}
            onClick={() => void reload()}
          >
            Reload suggestions
          </button>
        </div>
      )}
      {working && (
        <p role="status" className="text-sm">
          Checking your plan…
        </p>
      )}
      {!approval && data.contextChanged && (
        <div className="space-y-2" role="status">
          <p className="text-xs">
            Your plan changed. Refresh these suggestions before adding tasks.
            Refreshing uses an AI attempt.
          </p>
          {enabled && data.configured ? (
            <Button disabled={locked} onClick={() => void generate(true)}>
              Refresh changed suggestions
            </Button>
          ) : !enabled ? (
            <p className="text-xs">Enable automatic suggestions above to refresh with AI.</p>
          ) : null}
        </div>
      )}
      {data.receipt && (
        <p role="status" tabIndex={-1} ref={receiptHeading} className="text-sm">
          {confirmedApproval&&matchesApproval(data,confirmedApproval)
            ? 'Task added · still to do. Refresh suggestions to review other ideas.'
            : 'These saved suggestions were already applied. Check the project for the added tasks.'}
        </p>
      )}
      {cards.map((item: any) => {
        const review = planSelection(
          data.draft.items.map((row: any) => ({
            ...row,
            included: row.id === item.id,
          })),
          data.existingTasks,
          data.draft.duplicateSuggestions || [],
        );
        const complex =
          !!item.dependsOn.length ||
          !!review.missing.length ||
          !!review.unresolved.size ||
          !!review.invalidReuse.size ||
          !!review.duplicates.size;
        return (
          <article key={item.id} className="suggestion-card space-y-2">
            <h3 className="font-medium text-sm">{item.title}</h3>
            <p className="text-sm text-muted-foreground">{item.note}</p>
            <p className="text-xs text-muted-foreground">
              {item.category} · Unassigned ·{' '}
              {item.kind === 'activity' ? 'Activity' : 'Task'}
              {item.dueDate ? ' · Due ' + item.dueDate : ''}
              {item.start ? ' · Starts ' + item.start : ''}
              {item.end ? ' · Ends ' + item.end : ''}
              {item.start
                ? ' · ' + (data.event.timeZone || 'event-local time')
                : ''}
              {item.location ? ' · ' + item.location : ''} · Added as incomplete
            </p>
            <div className="flex gap-3 items-center">
              {!data.contextChanged && (complex ? !approval && (
                <a className="suggestion-review-link" target="_top" href={'/plan?' + query}>
                  Review &amp; add
                </a>
              ) : (
                <Button disabled={locked} onClick={() => add(item.id)}>
                  Add task
                </Button>
              ))}
              <button
                className="text-xs underline"
                disabled={locked}
                onClick={() => {
                  const ids = [...dismissed, item.id];
                  remember(dismissalKey, JSON.stringify(ids));
                  setDismissed(ids);
                }}
              >
                Dismiss
              </button>
            </div>
            {complex && !data.contextChanged && (
              <p className="text-xs text-muted-foreground">
                Review links &amp; duplicates before adding this task.
              </p>
            )}
          </article>
        );
      })}
      {!locked && !cards.length && !data.receipt && data.draft && (
        <p role="status" className="text-sm">
          No more suggestions right now.
        </p>
      )}
      {data.draft?.questions?.map((question: string, index: number) => (
        <p key={index} className="text-xs">
          To consider: {question}
        </p>
      ))}
      {enabled && !locked && (
        <button
          className="text-xs underline"
          onClick={() => void generate(true)}
        >
          Refresh suggestions
        </button>
      )}
    </section>
  );
}
