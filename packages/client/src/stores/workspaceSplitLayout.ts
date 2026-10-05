export type SplitDirection = 'right' | 'down';
export type ViewTree = { kind: 'group'; groupId: string } | {
  kind: 'split'; id: string; direction: SplitDirection; ratio: number; first: ViewTree; second: ViewTree;
};

export function treeGroups(tree: ViewTree): string[] {
  return tree.kind === 'group' ? [tree.groupId] : [...treeGroups(tree.first), ...treeGroups(tree.second)];
}

export function mapTree(tree: ViewTree, transform: (node: ViewTree) => ViewTree): ViewTree {
  return transform(tree.kind === 'group' ? tree : { ...tree, first: mapTree(tree.first, transform), second: mapTree(tree.second, transform) });
}

export function filterTree(tree: ViewTree, keep: (id: string) => boolean): ViewTree | null {
  if (tree.kind === 'group') return keep(tree.groupId) ? tree : null;
  const first = filterTree(tree.first, keep);
  const second = filterTree(tree.second, keep);
  return first && second ? { ...tree, first, second } : first ?? second;
}
