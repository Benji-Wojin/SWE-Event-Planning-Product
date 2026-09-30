import { body, json, principal, safe } from '@/lib/security';
import { createProject, listProjects } from '@/lib/projects';
export const dynamic = 'force-dynamic';
export async function GET() { return safe(async () => { const user=await principal(); return json({ projects: await listProjects(user), canCreateProjects:user.role==='admin' }); }); }
export async function POST(request: Request) { return safe(async () => json(await createProject(await principal(), await body(request)), 201)); }
