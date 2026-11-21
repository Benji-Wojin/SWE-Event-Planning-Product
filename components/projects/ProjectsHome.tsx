'use client';
// Adapted from Gather’s Lovable ProjectsHome (f7669b53).
import {
  AlertCircle,
  CalendarDays,
  MapPin,
  Plus,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Invitations } from './Invitations';
import { FirstProjectIntro } from './FirstProjectIntro';
import { TUTORIAL_GUIDE_STEPS, type TutorialResume } from '@/lib/guided-tutorial';

import { Button, buttonVariants } from "@/components/ui/button";

import "./projects-home.css";

export type GatherProject = {
  id: string;
  name: string;
  eventDate?: string;
  location?: string;
  openTaskCount: number;
};

type ProjectsHomeProps = {
  projects: GatherProject[];
  onCreate: () => void;
  onOpen: (project: GatherProject) => void;
  isLoading?: boolean;
  error?: string | null;
  accountHref?: string;
  onRetry?: () => void;
  canCreate?: boolean;
  canUseDemo?: boolean;
  guideHref?: string;
  resumeGuide?: TutorialResume | null;
};

export function ProjectsHome({
  projects,
  onCreate,
  onOpen,
  isLoading = false,
  error = null,
  accountHref = "/account",
  onRetry,
  canCreate = true,
  canUseDemo = false,
  guideHref,
  resumeGuide,
}: ProjectsHomeProps) {
  return (
    <div className="projects-home">
      <header className="projects-header">
        <a className="projects-brand" href="/" aria-label="Weft projects">
          <svg width="20" height="20" viewBox="0 0 28 28" fill="none" aria-hidden="true">
            <rect x="4" y="4" width="7" height="20" rx="3.5" transform="rotate(-10 4 4)" fill="#7AD6A3"/>
            <circle cx="17.5" cy="9.5" r="3.6" fill="#7AD6A3"/>
            <circle cx="19.5" cy="18.5" r="3.8" fill="#F29B7E"/>
          </svg>
          <strong>weft</strong>
        </a>
        <div className="projects-header-actions">
          <ThemeToggle />
          <a className="projects-account-link" href="/feedback">Feedback</a>
          {guideHref && <a className="projects-account-link" href={guideHref}>Getting started</a>}
          {canUseDemo && <a className="projects-account-link" href="/demo">Demo</a>}
          <a className="projects-account-link" href={accountHref}>Account</a>
        </div>
      </header>

      <main className="projects-main">
          <>
            <section className="projects-hero" aria-label="Workspace summary">
              <div className="projects-title-row">
                <div className="projects-title-copy">
                  <span className="projects-kicker">Event workspaces</span>
                  <h1>Projects</h1>
                </div>
                {canCreate && <Button size="lg" onClick={onCreate}><Plus /> New project</Button>}
              </div>
              {!isLoading && !error && projects.length > 0 ? (
                <div className="projects-hud" aria-label="Portfolio summary">
                  <span className="projects-hud-item">
                    <span>PROJECTS</span>
                    <strong className="tabular-nums">{projects.length}</strong>
                  </span>
                  <span className="projects-hud-item is-mint">
                    <span>OPEN TASKS</span>
                    <strong className="tabular-nums">
                      {projects.reduce((sum, p) => sum + p.openTaskCount, 0)}
                    </strong>
                  </span>
                  <span className="projects-hud-item is-amber">
                    <span>NEXT DATED</span>
                    <strong>
                      {projects
                        .map((p) => p.eventDate)
                        .filter((d): d is string => Boolean(d))
                        .sort()[0] || "Not set"}
                    </strong>
                  </span>
                </div>
              ) : null}
            </section>

            {isLoading ? <ProjectsLoadingState /> : null}
            {!isLoading && !error && resumeGuide ? <ResumeGuideCard resume={resumeGuide} projects={projects} /> : null}
            {!isLoading && !error && <Invitations />}
            {!isLoading && error ? <ProjectsErrorState message={error} {...(onRetry ? { onRetry } : {})} /> : null}
            {!isLoading && !error && projects.length === 0 ? (
              <ProjectsEmptyState onCreate={onCreate} canCreate={canCreate} guideHref={resumeGuide ? undefined : guideHref} />
            ) : null}
            {!isLoading && !error && projects.length > 0 ? (
              <div className="projects-grid" aria-label="Projects">
                {projects.map((project) => (
                  <button type="button" className="project-card" key={project.id} onClick={() => onOpen(project)}>
                    <span className="project-card-well">
                      <span className="project-card-title">{project.name}</span>
                      <span className="project-card-meta">
                        <span><CalendarDays /> {project.eventDate || "Date not set"}</span>
                        <span><MapPin /> {project.location || "Location not set"}</span>
                      </span>
                    </span>
                    <span className="project-card-footer">
                      <span className="tabular-nums">{project.openTaskCount} open {project.openTaskCount === 1 ? "task" : "tasks"}</span>
                      <span aria-hidden="true">Open →</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </>
      </main>
    </div>
  );
}

function ResumeGuideCard({ resume, projects }: { resume: TutorialResume; projects: GatherProject[] }) {
  const index = TUTORIAL_GUIDE_STEPS.findIndex(([step]) => step === resume.next);
  if (index < 0) return null;
  const [, title, description] = TUTORIAL_GUIDE_STEPS[index];
  const project = resume.projectId ? projects.find(project => project.id === resume.projectId) : null;
  if (resume.next === 'project_created' ? !!resume.projectId : !project) return null;
  const href = project ? '/project?project=' + encodeURIComponent(project.id) + '&guide=1' : '/guide';
  return <section className="projects-resume" aria-labelledby="projects-resume-title">
    <div>
      <p className="projects-resume-step">Getting started · Step {index + 1} of {TUTORIAL_GUIDE_STEPS.length}</p>
      <h2 id="projects-resume-title">{title}</h2>
      <p>{project ? <>Continue in <strong>{project.name}</strong>. </> : null}{description}</p>
    </div>
    <a className={buttonVariants({className:'h-auto min-h-11 max-w-full whitespace-normal'})} href={href}
      aria-describedby="projects-resume-title">Resume guide</a>
  </section>;
}

function ProjectsLoadingState() {
  return (
    <div className="projects-grid" aria-label="Loading projects" aria-busy="true">
      {[0, 1, 2].map((item) => <div className="project-card project-card-loading" key={item}><span /><span /><span /></div>)}
    </div>
  );
}

function ProjectsErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <section className="projects-state" role="alert">
      <AlertCircle />
      <h2>Projects didn’t load</h2>
      <p>{message}</p>
      {onRetry ? <Button variant="outline" onClick={onRetry}>Try again</Button> : null}
    </section>
  );
}

function ProjectsEmptyState({ onCreate, canCreate, guideHref }: { onCreate: () => void; canCreate:boolean; guideHref?: string }) {
  if (canCreate) return <FirstProjectIntro onCreate={onCreate} guideHref={guideHref} />;
  return (
    <section className="projects-state">
      <h2>No projects yet</h2>
      <p>{canCreate ? 'Create a project to start planning an event.' : 'Open an invitation from your organizer to join a project.'}</p>
      {canCreate && <Button onClick={onCreate}><Plus /> New project</Button>}
    </section>
  );
}
