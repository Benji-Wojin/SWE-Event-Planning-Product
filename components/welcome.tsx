import { ThemeToggle } from './theme-toggle';
import { PrivacyLinks } from './privacy-links';
import './welcome.css';

const steps = [
  [
    '01',
    'Start with the idea.',
    'A school night, a team off-site, a celebration. Give your event a name; the details can follow.',
  ],
  [
    '02',
    'Make a plan together.',
    'Turn the big picture into tasks, owners and dates. Start manually or review an optional AI draft.',
  ],
  [
    '03',
    'Bring it to life.',
    'See what needs attention, share updates and follow the event schedule when the day arrives.',
  ],
];

export function Welcome({ beta = false }: { beta?: boolean }) {
  const entry = beta ? '/signin-with-chatgpt?return_to=%2F' : '/signup';
  return (
    <main className="weft-welcome">
      <a className="welcome-skip" href="#welcome-main">
        Skip to introduction
      </a>
      <header className="welcome-header">
        <a href="/" className="welcome-brand" aria-label="Weft home">
          <span className="welcome-weave" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          weft
        </a>
        <nav aria-label="Welcome navigation">
          <a href="#how-it-works">How it works</a>
          <ThemeToggle />
          <a
            className="welcome-signin"
            href={beta ? entry : '/signin-with-chatgpt'}
          >
            {beta ? 'Tester sign in' : 'Sign in'}
          </a>
        </nav>
      </header>
      <section
        className="welcome-hero"
        id="welcome-main"
        aria-labelledby="welcome-title"
      >
        <div className="welcome-hero-copy">
          <p className="welcome-eyebrow">
            <span aria-hidden="true">✳</span> Good events start with a shared
            plan.
          </p>
          <h1 id="welcome-title">
            Less chasing.
            <br />
            More <em>coming together.</em>
          </h1>
          <p className="welcome-lead">
            From the first “what if” to the day itself, Weft gives your team one
            place to turn an event into something real.
          </p>
          <div className="welcome-actions">
            <a className="welcome-primary" href={entry}>
              {beta ? 'Sign in to Weft' : 'Plan your first event'}{' '}
              <span aria-hidden="true">↗</span>
            </a>
            <a className="welcome-secondary" href="#how-it-works">
              Meet Weft <span aria-hidden="true">↓</span>
            </a>
          </div>
          <p className="welcome-access">
            {beta
              ? 'Private beta · Already approved? Sign in to get started.'
              : 'Your project starts private. Invite your team when you’re ready.'}
          </p>
          {beta && (
            <p className="welcome-request">
              Want to try it?{' '}
              <a href="mailto:support@weftplan.com?subject=Weft%20beta%20access">
                Request beta access
              </a>
              .
            </p>
          )}
          <ul className="welcome-event-types" aria-label="Events you can plan">
            <li>School events</li>
            <li>Team gatherings</li>
            <li>Trips & celebrations</li>
          </ul>
        </div>
        <div className="welcome-scene">
          <div className="welcome-orbit welcome-orbit-one" aria-hidden="true" />
          <div className="welcome-orbit welcome-orbit-two" aria-hidden="true" />
          <article
            className="welcome-plan"
            aria-label="Illustrative event plan, not a live project"
          >
            <div className="welcome-plan-top">
              <span>THE PLAN</span>
              <span className="welcome-sample-label">Fictional example</span>
            </div>
            <h2>
              Community
              <br />
              science night<span aria-hidden="true">✳</span>
            </h2>
            <p className="welcome-plan-meta">
              One evening. A whole team behind it.
            </p>
            <div className="welcome-plan-progress">
              <span>From idea</span>
              <i aria-hidden="true" />
              <span>To opening night</span>
            </div>
            <ul className="welcome-sample-tasks">
              <li>
                <span className="welcome-task-check" aria-hidden="true">
                  ✓
                </span>
                <div>
                  <strong>Find our space</strong>
                  <small>Venue confirmed</small>
                </div>
                <span className="welcome-avatar">
                  AL<span className="sr-only"> · Alex</span>
                </span>
              </li>
              <li>
                <span className="welcome-task-dot" aria-hidden="true" />
                <div>
                  <strong>Bring the demos together</strong>
                  <small>In progress · Sam</small>
                </div>
                <span className="welcome-avatar welcome-avatar-coral">
                  SK<span className="sr-only"> · Sam</span>
                </span>
              </li>
              <li>
                <span className="welcome-task-dot" aria-hidden="true" />
                <div>
                  <strong>Give everyone a warm welcome</strong>
                  <small>Up next · Taylor</small>
                </div>
                <span className="welcome-avatar welcome-avatar-lime">
                  TP<span className="sr-only"> · Taylor</span>
                </span>
              </li>
            </ul>
            <div className="welcome-note">
              <span aria-hidden="true">↳</span>
              <p>
                A clear next step.
                <br />
                <strong>For every person.</strong>
              </p>
            </div>
          </article>
          <div className="welcome-day-card" aria-hidden="true">
            <span>THE BIG DAY</span>
            <strong>Doors open.</strong>
            <p>You’ve got a plan.</p>
          </div>
        </div>
      </section>
      <section
        className="welcome-how"
        id="how-it-works"
        aria-labelledby="welcome-how-title"
      >
        <div className="welcome-section-heading">
          <p className="welcome-eyebrow">
            A little structure. A lot more possibility.
          </p>
          <h2 id="welcome-how-title">Big idea → shared plan → great event.</h2>
          <p>You don’t need to have everything figured out to begin.</p>
        </div>
        <ol className="welcome-steps">
          {steps.map(([number, title, copy]) => (
            <li key={number}>
              <span className="welcome-step-number">{number}</span>
              <h3>{title}</h3>
              <p>{copy}</p>
            </li>
          ))}
        </ol>
      </section>
      <section
        className="welcome-toolkit"
        aria-labelledby="welcome-toolkit-title"
      >
        <div>
          <p className="welcome-eyebrow">Room for the whole picture</p>
          <h2 id="welcome-toolkit-title">The details belong together.</h2>
          <p>
            Tasks and people. Preparation deadlines and the event-day schedule.
            Shared guest information, files and an optional manual budget—all in
            your project.
          </p>
        </div>
        <aside className="welcome-ai">
          <span className="welcome-eyebrow">
            A thought partner, not an autopilot
          </span>
          <h3>Ask Weft · Coming soon.</h3>
          <p>
            We’re improving Ask Weft before making it available. AI is optional;
            it does not send messages, make purchases or complete tasks for you.
          </p>
        </aside>
      </section>
      <section className="welcome-final" aria-label="Get started">
        <h2>
          Make something worth
          <br />
          coming together for.
        </h2>
        <a className="welcome-primary" href={entry}>
          {beta ? 'Tester sign in' : 'Create your first project'}{' '}
          <span aria-hidden="true">↗</span>
        </a>
        <p>
          {beta
            ? 'Access is limited to approved beta testers.'
            : 'Start small. Add the rest as your plan takes shape.'}
        </p>
      </section>
      <footer className="welcome-footer">
        <span>weft · Bring the plan together.</span>
        <PrivacyLinks />
      </footer>
    </main>
  );
}
