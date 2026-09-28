import { create } from 'zustand';
import { toast } from 'sonner';

export type PendingOperationType =
  | 'fork'
  | 'revert'
  | 'edit'
  | 'compact'
  | 'delete'
  | 'rename'
  | 'regenerate_title';

export interface PendingOperation {
  type: PendingOperationType;
  sessionId: string;
  messageId?: string;
  startedAt: number;
  acknowledgedAt?: number;
}

const OPERATION_TIMEOUT_MS = 60_000;

const OPERATION_LABELS: Record<PendingOperationType, string> = {
  fork: 'Fork',
  revert: 'Revert',
  edit: 'Edit',
  compact: 'Compact',
  delete: 'Delete',
  rename: 'Rename',
  regenerate_title: 'Title generation',
};

interface PendingOperationsState {
  operations: PendingOperation[];
  startOperation: (op: PendingOperation) => void;
  acknowledgeOperation: (sessionId: string, type: PendingOperationType) => void;
  clearOperation: (sessionId: string, type: PendingOperationType) => void;
  clearSessionOperations: (sessionId: string) => void;
  isOperationPending: (sessionId: string, type: PendingOperationType) => boolean;
  getSessionPendingOperations: (sessionId: string) => PendingOperation[];
  cleanupStaleOperations: () => void;
}

export const usePendingOperationsStore = create<PendingOperationsState>((set, get) => ({
  operations: [],

  startOperation: (op) => {
    set((state) => {
      const filtered = state.operations.filter(
        (existing) => !(existing.sessionId === op.sessionId && existing.type === op.type),
      );
      return { operations: [...filtered, op] };
    });
  },

  acknowledgeOperation: (sessionId, type) => {
    set((state) => ({
      operations: state.operations.map((op) =>
        op.sessionId === sessionId && op.type === type && op.acknowledgedAt === undefined
          ? { ...op, acknowledgedAt: Date.now() }
          : op,
      ),
    }));
  },

  clearOperation: (sessionId, type) => {
    set((state) => ({
      operations: state.operations.filter(
        (op) => !(op.sessionId === sessionId && op.type === type),
      ),
    }));
  },

  clearSessionOperations: (sessionId) => {
    set((state) => ({
      operations: state.operations.filter((op) => op.sessionId !== sessionId),
    }));
  },

  isOperationPending: (sessionId, type) => {
    return get().operations.some(
      (op) => op.sessionId === sessionId && op.type === type,
    );
  },

  getSessionPendingOperations: (sessionId) => {
    return get().operations.filter((op) => op.sessionId === sessionId);
  },

  cleanupStaleOperations: () => {
    const now = Date.now();
    const stale = get().operations.filter(
      (op) => op.acknowledgedAt === undefined && now - op.startedAt >
        (op.type === 'compact' ? 150_000 : OPERATION_TIMEOUT_MS),
    );
    if (stale.length > 0) {
      for (const op of stale) {
        toast.error(`${OPERATION_LABELS[op.type]} timed out`, {
          description: 'The server did not respond in time.',
        });
      }
      const staleSet = new Set(stale.map((op) => `${op.sessionId}:${op.type}`));
      set((state) => ({
        operations: state.operations.filter(
          (op) => !staleSet.has(`${op.sessionId}:${op.type}`),
        ),
      }));
    }
  },
}));
