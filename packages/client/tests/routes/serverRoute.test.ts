import { describe, expect, it } from 'vitest';
import { Route } from '@/routes/server/$serverId';

describe('server route loader', () => {
  it('loads bootstrap data once instead of on every navigation within the server', () => {
    expect(Route.options.staleTime).toBe(Infinity);
    expect(Route.options.shouldReload).toBe(false);
  });
});
