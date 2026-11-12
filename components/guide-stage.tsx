import './guide-stage.css';

const stages = ['Project', 'Task', 'Budget', 'Event info', 'Invite'];

export function GuideStage({ step }: { step: number }) {
  return <div className="weft-guide-stage">
    <p><strong>Getting started</strong><span>Step {step} of {stages.length}</span></p>
    <ol aria-label="Guide progress">
      {stages.map((name, index) => {
        const position = index + 1;
        const status = position < step ? 'done' : position === step ? 'current' : 'upcoming';
        return <li key={name} data-state={status} aria-current={status === 'current' ? 'step' : undefined}>
          <span aria-hidden="true">{status === 'done' ? '✓' : position}</span>{name}
          {status === 'done' && <span className="sr-only"> complete</span>}
        </li>;
      })}
    </ol>
  </div>;
}
