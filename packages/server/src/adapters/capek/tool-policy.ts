import type { Jean2CompatibilityBindings } from './types';

// The managed-worktree lifecycle tool was removed with the git-worktree
// builtin; worktree management lives in the application/transport layers.

export const jean2ToolPolicy: NonNullable<Jean2CompatibilityBindings['toolPolicy']> = {
  resolveDefinition: ({ definition }) => definition,
};
