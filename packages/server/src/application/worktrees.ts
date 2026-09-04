import { isAbsolute, join, relative } from 'node:path';
import type { GitWorktreeRef, ManagedWorktree, Session } from '@prokopai/sdk';
import type {
  ManagedWorktreeRecord,
  ManagedWorktreeRepositoryPort,
  WorktreeEventPort,
  WorktreeGitPort,
  WorktreeGitStatus,
  WorktreeRepositoryIdentity,
  WorktreeSessionPort,
  WorktreeTerminalPort,
  WorktreeWorkspacePort,
} from './ports/worktree';

export type WorktreeFailureCode =
  | 'workspace_not_found'
  | 'worktree_not_found'
  | 'worktree_unavailable'
  | 'session_not_found'
  | 'workspace_mismatch'
  | 'session_running'
  | 'session_has_messages'
  | 'worktree_name_exists'
  | 'invalid_worktree_name'
  | 'branch_not_found'
  | 'branch_already_checked_out'
  | 'worktree_dirty'
  | 'terminal_attached'
  | 'repository_changed'
  | 'repository_outside_workspace'
  | 'git_not_installed'
  | 'not_a_git_repository'
  | 'invalid_branch_name'
  | 'operation_timed_out'
  | 'output_limit'
  | 'git_error';

export type WorktreeResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: WorktreeFailureCode; message: string };

export interface WorktreeApplication {
  list(workspaceId: string): Promise<WorktreeResult<ManagedWorktree[]>>;
  listRefs(workspaceId: string): Promise<WorktreeResult<GitWorktreeRef[]>>;
  refreshAttachments(worktreeId: string): Promise<void>;
  create(
    workspaceId: string,
    input: { name: string; branch: string },
  ): Promise<WorktreeResult<ManagedWorktree>>;
  remove(workspaceId: string, worktreeId: string): Promise<WorktreeResult<ManagedWorktree>>;
  bind(sessionId: string, worktreeId: string): Promise<WorktreeResult<Session>>;
  unbind(sessionId: string): Promise<WorktreeResult<Session>>;
}

export interface WorktreeApplicationDeps {
  dataDir: () => string;
  repository: ManagedWorktreeRepositoryPort;
  git: WorktreeGitPort;
  workspaces: WorktreeWorkspacePort;
  sessions: WorktreeSessionPort;
  terminals: WorktreeTerminalPort;
  events: WorktreeEventPort;
}

const repositoryQueues = new Map<string, Promise<unknown>>();
const removingWorktrees = new Set<string>();

async function serialized<T>(repositoryId: string, operation: () => Promise<T>): Promise<T> {
  const previous = repositoryQueues.get(repositoryId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  repositoryQueues.set(repositoryId, current);
  try {
    return await current;
  } finally {
    if (repositoryQueues.get(repositoryId) === current) {
      repositoryQueues.delete(repositoryId);
    }
  }
}

class WorktreeOperationError extends Error {
  constructor(readonly code: WorktreeFailureCode, message: string) {
    super(message);
  }
}

function failureCode(error: unknown): WorktreeFailureCode {
  if (error instanceof WorktreeOperationError) return error.code;
  if (error && typeof error === 'object' && 'code' in error) {
    const code = String(error.code);
    if (
      code === 'git_not_installed'
      || code === 'not_a_git_repository'
      || code === 'branch_not_found'
      || code === 'branch_already_checked_out'
      || code === 'invalid_branch_name'
      || code === 'operation_timed_out'
      || code === 'output_limit'
    ) {
      return code;
    }
  }
  return 'git_error';
}

function isMissingFailure(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'worktree_missing');
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function containsRepository(identity: WorktreeRepositoryIdentity): boolean {
  const path = relative(identity.selectedRoot, identity.repositoryTopLevel);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function validWorktreeName(name: string): boolean {
  if (!name || name !== name.trim() || name.length > 100 || name === '.' || name === '..') {
    return false;
  }
  return [...name].every((character) => {
    const code = character.charCodeAt(0);
    return code >= 32 && code !== 127;
  });
}

function attachmentsFor(
  record: ManagedWorktreeRecord,
  sessions: WorktreeSessionPort,
): ManagedWorktree['attachments'] {
  return sessions.listByWorkspace(record.workspaceId)
    .filter((session) => session.workspaceRootId === record.id)
    .map((session) => ({
      sessionId: session.id,
      title: session.title,
      running: sessions.isRunning(session),
    }));
}

function publicWorktree(
  record: ManagedWorktreeRecord,
  status: WorktreeGitStatus,
  sessions: WorktreeSessionPort,
): ManagedWorktree {
  return {
    id: record.id,
    name: record.name,
    workspaceId: record.workspaceId,
    repositoryId: record.repositoryId,
    path: record.path,
    branch: status.branch ?? record.branch,
    head: status.head ?? record.head,
    state: record.state,
    dirty: status.dirty,
    untrackedCount: status.untrackedCount,
    attachments: attachmentsFor(record, sessions),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function sessionWithWorktree(
  session: Session,
  record: ManagedWorktreeRecord | null,
): Session {
  return {
    ...session,
    worktree: record
      ? {
          id: record.id,
          name: record.name,
          branch: record.branch,
          path: record.path,
          state: record.state,
        }
      : null,
  };
}

const EMPTY_STATUS: WorktreeGitStatus = {
  branch: null,
  head: null,
  dirty: false,
  untrackedCount: 0,
};

export function createWorktreeApplication(deps: WorktreeApplicationDeps): WorktreeApplication {
  async function load(record: ManagedWorktreeRecord): Promise<ManagedWorktree> {
    if (record.state === 'removed' || (record.state === 'removing' && removingWorktrees.has(record.id))) {
      return publicWorktree(record, EMPTY_STATUS, deps.sessions);
    }
    try {
      const status = await deps.git.status(record.path);
      const updated = deps.repository.update(record.id, {
        branch: status.branch,
        head: status.head,
        state: 'available',
      }) ?? record;
      return publicWorktree(updated, status, deps.sessions);
    } catch (error: unknown) {
      if (isMissingFailure(error)) {
        const missing = deps.repository.update(record.id, { state: 'missing' }) ?? {
          ...record,
          state: 'missing' as const,
        };
        return publicWorktree(missing, EMPTY_STATUS, deps.sessions);
      }
      const recovered = record.state === 'removing'
        ? deps.repository.update(record.id, { state: 'available' }) ?? record
        : record;
      return publicWorktree(recovered, EMPTY_STATUS, deps.sessions);
    }
  }

  return {
    async list(workspaceId) {
      if (!deps.workspaces.get(workspaceId)) {
        return { ok: false, code: 'workspace_not_found', message: 'Workspace not found' };
      }
      return {
        ok: true,
        value: await Promise.all(deps.repository.listByWorkspace(workspaceId).map(load)),
      };
    },

    async listRefs(workspaceId) {
      const workspace = deps.workspaces.get(workspaceId);
      if (!workspace) {
        return { ok: false, code: 'workspace_not_found', message: 'Workspace not found' };
      }
      try {
        const identity = await deps.git.inspectRepository(workspace.path);
        if (!containsRepository(identity)) {
          return {
            ok: false,
            code: 'repository_outside_workspace',
            message: 'The Git repository root is outside the workspace',
          };
        }
        const refs = await deps.git.listRefs(workspace.path);
        return { ok: true, value: refs.filter((ref) => ref.kind === 'local') };
      } catch (error: unknown) {
        return {
          ok: false,
          code: failureCode(error),
          message: messageFor(error, 'Could not list Git branches'),
        };
      }
    },

    async refreshAttachments(worktreeId) {
      const record = deps.repository.get(worktreeId);
      if (!record) return;
      deps.events.worktreeChanged(await load(record));
    },

    async create(workspaceId, input) {
      const workspace = deps.workspaces.get(workspaceId);
      if (!workspace) {
        return { ok: false, code: 'workspace_not_found', message: 'Workspace not found' };
      }
      try {
        const queuedIdentity = await deps.git.inspectRepository(workspace.path);
        if (!containsRepository(queuedIdentity)) {
          return {
            ok: false,
            code: 'repository_outside_workspace',
            message: 'The Git repository root is outside the workspace',
          };
        }
        return await serialized(queuedIdentity.repositoryId, async () => {
          const identity = await deps.git.inspectRepository(workspace.path);
          if (
            identity.repositoryId !== queuedIdentity.repositoryId
            || identity.repositoryRoot !== queuedIdentity.repositoryRoot
          ) {
            return { ok: false, code: 'repository_changed', message: 'Repository identity changed' } as const;
          }
          if (!containsRepository(identity)) {
            return {
              ok: false,
              code: 'repository_outside_workspace',
              message: 'The Git repository root is outside the workspace',
            } as const;
          }
          if (!validWorktreeName(input.name)) {
            return {
              ok: false,
              code: 'invalid_worktree_name',
              message: 'Worktree name must be between 1 and 100 characters',
            } as const;
          }
          const nameExists = deps.repository.listByRepository(identity.repositoryId).some(
            (record) => record.state !== 'removed' && record.name === input.name,
          );
          if (nameExists) {
            return {
              ok: false,
              code: 'worktree_name_exists',
              message: `A worktree named "${input.name}" already exists`,
            } as const;
          }
          const id = crypto.randomUUID();
          const path = join(deps.dataDir(), 'worktrees', identity.repositoryId, id);
          const status = await deps.git.create({
            repositoryPath: workspace.path,
            destinationPath: path,
            branch: input.branch,
          });
          const now = new Date().toISOString();
          const record = deps.repository.create({
            id,
            name: input.name,
            workspaceId,
            repositoryId: identity.repositoryId,
            repositoryRoot: identity.repositoryRoot,
            path,
            branch: status.branch,
            head: status.head,
            state: 'available',
            createdAt: now,
            updatedAt: now,
          });
          const worktree = publicWorktree(record, status, deps.sessions);
          deps.events.worktreeChanged(worktree);
          return { ok: true, value: worktree } as const;
        });
      } catch (error: unknown) {
        return {
          ok: false,
          code: failureCode(error),
          message: messageFor(error, 'Git worktree creation failed'),
        };
      }
    },

    async remove(workspaceId, worktreeId) {
      const workspace = deps.workspaces.get(workspaceId);
      if (!workspace) {
        return { ok: false, code: 'workspace_not_found', message: 'Workspace not found' };
      }
      const record = deps.repository.get(worktreeId);
      if (!record || record.workspaceId !== workspaceId) {
        return { ok: false, code: 'worktree_not_found', message: 'Worktree not found' };
      }
      if (record.state === 'removed') {
        // The worktree directory is already gone; purge the leftover record
        // row entirely. Release FK references first: sessions still bound to
        // the removed worktree fall back to the primary checkout (a dead
        // binding protects nothing), and lingering terminal rows drop their
        // reference. Broadcasts worktreeDeleted so clients drop the row.
        const affected = deps.sessions.listByWorkspace(workspaceId)
          .filter((candidate) => candidate.workspaceRootId === worktreeId);
        for (const candidate of affected) {
          const stored = deps.sessions.updateWorkspaceRoot(candidate.id, null);
          if (stored) deps.events.sessionChanged(sessionWithWorktree(stored, null));
        }
        deps.terminals.clearWorktreeReferences(worktreeId);
        if (!deps.repository.delete(worktreeId)) {
          return { ok: false, code: 'worktree_not_found', message: 'Worktree not found' };
        }
        const purged = publicWorktree(record, EMPTY_STATUS, deps.sessions);
        deps.events.worktreeDeleted(purged);
        return { ok: true, value: purged };
      }
      if (record.state !== 'available') {
        return { ok: false, code: 'worktree_unavailable', message: 'Worktree is not available' };
      }

      return serialized(record.repositoryId, async () => {
        const current = deps.repository.get(worktreeId);
        if (!current || current.workspaceId !== workspaceId) {
          return { ok: false, code: 'worktree_not_found', message: 'Worktree not found' } as const;
        }
        if (current.state !== 'available') {
          return { ok: false, code: 'worktree_unavailable', message: 'Worktree is not available' } as const;
        }

        removingWorktrees.add(current.id);
        const reserved = deps.repository.update(current.id, { state: 'removing' }) ?? {
          ...current,
          state: 'removing' as const,
        };
        deps.events.worktreeChanged(publicWorktree(reserved, EMPTY_STATUS, deps.sessions));

        try {
          const identity = await deps.git.inspectRepository(workspace.path);
          if (
            identity.repositoryId !== current.repositoryId
            || identity.repositoryRoot !== current.repositoryRoot
            || !containsRepository(identity)
          ) {
            throw new WorktreeOperationError('repository_changed', 'Repository identity changed');
          }

          const attachments = attachmentsFor(current, deps.sessions);
          if (attachments.some((attachment) => attachment.running)) {
            throw new WorktreeOperationError(
              'session_running',
              'A session attached to this worktree is running',
            );
          }
          if (deps.terminals.listForWorktree(current.id, current.path).length > 0) {
            throw new WorktreeOperationError(
              'terminal_attached',
              'A terminal is attached to this worktree',
            );
          }

          const status = await deps.git.status(current.path);
          if (status.dirty) {
            throw new WorktreeOperationError('worktree_dirty', 'Worktree has uncommitted changes');
          }

          await deps.git.remove(workspace.path, current.path);
          const removed = deps.repository.update(current.id, { state: 'removed' }) ?? {
            ...current,
            state: 'removed' as const,
          };
          const worktree = publicWorktree(removed, EMPTY_STATUS, deps.sessions);
          deps.events.worktreeChanged(worktree);
          return { ok: true, value: worktree } as const;
        } catch (error: unknown) {
          const nextState = isMissingFailure(error) ? 'missing' : 'available';
          const restored = deps.repository.update(current.id, { state: nextState }) ?? {
            ...current,
            state: nextState,
          };
          deps.events.worktreeChanged(publicWorktree(restored, EMPTY_STATUS, deps.sessions));
          return {
            ok: false,
            code: isMissingFailure(error) ? 'worktree_unavailable' : failureCode(error),
            message: messageFor(error, 'Git worktree removal failed'),
          } as const;
        } finally {
          removingWorktrees.delete(current.id);
        }
      });
    },

    async bind(sessionId, worktreeId) {
      const initialRecord = deps.repository.get(worktreeId);
      if (!initialRecord) {
        return { ok: false, code: 'worktree_not_found', message: 'Worktree not found' };
      }
      return serialized(initialRecord.repositoryId, async () => {
        const session = deps.sessions.get(sessionId);
        if (!session) {
          return { ok: false, code: 'session_not_found', message: 'Session not found' } as const;
        }
        if (deps.sessions.hasMessages(session.id)) {
          return {
            ok: false,
            code: 'session_has_messages',
            message: 'A session checkout cannot be changed after its first message',
          } as const;
        }
        if (deps.sessions.isRunning(session)) {
          return {
            ok: false,
            code: 'session_running',
            message: 'Stop the session before changing its worktree',
          } as const;
        }
        const record = deps.repository.get(worktreeId);
        if (!record) {
          return { ok: false, code: 'worktree_not_found', message: 'Worktree not found' } as const;
        }
        if (record.workspaceId !== session.workspaceId) {
          return {
            ok: false,
            code: 'workspace_mismatch',
            message: 'Worktree belongs to another workspace',
          } as const;
        }
        if (record.state !== 'available') {
          return { ok: false, code: 'worktree_unavailable', message: 'Worktree is not available' } as const;
        }

        let status: WorktreeGitStatus;
        try {
          status = await deps.git.status(record.path);
        } catch (error: unknown) {
          if (isMissingFailure(error)) {
            deps.repository.update(record.id, { state: 'missing' });
            return {
              ok: false,
              code: 'worktree_unavailable',
              message: 'Worktree directory is missing',
            } as const;
          }
          return {
            ok: false,
            code: failureCode(error),
            message: messageFor(error, 'Could not inspect the worktree'),
          } as const;
        }

        const currentRecord = deps.repository.update(record.id, {
          branch: status.branch,
          head: status.head,
        }) ?? record;
        const stored = deps.sessions.updateWorkspaceRoot(session.id, record.id);
        if (!stored) {
          return { ok: false, code: 'session_not_found', message: 'Session not found' } as const;
        }
        const updated = sessionWithWorktree(stored, currentRecord);
        deps.events.sessionChanged(updated);
        if (session.workspaceRootId && session.workspaceRootId !== record.id) {
          const previousRecord = deps.repository.get(session.workspaceRootId);
          if (previousRecord) {
            deps.events.worktreeChanged(await load(previousRecord));
          }
        }
        deps.events.worktreeChanged(publicWorktree(currentRecord, status, deps.sessions));
        return { ok: true, value: updated } as const;
      });
    },

    async unbind(sessionId) {
      const session = deps.sessions.get(sessionId);
      if (!session) {
        return { ok: false, code: 'session_not_found', message: 'Session not found' };
      }
      // The first-message lock protects a live checkout mid-conversation.
      // A binding whose worktree record is gone or no longer available
      // protects nothing, so recovery must stay possible: sessions bound to
      // removed/missing worktrees can fall back to the primary checkout.
      const boundRecord = session.workspaceRootId
        ? deps.repository.get(session.workspaceRootId)
        : null;
      const deadBinding = Boolean(session.workspaceRootId)
        && (!boundRecord || boundRecord.state !== 'available');
      if (deps.sessions.hasMessages(session.id) && !deadBinding) {
        return {
          ok: false,
          code: 'session_has_messages',
          message: 'A session checkout cannot be changed after its first message',
        };
      }
      if (deps.sessions.isRunning(session)) {
        return { ok: false, code: 'session_running', message: 'Stop the session before changing its worktree' };
      }
      const stored = deps.sessions.updateWorkspaceRoot(session.id, null);
      if (!stored) {
        return { ok: false, code: 'session_not_found', message: 'Session not found' };
      }
      const updated = sessionWithWorktree(stored, null);
      deps.events.sessionChanged(updated);
      if (session.workspaceRootId) {
        const previousRecord = deps.repository.get(session.workspaceRootId);
        if (previousRecord) {
          deps.events.worktreeChanged(await load(previousRecord));
        }
      }
      return { ok: true, value: updated };
    },
  };
}
