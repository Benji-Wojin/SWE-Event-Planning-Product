'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { taskConversation, type TaskMessage } from '@/lib/task-conversation';
import type { PlanBrief, PlanOutput } from '@/lib/plan-generation';
const chatStarters = ['Plan my next three steps','Write a welcoming announcement','Draft a day-of checklist'];

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
}) {
  const [message, setMessage] = useState('');
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
    if (locked || !message.trim()) return;
    const next: TaskMessage[] = nextRows();
    const description = JSON.stringify(next);
    if (description.length > 4000) return;
    if (await onSend({ ...brief, description })) {
      setMessage('');
      onDirty(false);
    }
  }
  const overLimit =
    JSON.stringify(nextRows()).length > 4000 || nextRows().length > 8;
  return (
    <section className="task-chat" aria-label="Ask Weft conversation">
      {history.length===0&&!work&&<div className="chat-welcome"><span className="chat-avatar" aria-hidden="true">✦</span><div><h2>What can we take off your mind?</h2><p>Plan the next steps. Find the right words. Make a little room for the good part.</p></div></div>}
      <details className="text-sm text-muted-foreground">
        <summary>What I can actually do</summary>
        <p>
          I can propose tasks and prepare written drafts from the context shared
          here. This planning chat can’t browse (use Search web for that), see task notes or files, send messages, book,
          buy, run code, verify real-world work or mark tasks complete. A draft
          isn’t proof a task is finished.
        </p>
      </details>
      {history.length===0&&!work&&<div className="chat-starters" aria-label="Example requests">{chatStarters.map(prompt=><button key={prompt} type="button" disabled={locked} onClick={()=>{setMessage(prompt);onDirty(true);document.getElementById('task-chat-message')?.focus();}}>{prompt}<span aria-hidden="true">↗</span></button>)}</div>}
      <div className="task-chat-history" role="log" aria-label="Conversation">
        {history.map((row, index) => (
          <article
            key={index}
            className={'task-chat-message task-chat-' + row.role}
          >
            <span>{row.role === 'user' ? 'You' : 'Weft'}</span>
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
          <article className="weft-work space-y-3" aria-label="Weft response">
            <p className="text-xs font-medium">
              {work.kind === 'written_draft'
                ? 'WRITTEN DRAFT · PRIVATE · NOT APPLIED'
                : 'CAPABILITY LIMIT'}
            </p>
            <h2 className="font-semibold">{work.title}</h2>
            <p className="whitespace-pre-wrap break-words text-sm">
              {work.content}
            </p>
            {work.kind === 'written_draft' && (
              <p className="text-xs text-muted-foreground">
                Review facts and placeholders before using this. Nothing was
                sent, booked or changed in your project. No task was marked
                complete.
              </p>
            )}
          </article>
        )}
        {!asking && history.length > 0 && !applied && (
          <p className="text-xs text-muted-foreground">
            Review the response and any proposed tasks before using them. You
            can also ask for a revision.
          </p>
        )}
      </div>
      <form onSubmit={send} className="chat-composer space-y-3">
        <Label htmlFor="task-chat-message">
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
              : 'Write a welcome announcement for the event…'
          }
          onChange={(event) => {
            setMessage(event.target.value);
            onDirty(!!event.target.value.trim());
          }}
        />
        <details className="text-xs text-muted-foreground"><summary>What Send shares</summary><p>
          Send shares this conversation, event details, shared task names and
          saved event feedback with Groq. No emails, guest lists, files or
          private bookings. Each message uses an AI attempt.
        </p></details>
        {overLimit && (
          <p role="status" className="text-sm">
            This conversation is full. Start a new conversation to continue.
          </p>
        )}
        {!configured && (
          <p role="status" className="text-sm">
            AI isn’t configured. You can still use Add task.
          </p>
        )}
        <Button
          type="submit"
          disabled={locked || !configured || !message.trim() || overLimit}
        >
          {locked ? 'Thinking…' : asking ? 'Send answer' : 'Send'}
        </Button>
        {failed && history.length > 0 && (
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
