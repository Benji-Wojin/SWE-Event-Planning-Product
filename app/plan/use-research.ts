'use client';
import { useEffect, useRef, useState } from 'react';
export type ResearchSnapshot = {
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
export type ResearchController = {
  data: ResearchSnapshot | null;
  busy: boolean;
  error: string;
  uncertain: boolean;
  search: (question: string) => Promise<boolean>;
  reload: () => Promise<void>;
};
export function useResearch(
  query: string,
  locked: boolean,
  onBusy: (busy: boolean) => void,
): ResearchController {
  const [data, setData] = useState<ResearchSnapshot | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const pending = useRef(false),
    uncertain = useRef(false),
    url = '/api/research' + (query ? '?' + query : '');
  const scope = useRef({ url, epoch: 0 }), loadedUrl = useRef('');
  if (scope.current.url !== url) {
    scope.current = { url, epoch: scope.current.epoch + 1 };
    pending.current = false;
    uncertain.current = false;
  }
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
    const result = (await response.json()) as ResearchSnapshot & {
      error?: string;
    };
    if (!response.ok)
      throw Object.assign(
        new Error(result.error || 'Research is unavailable.'),
        { status: response.status },
      );
    return result;
  }
  function failed(error: unknown) {
    if ([401, 403, 404].includes((error as { status?: number })?.status || 0))
      setData(null);
    setError(
      (error instanceof Error ? error.message : 'Research is unavailable.') +
        ' Check search status before sending another web request.',
    );
  }
  useEffect(() => {
    let active = true;
    const epoch = scope.current.epoch;
    const current = () => active && scope.current.epoch === epoch;
    setData(null);
    setError('');
    setBusy(false);
    onBusy(false);
    void api()
      .then((value) => {
        if (current()) { loadedUrl.current = url; setData(value); }
      })
      .catch((error) => {
        if (current()) failed(error);
      });
    return () => {
      active = false;
      if (scope.current.epoch === epoch) {
        scope.current.epoch++;
        pending.current = false;
        onBusy(false);
      }
    };
  }, [url]);
  async function run(question?: string) {
    const epoch = scope.current.epoch;
    const current = () => scope.current.url === url && scope.current.epoch === epoch;
    if (pending.current || locked) return false;
    if (
      question &&
      (loadedUrl.current !== url || !data?.configured ||
        uncertain.current ||
        data.status === 'loading' ||
        !question.trim() ||
        question.length > 1200)
    )
      return false;
    pending.current = true;
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      if (question) uncertain.current = true;
      const result = await api(
        question
          ? {
              query: question.trim(),
              revision: data!.revision,
              requestId: crypto.randomUUID(),
              consent: true,
              consentVersion: 'groq-research-v1',
            }
          : undefined,
      );
      if (!current()) return false;
      loadedUrl.current = url;
      setData(result);
      uncertain.current = false;
      if (result.status === 'loading')
        setError(
          'A web request is pending. Check status later; it will not be resent automatically.',
        );
      if (result.status === 'error')
        setError(
          'The last web request failed. No cited result was saved. You can send a new request after the cooldown.',
        );
      if (result.status === 'interrupted')
        setError(
          'The earlier web request was interrupted and will not be resent. You can explicitly send a new request now.',
        );
      return result.status === 'ready';
    } catch (error) {
      if (current()) failed(error);
      return false;
    } finally {
      if (current()) {
        pending.current = false;
        setBusy(false);
        onBusy(false);
      }
    }
  }
  return {
    data: loadedUrl.current === url ? data : null,
    busy,
    error,
    uncertain: uncertain.current,
    search: (question) => run(question),
    reload: async () => {
      await run();
    },
  };
}
