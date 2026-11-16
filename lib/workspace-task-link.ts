const taskIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,179}$/;

export function workspaceTaskId(value: unknown): string {
  return typeof value==='string'&&taskIdPattern.test(value)?value:'';
}

export function workspaceTaskReview(value: unknown) {
  return value==='completion'||value==='amendment'||value==='owner'||value==='schedule'?value:'';
}

export function planTaskHref(params: URLSearchParams, id: string, guided = false, review = '', returnToReceipt = false): string {
  const task=workspaceTaskId(id);
  if(!task)return '';
  const demo=params.get('demo')==='1';
  const query=new URLSearchParams(demo?{as:'jack',task}:{project:params.get('project')||'main',task});
  if(!demo&&guided)query.set('guide','1');
  const focus=workspaceTaskReview(review);
  if(!demo&&focus)query.set('review',focus);
  if(!demo&&returnToReceipt&&params.get('project')&&focus)query.set('from','plan-receipt');
  return (demo?'/demo?':'/project?')+query;
}

export function planActivityHref(params: URLSearchParams, id: string, guided = false): string {
  const activity = workspaceTaskId(id);
  const project = params.get('project') || 'main';
  if (!activity || params.get('demo') === '1') return '';
  // The workspace resolves the date from its current authorized snapshot, not the receipt.
  const query = new URLSearchParams({ project, activity });
  if (guided) query.set('guide', '1');
  return '/project?' + query;
}

export function teamAccessFromPlanHref(project: string, receiptPlan: string, receiptTask = '', guided = false): string {
  const plan = workspaceTaskId(receiptPlan);
  if (!project || !plan) return '';
  const query = new URLSearchParams({ project, from: 'plan-handoff', receiptPlan: plan });
  const task = workspaceTaskId(receiptTask);
  if (task) query.set('receiptTask', task);
  if (guided) query.set('resumeGuide', '1');
  return '/team?' + query;
}

export function planHandoffHref(project: string, receiptPlan: string, receiptTask = '', guided = false): string {
  const plan = workspaceTaskId(receiptPlan);
  if (!project || !plan) return '';
  const query = new URLSearchParams({ project, receiptPlan: plan });
  const task = workspaceTaskId(receiptTask);
  if (task) query.set('receiptTask', task);
  if (guided) query.set('guide', '1');
  return '/plan?' + query;
}
