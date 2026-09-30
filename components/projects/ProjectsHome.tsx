'use client';
// Adapted from Gather’s Lovable ProjectsHome (f7669b53).
import {
  AlertCircle,
  CalendarDays,
  MapPin,
  Plus,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

import { Button } from "@/components/ui/button";

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
};

export function ProjectsHome({
  projects,
  onCreate,
  onOpen,
  isLoading = false,
  error = null,
  accountHref = "/settings",
  onRetry,
}: ProjectsHomeProps) {
  return (
    <div className="projects-home">
      <header className="projects-header">
        <a className="projects-brand" href="/" aria-label="Gather projects">
          <strong>gather</strong>
        </a>
        <div className="projects-header-actions">
          <ThemeToggle />
          <a className="projects-account-link" href="/demo">Demo</a>
          <a className="projects-account-link" href={accountHref}>Account</a>
        </div>
      </header>

      <main className="projects-main">
          <>
            <div className="projects-title-row">
              <div className="projects-title-copy">
                <h1>Projects</h1>
              </div>
              <Button onClick={onCreate}><Plus /> New project</Button>
            </div>

            {isLoading ? <ProjectsLoadingState /> : null}
            {!isLoading && error ? <ProjectsErrorState message={error} {...(onRetry ? { onRetry } : {})} /> : null}
            {!isLoading && !error && projects.length === 0 ? (
              <ProjectsEmptyState onCreate={onCreate} />
            ) : null}
            {!isLoading && !error && projects.length > 0 ? (
              <div className="projects-grid" aria-label="Projects">
                {projects.map((project) => (
                  <button className="project-card" key={project.id} onClick={() => onOpen(project)}>
                    <span className="project-card-title">{project.name}</span>
                    <span className="project-card-meta">
                      <span><CalendarDays /> {project.eventDate || "Date not set"}</span>
                      <span><MapPin /> {project.location || "Location not set"}</span>
                    </span>
                    <span className="project-card-footer">
                      <span>{project.openTaskCount} open {project.openTaskCount === 1 ? "task" : "tasks"}</span>
                      <span aria-hidden="true">Open</span>
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

function ProjectsEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <section className="projects-state">
      <h2>No projects yet</h2>
      <p>Create a project to start planning an event.</p>
      <Button onClick={onCreate}><Plus /> New project</Button>
    </section>
  );
}
