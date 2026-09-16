import { create } from 'zustand';

export interface GitCommitDraft {
  paths: string[];
  message: string;
  runHooks?: boolean;
}
export const EMPTY_GIT_DRAFT: GitCommitDraft = { paths: [], message: '' };
export function gitDraftKey(serverId: string | undefined, workspaceId: string, root?: string): string {
  return JSON.stringify([serverId ?? '', workspaceId, root ?? '']);
}
interface GitCommitStore {
  drafts: Record<string, GitCommitDraft>;
  update: (key: string, patch: Partial<GitCommitDraft>) => void;
  clear: (key: string) => void;
}
export const useGitCommitStore = create<GitCommitStore>((set) => ({
  drafts: {},
  update: (key, patch) => set((state) => ({ drafts: { ...state.drafts, [key]: { ...EMPTY_GIT_DRAFT, ...state.drafts[key], ...patch } } })),
  clear: (key) => set((state) => {
    const drafts = { ...state.drafts };
    delete drafts[key];
    return { drafts };
  }),
}));

export function selectedGitPaths(draft: GitCommitDraft, available: readonly string[]): string[] {
  const selected = new Set(draft.paths);
  return available.filter((path) => selected.has(path));
}
