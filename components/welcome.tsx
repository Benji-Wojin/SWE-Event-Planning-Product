import { ThemeToggle } from './theme-toggle';
import { PrivacyLinks } from './privacy-links';
import {
  WelcomeInteractivePreview,
  WelcomeManifesto,
  WelcomeScrollController,
  WelcomeWorkflowRail,
} from './welcome-interactive';
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
] as const;

export function Welcome({ beta = false }: { beta?: boolean }) {
  const entry = beta ? '/sign-in?return_to=%2F' : '/signup';
  return (
    <div className="weft-welcome">
      <WelcomeScrollController />
      <a className="welcome-skip" href="#welcome-main">
        Skip to introduction
      </a>

      {/* Morphing Sticky Pill Navbar */}
      <div className="welcome-nav-shell">
        <header id="welcomeStickyNav" className="welcome-header">
          <div className="welcome-brand-group">
            <a href="/" className="welcome-brand" aria-label="Weft home">
              <span className="welcome-weave" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span>weft</span>
            </a>
            <span className="welcome-nav-divider" aria-hidden="true" />
          </div>
          <nav aria-label="Welcome navigation">
            <a href="#how-it-works">How it works</a>
            <a href="#welcome-toolkit-title">Details</a>
            <ThemeToggle />
            <a
              className="welcome-signin"
              href={beta ? entry : '/sign-in'}
            >
              {beta ? 'Tester sign in' : 'Sign in'}
            </a>
          </nav>
        </header>
      </div>

      <main id="welcome-main">
        {/* 1. Sculptural Wave Dark Hero + Frosted Glass Interactive Stage */}
        <section
          className="welcome-hero-wrap"
          aria-labelledby="welcome-title"
        >
        <div className="welcome-hero-waves" aria-hidden="true">
          <div className="welcome-orb welcome-orb-coral" />
          <div className="welcome-orb welcome-orb-mint" />
          <div className="welcome-orb welcome-orb-amber" />
        </div>

        <div className="welcome-hero">
          <div className="welcome-hero-copy">
            <p className="welcome-eyebrow">
              <span className="welcome-eyebrow-dot" aria-hidden="true" />
              Good events start with a shared plan.
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
              <span className="welcome-primary-ring">
                <a className="welcome-primary" href={entry}>
                  <span>{beta ? 'Sign in to Weft' : 'Plan your first event'}</span>
                  <span className="welcome-primary-circle" aria-hidden="true">
                    ↗
                  </span>
                </a>
              </span>
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
          </div>

          <WelcomeInteractivePreview />

          <ul className="welcome-event-types" aria-label="Events you can plan">
            <li>
              <strong>School events</strong>
              <span>Science nights, dances, and fundraisers in one shared plan.</span>
            </li>
            <li>
              <strong>Team gatherings</strong>
              <span>Off-sites, workshops, and showcases with clear ownership.</span>
            </li>
            <li>
              <strong>Trips &amp; celebrations</strong>
              <span>Lodging, schedules, and manual budgets without group-chat chaos.</span>
            </li>
          </ul>
        </div>
      </section>

      {/* 2. Scroll-Revealed Split-Text Manifesto (Crisp White Polarity) */}
      <WelcomeManifesto />

      {/* 3. How It Works — Auto-Advancing Progress Rail Showcase (Obsidian Polarity) */}
      <section
        className="welcome-how-wrap"
        id="how-it-works"
        aria-labelledby="welcome-how-title"
      >
        <div className="welcome-how">
          <div className="welcome-section-heading">
            <div>
              <p className="welcome-eyebrow">
                A little structure. A lot more possibility.
              </p>
              <h2 id="welcome-how-title">Big idea → shared plan → great event.</h2>
            </div>
            <p>You don’t need to have everything figured out to begin.</p>
          </div>

          <WelcomeWorkflowRail steps={steps} />
        </div>
      </section>

      {/* 4. Details & Optional AI Split (Crisp White Polarity) */}
      <section
        className="welcome-toolkit-wrap"
        aria-labelledby="welcome-toolkit-title"
      >
        <div className="welcome-toolkit">
          <div className="welcome-toolkit-card">
            <div className="welcome-toolkit-inner">
              <p className="welcome-eyebrow-light">Room for the whole picture</p>
              <h2 id="welcome-toolkit-title">The details belong together.</h2>
              <p>
                Tasks and people. Preparation deadlines and the event-day schedule.
                Shared guest information, files and an optional manual budget—all in
                your project.
              </p>
            </div>
          </div>

          <aside className="welcome-ai">
            <div className="welcome-ai-inner">
              <span className="welcome-eyebrow-light">
                A thought partner, not an autopilot
              </span>
              <h3>Ask Weft · Coming soon.</h3>
              <p>
                We’re improving Ask Weft before making it available. AI is optional;
                it does not send messages, make purchases or complete tasks for you.
              </p>
            </div>
          </aside>
        </div>
      </section>

      {/* 5. Final CTA & Footer (Obsidian Polarity) */}
      <section className="welcome-final-wrap" aria-label="Get started">
        <div className="welcome-final">
          <h2>
            Make something worth
            <br />
            coming together for.
          </h2>
          <span className="welcome-primary-ring">
            <a className="welcome-primary" href={entry}>
              <span>{beta ? 'Tester sign in' : 'Create your first project'}</span>
              <span className="welcome-primary-circle" aria-hidden="true">
                ↗
              </span>
            </a>
          </span>
          <p>
            {beta
              ? 'Access is limited to approved beta testers.'
              : 'Start small. Add the rest as your plan takes shape.'}
          </p>
        </div>
      </section>
      </main>

      <div className="welcome-footer-shell">
        <footer className="welcome-footer">
          <span className="welcome-footer-brand">
            <span className="welcome-weave is-sm" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <strong>weft</strong> · Bring the plan together.
          </span>
          <PrivacyLinks />
        </footer>
      </div>
    </div>
  );
}
