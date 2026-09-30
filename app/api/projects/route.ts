import { body, json, principal, safe } from '@/lib/security';
import { createProject, listProjects } from '@/lib/projects';
export const dynamic = 'force-dynamic';
export async function GET() { return safe(async () => json({ projects: await listProjects(await principal()) })); }
export async function POST(request: Request) { return safe(async () => json(await createProject(await principal(), await body(request)), 201)); }
