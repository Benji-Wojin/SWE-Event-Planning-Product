'use client';
import { useEffect, useRef, useState } from 'react';
import { ProjectsHome, type GatherProject } from '@/components/projects/ProjectsHome';
import type { TutorialResume } from '@/lib/guided-tutorial';

type ProjectsResponse = {
  projects: (Omit<GatherProject, 'eventDate'> & { date?: string })[];
  canCreateProjects?: boolean;
  canUseDemo?: boolean;
  resumeGuide?: TutorialResume | null;
  error?: string;
};
export function ProjectsClient() {
  const [projects, setProjects] = useState<GatherProject[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const generation = useRef(0);
  const [canCreate,setCanCreate]=useState(false);
  const [canUseDemo,setCanUseDemo]=useState(false);
  const [resumeGuide, setResumeGuide] = useState<TutorialResume | null>(null);
  async function load(background = false) {
    const ticket = ++generation.current;
    if (!background) { setLoading(true); setError(''); }
    try {
      const response = await fetch('/api/projects', { credentials: 'same-origin', cache: 'no-store' });
      const data: ProjectsResponse = await response.json();
      if (!response.ok) throw new Error(data.error || 'Please try again.');
      if (generation.current === ticket) {
        setError('');
        setProjects(data.projects.map(({ date, ...project }) => ({ ...project, eventDate: date })));
        setCanCreate(data.canCreateProjects === true);
        setCanUseDemo(data.canUseDemo === true);
        setResumeGuide(data.resumeGuide ?? null);
      }
    } catch (error) { if (generation.current === ticket) setError(error instanceof Error ? error.message : 'Please try again.'); }
    finally { if (generation.current === ticket) setLoading(false); }
  }
  useEffect(() => { void load(); const refresh = () => { if (!document.hidden) void load(true); }; window.addEventListener('pageshow',refresh); document.addEventListener('visibilitychange',refresh); return () => { generation.current++; window.removeEventListener('pageshow',refresh); document.removeEventListener('visibilitychange',refresh); }; }, []);
  return <ProjectsHome projects={projects} canCreate={canCreate} canUseDemo={canUseDemo} isLoading={loading} error={error} onRetry={() => void load()} guideHref="/guide" resumeGuide={resumeGuide}
    onCreate={() => window.location.assign('/setup')}
    onOpen={project => window.location.assign('/project?project=' + encodeURIComponent(project.id))} />;
}
