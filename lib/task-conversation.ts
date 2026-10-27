export type TaskMessage = {role:'user'|'assistant'; content:string};
const excerptMarker = ' [Earlier draft excerpt; ask for a new draft to replace it.]';
function excerpt(content: string, limit: number) {
  return content.length <= limit ? content : content.slice(0, limit - excerptMarker.length) + excerptMarker;
}

// Keep the newest exchange usable without expanding the server/provider budget.
// Older context is explicitly disclosed in the UI, never summarized by a model.
export function taskFollowup(history: TaskMessage[], answer: string | undefined, message: string) {
  const rows: TaskMessage[] = [
    ...history.map(row => ({...row})),
    ...(answer ? [{role:'assistant' as const, content:excerpt(answer,1800)}] : []),
    {role:'user',content:message.trim()},
  ];
  let trimmed = false;
  while (rows.length > 3 && (rows.length > 8 || rows.filter(row=>row.role==='assistant').length > 3 || JSON.stringify(rows).length > 4000)) {
    rows.shift();
    while (rows[0]?.role === 'assistant') rows.shift();
    trimmed = true;
  }
  // A long previous request, response and new message can exceed 4000 together.
  // Retain the response and the entire new message; shorten only the earlier request.
  while (rows.length === 3 && JSON.stringify(rows).length > 4000 && rows[0].content.length > 80) {
    rows[0].content = excerpt(rows[0].content, Math.max(80, rows[0].content.length - Math.max(1, JSON.stringify(rows).length - 4000)));
    trimmed = true;
  }
  return {rows, description:JSON.stringify(rows), trimmed};
}

export function taskConversation(description: string): TaskMessage[] {
  let rows: any;
  try { rows=JSON.parse(description); } catch { throw new Error('Start a new task conversation.'); }
  if (!Array.isArray(rows) || !rows.length || rows.length>8 || rows[0]?.role!=='user' || rows.at(-1)?.role!=='user' ||
      rows.some(row=>!row || typeof row!=='object' || Object.keys(row).some(key=>!['role','content'].includes(key)) || !['user','assistant'].includes(row.role) || typeof row.content!=='string' || !row.content.trim() || row.content.length>1800) ||
      rows.filter(row=>row.role==='assistant').length>3) throw new Error('Keep the conversation short. Start a new conversation to continue.');
  return rows;
}
