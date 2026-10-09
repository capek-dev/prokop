import { act, render } from '@testing-library/react';
import { useContext } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const poolControl = vi.hoisted(() => ({
  instances: [] as Array<{
    poolOptions: { poolSize: number; totalASTLRUCacheSize: number };
    renderOptions: { theme: unknown };
    resolveInit: () => void;
    rejectInit: (error: Error) => void;
    working: boolean;
    initialized: boolean;
    terminate: Mock<() => void>;
  }>,
}));

vi.mock('@pierre/diffs/worker', () => ({
  WorkerPoolManager: class {
    private entry: (typeof poolControl.instances)[number];
    private initPromise: Promise<void>;
    constructor(poolOptions: never, renderOptions: never) {
      let resolveInit!: () => void;
      let rejectInit!: (error: Error) => void;
      this.initPromise = new Promise<void>((resolve, reject) => {
        resolveInit = resolve;
        rejectInit = reject;
      });
      this.entry = {
        poolOptions,
        renderOptions,
        resolveInit: () => {
          this.entry.initialized = true;
          resolveInit();
        },
        rejectInit,
        working: true,
        initialized: false,
        terminate: vi.fn<() => void>(),
      };
      poolControl.instances.push(this.entry);
    }
    initialize() { return this.initPromise; }
    isInitialized() { return this.entry.initialized; }
    isWorkingPool() { return this.entry.working; }
    terminate() { this.entry.terminate(); }
  },
}));

vi.mock('@pierre/diffs/react', async () => {
  const { createContext } = await import('react');
  return { WorkerPoolContext: createContext<unknown>(undefined) };
});

import { WorkerPoolContext } from '@pierre/diffs/react';
import { PierreWorkerPoolProvider } from '@/components/providers/PierreWorkerPoolProvider';
import {
  getPierreWorkerPool,
  pierreWorkerPoolSize,
  resetPierreWorkerPoolForTests,
  startPierreWorkerPool,
} from '@/lib/pierreWorkerPool';
import { PIERRE_THEME_PAIR } from '@/lib/pierreDiffsTheme';
import { pierreCacheKey } from '@/lib/pierreCacheKey';

function PoolProbe() {
  const pool = useContext(WorkerPoolContext);
  return <div data-testid="probe">{pool ? 'pool' : 'main-thread'}</div>;
}

const workerFactory = () => ({}) as Worker;

describe('pierreWorkerPool', () => {
  beforeEach(() => {
    poolControl.instances.length = 0;
    vi.stubGlobal('Worker', class {});
  });

  afterEach(() => {
    resetPierreWorkerPoolForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sizes the pool to half the cores, clamped to 2..4', () => {
    expect(pierreWorkerPoolSize(undefined)).toBe(2);
    expect(pierreWorkerPoolSize(1)).toBe(2);
    expect(pierreWorkerPoolSize(6)).toBe(3);
    expect(pierreWorkerPoolSize(16)).toBe(4);
  });

  it('publishes the pool only after it initializes, with the shared theme pair', async () => {
    const { getByTestId } = render(
      <PierreWorkerPoolProvider>
        <PoolProbe />
      </PierreWorkerPoolProvider>,
    );
    await startPierreWorkerPool(workerFactory);
    expect(poolControl.instances).toHaveLength(1);
    expect(poolControl.instances[0].renderOptions.theme).toEqual(PIERRE_THEME_PAIR);
    expect(getByTestId('probe').textContent).toBe('main-thread');

    await act(async () => {
      poolControl.instances[0].resolveInit();
    });
    expect(getByTestId('probe').textContent).toBe('pool');
  });

  it('starts once', async () => {
    await startPierreWorkerPool(workerFactory);
    await startPierreWorkerPool(workerFactory);
    expect(poolControl.instances).toHaveLength(1);
  });

  it('stays on the main thread when workers fail to start', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await startPierreWorkerPool(workerFactory);
    await act(async () => {
      poolControl.instances[0].rejectInit(new Error('worker boot failed'));
    });
    expect(getPierreWorkerPool()).toBeUndefined();
    expect(poolControl.instances[0].terminate).toHaveBeenCalled();
  });

  it('stays on the main thread when the pool reports itself not working', async () => {
    await startPierreWorkerPool(workerFactory);
    poolControl.instances[0].working = false;
    await act(async () => {
      poolControl.instances[0].resolveInit();
    });
    expect(getPierreWorkerPool()).toBeUndefined();
  });

  it('does nothing where Web Workers are unavailable', async () => {
    vi.stubGlobal('Worker', undefined);
    await startPierreWorkerPool(workerFactory);
    expect(poolControl.instances).toHaveLength(0);
  });
});

describe('pierreCacheKey', () => {
  it('is stable for equal contents and changes with contents or scope', () => {
    expect(pierreCacheKey('code:a.ts', 'const a = 1;')).toBe(pierreCacheKey('code:a.ts', 'const a = 1;'));
    expect(pierreCacheKey('code:a.ts', 'const a = 1;')).not.toBe(pierreCacheKey('code:a.ts', 'const a = 2;'));
    expect(pierreCacheKey('code:a.ts', 'x')).not.toBe(pierreCacheKey('code:b.ts', 'x'));
  });
});
