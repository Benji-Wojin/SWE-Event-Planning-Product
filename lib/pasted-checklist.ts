export const pastedChecklistLimit = 6000;

// A line is a proposed title, not a schedule, instruction, or completion record.
export function pastedChecklistTitles(value: unknown): string[] {
  if (typeof value !== 'string' || value.length > pastedChecklistLimit)
    throw new Error('Paste up to 6,000 characters of checklist text.');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))
    throw new Error('Use plain checklist text without control characters.');
  const titles = value.split(/\r\n?|\n|\u2028|\u2029/).map((line, index) => {
    const title = line.trimStart()
      .replace(/^(?:[-*+•◦▪–—]|\d{1,4}[.)])(?:\s+|$)/u, '')
      .replace(/^(?:\[[ xX]\]|[☐☑☒✓✔])(?:\s+|$)/u, '')
      .trim();
    if (title.length > 180) throw new Error(`Shorten line ${index + 1} to 180 characters or fewer.`);
    return title;
  }).filter(Boolean);
  if (!titles.length) throw new Error('Paste at least one task, one title per line.');
  if (titles.length > 24) throw new Error('Paste at most 24 task lines at a time.');
  return titles;
}
