import { describe, expect, test } from 'vitest';
import type { SavedServer } from '@prokopai/sdk';
import { resolveStartup, selectStartupServer } from '@/lib/serverStartup';

const servers: SavedServer[] = [
  {
    id: 'home',
    name: 'Home',
    url: 'localhost:8742',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'work',
    name: 'Work',
    url: 'work.example',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

describe('selectStartupServer', () => {
  test('does not select an empty registry', () => {
    expect(selectStartupServer([], null, false)).toBeNull();
  });

  test('selects the only saved server', () => {
    expect(selectStartupServer([servers[0]], null, false)).toBe(servers[0]);
  });

  test('selects the remembered server from multiple entries', () => {
    expect(selectStartupServer(servers, 'work', false)).toBe(servers[1]);
  });

  test('shows selection when the remembered server is stale', () => {
    expect(selectStartupServer(servers, 'missing', false)).toBeNull();
  });

  test('explicit selection always suppresses automatic routing', () => {
    expect(selectStartupServer([servers[0]], 'home', true)).toBeNull();
    expect(selectStartupServer(servers, 'work', true)).toBeNull();
  });
});

describe('resolveStartup', () => {
  test('shows startup before hydration', () => {
    expect(resolveStartup([], null, false, false, false)).toEqual({
      destination: null,
      showStartup: true,
    });
  });

  test('shows startup instead of selection before automatic navigation', () => {
    expect(resolveStartup([servers[0]], null, false, true, false)).toEqual({
      destination: servers[0],
      showStartup: true,
    });
    expect(resolveStartup(servers, 'work', false, true, false)).toEqual({
      destination: servers[1],
      showStartup: true,
    });
  });

  test('shows startup while discovering an empty registry', () => {
    expect(resolveStartup([], null, false, true, true)).toEqual({
      destination: null,
      showStartup: true,
    });
  });

  test('shows selection when discovery finds no server', () => {
    expect(resolveStartup([], null, false, true, false)).toEqual({
      destination: null,
      showStartup: false,
    });
  });

  test('explicit selection remains visible', () => {
    expect(resolveStartup([servers[0]], 'home', true, true, false)).toEqual({
      destination: null,
      showStartup: false,
    });
  });
});
