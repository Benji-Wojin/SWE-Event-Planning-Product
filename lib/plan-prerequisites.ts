export const planPrerequisiteLimit = 8;

type PlanLinkRow = { id: string; dependsOn: readonly string[] };

export function planPrerequisiteDependents(rows: readonly PlanLinkRow[]) {
  const dependents = new Map<string, string[]>();
  for (const row of rows) {
    for (const id of row.dependsOn) {
      const group = dependents.get(id);
      if (group) group.push(row.id);
      else dependents.set(id, [row.id]);
    }
  }
  return dependents;
}

// If a candidate already depends on this item (possibly through several rows),
// adding it in the other direction would create a cycle in the saved draft.
export function planPrerequisiteLoopSources(dependents: ReadonlyMap<string, readonly string[]>, itemId: string) {
  const seen = new Set([itemId]);
  for (const id of seen) {
    for (const dependent of dependents.get(id) || []) seen.add(dependent);
  }
  seen.delete(itemId);
  return seen;
}
