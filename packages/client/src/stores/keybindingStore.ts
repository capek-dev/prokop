import { create } from 'zustand';
import {
  normalizeKeybinding,
  parseStoredKeybindingSettings,
  type KeybindingCommandId,
  type KeybindingOverrides,
  type StoredKeybindingSettings,
} from '@/lib/keybindings';
import { STORAGE_KEYS } from '@/lib/storage';

interface KeybindingState {
  overrides: KeybindingOverrides;
  setBinding: (id: KeybindingCommandId, binding: string) => void;
  unsetBinding: (id: KeybindingCommandId) => void;
  resetBinding: (id: KeybindingCommandId) => void;
  resetAllBindings: () => void;
}

function loadOverrides(): KeybindingOverrides {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.KEYBINDINGS);
    if (raw === null) return {};
    return parseStoredKeybindingSettings(JSON.parse(raw)).overrides;
  } catch {
    return {};
  }
}

function persistOverrides(overrides: KeybindingOverrides): void {
  if (typeof localStorage === 'undefined') return;
  const settings: StoredKeybindingSettings = { version: 1, overrides };
  try {
    localStorage.setItem(STORAGE_KEYS.KEYBINDINGS, JSON.stringify(settings));
  } catch {
    // Storage can be unavailable in private browsing contexts.
  }
}

export const useKeybindingStore = create<KeybindingState>((set) => ({
  overrides: loadOverrides(),
  setBinding: (id, binding) => {
    const normalized = normalizeKeybinding(binding);
    if (!normalized) return;
    set((state) => {
      const overrides = { ...state.overrides, [id]: normalized };
      persistOverrides(overrides);
      return { overrides };
    });
  },
  unsetBinding: (id) => set((state) => {
    const overrides = { ...state.overrides, [id]: null };
    persistOverrides(overrides);
    return { overrides };
  }),
  resetBinding: (id) => set((state) => {
    const overrides = { ...state.overrides };
    delete overrides[id];
    persistOverrides(overrides);
    return { overrides };
  }),
  resetAllBindings: () => {
    const overrides = {};
    persistOverrides(overrides);
    set({ overrides });
  },
}));
