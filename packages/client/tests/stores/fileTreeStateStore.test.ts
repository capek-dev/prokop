import { describe, expect, test, beforeEach } from 'vitest';
import { mockLocalStorage } from '../helpers';
import {
  useFileTreeStateStore,
  fileTreeExpandedPaths,
} from '@/stores/fileTreeStateStore';

describe('fileTreeStateStore', () => {
  mockLocalStorage();

  beforeEach(() => {
    useFileTreeStateStore.setState({ byKey: {} });
  });

  test('recordExpanded stores and fileTreeExpandedPaths reads', () => {
    useFileTreeStateStore.getState().recordExpanded('ws1:', ['src/', 'src/nested/']);
    expect(fileTreeExpandedPaths('ws1:')).toEqual(['src/', 'src/nested/']);
  });

  test('keys are independent per workspace+root identity', () => {
    const store = useFileTreeStateStore.getState();
    store.recordExpanded('ws1:', ['a/']);
    store.recordExpanded('ws2:extra:', ['b/']);
    expect(fileTreeExpandedPaths('ws1:')).toEqual(['a/']);
    expect(fileTreeExpandedPaths('ws2:extra:')).toEqual(['b/']);
    expect(fileTreeExpandedPaths('missing')).toEqual([]);
  });

  test('recording an identical list still replaces the entry (dedup lives in the adapter)', () => {
    const { recordExpanded } = useFileTreeStateStore.getState();
    recordExpanded('k', ['x/']);
    recordExpanded('k', ['x/']);
    expect(fileTreeExpandedPaths('k')).toEqual(['x/']);
  });

  test('re-recording a changed list replaces it', () => {
    const { recordExpanded } = useFileTreeStateStore.getState();
    recordExpanded('k', ['x/']);
    recordExpanded('k', ['y/']);
    expect(fileTreeExpandedPaths('k')).toEqual(['y/']);
  });
});
