import { beforeEach } from 'vitest';

export function setupLocalStorage() {
  const store: Record<string, string> = {};

  beforeEach(() => {
    Object.keys(store).forEach((key) => delete store[key]);
  });

  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      Object.keys(store).forEach((key) => delete store[key]);
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (_index: number) => null,
  } as Storage;
}

export function mockLocalStorage() {
  const storage = setupLocalStorage();

  // Set up localStorage on globalThis
  (globalThis as unknown as { localStorage: Storage }).localStorage = storage;

  // Also set up window for modules that check `typeof window`
  if (typeof globalThis.window === 'undefined') {
    (globalThis as unknown as { window: object }).window = {};
  }
  (globalThis.window as unknown as { localStorage: Storage }).localStorage = storage;

  return storage;
}

/** Disconnected Git status feed members for partial `ProkopaiClient` fakes. */
export const gitStatusFeedStub = {
  connected: false,
  on: () => {},
  off: () => {},
  git: { subscribeStatus: () => {}, unsubscribeStatus: () => {}, refreshStatus: () => {} },
};
