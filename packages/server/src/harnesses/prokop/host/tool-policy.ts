import { ensureSessionTempDir, sessionTempInstructions } from '@/infrastructure/filesystem/session-temp';
import type { RuntimeHost as ProkopCompatibilityBindings } from '@/infrastructure/runtime/host';

// The managed-worktree lifecycle tool was removed with the git-worktree
// builtin; worktree management lives in the application/transport layers.

export const prokopToolPolicy: NonNullable<ProkopCompatibilityBindings['toolPolicy']> = {
  resolveDefinition: ({ definition, sessionId }) => {
    if (!['shell', 'terminal', 'read-file', 'write-file', 'edit', 'grep', 'glob', 'file-to-markdown'].includes(definition.name)) return definition;
    return { ...definition, description: `${definition.description}\n\n${sessionTempInstructions(ensureSessionTempDir(sessionId))}` };
  },
};
