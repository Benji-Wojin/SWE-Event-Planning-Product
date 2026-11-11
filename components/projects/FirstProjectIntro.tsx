import { Button } from '@/components/ui/button';

const firstSteps = [
  {
    title: 'Create your project',
    copy: 'Give your event a name. The date, location and other details can come later.',
  },
  {
    title: 'Invite a teammate',
    copy: 'Invite someone using the email they sign in with. Once they have access to Weft, they can accept from Projects.',
  },
  {
    title: 'Add your first task',
    copy: 'Pick one thing that needs doing and give it an owner. Start from scratch or use a starter checklist.',
  },
];

export function FirstProjectIntro({ onCreate }: { onCreate: () => void }) {
  return (
    <section
      className="first-project-intro"
      aria-labelledby="first-project-title"
    >
      <div className="first-project-heading">
        <span className="first-project-kicker">WELCOME TO WEFT</span>
        <h2 id="first-project-title">
          Your idea. Your people.
          <br />
          One place to bring it together.
        </h2>
        <p>
          Weft is the shared plan behind your event—from the first to-do to the
          day everyone arrives. Here’s a good way to begin.
        </p>
      </div>
      <ol className="first-project-steps">
        {firstSteps.map((step, index) => (
          <li key={step.title}>
            <span aria-hidden="true">0{index + 1}</span>
            <h3>{step.title}</h3>
            <p>{step.copy}</p>
          </li>
        ))}
      </ol>
      <div className="first-project-action">
        <Button
          className="h-auto min-h-11 max-w-full whitespace-normal px-5 py-2"
          onClick={onCreate}
        >
          Create my first project <span aria-hidden="true">↗</span>
        </Button>
        <p>
          No perfect plan required. Nothing is sent or added by AI
          automatically.
        </p>
      </div>
      <details className="first-project-details">
        <summary>What else can I keep in Weft?</summary>
        <p>
          Preparation deadlines, an event-day timeline, a manually maintained
          guest list, shared files and an optional manual budget. Your team sees
          the shared plan; private booking details stay in their separate
          organizer-only area.
        </p>
      </details>
    </section>
  );
}
