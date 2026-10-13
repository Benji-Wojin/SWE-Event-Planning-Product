'use client';
import { useEffect, useRef, useState } from 'react';
import { ProjectsHome, type GatherProject } from '@/components/projects/ProjectsHome';
export function ProjectsClient() {
  const [projects, setProjects] = useState<GatherProject[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const generation = useRef(0);
  const [canCreate,setCanCreate]=useState(false);
  const [canUseDemo,setCanUseDemo]=useState(false);
  async function load() {
    const ticket = ++generation.current;
    setLoading(true); setError('');
    try {
      const response = await fetch('/api/projects', { credentials: 'same-origin', cache: 'no-store' });
      const data: any = await response.json();
      if (!response.ok) throw new Error(data.error || 'Please try again.');
      if (generation.current === ticket) { setProjects(data.projects.map((project: any) => ({ ...project, eventDate: project.date }))); setCanCreate(data.canCreateProjects===true); setCanUseDemo(data.canUseDemo===true); }
    } catch (error) { if (generation.current === ticket) setError(error instanceof Error ? error.message : 'Please try again.'); }
    finally { if (generation.current === ticket) setLoading(false); }
  }
  useEffect(() => { void load(); const refresh = () => { if (!document.hidden) void load(); }; window.addEventListener('pageshow',refresh); document.addEventListener('visibilitychange',refresh); return () => { generation.current++; window.removeEventListener('pageshow',refresh); document.removeEventListener('visibilitychange',refresh); }; }, []);
  return <ProjectsHome projects={projects} canCreate={canCreate} canUseDemo={canUseDemo} isLoading={loading} error={error} onRetry={load}
    onCreate={() => window.location.assign('/setup')}
    onOpen={project => window.location.assign('/project?project=' + encodeURIComponent(project.id))} />;
}
