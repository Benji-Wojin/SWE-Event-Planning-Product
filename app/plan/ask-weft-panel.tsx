'use client';
import { type ComponentProps } from 'react';
import { TaskChat } from './task-chat';
import { useResearch } from './use-research';
export function AskWeftPanel({
  query,
  onBusy,
  ...props
}: ComponentProps<typeof TaskChat> & {
  query: string;
  onBusy: (busy: boolean) => void;
}) {
  const research = useResearch(query, props.locked, onBusy);
  return (
    <div className="ask-weft-panel">
      <TaskChat
        {...props}
        locked={props.locked || research.busy}
        research={research}
      />
    </div>
  );
}
