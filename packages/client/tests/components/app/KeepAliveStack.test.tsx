import { describe, expect, test } from 'vitest';
import { createRef, forwardRef, useEffect, useImperativeHandle } from 'react';
import { cleanup, render } from '@testing-library/react';
import { KeepAliveStack, retainKeepAliveEntries } from '@/components/app/KeepAliveStack';

describe('retainKeepAliveEntries', () => {
  const entry = (key: string, usedAt: number) => ({ key, value: key, usedAt });

  test('appends new keys in first-seen order', () => {
    const next = retainKeepAliveEntries([entry('a', 1)], { key: 'b', value: 'b' }, 3);
    expect(next.map((e) => e.key)).toEqual(['a', 'b']);
    expect(next[1].usedAt).toBe(2);
  });

  test('reactivating keeps position and refreshes the value', () => {
    const next = retainKeepAliveEntries([entry('a', 1), entry('b', 2)], { key: 'a', value: 'a2' }, 3);
    expect(next.map((e) => [e.key, e.value, e.usedAt])).toEqual([['a', 'a2', 3], ['b', 'b', 2]]);
  });

  test('evicts the least recently used entry past the limit', () => {
    const next = retainKeepAliveEntries([entry('a', 3), entry('b', 1), entry('c', 2)], { key: 'd', value: 'd' }, 3);
    expect(next.map((e) => e.key)).toEqual(['a', 'c', 'd']);
  });
});

describe('KeepAliveStack', () => {
  test('keeps recent subtrees mounted, hides inactive ones, and unmounts evicted ones', () => {
    const mounts: string[] = [];
    const unmounts: string[] = [];
    function Probe({ id }: { id: string }) {
      useEffect(() => {
        mounts.push(id);
        return () => { unmounts.push(id); };
      }, [id]);
      return <span data-probe={id}>{id}</span>;
    }
    const view = (key: string) => (
      <KeepAliveStack active={{ key, value: key }} limit={2}>
        {(value) => <Probe id={value} />}
      </KeepAliveStack>
    );
    const { container, rerender } = render(view('a'));
    const show = (key: string) => rerender(view(key));

    show('b');
    show('a');
    expect(mounts).toEqual(['a', 'b']);
    expect(unmounts).toEqual([]);
    const entries = [...container.querySelectorAll<HTMLElement>('[data-keep-alive-entry]')];
    expect(entries.map((el) => el.dataset.keepAliveEntry)).toEqual(['active', 'hidden']);
    expect(entries[1].style.visibility).toBe('hidden');
    expect(entries[1].hasAttribute('inert')).toBe(true);

    // 'c' evicts 'b', the least recently used.
    show('c');
    expect(unmounts).toEqual(['b']);
    expect(container.querySelector('[data-probe="a"]')).not.toBeNull();
    cleanup();
  });

  test('a ref passed only to the active entry follows switches both ways', () => {
    const Handle = forwardRef<{ id: string }, { id: string }>(({ id }, ref) => {
      useImperativeHandle(ref, () => ({ id }), [id]);
      return null;
    });
    const ref = createRef<{ id: string }>();
    const view = (key: string) => (
      <KeepAliveStack active={{ key, value: key }}>
        {(value, active) => <Handle ref={active ? ref : undefined} id={value} />}
      </KeepAliveStack>
    );
    const { rerender } = render(view('a'));
    expect(ref.current?.id).toBe('a');
    rerender(view('b'));
    expect(ref.current?.id).toBe('b');
    rerender(view('a'));
    expect(ref.current?.id).toBe('a');
    cleanup();
  });
});
