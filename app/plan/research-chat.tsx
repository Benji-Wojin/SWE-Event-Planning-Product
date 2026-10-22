'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
type Snapshot = {
  configured: boolean;
  revision: string;
  status: string;
  requestId: string;
  query: string;
  answer: string;
  sources: { url: string; title: string; host: string }[];
  generatedAt: string | null;
  retryAfter: number;
};
export function ResearchChat({
  query,
  locked,
  onDirty,
  onBusy,
}: {
  query: string;
  locked: boolean;
  onDirty: (dirty: boolean) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [question, setQuestion] = useState(''),
    [consent, setConsent] = useState(false),
    [data, setData] = useState<Snapshot | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const pending = useRef(false),
    uncertain = useRef(false),
    url = '/api/research' + (query ? '?' + query : '');
  async function api(input?: unknown) {
    const response = await fetch(url, {
      method: input ? 'POST' : 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(35000),
      ...(input
        ? {
            headers: {
              'Content-Type': 'application/json',
              'x-gather-request': '1',
            },
            body: JSON.stringify(input),
          }
        : {}),
    });
    const result = (await response.json()) as Snapshot & { error?: string };
    if (!response.ok)
      throw Object.assign(
        new Error(result.error || 'Research is unavailable.'),
        { status: response.status },
      );
    return result;
  }
  useEffect(() => {
    let active = true;
    void api()
      .then((value) => {
        if (active) setData(value);
      })
      .catch((error) => {
        if (active) {
          if ([401, 403, 404].includes(error?.status)) setData(null);
          setError(
            'Could not load research status. Reload status before searching.',
          );
        }
      });
    return () => {
      active = false;
    };
  }, [url]);
  async function run(search: boolean) {
    if (pending.current || locked) return;
    if (
      search &&
      (!data ||
        !data.configured ||
        !consent ||
        !question.trim() ||
        uncertain.current)
    )
      return;
    pending.current = true;
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      if (search) uncertain.current = true;
      const result = await api(
        search
          ? {
              query: question.trim(),
              revision: data!.revision,
              requestId: crypto.randomUUID(),
              consent: true,
              consentVersion: 'groq-research-v1',
            }
          : undefined,
      );
      setData(result);
      uncertain.current = false;
      if (search) {
        setQuestion('');
        onDirty(false);
        setConsent(false);
      }
      if (result.status === 'loading')
        setError(
          'A search is still pending. Reload status later; do not resend the question.',
        );
      if (result.status === 'error')
        setError(
          'The last search failed. No verified research result was saved. You may start a new search after the cooldown.',
        );
      if (result.status === 'interrupted')
        setError(
          'The earlier search was interrupted and will not be resent. You can explicitly start a new search now.',
        );
    } catch (e) {
      if ([401, 403, 404].includes((e as { status?: number })?.status || 0))
        setData(null);
      setError(
        (e instanceof Error ? e.message : 'Could not complete research.') +
          ' Reload status before another search.',
      );
    } finally {
      pending.current = false;
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <section
      className="research-chat task-chat"
      aria-label="Ask Weft web research"
    >
      <div className="chat-welcome">
        <span aria-hidden="true" className="chat-avatar">
          ↗
        </span>
        <div>
          <h2>Bring a little research to the plan.</h2>
          <p>
            Ask a standalone question. Get an answer and source links to check
            yourself.
          </p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Read-only research · private to your account in this project · latest
        result visible for 24 hours, then cleared on next access. Results are
        not copied into tasks or planning chat.
      </p>
      {data?.query && (
        <div
          className="task-chat-history"
          role="log"
          aria-label="Research result"
        >
          <article className="task-chat-message task-chat-user">
            <span>You · web question</span>
            <p>{data.query}</p>
          </article>
          {data.answer && (
            <article className="task-chat-message task-chat-assistant">
              <span>Weft · web research</span>
              <p>{data.answer}</p>
              <ol className="research-sources" aria-label="Sources">
                {data.sources.map((source) => (
                  <li key={source.url}>
                    <a
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      referrerPolicy="no-referrer"
                    >
                      {source.title}
                      <small>{source.host} ↗</small>
                    </a>
                  </li>
                ))}
              </ol>
              <small>
                Researched{' '}
                {data.generatedAt &&
                  new Date(data.generatedAt).toLocaleString()}
                . Pages may change. Check sources before relying on an answer.
              </small>
            </article>
          )}
        </div>
      )}
      <form
        className="chat-composer space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          void run(true);
        }}
      >
        <Label htmlFor="research-question">Your web research question</Label>
        <Textarea
          id="research-question"
          rows={3}
          maxLength={1200}
          disabled={busy || locked}
          value={question}
          placeholder="What belongs in an outdoor event’s rain contingency checklist?"
          onChange={(event) => {
            setQuestion(event.target.value);
            setConsent(false);
            onDirty(!!event.target.value.trim());
          }}
        />
        <label className="research-consent">
          <input
            type="checkbox"
            checked={consent}
            disabled={busy || locked}
            onChange={(event) => setConsent(event.target.checked)}
          />
          <span>
            Send only this question to Groq and its web-search provider. Don’t
            include personal data, secrets, private links or booking codes. No
            event context or chat history is sent automatically.
          </span>
        </label>
        {!data?.configured && (
          <p role="status" className="text-sm">
            Web search is not activated in this environment. Provider access and
            citation support must be verified first. Nothing will be sent.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            disabled={
              busy ||
              locked ||
              !data?.configured ||
              !consent ||
              !question.trim() ||
              uncertain.current ||
              data?.status === 'loading'
            }
          >
            {busy ? 'Working…' : 'Search the web ↗'}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || locked}
            onClick={() => void run(false)}
          >
            Reload status
          </Button>
        </div>
        <details className="text-xs text-muted-foreground">
          <summary>Limits &amp; what stays in your control</summary>
          <p>
            One attempt per search; no automatic retries. Up to 25 searches per
            account per day, shared with task helpful links, with one minute
            between research requests. External pages and model answers are
            untrusted. Weft does not book, buy, send messages, run code, or mark
            tasks complete. Links open only when you choose them.
          </p>
        </details>
      </form>
    </section>
  );
}
