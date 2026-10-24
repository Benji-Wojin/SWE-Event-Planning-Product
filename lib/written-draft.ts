// A local plain-text artifact, not a task update or proof of execution.
export function writtenDraftArtifact(
  work: unknown,
): { filename: string; text: string } | null {
  if (!work || typeof work !== 'object' || Array.isArray(work)) return null;
  const value = work as Record<string, unknown>;
  if (
    Object.keys(value).sort().join(',') !== 'content,kind,title' ||
    value.kind !== 'written_draft' ||
    typeof value.title !== 'string' ||
    !value.title.trim() ||
    value.title.length > 180 ||
    typeof value.content !== 'string' ||
    !value.content.trim() ||
    value.content.length > 6000
  )
    return null;
  const title = value.title.trim().replace(/[\r\n]+/g, ' ');
  const slug =
    title
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64)
      .replace(/-$/, '') || 'written-draft';
  return {
    filename: `weft-${slug}.txt`,
    text: `${title}\n\n${value.content}\n\n---\nAsk Weft draft — review facts and placeholders before using. Nothing was sent, booked or verified, and no task was marked complete.\n`,
  };
}
