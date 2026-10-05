import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DOCK_STORAGE_KEY, loadDockSizes, useDockStore } from '@/stores/dockStore';

describe('dockStore', () => {
  beforeEach(() => {
    localStorage.clear();
    useDockStore.setState(useDockStore.getInitialState());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    useDockStore.setState(useDockStore.getInitialState());
  });

  test('toggles regions independently without persisting visibility', () => {
    const store = useDockStore.getState();
    store.toggleDock('left');
    store.setDockOpen('right', true);
    store.toggleDock('bottom');
    expect(useDockStore.getState().docks).toEqual({
      left: { open: false, size: 256 },
      right: { open: true, size: 540 },
      bottom: { open: true, size: 336 },
    });
    expect(localStorage.getItem(DOCK_STORAGE_KEY)).toBeNull();
  });

  test('persists bounded dimensions for all positions, including bottom height', () => {
    const store = useDockStore.getState();
    store.setDockSize('left', 10000);
    store.setDockSize('right', 10);
    store.setDockSize('bottom', 410.6);
    expect(loadDockSizes()).toEqual({ left: 512, right: 360, bottom: 411 });
    expect(JSON.parse(localStorage.getItem(DOCK_STORAGE_KEY)!)).toEqual({
      version: 1, sizes: { left: 512, right: 360, bottom: 411 },
    });
    store.setDockOpen('bottom', true);
    store.setDockOpen('bottom', false);
    expect(useDockStore.getState().docks.bottom.size).toBe(411);
  });

  test('ignores non-finite resize values', () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      useDockStore.getState().setDockSize('bottom', value);
    }
    expect(useDockStore.getState().docks.bottom.size).toBe(336);
    expect(localStorage.getItem(DOCK_STORAGE_KEY)).toBeNull();
  });

  test('imports the live legacy side widths without altering legacy storage', () => {
    localStorage.setItem('prokopai_sessions_panel_width', '{"width":300}');
    localStorage.setItem('prokopai_workbench_width_px', '620');
    expect(loadDockSizes()).toEqual({ left: 300, right: 620, bottom: 336 });
    expect(localStorage.getItem('prokopai_workbench_width_px')).toBe('620');
    expect(localStorage.getItem(DOCK_STORAGE_KEY)).toBeNull();
  });

  test('valid new preferences take precedence over legacy widths', () => {
    localStorage.setItem('prokopai_sessions_panel_width', '{"width":300}');
    localStorage.setItem(DOCK_STORAGE_KEY, '{"version":1,"sizes":{"left":400,"right":650,"bottom":450}}');
    expect(loadDockSizes()).toEqual({ left: 400, right: 650, bottom: 450 });
  });

  test.each(['null', '[]', '{', '{"version":2,"sizes":{"left":400}}'])('handles malformed or unsupported preferences: %s', (raw) => {
    localStorage.setItem(DOCK_STORAGE_KEY, raw);
    expect(loadDockSizes()).toEqual({ left: 256, right: 540, bottom: 336 });
  });

  test('validates individual stored dimensions', () => {
    localStorage.setItem(DOCK_STORAGE_KEY, '{"version":1,"sizes":{"left":null,"right":"600","bottom":9000}}');
    expect(loadDockSizes()).toEqual({ left: 256, right: 540, bottom: 800 });
  });

  test('isolates a malformed legacy preference from the other region', () => {
    localStorage.setItem('prokopai_sessions_panel_width', '{');
    localStorage.setItem('prokopai_workbench_width_px', '640');
    expect(loadDockSizes()).toEqual({ left: 256, right: 640, bottom: 336 });
  });

  test('remains usable when browser storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('unavailable'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable'); });
    expect(loadDockSizes()).toEqual({ left: 256, right: 540, bottom: 336 });
    useDockStore.getState().setDockSize('bottom', 400);
    expect(useDockStore.getState().docks.bottom.size).toBe(400);
  });
});
