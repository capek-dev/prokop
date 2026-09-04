import type { Jean2CompatibilityBindings } from './types';

export function isManagedWorktreeLifecycleTool(name: string): boolean {
  return name === 'git-worktree';
}

export const jean2ToolPolicy: NonNullable<Jean2CompatibilityBindings['toolPolicy']> = {
  resolveDefinition: ({ definition }) => (
    isManagedWorktreeLifecycleTool(definition.name) ? null : definition
  ),
};
