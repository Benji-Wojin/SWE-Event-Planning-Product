const taskIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,179}$/;

export function workspaceTaskId(value: unknown): string {
  return typeof value==='string'&&taskIdPattern.test(value)?value:'';
}

export function planTaskHref(params: URLSearchParams, id: string, guided = false): string {
  const task=workspaceTaskId(id);
  if(!task)return '';
  const demo=params.get('demo')==='1';
  const query=new URLSearchParams(demo?{as:'jack',task}:{project:params.get('project')||'main',task});
  if(!demo&&guided)query.set('guide','1');
  return (demo?'/demo?':'/project?')+query;
}
