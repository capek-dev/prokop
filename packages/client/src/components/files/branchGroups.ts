/**
 * Groups branch names by their first path segment ("feature/1232" lands in a
 * "feature" group shown as "1232"). Root branches (no slash) form an unlabelled
 * leading group. Empty groups are dropped so headings never render alone.
 */
export interface BranchNameGroup<T extends { name: string }> {
  label: string | null;
  items: T[];
}

export function groupBranchesByPrefix<T extends { name: string }>(branches: readonly T[]): BranchNameGroup<T>[] {
  const root: T[] = [];
  const folders = new Map<string, T[]>();
  for (const branch of branches) {
    const slash = branch.name.indexOf('/');
    if (slash === -1) {
      root.push(branch);
      continue;
    }
    const prefix = branch.name.slice(0, slash);
    const bucket = folders.get(prefix);
    if (bucket) bucket.push(branch);
    else folders.set(prefix, [branch]);
  }
  const groups: BranchNameGroup<T>[] = [{ label: null, items: root }];
  for (const prefix of [...folders.keys()].sort()) {
    groups.push({ label: prefix, items: folders.get(prefix)! });
  }
  return groups.filter((group) => group.items.length > 0);
}

/** Display name for an item inside a group: the remainder after "prefix/". */
export function branchLabelInGroup(name: string, groupLabel: string | null): string {
  return groupLabel ? name.slice(groupLabel.length + 1) : name;
}
