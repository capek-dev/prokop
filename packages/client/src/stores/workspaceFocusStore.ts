import { create } from 'zustand';

interface WorkspaceFocusState {
  groupId: string;
  focusGroup: (groupId: string) => void;
}

// Interaction focus survives clicks on non-focusable content and portaled menus.
// It is transient, independent of the saved dock arrangement.
export const useWorkspaceFocusStore = create<WorkspaceFocusState>((set) => ({
  groupId: 'center',
  focusGroup: (groupId) => set({ groupId }),
}));
