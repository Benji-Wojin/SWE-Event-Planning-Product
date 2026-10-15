'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';
import { Card, CardContent } from '@/components/ui/card';
import { duplicateItemIdentity, planSelection } from '@/lib/plan-selection';
import {
  eventKinds,
  planCategories,
  type PlanBrief,
  type ReviewedItem,
} from '@/lib/plan-generation';

const names: Record<string, string> = {
  school: 'School event',
  corporate: 'Corporate event',
  offsite: 'Team off-site',
  trip: 'Trip',
  party: 'Party',
  anniversary: 'Anniversary',
  other: 'Other',
};
const emptyBrief: PlanBrief = {
  kind: 'other',
  description: '',
  endDate: '',
  startTime: '',
  endTime: '',
};
const editable = (brief: PlanBrief, items: ReviewedItem[]) =>
  JSON.stringify({ brief, items });
async function api(query: string, body?: unknown) {
  const response = await fetch('/api/plan?' + query, {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body
      ? { 'Content-Type': 'application/json', 'X-Gather-Request': '1' }
      : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data: any = await response.json().catch(() => null);
  if (!response.ok || !data?.event)
    throw Object.assign(
      new Error(
        data?.error ||
          'Could not reach the project. Your edits are still here.',
      ),
      { status: response.status },
    );
  return data;
}
export function PlanReview({ query }: { query: string }) {
  const [data, setData] = useState<any>(null),
    [brief, setBrief] = useState<PlanBrief>(emptyBrief),
    [items, setItems] = useState<ReviewedItem[]>([]);
  const [initial, setInitial] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const pending = useRef(false),
    request = useRef<any>(null),
    errorBox = useRef<HTMLParagraphElement>(null);
  const dirty = !!data && editable(brief, items) !== initial;
  const params = new URLSearchParams(query),
    demo = params.get('demo') === '1';
  const projectUrl = demo ? '/demo?as=jack' : '/project?' + query;
  const waiting = data?.status === 'generating',
    locked = busy || waiting,
    applied = !!data?.receipt;
  const {
    selected,
    reusable,
    matches,
    missing,
    duplicates,
    possible,
    unresolved,
    invalidReuse,
  } = planSelection(
    items,
    data?.existingTasks || [],
    data?.draft?.duplicateSuggestions || [],
  );
  const missingDependencies = missing.length > 0;
  function accept(result: any) {
    setData(result);
    setBrief(result.brief);
    setItems(result.draft?.items || []);
    setInitial(editable(result.brief, result.draft?.items || []));
  }
  async function run(operation: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await operation();
    } catch (e) {
      if ([401, 403, 404].includes((e as { status?: number }).status || 0)) {
        setData(null);
        setBrief(emptyBrief);
        setItems([]);
        setInitial('');
        request.current = null;
      }
      setError(
        e instanceof Error
          ? e.message
          : 'Could not save. Your edits are still here.',
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function reload() {
    await run(async () => {
      accept(await api(query));
      request.current = null;
    });
  }
  useEffect(() => {
    void reload();
  }, [query]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    if (error) errorBox.current?.focus();
  }, [error]);
  // Recover a running request after refresh; polling only reads, never generates another plan.
  useEffect(() => {
    if (!waiting || busy || error) return;
    const timer = window.setTimeout(
      () => void run(async () => accept(await api(query))),
      2500,
    );
    return () => window.clearTimeout(timer);
  }, [waiting, busy, data?.revision, error]);
  const updateBrief = <K extends keyof PlanBrief>(
    key: K,
    value: PlanBrief[K],
  ) => {
    request.current = null;
    setBrief((current) => ({ ...current, [key]: value }));
  };
  const updateItem = (id: string, patch: Partial<ReviewedItem>) => {
    request.current = null;
    setItems((current) =>
      current.map((item) => {
        if (item.id !== id) return item;
        const next = { ...item, ...patch };
        if (duplicateItemIdentity(next) !== duplicateItemIdentity(item)) {
          delete next.duplicateChoice;
          if (item.duplicateChoice === 'reuse') next.included = true;
        } else if (
          patch.included === true &&
          item.duplicateChoice === 'reuse'
        ) {
          delete next.duplicateChoice;
        }
        return next;
      }),
    );
  };
  async function save() {
    const result = await api(query, {
      action: 'save',
      revision: data.revision,
      brief,
      items,
      generation: data.draft?.generation,
    });
    accept(result);
    request.current = null;
    return result;
  }
  async function generate() {
    await run(async () => {
      if (!request.current) {
        // Preserve edited drafts before regeneration so a provider failure cannot discard them.
        const latest = dirty && !applied ? await save() : data;
        request.current = {
          action: 'generate',
          revision: latest.revision,
          workspaceRevision: latest.workspaceRevision,
          requestId: crypto.randomUUID(),
          brief,
          consent: true,
          consentVersion: 'groq-plan-v1',
        };
      }
      const result = await api(query, request.current);
      accept(result);
      request.current = null;
    });
  }
  async function refreshContext() {
    await run(async () => {
      const result = await api(query);
      if (result.revision !== data.revision)
        throw new Error(
          'The saved draft changed. Use Reload saved draft to review it; your local edits have not been replaced.',
        );
      setData(result);
      request.current = null;
      setNotice(
        result.contextChanged
          ? 'Event details or tasks changed. Generate a new draft before adding it.'
          : 'Project context refreshed. Your draft edits are kept.',
      );
    });
  }
  const alert = error && (
    <p
      role="alert"
      tabIndex={-1}
      ref={errorBox}
      className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
    >
      {error}
    </p>
  );
  if (!data)
    return (
      <section aria-busy={busy}>
        {alert || <p role="status">Loading project…</p>}
        {error && (
          <Button onClick={reload} disabled={busy}>
            Try again
          </Button>
        )}
        <a href="/" className="mt-5 block text-sm underline">
          All projects
        </a>
      </section>
    );
  return (
    <section aria-busy={locked}>
      {alert}
      {error && waiting && (
        <Button
          variant="outline"
          className="mb-4"
          disabled={busy}
          onClick={reload}
        >
          Check request status
        </Button>
      )}
      {notice && (
        <p role="status" className="mb-4 text-sm">
          {notice}
        </p>
      )}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 text-sm">
        <p className="min-w-0 break-words font-medium">
          {data.event.name}
          {demo ? ' · Demo' : ''}
        </p>
        <a href={projectUrl} className="text-primary underline">
          {applied ? 'Open project' : 'Skip / open project'}
        </a>
      </div>
      {data.issue && (
        <p role="status" className="mb-4 rounded-lg border p-4 text-sm">
          {data.issue}
        </p>
      )}
      {data.status === 'interrupted' && (
        <p role="status" className="mb-4 text-sm">
          The last request did not finish. Your saved draft is kept. You can try
          again.
        </p>
      )}
      {applied && (
        <div
          role="status"
          className="mb-5 rounded-lg border border-primary/40 p-4"
        >
          <p className="font-medium">
            {data.receipt.taskIds.length} items added to the project.
          </p>
          <a
            href={projectUrl}
            className="mt-2 inline-block text-sm text-primary underline"
          >
            View tasks and schedule
          </a>
        </div>
      )}
      <Card>
        <CardContent className="space-y-5 pt-6">
          <fieldset disabled={locked} className="space-y-5">
            <legend className="sr-only">Event brief</legend>
            <div className="space-y-2">
              <Label htmlFor="plan-kind">Event type</Label>
              <NativeSelect
                id="plan-kind"
                className="w-full"
                value={brief.kind}
                onChange={(e) => updateBrief('kind', e.target.value)}
              >
                {eventKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {names[kind]}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="plan-brief">What are you planning?</Label>
              <Textarea
                id="plan-brief"
                rows={4}
                maxLength={4000}
                value={brief.description}
                onChange={(e) => updateBrief('description', e.target.value)}
                placeholder="Purpose, activities, constraints, and decisions still to make"
              />
            </div>
            <details>
              <summary className="cursor-pointer text-sm font-medium">
                Dates and activity hours
              </summary>
              <p className="my-3 text-sm text-muted-foreground">
                {data.event.date || 'No event date'} ·{' '}
                {data.event.timeZone || 'No time zone'}.{' '}
                {demo ? (
                  'Edit event details in the demo.'
                ) : (
                  <a href={'/setup?' + query} className="underline">
                    Project settings
                  </a>
                )}
              </p>
              <div className="grid gap-4 sm:grid-cols-3">
                {(
                  [
                    ['endDate', 'Last day (optional)', 'date'],
                    ['startTime', 'Daily start (optional)', 'time'],
                    ['endTime', 'Daily end (optional)', 'time'],
                  ] as const
                ).map(([key, label, type]) => (
                  <div className="space-y-2" key={key}>
                    <Label htmlFor={'brief-' + key}>{label}</Label>
                    <Input
                      id={'brief-' + key}
                      type={type}
                      min={
                        key === 'endDate'
                          ? data.event.date || undefined
                          : undefined
                      }
                      value={brief[key]}
                      onChange={(e) => updateBrief(key, e.target.value)}
                    />
                  </div>
                ))}
              </div>
              <p className="mt-3 text-sm text-muted-foreground">
                Without a date, time zone, and start time, activities stay
                unscheduled. Daily end must be later than start; leave it blank
                for overnight activities and set the last day.
              </p>
            </details>
            <p className="text-sm text-muted-foreground">
              Generate sends this brief, event details, task names, and relevant
              saved feedback to Groq. Emails, guest lists, files, and private
              bookings are not included.
            </p>
            {!data.configured && (
              <p className="text-sm text-muted-foreground">
                AI is not configured. You can save this brief and add tasks
                manually.
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              <Button
                disabled={
                  locked || !brief.description.trim() || !data.configured
                }
                onClick={generate}
              >
                {waiting
                  ? 'Generating…'
                  : request.current
                    ? 'Retry request'
                    : data.draft
                      ? 'Generate another draft'
                      : 'Generate draft'}
              </Button>
              {!applied && (
                <Button
                  variant="outline"
                  disabled={locked || !brief.description.trim()}
                  onClick={() =>
                    void run(async () => {
                      await save();
                      setNotice('Draft saved.');
                    })
                  }
                >
                  Save {data.draft ? 'draft' : 'brief'}
                </Button>
              )}
            </div>
          </fieldset>
        </CardContent>
      </Card>
      {waiting && (
        <p role="status" className="my-4 text-sm">
          Generating a private draft. You can return later; nothing is added
          automatically.
        </p>
      )}
      {data.draft && (
        <section className="mt-8 space-y-4" aria-label="Review draft">
          <div>
            <h2 className="text-xl font-semibold">Review proposed items</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Adds to your {data.existingTaskCount} existing tasks. Dates,
              owners, and activities below are proposals.
            </p>
          </div>
          {data.draft.scheduleWarnings?.length > 0 && (
            <details className="rounded-lg border p-4 text-sm">
              <summary className="cursor-pointer font-medium">
                Dates to review ({data.draft.scheduleWarnings.length})
              </summary>
              <ul className="mt-2 list-disc space-y-2 pl-5">
                {data.draft.scheduleWarnings.map(
                  (warning: string, i: number) => (
                    <li key={i}>{warning}</li>
                  ),
                )}
              </ul>
            </details>
          )}
          {JSON.stringify(data.draft.brief) !== JSON.stringify(brief) && (
            <details className="rounded-lg border p-4 text-sm">
              <summary className="cursor-pointer font-medium">
                This draft uses an earlier brief
              </summary>
              <p className="mt-3 whitespace-pre-wrap">
                {data.draft.brief.description}
              </p>
              <p className="mt-2">
                {names[data.draft.brief.kind]} ·{' '}
                {data.draft.brief.endDate || data.event.date || 'Dates not set'}{' '}
                · {data.draft.brief.startTime || 'Unscheduled'}{' '}
                {data.draft.brief.endTime && '– ' + data.draft.brief.endTime}
              </p>
            </details>
          )}
          {(data.draft.questions.length > 0 ||
            data.draft.assumptions.length > 0) && (
            <details className="rounded-lg border p-4 text-sm">
              <summary className="cursor-pointer font-medium">
                Questions & assumptions (
                {data.draft.questions.length + data.draft.assumptions.length})
              </summary>
              {(['questions', 'assumptions'] as const).map(
                (key) =>
                  data.draft[key].length > 0 && (
                    <div key={key} className="mt-4">
                      <h3 className="font-medium">
                        {key === 'questions'
                          ? 'Decisions to make'
                          : 'Assumptions to check'}
                      </h3>
                      <ul className="mt-2 list-disc space-y-2 pl-5">
                        {data.draft[key].map((text: string, i: number) => (
                          <li key={i}>{text}</li>
                        ))}
                      </ul>
                    </div>
                  ),
              )}
            </details>
          )}
          <fieldset disabled={locked || applied} className="space-y-4">
            <legend className="sr-only">Proposed tasks and activities</legend>
            {items.map((item, index) => (
              <Card key={item.id}>
                <CardContent className="space-y-4 pt-6">
                  <div className="flex items-start gap-3">
                    <input
                      id={'include-' + item.id}
                      type="checkbox"
                      aria-label={
                        'Include ' + (item.title || 'item ' + (index + 1))
                      }
                      checked={item.included}
                      onChange={(e) =>
                        updateItem(item.id, { included: e.target.checked })
                      }
                      className="mt-1 size-5 shrink-0 accent-primary"
                    />
                    <div className="min-w-0 flex-1">
                      <label
                        htmlFor={'include-' + item.id}
                        className="text-sm font-medium"
                      >
                        {index + 1}.{' '}
                        {item.kind === 'activity' ? 'Activity' : 'Preparation'}
                      </label>
                      <Label className="sr-only" htmlFor={'title-' + item.id}>
                        Title for item {index + 1}
                      </Label>
                      <Input
                        id={'title-' + item.id}
                        className="mt-2"
                        maxLength={180}
                        value={item.title}
                        onChange={(e) =>
                          updateItem(item.id, { title: e.target.value })
                        }
                      />
                    </div>
                  </div>
                  {!applied && possible.has(item.id) && (
                    <div
                      className="rounded-lg border p-3 space-y-2 text-sm"
                      role="status"
                    >
                      <p>
                        {item.duplicateChoice === 'reuse'
                          ? 'Using existing task: '
                          : 'Possible duplicate of: '}
                        <strong>{possible.get(item.id)!.title}</strong>
                      </p>
                      <p className="text-muted-foreground">
                        {item.duplicateChoice === 'reuse'
                          ? 'This item will not be added. Prerequisites will link to the existing task; its details stay unchanged.'
                          : item.duplicateChoice === 'keep'
                            ? 'Kept as separate work.'
                            : 'AI found similar work. Choose whether it is the same task.'}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {item.duplicateChoice !== 'reuse' && (
                          <Button
                            type="button"
                            variant="outline"
                            className="h-auto min-h-10 max-w-full whitespace-normal break-words text-left"
                            onClick={() =>
                              updateItem(item.id, {
                                included: false,
                                duplicateChoice: 'reuse',
                              })
                            }
                          >
                            Use existing: {possible.get(item.id)!.title}
                          </Button>
                        )}
                        {item.duplicateChoice !== 'keep' && (
                          <Button
                            type="button"
                            variant="outline"
                            className="h-auto min-h-10 max-w-full whitespace-normal break-words text-left"
                            onClick={() =>
                              updateItem(item.id, {
                                included: true,
                                duplicateChoice: 'keep',
                              })
                            }
                          >
                            Keep separate: {item.title}
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                  {!applied && invalidReuse.has(item.id) && (
                    <div role="status" className="text-sm space-y-2">
                      <p>
                        The existing-task match changed. Review this item again.
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() =>
                          updateItem(item.id, {
                            included: true,
                            duplicateChoice: 'keep',
                          })
                        }
                      >
                        Keep separate: {item.title}
                      </Button>
                    </div>
                  )}
                  {!applied && !!matches.get(item.id)?.length && (
                    <div className="space-y-2 text-sm" role="status">
                      <p>
                        {matches.get(item.id)!.length === 1
                          ? 'Already in project. Leave unchecked to use the existing task for prerequisites. Its details will not change.'
                          : 'Multiple matching tasks exist. Leave unchecked, then review any prerequisite links below.'}
                      </p>
                      {item.included && (
                        <Button
                          type="button"
                          variant="outline"
                          className="h-auto min-h-10 max-w-full whitespace-normal break-words text-left"
                          onClick={() =>
                            updateItem(item.id, { included: false })
                          }
                        >
                          Skip existing task: {item.title}
                        </Button>
                      )}
                    </div>
                  )}
                  {duplicates.has(item.id) && !matches.get(item.id)?.length && (
                    <p role="status" className="text-sm">
                      Another selected draft item has this title and time.
                      Uncheck or rename this item.
                    </p>
                  )}
                  {missing
                    .filter((link) => link.itemId === item.id)
                    .map((link) => {
                      const prerequisite = items.find(
                        (other) => other.id === link.prerequisiteId,
                      )!;
                      return (
                        <div
                          key={link.prerequisiteId}
                          className="rounded-lg border p-3 space-y-2 text-sm"
                          role="status"
                        >
                          <p>
                            “{item.title}” depends on unchecked “
                            {prerequisite.title}”.
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {!matches.get(prerequisite.id)?.length && (
                              <Button
                                type="button"
                                variant="outline"
                                className="h-auto min-h-10 max-w-full whitespace-normal break-words text-left"
                                onClick={() =>
                                  updateItem(prerequisite.id, {
                                    included: true,
                                  })
                                }
                              >
                                Include prerequisite: {prerequisite.title}
                              </Button>
                            )}
                            <Button
                              type="button"
                              variant="outline"
                              className="h-auto min-h-10 max-w-full whitespace-normal break-words text-left"
                              onClick={() =>
                                updateItem(item.id, {
                                  dependsOn: item.dependsOn.filter(
                                    (id) => id !== prerequisite.id,
                                  ),
                                })
                              }
                            >
                              Remove link: {item.title} → {prerequisite.title}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor={'owner-' + item.id}>Owner</Label>
                      <NativeSelect
                        id={'owner-' + item.id}
                        className="w-full"
                        value={item.owner}
                        onChange={(e) =>
                          updateItem(item.id, { owner: e.target.value })
                        }
                      >
                        <option value="">Unassigned</option>
                        {data.members.map((member: any) => (
                          <option key={member.id} value={member.id}>
                            {member.name}
                          </option>
                        ))}
                        {item.owner &&
                          !data.members.some(
                            (member: any) => member.id === item.owner,
                          ) && (
                            <option value={item.owner}>
                              Former teammate — choose another owner
                            </option>
                          )}
                      </NativeSelect>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={'date-' + item.id}>
                        {item.kind === 'activity'
                          ? 'Activity start'
                          : 'Preparation due date'}
                      </Label>
                      <Input
                        id={'date-' + item.id}
                        type={
                          item.kind === 'activity' ? 'datetime-local' : 'date'
                        }
                        value={
                          item.kind === 'activity' ? item.start : item.dueDate
                        }
                        onChange={(e) =>
                          updateItem(
                            item.id,
                            item.kind === 'activity'
                              ? {
                                  start: e.target.value,
                                  ...(!e.target.value ? { end: '' } : {}),
                                }
                              : { dueDate: e.target.value },
                          )
                        }
                      />
                    </div>
                  </div>
                  <details>
                    <summary className="cursor-pointer text-sm font-medium">
                      Details
                      {item.dependsOn.length
                        ? ' · ' + item.dependsOn.length + ' prerequisites'
                        : ''}
                    </summary>
                    <div className="mt-4 space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor={'note-' + item.id}>
                          What needs to be done
                        </Label>
                        <Textarea
                          id={'note-' + item.id}
                          rows={3}
                          maxLength={2000}
                          value={item.note}
                          onChange={(e) =>
                            updateItem(item.id, { note: e.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={'category-' + item.id}>Category</Label>
                        <NativeSelect
                          id={'category-' + item.id}
                          className="w-full"
                          value={item.category}
                          onChange={(e) =>
                            updateItem(item.id, { category: e.target.value })
                          }
                        >
                          {planCategories.map((category) => (
                            <option key={category}>{category}</option>
                          ))}
                        </NativeSelect>
                      </div>
                      {item.kind === 'activity' && (
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor={'end-' + item.id}>
                              Activity end (optional)
                            </Label>
                            <Input
                              id={'end-' + item.id}
                              type="datetime-local"
                              value={item.end}
                              onChange={(e) =>
                                updateItem(item.id, { end: e.target.value })
                              }
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor={'location-' + item.id}>
                              Location (optional)
                            </Label>
                            <Input
                              id={'location-' + item.id}
                              maxLength={240}
                              value={item.location}
                              onChange={(e) =>
                                updateItem(item.id, {
                                  location: e.target.value,
                                })
                              }
                            />
                          </div>
                        </div>
                      )}
                      <fieldset className="space-y-2">
                        <legend className="mb-2 text-sm font-medium">
                          Depends on
                        </legend>
                        {items
                          .filter((other) => other.id !== item.id)
                          .map((other) => (
                            <label
                              key={other.id}
                              className="flex items-start gap-2 text-sm"
                            >
                              <input
                                type="checkbox"
                                className="mt-1 size-4 shrink-0 accent-primary"
                                checked={item.dependsOn.includes(other.id)}
                                onChange={(e) =>
                                  updateItem(item.id, {
                                    dependsOn: e.target.checked
                                      ? [...item.dependsOn, other.id]
                                      : item.dependsOn.filter(
                                          (id) => id !== other.id,
                                        ),
                                  })
                                }
                              />
                              <span className="break-words">
                                {other.title}
                                {reusable.has(other.id)
                                  ? ' (existing project task)'
                                  : !other.included
                                    ? ' (unchecked)'
                                    : ''}
                              </span>
                            </label>
                          ))}
                      </fieldset>
                    </div>
                  </details>
                </CardContent>
              </Card>
            ))}
          </fieldset>
          {!applied && (
            <div className="rounded-lg border p-5 space-y-3">
              {data.contextChanged && (
                <p role="status" className="text-sm">
                  Project details or tasks changed. Generate a new draft before
                  adding it.
                </p>
              )}
              {missingDependencies && (
                <p role="status" className="text-sm">
                  Resolve the unchecked prerequisites shown beside each affected
                  task.
                </p>
              )}
              {(unresolved.size > 0 || invalidReuse.size > 0) && (
                <p role="status" className="text-sm">
                  Review the possible duplicates above: use an existing task or
                  keep separate work.
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                Only selected items will be added, all as incomplete. Nothing
                will be sent or booked.
              </p>
              <Button
                className="h-auto min-h-10 whitespace-normal"
                disabled={
                  locked ||
                  !selected.length ||
                  missingDependencies ||
                  duplicates.size > 0 ||
                  unresolved.size > 0 ||
                  invalidReuse.size > 0 ||
                  data.contextChanged
                }
                onClick={() =>
                  void run(async () => {
                    const latest = dirty ? await save() : data;
                    const result = await api(query, {
                      action: 'apply',
                      revision: latest.revision,
                      workspaceRevision: latest.workspaceRevision,
                      generation: latest.draft.generation,
                      items: latest.draft.items,
                      confirm: true,
                    });
                    accept(result);
                    request.current = null;
                  })
                }
              >
                Add {selected.length} selected items to project
              </Button>
            </div>
          )}
        </section>
      )}
      <nav
        aria-label="Draft navigation"
        className="mt-6 flex flex-wrap gap-4 text-sm"
      >
        <button
          type="button"
          disabled={locked}
          onClick={refreshContext}
          className="text-primary underline disabled:opacity-50"
        >
          Refresh project context
        </button>
        <button
          type="button"
          disabled={locked}
          onClick={() => {
            if (
              !dirty ||
              window.confirm(
                'Discard unsaved edits and reload the saved draft?',
              )
            )
              void reload();
          }}
          className="text-primary underline disabled:opacity-50"
        >
          Reload saved draft
        </button>
        <a href={projectUrl} className="text-primary underline">
          Open project
        </a>
      </nav>
    </section>
  );
}
