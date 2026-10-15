import type { ReviewedItem } from './plan-generation';

// Shared by review UI and apply validation. Match only title + exact start time;
// similar wording or activities on other dates are not interchangeable.
export type ExistingPlanTask = { id: string; title: string; start: string };
export function planTaskSignature(item: { title: string; start: string }) {
  return (
    item.title
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim() +
    '|' +
    item.start
  );
}
export function planSelection(
  items: ReviewedItem[],
  existing: ExistingPlanTask[],
) {
  const matches = new Map<string, ExistingPlanTask[]>();
  for (const item of items) {
    matches.set(
      item.id,
      existing.filter(
        (task) => planTaskSignature(task) === planTaskSignature(item),
      ),
    );
  }
  const reusable = new Map<string, string>();
  for (const item of items) {
    const found = matches.get(item.id)!;
    if (!item.included && found.length === 1)
      reusable.set(item.id, found[0].id);
  }
  const selected = items.filter((item) => item.included);
  const selectedIds = new Set(selected.map((item) => item.id));
  const missing = selected.flatMap((item) =>
    item.dependsOn
      .filter((id) => !selectedIds.has(id) && !reusable.has(id))
      .map((id) => ({ itemId: item.id, prerequisiteId: id })),
  );
  const seen = new Set(existing.map(planTaskSignature));
  const duplicates = new Set<string>();
  for (const item of selected) {
    const signature = planTaskSignature(item);
    if (seen.has(signature)) duplicates.add(item.id);
    seen.add(signature);
  }
  return { matches, reusable, selected, missing, duplicates };
}
