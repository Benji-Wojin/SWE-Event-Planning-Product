export type TaskMessage = {role:'user'|'assistant'; content:string};
export function taskConversation(description: string): TaskMessage[] {
  let rows: any;
  try { rows=JSON.parse(description); } catch { throw new Error('Start a new task conversation.'); }
  if (!Array.isArray(rows) || !rows.length || rows.length>8 || rows[0]?.role!=='user' || rows.at(-1)?.role!=='user' ||
      rows.some(row=>!row || typeof row!=='object' || Object.keys(row).some(key=>!['role','content'].includes(key)) || !['user','assistant'].includes(row.role) || typeof row.content!=='string' || !row.content.trim() || row.content.length>1800) ||
      rows.filter(row=>row.role==='assistant').length>3) throw new Error('Keep the conversation short. Start a new conversation to continue.');
  return rows;
}
