import type { ReviewedItem } from './plan-generation';

// Shared by review UI and apply validation. Exact matches use title + start time;
// differently worded matches require a server-bound AI hint and human approval.
export type ExistingPlanTask = { id: string; title: string; start: string };
export type DuplicateSuggestion = {
  itemId: string;
  taskId: string;
  itemIdentity: string;
  taskIdentity: string;
};
// Bind suggestions to reviewed content, not just a mutable item ID. Any change
// to meaning or timing invalidates the old AI suggestion and reuse decision.
export function duplicateItemIdentity(item: ReviewedItem) {
  return JSON.stringify([
    item.title.trim(),
    item.kind,
    item.note.trim(),
    item.dueDate,
    item.start,
    item.end,
    item.location.trim(),
    item.category,
  ]);
}
export function duplicateSuggestions(
  items: ReviewedItem[],
  existing: ExistingPlanTask[],
): DuplicateSuggestion[] {
  return items.flatMap((item) => {
    const index = item.existingTaskIndex;
    const task =
      typeof index === 'number' && Number.isInteger(index)
        ? existing[index]
        : undefined;
    if (
      !task ||
      task.start !== item.start ||
      planTaskSignature(task) === planTaskSignature(item)
    )
      return [];
    return [
      {
        itemId: item.id,
        taskId: task.id,
        itemIdentity: duplicateItemIdentity(item),
        taskIdentity: planTaskSignature(task),
      },
    ];
  });
}
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
  suggestions: DuplicateSuggestion[] = [],
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
  const possible = new Map<string, ExistingPlanTask>();
  const unresolved = new Set<string>();
  const invalidReuse = new Set<string>();
  for (const item of items) {
    const found = matches.get(item.id)!;
    if (!item.included && found.length === 1)
      reusable.set(item.id, found[0].id);
    const candidates = suggestions.filter(
      (s) =>
        s.itemId === item.id && s.itemIdentity === duplicateItemIdentity(item),
    );
    const suggestion = candidates.length === 1 ? candidates[0] : undefined;
    const task =
      suggestion &&
      existing.find(
        (t) =>
          t.id === suggestion.taskId &&
          planTaskSignature(t) === suggestion.taskIdentity &&
          t.start === item.start,
      );
    if (task && !found.length) possible.set(item.id, task);
    if (item.duplicateChoice === 'reuse') {
      if (!task || item.included) invalidReuse.add(item.id);
      else reusable.set(item.id, task.id);
    }
    if (possible.has(item.id) && item.included && !item.duplicateChoice)
      unresolved.add(item.id);
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
  return {
    matches,
    reusable,
    selected,
    missing,
    duplicates,
    possible,
    unresolved,
    invalidReuse,
  };
}
