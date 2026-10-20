'use client';
import {useState} from 'react';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {Label} from '@/components/ui/label';
import {taskConversation, type TaskMessage} from '@/lib/task-conversation';
import type {PlanBrief} from '@/lib/plan-generation';

export function TaskChat({brief,question,applied,locked,configured,failed,onSend,onDirty,onNew}: {
  brief:PlanBrief;question?:string;applied:boolean;locked:boolean;configured:boolean;failed:boolean;
  onSend:(brief:PlanBrief)=>Promise<boolean>;onDirty:(value:boolean)=>void;
  onNew:()=>void;
}) {
  const [message,setMessage]=useState('');
  let history:TaskMessage[]=[];
  if(brief.description)try{history=taskConversation(brief.description);}catch{/* An invalid conversation can be replaced by a new request. */}
  const asking=!!question && !history.some(row=>row.role==='assistant') && !applied;
  async function send(event:React.FormEvent){
    event.preventDefault();if(locked||!message.trim())return;
    const next:TaskMessage[]=[...(applied?[]:history),...(asking?[{role:'assistant' as const,content:question!}]:[]),{role:'user',content:message.trim()}];
    const description=JSON.stringify(next);
    if(description.length>4000)return;
    if(await onSend({...brief,description})){setMessage('');onDirty(false);}
  }
  const overLimit=JSON.stringify([...(applied?[]:history),...(asking?[{role:'assistant',content:question}]:[]),{role:'user',content:message.trim()}]).length>4000 || (!applied && history.length>=8);
  return <section className="task-chat" aria-label="Task creation conversation">
    <p className="text-sm text-muted-foreground">Tell me what you want to add. I’ll draft up to five tasks for you to review—not do the work or save anything automatically.</p>
    <div className="task-chat-history" role="log" aria-label="Conversation">
      {history.map((row,index)=><article key={index} className={'task-chat-message task-chat-'+row.role}><span>{row.role==='user'?'You':'Weft'}</span><p>{row.content}</p></article>)}
      {asking && <article className="task-chat-message task-chat-assistant"><span>Weft · one quick question</span><p>{question}</p></article>}
      {!asking && history.length>0 && !applied && <p className="text-xs text-muted-foreground">Review the draft below. You can also ask for a revision.</p>}
    </div>
    <form onSubmit={send} className="space-y-3">
      <Label htmlFor="task-chat-message">{applied?'What else would you like to add?':asking?'Your answer':'Message Weft'}</Label>
      <Textarea id="task-chat-message" rows={3} maxLength={1800} disabled={locked} value={message} placeholder={asking?'A short answer is enough…':'Create a task to prepare welcome signs for our event…'} onChange={event=>{setMessage(event.target.value);onDirty(!!event.target.value.trim());}} />
      <p className="text-xs text-muted-foreground">Send shares this conversation, event details, shared task names and saved event feedback with Groq. No emails, guest lists, files or private bookings. Each message uses an AI attempt.</p>
      {overLimit && <p role="status" className="text-sm">This conversation is full. Start a new conversation to continue.</p>}
      {!configured && <p role="status" className="text-sm">AI isn’t configured. You can still use Add task.</p>}
      <Button type="submit" disabled={locked||!configured||!message.trim()||overLimit}>{locked?'Thinking…':asking?'Send answer':applied?'Draft more tasks':'Send & draft tasks'}</Button>
      {failed && history.length>0 && <Button type="button" variant="outline" disabled={locked||!configured} onClick={()=>void onSend(brief)}>Retry last message</Button>}
      {(history.length>0 || message) && <Button type="button" variant="ghost" disabled={locked} onClick={onNew}>New conversation</Button>}
    </form>
  </section>;
}
