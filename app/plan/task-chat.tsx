'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { taskConversation, type TaskMessage } from '@/lib/task-conversation';
import type { PlanBrief, PlanOutput } from '@/lib/plan-generation';
import { researchIntent } from '@/lib/research-intent';
import { ResearchMessages } from './research-messages';
import type { ResearchController } from './use-research';
import { writtenDraftArtifact } from '@/lib/written-draft';
const chatStarters = [
  'Plan my next three steps',
  'Write a welcoming announcement',
  'Draft a day-of checklist',
  'Find outdoor event ideas in Seattle',
];

export function TaskChat({
  brief,
  question,
  reply,
  work,
  applied,
  locked,
  configured,
  failed,
  onSend,
  onDirty,
  onNew,
  research,
  replyAt,
  proposalCount = 0,
}: {
  brief: PlanBrief;
  question?: string;
  reply?: string;
  work?: PlanOutput['work'];
  applied: boolean;
  locked: boolean;
  configured: boolean;
  failed: boolean;
  onSend: (brief: PlanBrief) => Promise<boolean>;
  onDirty: (value: boolean) => void;
  onNew: () => void;
  research?: ResearchController;
  replyAt?: string;
  proposalCount?: number;
}) {
  const [message, setMessage] = useState('');
  const sending = useRef(false);
  const threadBox = useRef<HTMLDivElement>(null),
    followLatest = useRef(true);
  useEffect(() => {
    const element = threadBox.current;
    if (element && followLatest.current)
      element.scrollTop = element.scrollHeight;
  }, [
    brief.description,
    work?.content,
    question,
    research?.data?.requestId,
    research?.busy,
  ]);
  const intent = researchIntent(message),
    web = intent === 'search',
    clarify = intent === 'clarify';
  let history: TaskMessage[] = [];
  if (brief.description)
    try {
      history = taskConversation(brief.description);
    } catch {
      /* An invalid conversation can be replaced by a new request. */
    }
  const asking =
    !!question && !history.some((row) => row.role === 'assistant') && !applied;
  const answer = asking ? question : reply;
  const excerptMarker =
    ' [Earlier draft excerpt; ask for a new draft to replace it.]';
  const nextRows = () => [
    ...(applied ? [] : history),
    ...(!applied && answer
      ? [
          {
            role: 'assistant' as const,
            content:
              answer.length > 1800
                ? answer.slice(0, 1800 - excerptMarker.length) + excerptMarker
                : answer,
          },
        ]
      : []),
    { role: 'user' as const, content: message.trim() },
  ];
  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (locked || sending.current || !message.trim() || clarify) return;
    if (
      web &&
      (!research?.data?.configured ||
        research.uncertain ||
        research.data.status === 'loading' ||
        message.length > 1200)
    )
      return;
    const description = web ? '' : JSON.stringify(nextRows());
    if (!web && (description.length > 4000 || nextRows().length > 8)) return;
    sending.current = true;
    followLatest.current = true;
    try {
      if (
        await (web
          ? research!.search(message.trim())
          : onSend({ ...brief, description }))
      ) {
        setMessage('');
        onDirty(false);
      }
    } finally {
      sending.current = false;
    }
  }
  const overLimit = web
    ? message.length > 1200
    : JSON.stringify(nextRows()).length > 4000 || nextRows().length > 8;
  const hasResearch = !!research?.data?.query;
  const researchFirst =
    hasResearch &&
    !!replyAt &&
    !!research?.data?.generatedAt &&
    replyAt > research.data.generatedAt;
  const thread = (
    <>
      {researchFirst && <ResearchMessages data={research!.data} />}
      {history.map((row, index) => (
        <article
          key={index}
          className={'task-chat-message task-chat-' + row.role}
        >
          <span>{row.role === 'user' ? 'You' : '✦ Weft'}</span>
          <p>{row.content}</p>
        </article>
      ))}
      {asking && (
        <article className="task-chat-message task-chat-assistant">
          <span>Weft · one quick question</span>
          <p>{question}</p>
        </article>
      )}
      {work && (
        <article
          className="task-chat-message task-chat-assistant weft-work"
          aria-label="Weft response"
        >
          <span>
            ✦ Weft ·{' '}
            {work.kind === 'written_draft'
              ? 'private written draft'
              : 'capability limit'}
          </span>
          <h2>{work.title}</h2>
          <p>{work.content}</p>
          {work.kind === 'written_draft' && (
            <>
              <small>
                Review facts and placeholders before using this. Nothing was
                sent, booked or changed in your project. No task was marked
                complete.
              </small>
              <WrittenDraftActions work={work} locked={locked} />
            </>
          )}
        </article>
      )}
      {!work && !asking && !failed && !applied && proposalCount > 0 && (
        <article className="task-chat-message task-chat-assistant">
          <span>✦ Weft · task suggestions</span>
          <p>
            I’ve prepared {proposalCount} task{' '}
            {proposalCount === 1 ? 'suggestion' : 'suggestions'} for your review
            below. Nothing has been added yet.
          </p>
        </article>
      )}
      {!researchFirst && <ResearchMessages data={research?.data || null} />}
    </>
  );
  return (
    <section className="task-chat" aria-label="Ask Weft conversation">
      <div className="chat-presence">
        <span className="chat-avatar" aria-hidden="true">
          ✦
        </span>
        <div>
          <strong>Your planning partner</strong>
          <span>Plan, write, or ask me to find something.</span>
        </div>
      </div>
      <details className="chat-capabilities text-xs text-muted-foreground">
        <summary>What I can actually do</summary>
        <p>
          I can propose tasks and prepare written drafts from the context shared
          here. Ask me to find something or search the web for cited research
          when search is activated. I can’t see task notes or files, send
          messages, book, buy, run code, verify real-world work or mark tasks
          complete. A draft isn’t proof a task is finished.
        </p>
        <p>
          Planning uses a bounded conversation; only the latest web result is
          restored after reload. Web results stay separate from planning context
          unless you explicitly copy them into a new message. Research is
          visible for 24 hours, then cleared on next access.
        </p>
      </details>
      <div
        className="task-chat-thread"
        ref={threadBox}
        onScroll={(event) => {
          const element = event.currentTarget;
          followLatest.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            48;
        }}
        tabIndex={0}
        role="region"
        aria-label="Conversation messages"
      >
        {history.length === 0 && !work && !hasResearch && (
          <div className="chat-empty">
            <span aria-hidden="true">✦</span>
            <h2>What can we take off your mind?</h2>
            <p>We’ll find the next step together.</p>
            <div className="chat-starters" aria-label="Example requests">
              {chatStarters.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    setMessage(prompt);
                    onDirty(true);
                    document.getElementById('task-chat-message')?.focus();
                  }}
                >
                  {prompt}
                  <span aria-hidden="true">↗</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div
          className="task-chat-history"
          role="log"
          aria-label="Conversation"
          aria-live="polite"
        >
          {thread}
        </div>
        {locked && (
          <p className="chat-thinking" role="status">
            ✦ {research?.busy ? 'Searching the web…' : 'Weft is thinking…'}
          </p>
        )}
      </div>
      <form onSubmit={send} className="chat-composer">
        <Label className="sr-only" htmlFor="task-chat-message">
          {applied
            ? 'What else would you like to do?'
            : asking
              ? 'Your answer'
              : 'Message Weft'}
        </Label>
        <Textarea
          id="task-chat-message"
          rows={2}
          maxLength={1800}
          disabled={locked}
          value={message}
          placeholder={
            asking
              ? 'A short answer is enough…'
              : 'Ask Weft anything about your event…'
          }
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          onChange={(event) => {
            setMessage(event.target.value);
            onDirty(!!event.target.value.trim());
          }}
        />
        {web ? (
          <p className="chat-route-note" role="status">
            ↗ I’ll search the web for this message only. Send &amp; search
            shares it with Groq and its web-search provider—not your project or
            chat history. Keep private data, links and booking codes out.
          </p>
        ) : clarify ? (
          <p className="chat-route-note" role="status">
            What would you like me to find, and where? Include the details in
            this message; I won’t infer them from your project or send this
            vague request.
          </p>
        ) : (
          <details className="text-xs text-muted-foreground">
            <summary>What Send shares</summary>
            <p>
              Send shares this conversation, event details, shared task names
              and saved event feedback with Groq. No emails, guest lists, files
              or private bookings. Each message uses an AI attempt.
            </p>
          </details>
        )}
        {overLimit && (
          <p role="status" className="text-sm">
            {web
              ? 'Keep a web request to 1200 characters.'
              : 'This conversation is full. Start a new conversation to continue.'}
          </p>
        )}
        {web && !research?.data?.configured ? (
          <p role="status" className="text-sm">
            Web search is not activated here yet. Nothing will be sent; you can
            still ask me to plan or write.
          </p>
        ) : (
          !web &&
          !configured && (
            <p role="status" className="text-sm">
              AI isn’t configured. You can still use Add task.
            </p>
          )
        )}
        {research?.error && (
          <p role="alert" className="text-sm">
            {research.error}
          </p>
        )}
        <div className="chat-composer-actions">
          <span className="chat-key-hint">Shift + Enter for a new line</span>
          <Button
            type="submit"
            disabled={
              locked ||
              !(web ? research?.data?.configured : configured) ||
              !message.trim() ||
              overLimit ||
              clarify ||
              !!(
                web &&
                (research?.uncertain || research?.data?.status === 'loading')
              )
            }
          >
            {locked
              ? 'Working…'
              : web
                ? 'Send & search ↗'
                : asking
                  ? 'Send answer ↑'
                  : 'Send ↑'}
          </Button>
        </div>
        {(research?.error ||
          research?.data?.status === 'loading' ||
          research?.uncertain) && (
          <Button
            type="button"
            variant="outline"
            disabled={locked}
            onClick={() => void research?.reload()}
          >
            Check search status
          </Button>
        )}
        {!web && failed && history.length > 0 && (
          <Button
            type="button"
            variant="outline"
            disabled={locked || !configured}
            onClick={() => void onSend(brief)}
          >
            Retry last message
          </Button>
        )}
        {(history.length > 0 || message) && (
          <Button
            type="button"
            variant="ghost"
            disabled={locked}
            onClick={onNew}
          >
            New conversation
          </Button>
        )}
      </form>
    </section>
  );
}

export function WrittenDraftActions({
  work,
  locked,
}: {
  work: PlanOutput['work'];
  locked: boolean;
}) {
  const artifact = writtenDraftArtifact(work);
  const [feedback, setFeedback] = useState({ source: '', message: '' });
  const [copyingSource, setCopyingSource] = useState('');
  const notice = feedback.source === artifact?.text ? feedback.message : '';
  const copying = !!artifact && copyingSource === artifact.text;
  const attempt = useRef(0),
    inFlight = useRef(false);
  useEffect(() => {
    inFlight.current = false;
    // Cancel progress too: an invalidated clipboard request cannot clear it later.
    setCopyingSource('');
    return () => {
      attempt.current++;
    };
  }, [artifact?.text]);
  if (!artifact) return null;
  async function copyDraft() {
    if (locked || inFlight.current || !artifact) return;
    const ticket = ++attempt.current;
    const notify = (message: string) =>
      setFeedback({ source: artifact.text, message });
    inFlight.current = true;
    setCopyingSource(artifact.text);
    notify('');
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(artifact.text);
      if (ticket === attempt.current)
        notify('Draft copied. Review it before sharing.');
    } catch {
      if (ticket === attempt.current)
        notify(
          'Copy is unavailable here. Download the draft, or select its text to copy it.',
        );
    } finally {
      if (ticket === attempt.current) {
        inFlight.current = false;
        setCopyingSource('');
      }
    }
  }
  function downloadDraft() {
    if (locked || !artifact) return;
    const notify = (message: string) =>
      setFeedback({ source: artifact.text, message });
    let url: string | undefined, link: HTMLAnchorElement | undefined;
    try {
      url = URL.createObjectURL(
        new Blob([artifact.text], { type: 'text/plain;charset=utf-8' }),
      );
      link = document.createElement('a');
      link.href = url;
      link.download = artifact.filename;
      document.body.appendChild(link);
      link.click();
      notify('Download requested. Check your downloads.');
    } catch {
      notify(
        'The download could not start. You can select and copy the draft text.',
      );
    } finally {
      link?.remove();
      if (url) {
        const downloadUrl = url;
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      }
    }
  }
  return (
    <div className="mt-3 space-y-2">
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="Use written draft"
      >
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="min-h-11 min-w-11 aria-disabled:opacity-50"
          disabled={locked}
          aria-disabled={locked || copying}
          aria-busy={copying || undefined}
          onClick={() => void copyDraft()}
        >
          {copying ? 'Copying…' : 'Copy draft'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="min-h-11 min-w-11"
          disabled={locked}
          onClick={downloadDraft}
        >
          Download draft (.txt)
        </Button>
      </div>
      <small>
        Includes this draft’s title, text and review reminder only. It is not
        shared with your team.
      </small>
      <p role="status" aria-live="polite" className="text-xs">
        {notice}
      </p>
    </div>
  );
}
