'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { planSelection } from '@/lib/plan-selection';

async function read(query: string, body?: unknown) {
  const response = await fetch('/api/plan?' + query, {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body
      ? { 'Content-Type': 'application/json', 'X-Gather-Request': '1' }
      : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const result: any = await response.json().catch(() => null);
  if (!response.ok || !result?.event)
    throw Object.assign(
      new Error(result?.error || 'Could not load suggestions.'),
      { status: response.status },
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
  async function run(operation: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (e) {
      if ([401, 403, 404].includes((e as { status?: number }).status || 0)) {
        remember(activeConsent.current, null);
        setData(null);
        setEnabled(false);
        setDismissed([]);
        queuedReload.current = false;
      }
      setError(e instanceof Error ? e.message : 'Suggestions are unavailable.');
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
  const reload = () => run(async () => accept(await read(query)));
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
        dirty: false,
        busy: busy || data?.status === 'generating',
      },
      location.origin,
    );
  }, [busy, data?.status]);
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
    if (!data) return;
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
  }, [data, enabled, busy, error]);
  useEffect(() => {
    if (data?.status !== 'generating' || busy || error) return;
    const timer = window.setTimeout(() => void reload(), 2500);
    return () => window.clearTimeout(timer);
  }, [data?.status, data?.revision, busy, error]);
  async function add(id: string) {
    await run(async () => {
      const items = data.draft.items.map((item: any) => ({
        ...item,
        included: item.id === id,
      }));
      const result = await read(query, {
        action: 'apply',
        revision: data.revision,
        workspaceRevision: data.workspaceRevision,
        generation: data.draft.generation,
        items,
        confirm: true,
      });
      accept(result);
      window.parent.postMessage(
        { type: 'weft-plan-sidebar', event: 'applied' },
        location.origin,
      );
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
  const locked = busy || data.status === 'generating';
  const cards = (data.receipt ? [] : data.draft?.items || []).filter(
    (item: any) => item.included && !dismissed.includes(item.id),
  );
  return (
    <section
      className="suggestion-feed space-y-3"
      aria-label="Automatic AI suggestions"
      aria-busy={locked}
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
            disabled={locked}
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
      {(error || data.issue) && (
        <div>
          <p role="alert" className="text-sm">
            {error || data.issue} Reload the project to check the saved result
            before retrying.
          </p>
          <button
            className="text-xs underline"
            disabled={locked}
            onClick={() => void reload()}
          >
            Reload suggestions
          </button>
        </div>
      )}
      {locked && (
        <p role="status" className="text-sm">
          Checking your plan…
        </p>
      )}
      {data.contextChanged && (
        <p className="text-xs" role="status">
          Your plan changed. These suggestions need a fresh review before
          adding.
        </p>
      )}
      {data.receipt && (
        <p role="status" className="text-sm">
          Task added · still to do. Other suggestions refresh with the updated
          plan.
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
              <Button
                disabled={locked || data.contextChanged || complex}
                onClick={() => void add(item.id)}
              >
                Add task
              </Button>
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
              {complex && (
                <a
                  className="text-xs underline"
                  target="_top"
                  href={'/plan?' + query}
                >
                  Review links & duplicates
                </a>
              )}
            </div>
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
