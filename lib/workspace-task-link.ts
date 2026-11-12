const taskIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,179}$/;

export function workspaceTaskId(value: unknown): string {
  return typeof value==='string'&&taskIdPattern.test(value)?value:'';
}

export function planReceiptTaskHref(params: URLSearchParams, id: string): string {
  const task=workspaceTaskId(id);
  if(!task)return '';
  const demo=params.get('demo')==='1';
  const query=new URLSearchParams(demo?{as:'jack',task}:{project:params.get('project')||'main',task});
  return (demo?'/demo?':'/project?')+query;
}
