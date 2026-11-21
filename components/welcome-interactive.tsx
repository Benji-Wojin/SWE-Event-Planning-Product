'use client';

import { useEffect, useRef, useState } from 'react';

type SampleTask = {
  id: string;
  title: string;
  meta: string;
  initials: string;
  name: string;
  tone: 'mint' | 'coral' | 'amber';
  done: boolean;
};

const INITIAL_TASKS: SampleTask[] = [
  {
    id: 'space',
    title: 'Find our space',
    meta: 'Venue confirmed · Alex',
    initials: 'AL',
    name: 'Alex',
    tone: 'mint',
    done: true,
  },
  {
    id: 'demos',
    title: 'Bring the demos together',
    meta: 'In progress · Sam',
    initials: 'SK',
    name: 'Sam',
    tone: 'coral',
    done: false,
  },
  {
    id: 'welcome',
    title: 'Give everyone a warm welcome',
    meta: 'Up next · Taylor',
    initials: 'TP',
    name: 'Taylor',
    tone: 'amber',
    done: false,
  },
];

export function WelcomeScrollController() {
  useEffect(() => {
    const nav = document.getElementById('welcomeStickyNav');
    if (!nav) return;
    const onScroll = () => {
      nav.classList.toggle('is-scrolled', window.scrollY > 48);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return null;
}

const PREVIEW_TABS = [
  ['tasks', 'Shared tasks'],
  ['map', 'Link map'],
  ['schedule', 'Schedule'],
  ['budget', 'Budget'],
] as const;

type PreviewTabId = (typeof PREVIEW_TABS)[number][0];

export function WelcomeInteractivePreview() {
  const [tab, setTab] = useState<PreviewTabId>('tasks');
  const [tasks, setTasks] = useState<SampleTask[]>(INITIAL_TASKS);
  const tabRefs = useRef<Partial<Record<PreviewTabId, HTMLButtonElement | null>>>({});

  const doneCount = tasks.filter(t => t.done).length;
  const pct = Math.round((doneCount / tasks.length) * 100);

  const toggleTask = (id: string) => {
    setTasks(prev => prev.map(t => (t.id === id ? { ...t, done: !t.done } : t)));
  };

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    let nextIndex = -1;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % PREVIEW_TABS.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + PREVIEW_TABS.length) % PREVIEW_TABS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = PREVIEW_TABS.length - 1;
    if (nextIndex === -1) return;
    event.preventDefault();
    const nextId = PREVIEW_TABS[nextIndex][0];
    setTab(nextId);
    tabRefs.current[nextId]?.focus();
  };

  return (
    <div className="welcome-glass-stage">
      {/* Hairline-divided CleanMeter Telemetry HUD */}
      <div className="welcome-hud">
        <span className="sr-only" aria-live="polite" aria-atomic="true">
          {doneCount} of {tasks.length} sample tasks complete, {pct}% ready
        </span>
        <span className="welcome-hud-item">
          <span>PLAN</span>
          <strong>Community science night</strong>
        </span>
        <span className="welcome-hud-item is-mint">
          <span>DONE</span>
          <strong className="welcome-tabular">
            {doneCount}/{tasks.length}
          </strong>
        </span>
        <span className="welcome-hud-item is-amber">
          <span>READY</span>
          <strong className="welcome-tabular">{pct}%</strong>
        </span>
        <span className="welcome-hud-item is-coral">
          <span>THE BIG DAY</span>
          <strong>Doors open</strong>
        </span>
      </div>

      {/* Interactive Fictional Plan Card */}
      <article
        className="welcome-plan-window"
        aria-label="Illustrative event plan, not a live project"
      >
        <div className="welcome-plan-bar">
          <div className="welcome-plan-title-group">
            <span className="welcome-window-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <div>
              <h2>Community science night</h2>
              <p>One evening. A whole team behind it.</p>
            </div>
            <span className="welcome-sample-tag">Fictional example</span>
          </div>

          <div className="welcome-plan-tabs" role="tablist" aria-label="Sample views">
            {PREVIEW_TABS.map(([key, label], index) => (
              <button
                key={key}
                ref={el => {
                  tabRefs.current[key] = el;
                }}
                id={`welcome-tab-${key}`}
                type="button"
                role="tab"
                aria-selected={tab === key}
                aria-controls={`welcome-panel-${key}`}
                tabIndex={tab === key ? 0 : -1}
                className={`welcome-plan-tab${tab === key ? ' is-active' : ''}`}
                onClick={() => setTab(key)}
                onKeyDown={event => onTabKeyDown(event, index)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div
          id={`welcome-panel-${tab}`}
          role="tabpanel"
          aria-labelledby={`welcome-tab-${tab}`}
          tabIndex={0}
          className="welcome-plan-body"
        >
          {tab === 'tasks' && (
            <ul className="welcome-sample-list">
              {tasks.map(task => (
                <li key={task.id}>
                  <button
                    type="button"
                    className={`welcome-sample-row${task.done ? ' is-done' : ''}`}
                    onClick={() => toggleTask(task.id)}
                    aria-pressed={task.done}
                  >
                    <span
                      className={`welcome-check${task.done ? ' is-checked' : ''}`}
                      aria-hidden="true"
                    >
                      {task.done ? '✓' : ''}
                    </span>
                    <span className="welcome-row-copy">
                      <strong>{task.title}</strong>
                      <small>{task.done ? 'Completed' : task.meta}</small>
                    </span>
                    <span className={`welcome-avatar is-${task.tone}`}>
                      <span aria-hidden="true">{task.initials}</span>
                      <span className="sr-only">{task.name}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {tab === 'map' && (
            <div className="welcome-dag-preview">
              <div className="welcome-dag-node is-ready">
                <span className="welcome-dag-kicker">
                  <i /> VENUE · READY
                </span>
                <strong>Find our space</strong>
                <small>Alex · Unlocks 1</small>
              </div>
              <span className="welcome-dag-arrow" aria-hidden="true">
                →
              </span>
              <div className="welcome-dag-node is-waiting">
                <span className="welcome-dag-kicker">
                  <i /> PROGRAM · NEXT
                </span>
                <strong>Bring the demos together</strong>
                <small>Sam · Unlocks 1</small>
              </div>
              <span className="welcome-dag-arrow" aria-hidden="true">
                →
              </span>
              <div className="welcome-dag-node is-ready">
                <span className="welcome-dag-kicker">
                  <i /> DOORS OPEN
                </span>
                <strong>Give everyone a warm welcome</strong>
                <small>Taylor · Opening night</small>
              </div>
            </div>
          )}

          {tab === 'schedule' && (
            <ul className="welcome-mini-rows">
              <li>
                <span className="welcome-time-tag">16:30</span>
                <span>
                  <strong>Auditorium setup &amp; power check</strong>
                  <small>Lead · Alex</small>
                </span>
              </li>
              <li>
                <span className="welcome-time-tag">17:30</span>
                <span>
                  <strong>Student demo tables ready</strong>
                  <small>Lead · Sam</small>
                </span>
              </li>
              <li>
                <span className="welcome-time-tag">18:00</span>
                <span>
                  <strong>Doors open · Check-in desk live</strong>
                  <small>Lead · Taylor</small>
                </span>
              </li>
            </ul>
          )}

          {tab === 'budget' && (
            <div className="welcome-budget-preview">
              <div className="welcome-budget-kpis welcome-tabular">
                <div>
                  <span>Expected</span>
                  <strong>$453</strong>
                </div>
                <div>
                  <span>Target</span>
                  <strong>$520</strong>
                </div>
                <div>
                  <span>Tracking</span>
                  <strong>Manual</strong>
                </div>
              </div>
              <div className="welcome-budget-bar" aria-hidden="true">
                <i style={{ width: '87%' }} />
              </div>
              <p className="welcome-budget-caption">
                Shared manual cost estimates and payments—Weft never moves money.
              </p>
            </div>
          )}

          <div className="welcome-plan-foot">
            <span>A clear next step. For every person.</span>
            <span>From idea → To opening night</span>
          </div>
        </div>
      </article>
    </div>
  );
}

const MANIFESTO_LINES: Array<Array<{ text: string; tone?: 'green' | 'amber' | 'coral' }>> = [
  [
    { text: 'Most event plans get buried across spreadsheets, group chats, and scattered docs. Weft brings every detail into one ' },
    { text: 'shared plan.', tone: 'green' },
  ],
  [
    { text: 'Everyone sees their next steps, what blocks what, and what happens on event day—so coordination feels ' },
    { text: 'calm, clear, and honest.', tone: 'amber' },
  ],
  [
    { text: 'From school nights to team off-sites and group trips, Weft keeps the whole crew moving ' },
    { text: 'without the chasing.', tone: 'coral' },
  ],
];

type ManifestoToken = {
  key: string;
  text: string;
  wordIndex: number | null;
  tone?: 'green' | 'amber' | 'coral';
};

const { paragraphs: MANIFESTO_PARAGRAPHS, totalWords: MANIFESTO_TOTAL_WORDS } = (() => {
  let wordIndex = 0;
  const paragraphs: ManifestoToken[][] = MANIFESTO_LINES.map((para, pIdx) =>
    para.flatMap((seg, sIdx) =>
      seg.text
        .split(/(\s+)/)
        .filter(Boolean)
        .map((token, tIdx): ManifestoToken => {
          const isWord = Boolean(token.trim());
          const idx = isWord ? wordIndex++ : null;
          return {
            key: `${pIdx}-${sIdx}-${tIdx}`,
            text: token,
            wordIndex: idx,
            tone: seg.tone,
          };
        }),
    ),
  );
  return { paragraphs, totalWords: wordIndex };
})();

export function WelcomeManifesto() {
  const sectionRef = useRef<HTMLElement | null>(null);
  const [litRatio, setLitRatio] = useState(1);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    let raf = 0;
    const update = () => {
      raf = 0;
      const el = sectionRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      // Start illuminating as section enters and reach 100% by the time it sits centered
      const start = vh * 0.92;
      const end = Math.max(80, vh * 0.34);
      const raw = (start - rect.top) / Math.max(1, start - end);
      setLitRatio(Math.max(0.22, Math.min(1, raw)));
    };

    const onScrollOrResize = () => {
      if (!raf) raf = window.requestAnimationFrame(update);
    };

    onScrollOrResize();
    window.addEventListener('scroll', onScrollOrResize, { passive: true });
    window.addEventListener('resize', onScrollOrResize, { passive: true });
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScrollOrResize);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, []);

  const litCutoff = Math.round(litRatio * MANIFESTO_TOTAL_WORDS);

  return (
    <section
      ref={sectionRef}
      className="welcome-manifesto"
      aria-label="Why Weft"
    >
      <div className="welcome-manifesto-inner">
        {MANIFESTO_PARAGRAPHS.map((tokens, pIdx) => (
          <p key={pIdx} className="welcome-manifesto-para">
            {tokens.map(token => {
              if (token.wordIndex === null) return token.text;
              const lit = token.wordIndex < litCutoff;
              return (
                <span
                  key={token.key}
                  className={`welcome-m-word${lit ? ' is-lit' : ''}${
                    token.tone ? ` is-${token.tone}` : ''
                  }`}
                >
                  {token.text}
                </span>
              );
            })}
          </p>
        ))}
      </div>
    </section>
  );
}

type WorkflowStep = readonly [string, string, string];

export function WelcomeWorkflowRail({ steps }: { steps: readonly WorkflowStep[] }) {
  const [active, setActive] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLLIElement | null>>([]);
  const hoveredRef = useRef(false);
  const focusedRef = useRef(false);
  const visibleRef = useRef(false);
  const userPausedRef = useRef(false);
  const elapsedRef = useRef(0);
  const activeRef = useRef(0);
  const syncLoopRef = useRef<() => void>(() => {});

  const updateRailFill = (currentIdx: number, fill: number) => {
    itemRefs.current.forEach((node, i) => {
      if (!node) return;
      node.style.setProperty('--rail-fill', i === currentIdx ? String(fill) : '0');
    });
  };

  const selectStep = (idx: number) => {
    activeRef.current = idx;
    elapsedRef.current = 0;
    userPausedRef.current = true;
    setUserPaused(true);
    setActive(idx);
    updateRailFill(idx, 1);
    syncLoopRef.current();
  };

  const togglePlayback = () => {
    const nextPaused = !userPausedRef.current;
    userPausedRef.current = nextPaused;
    setUserPaused(nextPaused);
    if (nextPaused) {
      updateRailFill(activeRef.current, 1);
    } else {
      elapsedRef.current = 0;
      updateRailFill(activeRef.current, 0);
    }
    syncLoopRef.current();
  };

  useEffect(() => {
    if (steps.length === 0) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      updateRailFill(activeRef.current, 1);
      return;
    }

    const DURATION = 6200;
    let raf = 0;
    let last: number | null = null;

    const shouldRun = () =>
      visibleRef.current &&
      document.visibilityState === 'visible' &&
      !hoveredRef.current &&
      !focusedRef.current &&
      !userPausedRef.current;

    const stop = () => {
      if (raf) {
        window.cancelAnimationFrame(raf);
        raf = 0;
      }
      last = null;
    };

    const tick = (ts: number) => {
      if (!shouldRun()) {
        stop();
        return;
      }
      if (last !== null) {
        elapsedRef.current += Math.min(64, ts - last);
      }
      last = ts;
      if (elapsedRef.current >= DURATION) {
        const next = (activeRef.current + 1) % steps.length;
        activeRef.current = next;
        elapsedRef.current = 0;
        updateRailFill(next, 0);
        setActive(next);
      } else {
        updateRailFill(activeRef.current, Math.min(1, elapsedRef.current / DURATION));
      }
      raf = window.requestAnimationFrame(tick);
    };

    const syncLoop = () => {
      if (shouldRun()) {
        if (!raf) raf = window.requestAnimationFrame(tick);
      } else {
        stop();
      }
    };
    syncLoopRef.current = syncLoop;

    const el = rootRef.current;
    const observer =
      typeof IntersectionObserver !== 'undefined' && el
        ? new IntersectionObserver(
            entries => {
              visibleRef.current = Boolean(entries[0]?.isIntersecting);
              syncLoop();
            },
            { threshold: 0.15 },
          )
        : null;

    if (observer && el) {
      observer.observe(el);
    } else {
      visibleRef.current = true;
      syncLoop();
    }

    const onVisibility = () => syncLoop();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      observer?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      syncLoopRef.current = () => {};
    };
  }, [steps.length]);

  return (
    <div
      ref={rootRef}
      className="welcome-rail-split"
      onMouseEnter={() => {
        hoveredRef.current = true;
        syncLoopRef.current();
      }}
      onMouseLeave={() => {
        hoveredRef.current = false;
        syncLoopRef.current();
      }}
      onFocus={() => {
        focusedRef.current = true;
        syncLoopRef.current();
      }}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          focusedRef.current = false;
          syncLoopRef.current();
        }
      }}
    >
      <div className="welcome-rail-column">
        <ol className="welcome-steps welcome-rail-list">
          {steps.map(([number, title, copy], idx) => {
            const isCurrent = idx === active;
            const panelId = `welcome-step-panel-${number}`;
            const buttonId = `welcome-step-btn-${number}`;
            return (
              <li
                key={number}
                ref={node => {
                  itemRefs.current[idx] = node;
                }}
                className={`welcome-rail-item${isCurrent ? ' is-active' : ''}`}
                style={{
                  ['--rail-fill' as string]: isCurrent ? '1' : '0',
                }}
              >
                <h3 className="welcome-rail-heading">
                  <button
                    id={buttonId}
                    type="button"
                    className={`welcome-rail-btn${isCurrent ? ' is-active' : ''}`}
                    onClick={() => selectStep(idx)}
                    aria-expanded={isCurrent}
                    aria-controls={panelId}
                  >
                    <span className="welcome-step-number">{number}</span>
                    <span className="welcome-rail-title">{title}</span>
                  </button>
                </h3>
                <section
                  id={panelId}
                  aria-labelledby={buttonId}
                  aria-hidden={!isCurrent}
                  className={`welcome-rail-desc${isCurrent ? ' is-open' : ''}`}
                >
                  <p>{copy}</p>
                </section>
              </li>
            );
          })}
        </ol>

        <button
          type="button"
          className="welcome-rail-playback"
          onClick={togglePlayback}
          aria-pressed={userPaused}
        >
          {userPaused ? 'Resume walkthrough' : 'Pause walkthrough'}
        </button>
      </div>

      <div className="welcome-rail-stage" aria-hidden="true">
        <div className={`welcome-rail-pane is-bg-0${active === 0 ? ' is-active' : ''}`}>
          <div className="welcome-pane-card">
            <span className="welcome-pane-tag is-mint">01 · START WITH THE IDEA</span>
            <strong>Community science night</strong>
            <div className="welcome-pane-rows">
              <div>
                <span>Date</span>
                <b>May 18</b>
              </div>
              <div>
                <span>Location</span>
                <b>North Hall</b>
              </div>
              <div>
                <span>Team</span>
                <b>3 organizers invited</b>
              </div>
            </div>
          </div>
        </div>

        <div className={`welcome-rail-pane is-bg-1${active === 1 ? ' is-active' : ''}`}>
          <div className="welcome-pane-card">
            <span className="welcome-pane-tag is-amber">02 · SHARED PLAN &amp; LINK MAP</span>
            <strong>See what unlocks what</strong>
            <div className="welcome-pane-rows">
              <div>
                <span>Find our space</span>
                <b>Venue confirmed</b>
              </div>
              <div>
                <span>Bring demos together</span>
                <b>Sam · In progress</b>
              </div>
              <div>
                <span>Optional AI draft</span>
                <b>Review before adding</b>
              </div>
            </div>
          </div>
        </div>

        <div className={`welcome-rail-pane is-bg-2${active === 2 ? ' is-active' : ''}`}>
          <div className="welcome-pane-card">
            <span className="welcome-pane-tag is-coral">03 · EVENT DAY READY</span>
            <strong>Doors open on schedule</strong>
            <div className="welcome-pane-rows">
              <div>
                <span>16:30</span>
                <b>Setup &amp; AV check</b>
              </div>
              <div>
                <span>17:30</span>
                <b>Demo stations ready</b>
              </div>
              <div>
                <span>18:00</span>
                <b>Welcome table live</b>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
