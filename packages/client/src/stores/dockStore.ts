import { create } from 'zustand';

export type DockPosition = 'left' | 'right' | 'bottom';

export const DOCK_POSITIONS = ['left', 'right', 'bottom'] as const;
export const DOCK_SIZE_LIMITS = {
  left: { min: 220, max: 512, default: 256 },
  right: { min: 360, max: 720, default: 540 },
  bottom: { min: 200, max: 800, default: 336 },
} as const;

export const DOCK_STORAGE_KEY = 'prokopai_dock_sizes';
type DockSizes = Record<DockPosition, number>;

export interface DockState {
  open: boolean;
  size: number;
}

interface DockStore {
  docks: Record<DockPosition, DockState>;
  setDockOpen: (position: DockPosition, open: boolean) => void;
  toggleDock: (position: DockPosition) => void;
  setDockSize: (position: DockPosition, size: number) => void;
}

export function clampDockSize(position: DockPosition, size: number): number {
  const limits = DOCK_SIZE_LIMITS[position];
  return Math.round(Math.max(limits.min, Math.min(limits.max, size)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function loadDockSizes(): DockSizes {
  const sizes: DockSizes = { left: 256, right: 540, bottom: 336 };
  if (typeof window === 'undefined') return sizes;
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(DOCK_STORAGE_KEY) ?? 'null');
    if (isRecord(stored) && stored.version === 1 && isRecord(stored.sizes)) {
      for (const position of DOCK_POSITIONS) {
        const size = stored.sizes[position];
        if (typeof size === 'number' && Number.isFinite(size)) {
          sizes[position] = clampDockSize(position, size);
        }
      }
      return sizes;
    }
  } catch {
    // Invalid or unavailable storage must not prevent opening the workspace.
  }

  // The live right workbench used a different key from the older Files sidebar.
  for (const position of ['left', 'right'] as const) {
    try {
      const raw = localStorage.getItem(position === 'left'
        ? 'prokopai_sessions_panel_width'
        : 'prokopai_workbench_width_px');
      if (raw === null) continue;
      const value: unknown = JSON.parse(raw);
      const size = position === 'left' && isRecord(value) ? value.width : value;
      if (typeof size === 'number' && Number.isFinite(size)) {
        sizes[position] = clampDockSize(position, size);
      }
    } catch {
      // Migrate each legacy preference independently.
    }
  }
  return sizes;
}

function saveDockSizes(docks: DockStore['docks']): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(DOCK_STORAGE_KEY, JSON.stringify({
      version: 1,
      sizes: { left: docks.left.size, right: docks.right.size, bottom: docks.bottom.size },
    }));
  } catch {
    // Resizing still works when browser storage is unavailable.
  }
}

const initialSizes = loadDockSizes();

export const useDockStore = create<DockStore>((set) => ({
  docks: {
    left: { open: true, size: initialSizes.left },
    right: { open: false, size: initialSizes.right },
    bottom: { open: false, size: initialSizes.bottom },
  },
  setDockOpen: (position, open) => set((state) => ({
    docks: { ...state.docks, [position]: { ...state.docks[position], open } },
  })),
  toggleDock: (position) => set((state) => ({
    docks: { ...state.docks, [position]: { ...state.docks[position], open: !state.docks[position].open } },
  })),
  setDockSize: (position, size) => {
    if (!Number.isFinite(size)) return;
    set((state) => {
      const docks = {
        ...state.docks,
        [position]: { ...state.docks[position], size: clampDockSize(position, size) },
      };
      saveDockSizes(docks);
      return { docks };
    });
  },
}));
