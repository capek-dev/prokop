import { describe, expect, it } from 'vitest';
import type { ManagedWorktree, Session } from '@prokopai/sdk';
import { groupSessionsByCheckout, MAIN_CHECKOUT_NAME } from '@/lib/sessionCheckoutGroups';
import { worktreeHue } from '@/lib/worktreeTone';

function session(id: string, workspaceRootId: string | null, worktreeName?: string): Session {
  return {
    id,
    workspaceRootId,
    worktree: worktreeName ? { id: workspaceRootId, name: worktreeName, branch: null, path: `/wt/${worktreeName}`, state: 'available' } : null,
  } as unknown as Session;
}

const worktree = (id: string, name: string, state: ManagedWorktree['state'] = 'available') =>
  ({ id, name, state, path: `/wt/${name}`, branch: name }) as ManagedWorktree;

describe('groupSessionsByCheckout', () => {
  it('puts the main checkout first and worktrees by their latest session', () => {
    const groups = groupSessionsByCheckout(
      [session('a', 'w2'), session('b', null), session('c', 'w1'), session('d', 'w2')],
      [worktree('w1', 'auth-fix'), worktree('w2', 'store-refactor')],
    );
    expect(groups.map((g) => [g.name, g.sessions.map((s) => s.id)])).toEqual([
      [MAIN_CHECKOUT_NAME, ['b']],
      ['store-refactor', ['a', 'd']],
      ['auth-fix', ['c']],
    ]);
  });

  it('names a worktree from the session binding when it is no longer listed, and flags it unavailable', () => {
    const [group] = groupSessionsByCheckout([session('a', 'gone', 'old-branch')], []);
    expect(group).toMatchObject({ worktreeId: 'gone', name: 'old-branch', available: true });
    const [removed] = groupSessionsByCheckout([session('a', 'w1')], [worktree('w1', 'x', 'missing' as ManagedWorktree['state'])]);
    expect(removed.available).toBe(false);
  });

  it('omits an empty main checkout group', () => {
    expect(groupSessionsByCheckout([session('a', 'w1')], [worktree('w1', 'x')]).map((g) => g.worktreeId)).toEqual(['w1']);
  });
});

describe('worktreeHue', () => {
  it('is stable per worktree and avoids status hues', () => {
    expect(worktreeHue('w1')).toBe(worktreeHue('w1'));
    for (const id of ['a', 'b', 'c', 'w1', 'w2', '7b51eec5']) {
      const hue = worktreeHue(id);
      expect(hue < 20 || hue > 75).toBe(true); // not red/amber
      expect(hue < 120 || hue > 155).toBe(true); // not green
    }
  });
});
