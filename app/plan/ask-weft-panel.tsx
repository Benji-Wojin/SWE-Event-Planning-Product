'use client';
import { useState, type ComponentProps } from 'react';
import { TaskChat } from './task-chat';
import { ResearchChat } from './research-chat';
export function AskWeftPanel({
  query,
  onBusy,
  ...props
}: ComponentProps<typeof TaskChat> & {
  query: string;
  onBusy: (busy: boolean) => void;
}) {
  const [mode, setMode] = useState('chat'),
    [researchBusy, setResearchBusy] = useState(false),
    [researchDirty, setResearchDirty] = useState(false),
    [chatDirty, setChatDirty] = useState(false);
  const locked = props.locked || researchBusy;
  return (
    <div className="ask-weft-panel">
      <div className="ask-weft-modes" role="group" aria-label="Ask Weft mode">
        <button
          type="button"
          aria-pressed={mode === 'chat'}
          disabled={locked}
          onClick={() => setMode('chat')}
        >
          ✦ Plan &amp; write{chatDirty ? ' · draft' : ''}
        </button>
        <button
          type="button"
          aria-pressed={mode === 'research'}
          disabled={locked}
          onClick={() => setMode('research')}
        >
          ↗ Search web{researchDirty ? ' · draft' : ''}
        </button>
      </div>
      <div hidden={mode !== 'chat'}>
        <TaskChat
          {...props}
          locked={locked}
          onDirty={(value) => {
            setChatDirty(value);
            props.onDirty(value || researchDirty);
          }}
        />
      </div>
      <div hidden={mode !== 'research'}>
        <ResearchChat
          query={query}
          locked={props.locked}
          onBusy={(value) => {
            setResearchBusy(value);
            onBusy(value);
          }}
          onDirty={(value) => {
            setResearchDirty(value);
            props.onDirty(value || chatDirty);
          }}
        />
      </div>
    </div>
  );
}
